function problem(code, path, message, entityId = null, details = null) {
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expected) {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort(compareText);
  const sortedExpected = [...expected].sort(compareText);
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}

export function rigidBoneBindingForTarget(project, targetNodeId) {
  return [...(project.rig?.rigidBoneBindings || [])]
    .filter((binding) => binding?.targetNodeId === targetNodeId && binding.enabled)
    .sort((left, right) => compareText(left.id, right.id))[0] || null;
}

/**
 * Shared influence-conflict boundary for the future SkinBinding domain.
 * Phase 7-2 supplies only rigid bindings; Phase 7-3 can pass enabled skin
 * targets without changing the one-enabled-influence rule.
 */
export function influenceBindingConflicts(rigidBindings, enabledSkinTargetIds = new Set()) {
  const enabledByTarget = new Map();
  const conflicts = [];
  for (const binding of [...rigidBindings]
    .filter((entry) => entry?.enabled && nonEmpty(entry.targetNodeId))
    .sort((left, right) => compareText(left.targetNodeId, right.targetNodeId) ||
      compareText(left.id || "", right.id || ""))) {
    const previous = enabledByTarget.get(binding.targetNodeId);
    if (previous || enabledSkinTargetIds.has(binding.targetNodeId)) {
      conflicts.push({
        targetNodeId: binding.targetNodeId,
        bindingIds: [previous, binding.id].filter(nonEmpty).sort(compareText),
        conflictsWithSkin: enabledSkinTargetIds.has(binding.targetNodeId),
      });
    } else enabledByTarget.set(binding.targetNodeId, binding.id);
  }
  return conflicts;
}

export function validateRigidBoneBindings(
  project,
  register = () => {},
  { enabledSkinTargetIds = new Set() } = {},
) {
  const bindings = project.rig?.rigidBoneBindings;
  if (!Array.isArray(bindings)) {
    return [problem(
      "collection.invalid",
      "rig.rigidBoneBindings",
      "rig.rigidBoneBindings must be an array.",
    )];
  }
  const issues = [];
  const nodes = project.scene?.nodes || {};
  const boneIds = new Set((project.rig?.bones || []).map((bone) => bone?.id));
  for (const [index, binding] of bindings.entries()) {
    const path = `rig.rigidBoneBindings.${index}`;
    if (!object(binding)) {
      issues.push(problem(
        "RIGID_BINDING_TARGET_INVALID",
        path,
        "RigidBoneBinding must be an object.",
      ));
      continue;
    }
    if (nonEmpty(binding.id)) register(binding.id, `${path}.id`);
    else issues.push(problem("identity.missing", `${path}.id`,
      "RigidBoneBinding stable ID is required."));
    if (!exactKeys(binding, ["id", "targetNodeId", "boneId", "enabled"])) {
      issues.push(problem(
        "RIGID_BINDING_TARGET_INVALID",
        path,
        "RigidBoneBinding contains missing or unsupported persistent fields.",
        binding.id || null,
      ));
    }
    const target = nodes[binding.targetNodeId];
    if (!nonEmpty(binding.targetNodeId) || !target || target.kind !== "part") {
      issues.push(problem(
        "RIGID_BINDING_TARGET_INVALID",
        `${path}.targetNodeId`,
        "RigidBoneBinding target must be a renderable PartNode.",
        binding.id || null,
        { targetNodeId: binding.targetNodeId ?? null },
      ));
    }
    const boneNode = nodes[binding.boneId];
    if (!nonEmpty(binding.boneId) || !boneIds.has(binding.boneId) ||
      boneNode?.kind !== "bone") {
      issues.push(problem(
        "BONE_NODE_MISSING",
        `${path}.boneId`,
        "RigidBoneBinding must reference an existing Bone and BoneNode.",
        binding.id || null,
        { boneId: binding.boneId ?? null },
      ));
    }
    if (typeof binding.enabled !== "boolean") {
      issues.push(problem(
        "RIGID_BINDING_TARGET_INVALID",
        `${path}.enabled`,
        "RigidBoneBinding enabled must be boolean.",
        binding.id || null,
      ));
    }
  }
  for (const conflict of influenceBindingConflicts(bindings, enabledSkinTargetIds)) {
    issues.push(problem(
      "RIGID_BINDING_CONFLICT",
      "rig.rigidBoneBindings",
      "A target may have only one enabled rigid or weighted skin binding.",
      conflict.bindingIds[0] || null,
      conflict,
    ));
  }
  return issues.sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.entityId || "", right.entityId || "") ||
    compareText(left.path, right.path));
}

export function rigidBoneBindingValidationResult(project) {
  const enabledSkinTargetIds = new Set((project.rig?.skinBindings || [])
    .filter((binding) => binding?.enabled && nonEmpty(binding.targetNodeId))
    .map((binding) => binding.targetNodeId));
  const issues = validateRigidBoneBindings(project, () => {}, { enabledSkinTargetIds });
  return { valid: issues.length === 0, issues };
}
