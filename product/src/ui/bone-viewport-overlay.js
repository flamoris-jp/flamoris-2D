import { imageToScreen } from "../mesh.js";
import { bonePoseDeltaForKeyArt } from "../core/bone-fk-evaluator.js";
import {
  createEndpointBoneWarpEvaluationStages,
  evaluateEndpointProjectedBoneFk,
} from "../core/rigid-bone-evaluator.js";
import {
  invertWarpStages,
  resolveWarpEvaluationStages,
} from "../core/warp-deformer-evaluator.js";
import {
  invertAffine,
  transformPoint,
  worldTransformMatrix,
} from "../core/transforms.js";
import { boneSceneTransform, identityBonePoseDelta } from "../model/bone.js";
import { cloneProject } from "../model/project.js";

function distanceToSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (from.x + dx * amount), point.y - (from.y + dy * amount));
}

export function projectBoneOverlay({ project, authoring, view }) {
  if (!project || !authoring || !view) return { bones: [], ghosts: [], diagnostics: [] };
  let evaluationProject = project;
  if (authoring.mode === "edit" && authoring.dragging && authoring.selectedBoneId) {
    evaluationProject = cloneProject(project);
    const bone = evaluationProject.rig.bones.find((entry) => entry.id === authoring.selectedBoneId);
    if (bone) {
      bone.restLocalTransform = {
        x: authoring.editableValue.x,
        y: authoring.editableValue.y,
        rotation: authoring.editableValue.rotation,
      };
      bone.length = authoring.editableValue.length;
      evaluationProject.scene.nodes[bone.id].transform = boneSceneTransform(bone.restLocalTransform);
    }
  }
  const poseForBone = authoring.mode === "pose" && authoring.dragging
    ? (bone) => bone.id === authoring.selectedBoneId
      ? cloneProject(authoring.editableValue)
      : bonePoseDeltaForKeyArt(evaluationProject, bone.id, authoring.activeKeyArt?.id)
    : authoring.mode === "edit" ? () => ({ x: 0, y: 0, rotation: 0 }) : null;
  const evaluation = evaluateEndpointProjectedBoneFk(
    evaluationProject,
    authoring.activeKeyArt?.id || null,
    { poseForBone },
  );
  const screenPose = new Map(evaluation.poses.map((pose) => [pose.boneId, {
    head: imageToScreen(pose.head.x, pose.head.y, view),
    tip: imageToScreen(pose.tip.x, pose.tip.y, view),
  }]));
  const bones = evaluation.poses.map((pose) => {
    const screen = screenPose.get(pose.boneId);
    const dx = screen.tip.x - screen.head.x;
    const dy = screen.tip.y - screen.head.y;
    const length = Math.max(1e-9, Math.hypot(dx, dy));
    const normal = { x: -dy / length, y: dx / length };
    const width = Math.min(9, Math.max(4, length * 0.12));
    return {
      boneId: pose.boneId,
      parentBoneId: pose.parentBoneId,
      head: screen.head,
      tip: screen.tip,
      body: [
        screen.head,
        { x: screen.head.x + dx * 0.22 + normal.x * width, y: screen.head.y + dy * 0.22 + normal.y * width },
        screen.tip,
        { x: screen.head.x + dx * 0.22 - normal.x * width, y: screen.head.y + dy * 0.22 - normal.y * width },
      ],
      parentLink: pose.parentBoneId ? {
        from: screenPose.get(pose.parentBoneId)?.tip || screen.head,
        to: screen.head,
      } : null,
      rotationHandle: {
        x: screen.head.x + normal.x * 28,
        y: screen.head.y + normal.y * 28,
      },
      selected: pose.boneId === authoring.selectedBoneId,
      hovered: pose.boneId === authoring.hoverBoneId,
    };
  });
  let ghosts = [];
  if (authoring.ghostKeyArtId && authoring.ghostKeyArtId !== authoring.activeKeyArt?.id) {
    const ghost = evaluateEndpointProjectedBoneFk(evaluationProject, authoring.ghostKeyArtId);
    ghosts = ghost.poses.map((pose) => ({
      boneId: pose.boneId,
      head: imageToScreen(pose.head.x, pose.head.y, view),
      tip: imageToScreen(pose.tip.x, pose.tip.y, view),
    }));
  }
  return { bones, ghosts, diagnostics: evaluation.diagnostics };
}

