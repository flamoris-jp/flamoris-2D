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

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
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

function validLocalTransform(value) {
  return exactKeys(value, ["x", "y", "rotation"]) &&
    finite(value.x) && finite(value.y) && finite(value.rotation);
}

export function validateBones(project) {
  const issues = [];
  const nodes = project.scene?.nodes || {};
  const rig = project.rig;
  if (!object(rig)) {
    return [problem("collection.invalid", "rig", "Project rig must be an object.")];
  }
  const bones = rig.bones;
  const keyforms = rig.bonePoseKeyforms;
  if (!Array.isArray(bones)) {
    issues.push(problem("collection.invalid", "rig.bones", "rig.bones must be an array."));
  }
  if (!Array.isArray(keyforms)) {
    issues.push(problem(
      "collection.invalid",
      "rig.bonePoseKeyforms",
      "rig.bonePoseKeyforms must be an array.",
    ));
  }
  if (!Array.isArray(bones) || !Array.isArray(keyforms)) return issues;

  const boneById = new Map();
  for (const [index, bone] of bones.entries()) {
    const path = `rig.bones.${index}`;
    if (!object(bone)) {
      issues.push(problem("BONE_REST_INVALID", path, "Bone must be an object."));
      continue;
    }
    if (!nonEmpty(bone.id)) {
      issues.push(problem("identity.missing", `${path}.id`, "Bone stable ID is required."));
    } else if (boneById.has(bone.id)) {
      issues.push(problem("identity.duplicate", `${path}.id`,
        `Duplicate Bone stable ID ${bone.id}.`, bone.id));
    } else boneById.set(bone.id, bone);
    const node = nodes[bone.id];
    if (!node) {
      issues.push(problem("BONE_NODE_MISSING", `${path}.id`,
        "Bone must reference a BoneNode with the same stable ID.", bone.id || null));
    } else if (node.kind !== "bone") {
      issues.push(problem("BONE_SCENE_IDENTITY_MISMATCH", `${path}.id`,
        "Bone stable ID must resolve to a BoneNode.", bone.id));
    }
    if (!nonEmpty(bone.parentNodeId) || !nodes[bone.parentNodeId]) {
      issues.push(problem("BONE_PARENT_INVALID", `${path}.parentNodeId`,
        "Bone parent node does not exist.", bone.id || null));
    } else if (!["group", "deformer", "bone"].includes(nodes[bone.parentNodeId].kind)) {
      issues.push(problem("BONE_PARENT_INVALID", `${path}.parentNodeId`,
        "Bone parent must be a GroupNode, DeformerNode, or BoneNode.", bone.id || null));
    }
    if (node && node.parentId !== bone.parentNodeId) {
      issues.push(problem("BONE_SCENE_IDENTITY_MISMATCH", `${path}.parentNodeId`,
        "Bone parent must match the Scene hierarchy.", bone.id || null));
    }
    if (!validLocalTransform(bone.restLocalTransform)) {
      issues.push(problem("BONE_REST_INVALID", `${path}.restLocalTransform`,
        "Bone rest-local x, y, and rotation must be finite.", bone.id || null));
    }
    if (!finite(bone.length) || bone.length <= 0) {
      issues.push(problem("BONE_LENGTH_INVALID", `${path}.length`,
        "Bone length must be a positive finite number.", bone.id || null));
    }
    if (typeof bone.enabled !== "boolean") {
      issues.push(problem("BONE_REST_INVALID", `${path}.enabled`,
        "Bone enabled must be boolean.", bone.id || null));
    }
  }

  for (const bone of bones) {
    const parent = nodes[bone?.parentNodeId];
    if (parent?.kind === "bone" && !boneById.has(parent.id)) {
      issues.push(problem("BONE_PARENT_INVALID", `rig.bones.${bone?.id}.parentNodeId`,
        "Bone parent node requires matching Bone rig data.", bone?.id || null));
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.kind === "bone" && !boneById.has(node.id)) {
      issues.push(problem("BONE_NODE_MISSING", `scene.nodes.${node.id}`,
        "BoneNode requires matching Bone rig data.", node.id));
    }
    if (node.kind === "bone") {
      for (const childId of node.children || []) {
        if (nodes[childId]?.kind !== "bone") {
          issues.push(problem("BONE_PARENT_INVALID", `scene.nodes.${node.id}.children`,
            "BoneNode children must be BoneNodes; rigid targets use explicit bindings.",
            node.id, { childNodeId: childId }));
        }
      }
    }
  }

  for (const bone of bones) {
    const visited = new Set();
    let current = nodes[bone?.id];
    while (current?.kind === "bone") {
      if (visited.has(current.id)) {
        issues.push(problem("BONE_HIERARCHY_CYCLE", `scene.nodes.${current.id}`,
          "Bone hierarchy contains a cycle.", bone?.id || null));
        break;
      }
      visited.add(current.id);
      current = current.parentId ? nodes[current.parentId] : null;
    }
  }

  const keyformKeys = new Set();
  const keyArtIds = new Set((project.keyArts || []).map(({ id }) => id));
  for (const [index, keyform] of keyforms.entries()) {
    const path = `rig.bonePoseKeyforms.${index}`;
    if (!exactKeys(keyform, ["boneId", "keyArtId", "localDelta"])) {
      issues.push(problem("BONE_POSE_INVALID", path,
        "BonePoseKeyform contains missing or unsupported persistent fields.",
        keyform?.boneId || null));
    }
    const key = `${keyform?.boneId || ""}\u0000${keyform?.keyArtId || ""}`;
    if (keyformKeys.has(key)) {
      issues.push(problem("BONE_POSE_INVALID", path,
        "A Bone may have only one pose keyform per Key Art.", keyform?.boneId || null));
    }
    keyformKeys.add(key);
    if (!boneById.has(keyform?.boneId)) {
      issues.push(problem("BONE_NODE_MISSING", `${path}.boneId`,
        "BonePoseKeyform references a missing Bone.", keyform?.boneId || null));
    }
    if (!keyArtIds.has(keyform?.keyArtId)) {
      issues.push(problem("BONE_KEYART_REFERENCE_INVALID", `${path}.keyArtId`,
        "BonePoseKeyform references a missing Key Art.", keyform?.boneId || null));
    }
    if (!validLocalTransform(keyform?.localDelta)) {
      issues.push(problem("BONE_POSE_INVALID", `${path}.localDelta`,
        "Bone pose-local x, y, and rotation must be finite.", keyform?.boneId || null));
    }
  }

  return issues.sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.entityId || "", right.entityId || "") ||
    compareText(left.path, right.path));
}

export function boneValidationResult(project) {
  const issues = validateBones(project);
  return { valid: issues.length === 0, issues };
}
