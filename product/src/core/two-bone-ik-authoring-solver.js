import {
  bonePoseDeltaForKeyArt,
  shortestBoneRotationDelta,
} from "./bone-fk-evaluator.js";
import { evaluateEndpointProjectedBoneFk } from "./rigid-bone-evaluator.js";
import { solveTwoBoneIk } from "./two-bone-ik-solver.js";
import { applyBoneRotationConstraint } from "./bone-rotation-constraint-evaluator.js";
import { rotationConstraintForBone } from "../model/bone-rotation-constraint-validation.js";

function diagnostic(code, message, details = null) {
  return { code, message, ...(details ? { details } : {}) };
}

function angle(pose) {
  return Math.atan2(pose.tip.y - pose.head.y, pose.tip.x - pose.head.x);
}

function length(pose) {
  return Math.hypot(pose.tip.x - pose.head.x, pose.tip.y - pose.head.y);
}

// The analytic two-link solver treats both links as rigid Euclidean segments.
// A projected Warp bind frame may instead contain shear, non-uniform scale, or
// a reflection.  In that case a document-space angle is not a Bone-local
// rotation, so baking a result would not be faithful to the existing FK.
const FRAME_TOLERANCE = 1e-9;

function compatibleRigidProjectedFrame(pose) {
  const [a, b, c, d] = pose.poseMatrix;
  const xLengthSquared = a * a + b * b;
  const yLengthSquared = c * c + d * d;
  const scale = Math.max(1, xLengthSquared, yLengthSquared);
  const dot = a * c + b * d;
  const determinant = a * d - b * c;
  return Number.isFinite(xLengthSquared) && Number.isFinite(yLengthSquared) &&
    Number.isFinite(dot) && Number.isFinite(determinant) &&
    xLengthSquared > FRAME_TOLERANCE && yLengthSquared > FRAME_TOLERANCE &&
    Math.abs(dot) <= FRAME_TOLERANCE * scale &&
    Math.abs(xLengthSquared - yLengthSquared) <= FRAME_TOLERANCE * scale &&
    determinant > FRAME_TOLERANCE;
}

function constraintFor(project, id) {
  return project.rig?.twoBoneIkConstraints?.find((entry) => entry.id === id) || null;
}

export function projectTwoBoneIkChain(project, constraintId, keyArtId) {
  const constraint = constraintFor(project, constraintId);
  if (!constraint) return { chain: null, diagnostics: [diagnostic(
    "TWO_BONE_IK_NOT_FOUND", "TwoBoneIkConstraint does not exist.", { constraintId })] };
  const evaluation = evaluateEndpointProjectedBoneFk(project, keyArtId);
  if (evaluation.diagnostics.length) return { chain: null, diagnostics: evaluation.diagnostics };
  const poses = new Map(evaluation.poses.map((entry) => [entry.boneId, entry]));
  const root = poses.get(constraint.rootBoneId);
  const mid = poses.get(constraint.midBoneId);
  const end = poses.get(constraint.endBoneId);
  if (!root || !mid || !end) return { chain: null, diagnostics: [diagnostic(
    "TWO_BONE_IK_BONE_MISSING", "IK chain was not produced by existing FK.",
    { constraintId, rootBoneId: constraint.rootBoneId,
      midBoneId: constraint.midBoneId, endBoneId: constraint.endBoneId })] };
  return { chain: { constraint, root, mid, end }, diagnostics: [] };
}

export function solveProjectTwoBoneIk(project, { constraintId, keyArtId, target }) {
  const projected = projectTwoBoneIkChain(project, constraintId, keyArtId);
  if (projected.diagnostics.length) return { solution: null, diagnostics: projected.diagnostics };
  const { constraint, root, mid } = projected.chain;
  if (!constraint.enabled) return { solution: null, diagnostics: [diagnostic(
    "TWO_BONE_IK_DISABLED", "TwoBoneIkConstraint is disabled.", { constraintId })] };
  for (const pose of [root, mid]) {
    if (!compatibleRigidProjectedFrame(pose)) {
      return { solution: null, diagnostics: [diagnostic(
        "TWO_BONE_IK_PROJECTED_FRAME_INCOMPATIBLE",
        "Two-bone IK requires orientation-preserving rigid projected Bone frames.",
        { constraintId, boneId: pose.boneId, poseMatrix: [...pose.poseMatrix] },
      )] };
    }
  }
  const analytic = solveTwoBoneIk({
    root: root.head,
    target,
    firstLength: length(root),
    secondLength: length(mid),
    bendDirection: constraint.bendDirection,
  });
  if (analytic.diagnostics.length) return analytic;

  const rootAuthored = bonePoseDeltaForKeyArt(project, constraint.rootBoneId, keyArtId);
  const midAuthored = bonePoseDeltaForKeyArt(project, constraint.midBoneId, keyArtId);
  const rootCurrent = applyBoneRotationConstraint(rootAuthored,
    rotationConstraintForBone(project, constraint.rootBoneId));
  const midCurrent = applyBoneRotationConstraint(midAuthored,
    rotationConstraintForBone(project, constraint.midBoneId));
  const desiredRootAngle = analytic.solution.rootRotation;
  const desiredMidAngle = analytic.solution.rootRotation + analytic.solution.midRotation;
  const requestedRootChange = shortestBoneRotationDelta(angle(root), desiredRootAngle);
  const rootSolved = applyBoneRotationConstraint({
    ...rootCurrent,
    rotation: rootCurrent.rotation + requestedRootChange,
  }, rotationConstraintForBone(project, constraint.rootBoneId));
  const appliedRootChange = rootSolved.rotation - rootCurrent.rotation;
  const midSolved = applyBoneRotationConstraint({
    ...midCurrent,
    rotation: midCurrent.rotation + shortestBoneRotationDelta(
      angle(mid) + appliedRootChange,
      desiredMidAngle,
    ),
  }, rotationConstraintForBone(project, constraint.midBoneId));
  const poseDeltas = [
    { boneId: constraint.rootBoneId, keyArtId, localDelta: rootSolved },
    { boneId: constraint.midBoneId, keyArtId, localDelta: midSolved },
  ];
  const byBone = new Map(poseDeltas.map((entry) => [entry.boneId, entry.localDelta]));
  const fk = evaluateEndpointProjectedBoneFk(project, keyArtId, {
    poseForBone: (bone) => byBone.get(bone.id) ||
      bonePoseDeltaForKeyArt(project, bone.id, keyArtId),
  });
  const rootPose = fk.poses.find((entry) => entry.boneId === constraint.rootBoneId) || null;
  const midPose = fk.poses.find((entry) => entry.boneId === constraint.midBoneId) || null;
  const endPose = fk.poses.find((entry) => entry.boneId === constraint.endBoneId) || null;
  return {
    solution: {
      constraintId,
      keyArtId,
      target: { ...target },
      bendDirection: constraint.bendDirection,
      reach: analytic.solution.reach,
      limited: rootSolved.rotation !== rootCurrent.rotation + requestedRootChange ||
        midSolved.rotation !== midCurrent.rotation + shortestBoneRotationDelta(
          angle(mid) + appliedRootChange, desiredMidAngle),
      poseDeltas,
      end: endPose?.head || analytic.solution.end,
      joints: rootPose && midPose && endPose ? {
        root: rootPose.head,
        mid: midPose.head,
        end: endPose.head,
      } : null,
    },
    diagnostics: fk.diagnostics,
  };
}
