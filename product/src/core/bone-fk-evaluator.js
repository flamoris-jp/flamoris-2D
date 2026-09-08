import { identityBonePoseDelta } from "../model/bone.js";
import {
  invertAffine,
  multiplyAffine,
  transformPoint,
} from "./transforms.js";

const IDENTITY_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);
const TWO_PI = Math.PI * 2;

export class BoneEvaluationError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "BoneEvaluationError";
    this.code = code;
    this.details = details;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finiteDelta(delta) {
  return delta && Number.isFinite(delta.x) && Number.isFinite(delta.y) &&
    Number.isFinite(delta.rotation);
}

function localMatrix(transform) {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return [cosine, sine, -sine, cosine, transform.x, transform.y];
}

function projectedPoint(projectPoint, point, bone, role) {
  const projected = projectPoint({ ...point }, { boneId: bone.id, role });
  if (!finitePoint(projected)) {
    throw new BoneEvaluationError(
      "Bone bind-frame projection must produce finite points.",
      "BONE_PROJECTED_FRAME_DEGENERATE",
      { boneId: bone.id, role },
    );
  }
  return projected;
}

export function projectBoneBindFrame(
  bone,
  globalBindMatrix,
  projectPoint = (point) => point,
) {
  const head = projectedPoint(
    projectPoint,
    transformPoint(globalBindMatrix, { x: 0, y: 0 }),
    bone,
    "head",
  );
  const tip = projectedPoint(
    projectPoint,
    transformPoint(globalBindMatrix, { x: bone.length, y: 0 }),
    bone,
    "tip",
  );
  const normal = projectedPoint(
    projectPoint,
    transformPoint(globalBindMatrix, { x: 0, y: bone.length }),
    bone,
    "normal",
  );
  const matrix = [
    (tip.x - head.x) / bone.length,
    (tip.y - head.y) / bone.length,
    (normal.x - head.x) / bone.length,
    (normal.y - head.y) / bone.length,
    head.x,
    head.y,
  ];
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!matrix.every(Number.isFinite) || Math.abs(determinant) < 1e-12) {
    throw new BoneEvaluationError(
      "Projected Bone bind frame is degenerate.",
      "BONE_PROJECTED_FRAME_DEGENERATE",
      { boneId: bone.id },
    );
  }
  return matrix;
}

export function boneEvaluationOrder(project) {
  const bones = [...(project.rig?.bones || [])]
    .sort((left, right) => compareText(left.id, right.id));
  const nodes = project.scene?.nodes || {};
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  const state = new Map();
  const order = [];
  const visit = (bone) => {
    if (state.get(bone.id) === "visited") return;
    if (state.get(bone.id) === "visiting") {
      throw new BoneEvaluationError(
        "Bone hierarchy contains a cycle.",
        "BONE_HIERARCHY_CYCLE",
        { boneId: bone.id },
      );
    }
    state.set(bone.id, "visiting");
    const parentNode = nodes[bone.parentNodeId];
    if (!parentNode) {
      throw new BoneEvaluationError(
        "Bone parent node does not exist.",
        "BONE_PARENT_INVALID",
        { boneId: bone.id, parentNodeId: bone.parentNodeId },
      );
    }
    if (parentNode.kind === "bone") {
      const parentBone = byId.get(parentNode.id);
      if (!parentBone) {
        throw new BoneEvaluationError(
          "Bone parent node has no matching rig Bone.",
          "BONE_PARENT_INVALID",
          { boneId: bone.id, parentNodeId: bone.parentNodeId },
        );
      }
      visit(parentBone);
    }
    state.set(bone.id, "visited");
    order.push(bone);
  };
  for (const bone of bones) visit(bone);
  return order;
}

export function bonePoseDeltaForKeyArt(project, boneId, keyArtId) {
  const keyform = (project.rig?.bonePoseKeyforms || []).find((entry) =>
    entry.boneId === boneId && entry.keyArtId === keyArtId);
  return keyform
    ? { ...keyform.localDelta }
    : identityBonePoseDelta();
}

function shortestAngleDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

