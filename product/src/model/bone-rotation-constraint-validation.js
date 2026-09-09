function issue(code, path, message, entityId = null, details = null) {
  return {
    code,
    path,
    message,
    entityId,
    severity: "error",
    ...(details ? { details } : {}),
  };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function exactKeys(value, expected) {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rotationConstraintForBone(project, boneId) {
  return [...(project.rig?.boneRotationConstraints || [])]
    .filter((entry) => entry.enabled && entry.boneId === boneId)
    .sort((left, right) => compare(left.id, right.id))[0] || null;
}

export function rotationConstraintsReferencingBones(project, boneIds) {
  const ids = new Set(boneIds);
  return [...(project.rig?.boneRotationConstraints || [])]
    .filter((entry) => ids.has(entry.boneId))
    .sort((left, right) => compare(left.id, right.id));
}

export function validateBoneRotationConstraints(project, registerId = null) {
  const constraints = project.rig?.boneRotationConstraints;
  if (!Array.isArray(constraints)) return [issue(
    "collection.invalid",
    "rig.boneRotationConstraints",
    "rig.boneRotationConstraints must be an array.",
  )];
  const bones = new Set((project.rig?.bones || []).map((entry) => entry.id));
  const enabledByBone = new Map();
  const issues = [];
  for (const [index, constraint] of constraints.entries()) {
    const path = `rig.boneRotationConstraints.${index}`;
    if (!exactKeys(constraint, [
      "id", "boneId", "enabled", "minRotation", "maxRotation",
    ])) {
      issues.push(issue("BONE_ROTATION_CONSTRAINT_INVALID", path,
        "BoneRotationConstraint contains missing or unsupported fields.",
        constraint?.id || null));
    }
    if (!nonEmpty(constraint?.id)) {
      issues.push(issue("identity.missing", `${path}.id`,
        "BoneRotationConstraint stable ID is required."));
    } else registerId?.(constraint.id, `${path}.id`);
    if (!nonEmpty(constraint?.boneId) || !bones.has(constraint.boneId)) {
      issues.push(issue("BONE_ROTATION_CONSTRAINT_BONE_MISSING", `${path}.boneId`,
        "BoneRotationConstraint references a missing Bone.", constraint?.id || null,
        { boneId: constraint?.boneId || null }));
    }
    if (typeof constraint?.enabled !== "boolean" ||
      !Number.isFinite(constraint?.minRotation) ||
      !Number.isFinite(constraint?.maxRotation) ||
      constraint?.minRotation > constraint?.maxRotation) {
      issues.push(issue("BONE_ROTATION_CONSTRAINT_INVALID", path,
        "Rotation bounds must be finite radians with minRotation <= maxRotation.",
        constraint?.id || null));
    }
    if (constraint?.enabled && nonEmpty(constraint?.boneId)) {
      const previous = enabledByBone.get(constraint.boneId);
      if (previous) {
        issues.push(issue("BONE_ROTATION_CONSTRAINT_CONFLICT", `${path}.boneId`,
          "A Bone may have at most one enabled rotation constraint.",
          constraint.id || null, { boneId: constraint.boneId, constraintIds: [previous, constraint.id].sort() }));
      } else enabledByBone.set(constraint.boneId, constraint.id);
    }
  }
  return issues.sort((left, right) =>
    compare(left.code, right.code) || compare(left.entityId || "", right.entityId || "") ||
    compare(left.path, right.path));
}

export function boneRotationConstraintValidationResult(project) {
  const issues = validateBoneRotationConstraints(project);
  return { valid: issues.length === 0, issues };
}