function authoringDiagnostic(error, boneId) {
  return {
    code: error?.code || "BONE_AUTHORING_SPACE_INVALID",
    boneId: error?.details?.boneId || boneId,
    message: error?.message || "Bone authoring space could not be resolved.",
    ...(error?.details ? { details: error.details } : {}),
  };
}

/**
 * Freezes the selected Bone's document -> authoring-local projection for one
 * gesture. Rest edits invert the canonical ancestor Warp stages and then the
 * authoritative Scene parent transform. Pose edits use the projected FK frame
 * immediately before the selected Bone's localDelta.
 */
export function createBoneAuthoringSpace({ project, authoring, boneId }) {
  try {
    const bone = project.rig?.bones?.find((entry) => entry.id === boneId);
    const node = project.scene?.nodes?.[boneId];
    if (!bone || !node || node.kind !== "bone") {
      throw Object.assign(new Error("Bone authoring requires a matching BoneNode."), {
        code: "BONE_NODE_MISSING",
        details: { boneId },
      });
    }
    if (authoring.mode === "edit") {
      const rawStages = createEndpointBoneWarpEvaluationStages(
        project,
        boneId,
        authoring.activeKeyArt?.id || null,
      );
      const stages = resolveWarpEvaluationStages(rawStages);
      const toParentLocal = invertAffine(worldTransformMatrix(project, node.parentId));
      return {
        diagnostics: [],
        toLocal(documentPoint) {
          return transformPoint(
            toParentLocal,
            invertWarpStages(documentPoint, stages),
          );
        },
      };
    }
    if (!authoring.activeKeyArt?.id) {
      throw Object.assign(new Error("Select an active Key Art before posing a Bone."), {
        code: "BONE_KEY_ART_REQUIRED",
        details: { boneId },
      });
    }
    const evaluation = evaluateEndpointProjectedBoneFk(
      project,
      authoring.activeKeyArt.id,
      {
        poseForBone: (entry) => entry.id === boneId
          ? identityBonePoseDelta()
          : bonePoseDeltaForKeyArt(project, entry.id, authoring.activeKeyArt.id),
      },
    );
    if (evaluation.diagnostics.length) {
      return { toLocal: null, diagnostics: evaluation.diagnostics };
    }
    const pose = evaluation.poses.find((entry) => entry.boneId === boneId);
    if (!pose) throw Object.assign(new Error("Selected Bone was not produced by FK evaluation."), {
      code: "BONE_NODE_MISSING",
      details: { boneId },
    });
    const toPoseDeltaLocal = invertAffine(pose.poseMatrix);
    return {
      diagnostics: [],
      toLocal(documentPoint) {
        return transformPoint(toPoseDeltaLocal, documentPoint);
      },
    };
  } catch (error) {
    return { toLocal: null, diagnostics: [authoringDiagnostic(error, boneId)] };
  }
}

export function nearestBoneHandle(overlay, point, radius = 10) {
  let best = null;
  const consider = (bone, kind, distance) => {
    if (distance > radius) return;
    if (!best || distance < best.distance ||
      distance === best.distance && bone.boneId < best.boneId) {
      best = { boneId: bone.boneId, kind, distance };
    }
  };
  for (const bone of overlay?.bones || []) {
    consider(bone, "rotation", Math.hypot(
      point.x - bone.rotationHandle.x, point.y - bone.rotationHandle.y,
    ));
    consider(bone, "head", Math.hypot(point.x - bone.head.x, point.y - bone.head.y));
    consider(bone, "tip", Math.hypot(point.x - bone.tip.x, point.y - bone.tip.y));
    consider(bone, "body", distanceToSegment(point, bone.head, bone.tip));
  }
  return best;
}
