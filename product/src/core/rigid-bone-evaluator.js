import {
  bonePoseDeltaForKeyArt,
  evaluateBoneFk,
  interpolateBonePoseDeltas,
} from "./bone-fk-evaluator.js";
import {
  invertAffine,
  multiplyAffine,
  transformPoint,
  worldTransformMatrix,
} from "./transforms.js";
import {
  createInterpolatedWarpEvaluationStages,
  createWarpEvaluationStages,
  evaluateWarpStages,
  WarpDeformerEvaluationError,
} from "./warp-deformer-evaluator.js";
import { rigidBoneBindingForTarget } from "../model/rigid-bone-binding-validation.js";

export class RigidBoneEvaluationError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "RigidBoneEvaluationError";
    this.code = code;
    this.details = details;
  }
}

function documentWarpSpace(project, deformerId) {
  const fromDeformerLocal = worldTransformMatrix(project, deformerId);
  return {
    toDeformerLocal: invertAffine(fromDeformerLocal),
    fromDeformerLocal,
  };
}

function rootParentId(project, boneId) {
  const visited = new Set();
  let node = project.scene?.nodes?.[boneId];
  while (node?.kind === "bone") {
    if (visited.has(node.id)) throw new RigidBoneEvaluationError(
      "Bone hierarchy contains a cycle.",
      "BONE_HIERARCHY_CYCLE",
      { boneId },
    );
    visited.add(node.id);
    const parent = project.scene.nodes[node.parentId];
    if (!parent) throw new RigidBoneEvaluationError(
      "Bone hierarchy references a missing parent.",
      "BONE_PARENT_INVALID",
      { boneId, parentNodeId: node.parentId },
    );
    if (parent.kind !== "bone") return parent.id;
    node = parent;
  }
  throw new RigidBoneEvaluationError(
    "Rigid binding references a missing BoneNode.",
    "BONE_NODE_MISSING",
    { boneId },
  );
}

function endpointStages(project, boneId, keyArtId) {
  const resolved = createWarpEvaluationStages(project, boneId, keyArtId, {
    spaceForDeformer: (deformerId) => documentWarpSpace(project, deformerId),
  });
  if (resolved.diagnostics.length) {
    const entry = resolved.diagnostics[0];
    throw new RigidBoneEvaluationError(entry.message, entry.code, {
      ...entry,
      boneId,
    });
  }
  return resolved.stages;
}

function morphStages(project, boneId, fromKeyArtId, toKeyArtId, geometryWeight) {
  return createInterpolatedWarpEvaluationStages(
    project,
    boneId,
    boneId,
    fromKeyArtId,
    toKeyArtId,
    geometryWeight,
    { spaceForDeformer: (deformerId) => documentWarpSpace(project, deformerId) },
  );
}

function projectedWarpPoint(project, stageForBone) {
  const cache = new Map();
  return (point, { boneId }) => {
    let entry = cache.get(boneId);
    if (!entry) {
      entry = {
        rigToDocument: worldTransformMatrix(project, rootParentId(project, boneId)),
        stages: stageForBone(boneId),
      };
      cache.set(boneId, entry);
    }
    const documentPoint = transformPoint(entry.rigToDocument, point);
    if (!entry.stages.length) return documentPoint;
    const projected = evaluateWarpStages(
      [documentPoint.x, documentPoint.y],
      entry.stages,
    );
    return { x: projected[0], y: projected[1] };
  };
}

function evaluationDiagnostic(error, binding = null) {
  const code = error instanceof WarpDeformerEvaluationError
    ? error.code : error?.code || "BONE_POSE_INVALID";
  return {
    code,
    boneId: error?.details?.boneId || binding?.boneId || null,
    bindingId: binding?.id || null,
    message: error?.message || "Rigid Bone evaluation failed.",
    ...(error?.details ? { details: error.details } : {}),
  };
}

