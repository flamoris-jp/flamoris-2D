import { SKIN_WEIGHT_SUM_TOLERANCE } from "./skin-binding.js";
import {
  influenceBindingConflicts,
  validateRigidBoneBindings,
} from "./rigid-bone-binding-validation.js";

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
  const canonical = [...expected].sort(compareText);
  return keys.length === canonical.length &&
    keys.every((key, index) => key === canonical[index]);
}

function targetTopologyIds(project, targetNodeId) {
  const slotIds = new Set((project.semanticSlots || [])
    .filter((slot) => (slot.mappings || []).some((mapping) =>
      mapping.nodeId === targetNodeId))
    .map((slot) => slot.id));
  return new Set((project.meshKeyforms || [])
    .filter((keyform) => slotIds.has(keyform.semanticSlotId))
    .map((keyform) => keyform.topologyId));
}

function skeletonRootParentId(project, boneId) {
  const visited = new Set();
  let node = project.scene?.nodes?.[boneId];
  while (node?.kind === "bone") {
    if (visited.has(node.id)) return null;
    visited.add(node.id);
    node = project.scene.nodes[node.parentId];
  }
  return node?.id || null;
}

export function enabledSkinTargetIds(project) {
  return new Set((project.rig?.skinBindings || [])
    .filter((binding) => binding?.enabled && nonEmpty(binding.targetNodeId))
    .map((binding) => binding.targetNodeId));
}

export function skinBindingForTarget(project, targetNodeId) {
  return [...(project.rig?.skinBindings || [])]
    .filter((binding) => binding?.targetNodeId === targetNodeId && binding.enabled)
    .sort((left, right) => compareText(left.id, right.id))[0] || null;
}

export function skinBindingsReferencingTopology(project, topologyId) {
  return [...(project.rig?.skinBindings || [])]
    .filter((binding) => binding?.topologyId === topologyId)
    .sort((left, right) => compareText(left.id, right.id));
}

export function skinBindingsReferencingBones(project, boneIds) {
  const requested = new Set(boneIds);
  return [...(project.rig?.skinBindings || [])]
    .filter((binding) => (binding?.vertexWeights || []).some((entry) =>
      (entry?.influences || []).some((influence) => requested.has(influence?.boneId))))
    .sort((left, right) => compareText(left.id, right.id));
}

