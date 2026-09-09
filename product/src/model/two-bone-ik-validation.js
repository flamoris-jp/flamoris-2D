import { IK_BEND_DIRECTIONS } from "./two-bone-ik-constraint.js";

function issue(code, path, message, entityId = null, details = null) {
  return { code, path, message, entityId, severity: "error",
    ...(details ? { details } : {}) };
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

function contiguous(parent, child) {
  return parent && child && Number.isFinite(parent.length) &&
    Math.abs(child.restLocalTransform?.x - parent.length) <= 1e-9 &&
    Math.abs(child.restLocalTransform?.y) <= 1e-9;
}

export function twoBoneIkConstraintsReferencingBones(project, boneIds) {
  const ids = new Set(boneIds);
  return [...(project.rig?.twoBoneIkConstraints || [])]
    .filter((entry) => ids.has(entry.rootBoneId) || ids.has(entry.midBoneId) ||
      ids.has(entry.endBoneId))
    .sort((left, right) => compare(left.id, right.id));
}

export function validateTwoBoneIkConstraints(project, registerId = null) {
  const constraints = project.rig?.twoBoneIkConstraints;
  if (!Array.isArray(constraints)) return [issue("collection.invalid",
    "rig.twoBoneIkConstraints", "rig.twoBoneIkConstraints must be an array.")];
  const bones = new Map((project.rig?.bones || []).map((entry) => [entry.id, entry]));
  const nodes = project.scene?.nodes || {};
  const enabledEnd = new Map();
  const issues = [];
  for (const [index, constraint] of constraints.entries()) {
    const path = `rig.twoBoneIkConstraints.${index}`;
    if (!exactKeys(constraint, ["id", "rootBoneId", "midBoneId", "endBoneId",
      "enabled", "bendDirection"])) {
      issues.push(issue("TWO_BONE_IK_INVALID", path,
        "TwoBoneIkConstraint contains missing or unsupported fields.", constraint?.id || null));
    }
    if (!nonEmpty(constraint?.id)) issues.push(issue("identity.missing", `${path}.id`,
      "TwoBoneIkConstraint stable ID is required."));
    else registerId?.(constraint.id, `${path}.id`);
    const ids = [constraint?.rootBoneId, constraint?.midBoneId, constraint?.endBoneId];
    if (ids.some((id) => !nonEmpty(id)) || new Set(ids).size !== 3) {
      issues.push(issue("TWO_BONE_IK_BONES_INVALID", path,
        "Two-bone IK requires three distinct stable Bone IDs.", constraint?.id || null));
    }
    for (const [role, boneId] of [["root", ids[0]], ["mid", ids[1]], ["end", ids[2]]]) {
      if (!bones.has(boneId)) issues.push(issue("TWO_BONE_IK_BONE_MISSING",
        `${path}.${role}BoneId`, "TwoBoneIkConstraint references a missing Bone.",
        constraint?.id || null, { role, boneId: boneId || null }));
    }
    if (bones.has(ids[0]) && bones.has(ids[1]) && bones.has(ids[2])) {
      if (nodes[ids[1]]?.parentId !== ids[0] || nodes[ids[2]]?.parentId !== ids[1]) {
        issues.push(issue("TWO_BONE_IK_HIERARCHY_INVALID", path,
          "IK Bones must be a direct root -> mid -> end Scene chain.",
          constraint.id || null, { rootBoneId: ids[0], midBoneId: ids[1], endBoneId: ids[2] }));
      }
      if (!contiguous(bones.get(ids[0]), bones.get(ids[1])) ||
        !contiguous(bones.get(ids[1]), bones.get(ids[2]))) {
        issues.push(issue("TWO_BONE_IK_CHAIN_GEOMETRY_INVALID", path,
          "IK child heads must coincide with their parent Bone tips in rest-local space.",
          constraint.id || null));
      }
    }
    if (typeof constraint?.enabled !== "boolean" ||
      !IK_BEND_DIRECTIONS.includes(constraint?.bendDirection)) {
      issues.push(issue("TWO_BONE_IK_INVALID", path,
        "IK enabled must be boolean and bendDirection must be clockwise or counterclockwise.",
        constraint?.id || null));
    }
    if (constraint?.enabled && nonEmpty(constraint?.endBoneId)) {
      const previous = enabledEnd.get(constraint.endBoneId);
      if (previous) issues.push(issue("TWO_BONE_IK_END_CONFLICT", `${path}.endBoneId`,
        "An end Bone may have at most one enabled two-bone IK constraint.",
        constraint.id || null, { endBoneId: constraint.endBoneId,
          constraintIds: [previous, constraint.id].sort() }));
      else enabledEnd.set(constraint.endBoneId, constraint.id);
    }
  }
  return issues.sort((left, right) => compare(left.code, right.code) ||
    compare(left.entityId || "", right.entityId || "") || compare(left.path, right.path));
}

export function twoBoneIkValidationResult(project) {
  const issues = validateTwoBoneIkConstraints(project);
  return { valid: issues.length === 0, issues };
}
