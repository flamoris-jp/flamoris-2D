import { imageToScreen } from "../mesh.js";
import { evaluateBoneFk, bonePoseDeltaForKeyArt } from "../core/bone-fk-evaluator.js";
import { evaluateEndpointProjectedBoneFk } from "../core/rigid-bone-evaluator.js";
import { boneSceneTransform } from "../model/bone.js";
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
  const evaluation = authoring.activeKeyArt
    ? evaluateEndpointProjectedBoneFk(
      evaluationProject,
      authoring.activeKeyArt.id,
      { poseForBone },
    )
    : evaluateBoneFk(evaluationProject, null, { poseForBone });
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