export function validateSkinBindings(project, register = () => {}) {
  const bindings = project.rig?.skinBindings;
  if (!Array.isArray(bindings)) {
    return [problem(
      "collection.invalid",
      "rig.skinBindings",
      "rig.skinBindings must be an array.",
    )];
  }
  const issues = [];
  const nodes = project.scene?.nodes || {};
  const topologies = new Map((project.meshTopologies || [])
    .map((topology) => [topology?.id, topology]));
  const bones = new Set((project.rig?.bones || []).map((bone) => bone?.id));
  const enabledByTarget = new Map();
  for (const [index, binding] of bindings.entries()) {
    const path = `rig.skinBindings.${index}`;
    if (!object(binding)) {
      issues.push(problem(
        "SKIN_BINDING_TARGET_INVALID",
        path,
        "SkinBinding must be an object.",
      ));
      continue;
    }
    if (nonEmpty(binding.id)) register(binding.id, `${path}.id`);
    else issues.push(problem("identity.missing", `${path}.id`,
      "SkinBinding stable ID is required."));
    if (!exactKeys(binding, [
      "id", "targetNodeId", "topologyId", "enabled", "vertexWeights",
    ])) {
      issues.push(problem(
        "SKIN_BINDING_TARGET_INVALID",
        path,
        "SkinBinding contains missing or unsupported persistent fields.",
        binding.id || null,
      ));
    }
    const target = nodes[binding.targetNodeId];
    if (!nonEmpty(binding.targetNodeId) || !target) {
      issues.push(problem(
        "SKIN_BINDING_TARGET_MISSING",
        `${path}.targetNodeId`,
        "SkinBinding target does not exist.",
        binding.id || null,
        { targetNodeId: binding.targetNodeId ?? null },
      ));
    } else if (target.kind !== "part") {
      issues.push(problem(
        "SKIN_BINDING_TARGET_INVALID",
        `${path}.targetNodeId`,
        "SkinBinding target must be a renderable PartNode.",
        binding.id || null,
        { targetNodeId: binding.targetNodeId, targetKind: target.kind },
      ));
    }
    const topology = topologies.get(binding.topologyId);
    if (!nonEmpty(binding.topologyId) || !topology) {
      issues.push(problem(
        "SKIN_BINDING_TOPOLOGY_MISSING",
        `${path}.topologyId`,
        "SkinBinding MeshTopology does not exist.",
        binding.id || null,
        { topologyId: binding.topologyId ?? null },
      ));
    } else if (target?.kind === "part" &&
      !targetTopologyIds(project, binding.targetNodeId).has(binding.topologyId)) {
      issues.push(problem(
        "SKIN_BINDING_TOPOLOGY_TARGET_MISMATCH",
        `${path}.topologyId`,
        "SkinBinding topology does not match the target Part's MeshKeyform contract.",
        binding.id || null,
        { targetNodeId: binding.targetNodeId, topologyId: binding.topologyId },
      ));
    }
    if (typeof binding.enabled !== "boolean") {
      issues.push(problem(
        "SKIN_BINDING_TARGET_INVALID",
        `${path}.enabled`,
        "SkinBinding enabled must be boolean.",
        binding.id || null,
      ));
    }
    if (binding.enabled && nonEmpty(binding.targetNodeId)) {
      const previous = enabledByTarget.get(binding.targetNodeId);
      if (previous) {
        issues.push(problem(
          "SKIN_BINDING_TARGET_CONFLICT",
          "rig.skinBindings",
          "A target may have only one enabled SkinBinding.",
          binding.id || null,
          {
            targetNodeId: binding.targetNodeId,
            bindingIds: [previous, binding.id].filter(nonEmpty).sort(compareText),
          },
        ));
      } else enabledByTarget.set(binding.targetNodeId, binding.id);
    }
    if (!Array.isArray(binding.vertexWeights)) {
      issues.push(problem(
        "SKIN_BINDING_VERTEX_INVALID",
        `${path}.vertexWeights`,
        "SkinBinding vertexWeights must be an array.",
        binding.id || null,
      ));
      continue;
    }
    const vertexIds = new Set(topology?.vertexIds || []);
    const weightedVertexIds = new Set();
    let previousVertexId = null;
    for (const [weightIndex, vertexWeight] of binding.vertexWeights.entries()) {
      const weightPath = `${path}.vertexWeights.${weightIndex}`;
      if (!object(vertexWeight) || !exactKeys(vertexWeight, ["vertexId", "influences"])) {
        issues.push(problem(
          "SKIN_BINDING_VERTEX_INVALID",
          weightPath,
          "Skin vertex weight must contain only vertexId and influences.",
          binding.id || null,
        ));
        continue;
      }
      if (!nonEmpty(vertexWeight.vertexId) || !vertexIds.has(vertexWeight.vertexId)) {
        issues.push(problem(
          "SKIN_BINDING_VERTEX_MISSING",
          `${weightPath}.vertexId`,
          "Skin weight references a stable vertex ID outside its MeshTopology.",
          binding.id || null,
          { topologyId: binding.topologyId, vertexId: vertexWeight.vertexId ?? null },
        ));
      }
      if (weightedVertexIds.has(vertexWeight.vertexId)) {
        issues.push(problem(
          "SKIN_BINDING_VERTEX_DUPLICATE",
          `${weightPath}.vertexId`,
          "SkinBinding contains a duplicate stable vertex entry.",
          binding.id || null,
          { vertexId: vertexWeight.vertexId },
        ));
      }
      weightedVertexIds.add(vertexWeight.vertexId);
      if (previousVertexId !== null && compareText(previousVertexId, vertexWeight.vertexId) > 0) {
        issues.push(problem(
          "SKIN_BINDING_VERTEX_ORDER_INVALID",
          `${path}.vertexWeights`,
          "SkinBinding vertex entries must use canonical stable vertex ID order.",
          binding.id || null,
        ));
      }
      previousVertexId = vertexWeight.vertexId;
      const influences = vertexWeight.influences;
      if (!Array.isArray(influences) || influences.length < 1 || influences.length > 4) {
        issues.push(problem(
          "SKIN_BINDING_INFLUENCE_COUNT_INVALID",
          `${weightPath}.influences`,
          "A weighted vertex requires one to four Bone influences.",
          binding.id || null,
          { vertexId: vertexWeight.vertexId, influenceCount: Array.isArray(influences) ? influences.length : null },
        ));
        continue;
      }
      const seenBones = new Set();
      const roots = new Set();
      let previousBoneId = null;
      let sum = 0;
      for (const [influenceIndex, influence] of influences.entries()) {
        const influencePath = `${weightPath}.influences.${influenceIndex}`;
        if (!object(influence) || !exactKeys(influence, ["boneId", "weight"])) {
          issues.push(problem(
            "SKIN_BINDING_INFLUENCE_INVALID",
            influencePath,
            "Skin influence must contain only boneId and weight.",
            binding.id || null,
          ));
          continue;
        }
        if (seenBones.has(influence.boneId)) {
          issues.push(problem(
            "SKIN_BINDING_INFLUENCE_DUPLICATE",
            `${influencePath}.boneId`,
            "A weighted vertex cannot reference the same Bone more than once.",
            binding.id || null,
            { vertexId: vertexWeight.vertexId, boneId: influence.boneId },
          ));
        }
        seenBones.add(influence.boneId);
        if (previousBoneId !== null && compareText(previousBoneId, influence.boneId) > 0) {
          issues.push(problem(
            "SKIN_BINDING_INFLUENCE_ORDER_INVALID",
            `${weightPath}.influences`,
            "Skin influences must use canonical Bone ID order.",
            binding.id || null,
          ));
        }
        previousBoneId = influence.boneId;
        if (!nonEmpty(influence.boneId) || !bones.has(influence.boneId) ||
          nodes[influence.boneId]?.kind !== "bone") {
          issues.push(problem(
            "BONE_NODE_MISSING",
            `${influencePath}.boneId`,
            "Skin influence must reference an existing Bone and BoneNode.",
            binding.id || null,
            { vertexId: vertexWeight.vertexId, boneId: influence.boneId ?? null },
          ));
        } else {
          const root = skeletonRootParentId(project, influence.boneId);
          if (root) roots.add(root);
        }
        if (!Number.isFinite(influence.weight) || !(influence.weight > 0)) {
          issues.push(problem(
            "SKIN_BINDING_WEIGHT_INVALID",
            `${influencePath}.weight`,
            "Skin influence weight must be finite and greater than zero.",
            binding.id || null,
            { vertexId: vertexWeight.vertexId, boneId: influence.boneId, weight: influence.weight ?? null },
          ));
        } else sum += influence.weight;
      }
      if (Number.isFinite(sum) && Math.abs(sum - 1) > SKIN_WEIGHT_SUM_TOLERANCE) {
        issues.push(problem(
          "SKIN_BINDING_WEIGHT_NOT_NORMALIZED",
          `${weightPath}.influences`,
          `Skin influence weights must sum to 1 within ${SKIN_WEIGHT_SUM_TOLERANCE}.`,
          binding.id || null,
          { vertexId: vertexWeight.vertexId, sum, tolerance: SKIN_WEIGHT_SUM_TOLERANCE },
        ));
      }
      if (roots.size > 1) {
        issues.push(problem(
          "SKIN_BINDING_BONE_HIERARCHY_INCOMPATIBLE",
          `${weightPath}.influences`,
          "Skin influences must belong to one compatible Bone hierarchy.",
          binding.id || null,
          { vertexId: vertexWeight.vertexId, rootParentNodeIds: [...roots].sort(compareText) },
        ));
      }
    }
    if (binding.enabled && topology) {
      for (const vertexId of [...vertexIds].sort(compareText)) {
        if (!weightedVertexIds.has(vertexId)) {
          issues.push(problem(
            "SKIN_BINDING_VERTEX_MISSING",
            `${path}.vertexWeights`,
            "Enabled SkinBinding must weight every stable topology vertex.",
            binding.id || null,
            { topologyId: topology.id, vertexId },
          ));
        }
      }
    }
  }
  return issues.sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.entityId || "", right.entityId || "") ||
    compareText(left.path, right.path) ||
    compareText(JSON.stringify(left.details || {}), JSON.stringify(right.details || {})));
}

function rigidConflicts(project) {
  const targets = enabledSkinTargetIds(project);
  if (!targets.size) return [];
  const conflicts = new Set(influenceBindingConflicts(
    project.rig?.rigidBoneBindings || [],
    targets,
  ).filter((entry) => entry.conflictsWithSkin).map((entry) => entry.targetNodeId));
  if (!conflicts.size) return [];
  return validateRigidBoneBindings(project, () => {}, {
    enabledSkinTargetIds: targets,
  }).filter((entry) => entry.code === "RIGID_BINDING_CONFLICT");
}

export function skinBindingValidationResult(project) {
  const issues = [...validateSkinBindings(project), ...rigidConflicts(project)]
    .sort((left, right) =>
      compareText(left.code, right.code) ||
      compareText(left.entityId || "", right.entityId || "") ||
      compareText(left.path, right.path));
  return { valid: issues.length === 0, issues };
}
