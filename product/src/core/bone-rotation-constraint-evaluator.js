import { rotationConstraintForBone } from "../model/bone-rotation-constraint-validation.js";

export class BoneRotationConstraintEvaluationError extends Error {
  constructor(message, code = "BONE_ROTATION_CONSTRAINT_INVALID", details = null) {
    super(message);
    this.name = "BoneRotationConstraintEvaluationError";
    this.code = code;
    this.details = details;
  }
}

function finiteDelta(delta) {
  return delta && Number.isFinite(delta.x) && Number.isFinite(delta.y) &&
    Number.isFinite(delta.rotation);
}

export function applyBoneRotationConstraint(localDelta, constraint) {
  if (!finiteDelta(localDelta)) throw new BoneRotationConstraintEvaluationError(
    "Bone local pose delta must be finite.", "BONE_POSE_INVALID");
  if (!constraint || constraint.enabled === false) return { ...localDelta };
  if (constraint.enabled !== true || !Number.isFinite(constraint.minRotation) ||
    !Number.isFinite(constraint.maxRotation) ||
    constraint.minRotation > constraint.maxRotation) {
    throw new BoneRotationConstraintEvaluationError(
      "Rotation constraint bounds must be finite and ordered.",
      "BONE_ROTATION_CONSTRAINT_INVALID",
      { constraintId: constraint.id || null, boneId: constraint.boneId || null },
    );
  }
  return {
    ...localDelta,
    rotation: Math.min(constraint.maxRotation,
      Math.max(constraint.minRotation, localDelta.rotation)),
  };
}

export function constrainedBonePoseDelta(project, boneId, authoredDelta) {
  const enabled = [...(project.rig?.boneRotationConstraints || [])]
    .filter((entry) => entry.enabled && entry.boneId === boneId)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (enabled.length > 1) throw new BoneRotationConstraintEvaluationError(
    "A Bone has multiple enabled rotation constraints.",
    "BONE_ROTATION_CONSTRAINT_CONFLICT",
    { boneId, constraintIds: enabled.map((entry) => entry.id) },
  );
  return applyBoneRotationConstraint(authoredDelta,
    enabled[0] || rotationConstraintForBone(project, boneId));
}