function fkEndpoint(project, keyArtId) {
  try {
    return evaluateBoneFk(project, keyArtId, {
      projectPoint: projectedWarpPoint(
        project,
        (boneId) => endpointStages(project, boneId, keyArtId),
      ),
    });
  } catch (error) {
    return { poses: [], diagnostics: [evaluationDiagnostic(error)] };
  }
}

function fkMorph(project, fromKeyArtId, toKeyArtId, geometryWeight) {
  try {
    return evaluateBoneFk(project, fromKeyArtId, {
      projectPoint: projectedWarpPoint(
        project,
        (boneId) => morphStages(
          project, boneId, fromKeyArtId, toKeyArtId, geometryWeight,
        ),
      ),
      poseForBone: (bone) => interpolateBonePoseDeltas(
        bonePoseDeltaForKeyArt(project, bone.id, fromKeyArtId),
        bonePoseDeltaForKeyArt(project, bone.id, toKeyArtId),
        geometryWeight,
      ),
    });
  } catch (error) {
    return { poses: [], diagnostics: [evaluationDiagnostic(error)] };
  }
}

function applyPose(mesh, targetWorldTransform, binding, evaluation) {
  if (evaluation.diagnostics.length) {
    return {
      mesh,
      diagnostics: evaluation.diagnostics.map((entry) => ({
        ...entry,
        boneId: entry.boneId || binding.boneId,
        bindingId: binding.id,
      })),
    };
  }
  const pose = evaluation.poses.find((entry) => entry.boneId === binding.boneId);
  if (!pose) return {
    mesh,
    diagnostics: [evaluationDiagnostic(new RigidBoneEvaluationError(
      "Rigid binding Bone was not produced by FK evaluation.",
      "BONE_NODE_MISSING",
      { boneId: binding.boneId },
    ), binding)],
  };
  const localSkinMatrix = multiplyAffine(
    multiplyAffine(invertAffine(targetWorldTransform), pose.skinMatrix),
    targetWorldTransform,
  );
  const positions = [];
  for (let index = 0; index < mesh.positions.length; index += 2) {
    const point = transformPoint(localSkinMatrix, {
      x: mesh.positions[index],
      y: mesh.positions[index + 1],
    });
    positions.push(point.x, point.y);
  }
  return { mesh: { ...mesh, positions }, diagnostics: [] };
}

export function evaluateEndpointRigidBoneMesh(project, {
  targetNodeId,
  keyArtId,
  mesh,
  targetWorldTransform,
}) {
  const binding = rigidBoneBindingForTarget(project, targetNodeId);
  if (!binding) return { mesh, diagnostics: [] };
  return applyPose(mesh, targetWorldTransform, binding, fkEndpoint(project, keyArtId));
}

export function evaluateMorphRigidBoneMesh(project, {
  fromTargetNodeId,
  toTargetNodeId,
  fromKeyArtId,
  toKeyArtId,
  geometryWeight,
  mesh,
  targetWorldTransform,
}) {
  const fromBinding = rigidBoneBindingForTarget(project, fromTargetNodeId);
  const toBinding = rigidBoneBindingForTarget(project, toTargetNodeId);
  if (!fromBinding && !toBinding) return { mesh, diagnostics: [] };
  if (!fromBinding || !toBinding || fromBinding.boneId !== toBinding.boneId) {
    return {
      mesh,
      diagnostics: [evaluationDiagnostic(new RigidBoneEvaluationError(
        "Morph endpoints must use compatible enabled rigid Bone bindings.",
        "BONE_TRANSITION_INCOMPATIBLE",
        {
          fromBindingId: fromBinding?.id || null,
          toBindingId: toBinding?.id || null,
          fromBoneId: fromBinding?.boneId || null,
          toBoneId: toBinding?.boneId || null,
        },
      ))],
    };
  }
  return applyPose(
    mesh,
    targetWorldTransform,
    fromBinding,
    fkMorph(project, fromKeyArtId, toKeyArtId, geometryWeight),
  );
}