export function interpolateBonePoseDeltas(from, to, amount) {
  if (!finiteDelta(from) || !finiteDelta(to) ||
    !Number.isFinite(amount) || amount < 0 || amount > 1) {
    throw new BoneEvaluationError(
      "Bone pose interpolation requires finite deltas and a weight from zero to one.",
      "BONE_POSE_INVALID",
    );
  }
  if (amount === 0) return { ...from };
  if (amount === 1) return { ...to };
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    rotation: from.rotation + shortestAngleDelta(from.rotation, to.rotation) * amount,
  };
}

function diagnostic(error, boneId = null) {
  return {
    code: error?.code || "BONE_POSE_INVALID",
    boneId: error?.details?.boneId || boneId,
    message: error?.message || "Bone evaluation failed.",
    ...(error?.details ? { details: error.details } : {}),
  };
}

/**
 * Evaluates the Project Bone hierarchy in the post-Warp, pre-world-transform
 * rig space. projectPoint is the explicit Phase 6 -> Phase 7 boundary: Phase
 * 7-2 can supply the already-evaluated ancestor Warp mapping without changing
 * FK or introducing a second Transition evaluator.
 */
export function evaluateBoneFk(project, keyArtId, {
  projectPoint = (point) => point,
  poseForBone = null,
} = {}) {
  let order;
  try {
    order = boneEvaluationOrder(project);
  } catch (error) {
    return { poses: [], diagnostics: [diagnostic(error)] };
  }
  const nodes = project.scene?.nodes || {};
  const globalUnprojectedBind = new Map();
  const projectedBind = new Map();
  const projectedPose = new Map();
  const poses = [];
  const diagnostics = [];
  const failed = new Set();

  for (const bone of order) {
    const parentNode = nodes[bone.parentNodeId];
    const parentBoneId = parentNode?.kind === "bone" ? parentNode.id : null;
    if (parentBoneId && failed.has(parentBoneId)) {
      failed.add(bone.id);
      diagnostics.push({
        code: "BONE_PARENT_INVALID",
        boneId: bone.id,
        message: "Bone parent could not be evaluated.",
        details: { parentBoneId },
      });
      continue;
    }
    try {
      const localBind = localMatrix(bone.restLocalTransform);
      const unprojectedBind = parentBoneId
        ? multiplyAffine(globalUnprojectedBind.get(parentBoneId), localBind)
        : localBind;
      globalUnprojectedBind.set(bone.id, unprojectedBind);
      const bind = projectBoneBindFrame(bone, unprojectedBind, projectPoint);
      projectedBind.set(bone.id, bind);

      const resolvedDelta = poseForBone
        ? poseForBone(bone, keyArtId)
        : bonePoseDeltaForKeyArt(project, bone.id, keyArtId);
      if (!finiteDelta(resolvedDelta)) {
        throw new BoneEvaluationError(
          "Bone pose delta must contain finite x, y, and rotation.",
          "BONE_POSE_INVALID",
          { boneId: bone.id, keyArtId },
        );
      }
      const delta = bone.enabled ? resolvedDelta : identityBonePoseDelta();
      const deltaMatrix = localMatrix(delta);
      const pose = parentBoneId
        ? multiplyAffine(
          multiplyAffine(
            multiplyAffine(
              projectedPose.get(parentBoneId),
              invertAffine(projectedBind.get(parentBoneId)),
            ),
            bind,
          ),
          deltaMatrix,
        )
        : multiplyAffine(bind, deltaMatrix);
      projectedPose.set(bone.id, pose);
      const skinMatrix = multiplyAffine(pose, invertAffine(bind));
      poses.push({
        boneId: bone.id,
        parentBoneId,
        bindMatrix: [...bind],
        poseMatrix: [...pose],
        skinMatrix,
        head: transformPoint(pose, { x: 0, y: 0 }),
        tip: transformPoint(pose, { x: bone.length, y: 0 }),
      });
    } catch (error) {
      failed.add(bone.id);
      diagnostics.push(diagnostic(error, bone.id));
    }
  }

  poses.sort((left, right) => compareText(left.boneId, right.boneId));
  diagnostics.sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.boneId || "", right.boneId || ""));
  return { poses, diagnostics };
}

export function identityBoneEvaluation() {
  return {
    bindMatrix: [...IDENTITY_AFFINE],
    poseMatrix: [...IDENTITY_AFFINE],
    skinMatrix: [...IDENTITY_AFFINE],
  };
}
