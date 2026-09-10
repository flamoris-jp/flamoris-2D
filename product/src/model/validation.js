import { PROJECT_SCHEMA_VERSION } from "./project.js";
import { validateTemporalPrograms } from "./temporal-validation.js";
import { TIMEBASE_TICKS_PER_SECOND, normalizeFrameRate } from "../core/temporal.js";
import { validateTransitionDomain } from "./transition-validation.js";
import { validateClippingBindings } from "./clipping-validation.js";
import { validateTransitionClipping } from "./clipping-transition-validation.js";
import { validateWarpDeformers } from "./warp-deformer-validation.js";
import { validateBones } from "./bone-validation.js";
import { validateRigidBoneBindings } from "./rigid-bone-binding-validation.js";
import {
  enabledSkinTargetIds,
  validateSkinBindings,
} from "./skin-binding-validation.js";
import { validateMeshFormCorrections } from "./mesh-form-correction-validation.js";
import { validateBoneRotationConstraints } from "./bone-rotation-constraint-validation.js";
import { validateTwoBoneIkConstraints } from "./two-bone-ik-validation.js";
import { validateSequences } from "./sequence-validation.js";
import { validateAnimationClips } from "./animation-clip-validation.js";
import {
  validateTemporalProgramOwnership,
  validateTemporalProgramOwnerTracks,
} from "./temporal-program-ownership.js";

function issue(code, path, message, entityId = null, severity = "error") {
  return { code, path, message, entityId, severity };
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

export function validateProject(project) {
  const issues = [];
  if (!project || typeof project !== "object") {
    return [issue("project.invalid", "$", "Project must be an object.")];
  }
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    issues.push(issue("project.unsupported_schema", "schemaVersion", "Unsupported project schema."));
  }
  if (project.timebaseTicksPerSecond !== TIMEBASE_TICKS_PER_SECOND) {
    issues.push(issue("ANIMATION_INVALID_TIMEBASE", "timebaseTicksPerSecond", "Project timebase must be 120000 ticks per second."));
  }
  if (!project.id) issues.push(issue("project.missing_id", "id", "Project ID is required."));
  if (!finite(project.canvas?.width) || project.canvas.width <= 0) {
    issues.push(issue("canvas.invalid_width", "canvas.width", "Canvas width must be positive."));
  }
  if (!finite(project.canvas?.height) || project.canvas.height <= 0) {
    issues.push(issue("canvas.invalid_height", "canvas.height", "Canvas height must be positive."));
  }
  try {
    const normalized = normalizeFrameRate(project.renderSettings?.frameRate);
    if (normalized.numerator !== project.renderSettings.frameRate.numerator ||
      normalized.denominator !== project.renderSettings.frameRate.denominator) {
      issues.push(issue("ANIMATION_INVALID_FRAME_RATE", "renderSettings.frameRate", "Frame rate must be a reduced positive rational."));
    }
  } catch {
    issues.push(issue("ANIMATION_INVALID_FRAME_RATE", "renderSettings.frameRate", "Frame rate must be a reduced positive rational."));
  }
  if (Object.hasOwn(project.renderSettings || {}, "durationTicks")) {
    issues.push(issue("ANIMATION_SECOND_DURATION_AUTHORITY", "renderSettings.durationTicks", "Duration belongs only to an owned TemporalProgram."));
  }
  if (!project.animation || typeof project.animation !== "object" ||
    Array.isArray(project.animation) ||
    !hasExactKeys(project.animation, ["clips", "deformationSamples"])) {
    issues.push(issue(
      "ANIMATION_SCHEMA_INVALID",
      "animation",
      "Schema 14 animation must contain exactly the typed clips and reserved deformationSamples collections.",
    ));
  }
  if (Array.isArray(project.animation?.deformationSamples) &&
    project.animation.deformationSamples.length > 0) {
    issues.push(issue(
      "ANIMATION_DEFORMATION_SAMPLE_UNSUPPORTED",
      "animation.deformationSamples",
      "Animation deformation samples are not authored in Phase 8-2 and must remain empty in schema 14.",
    ));
  }

  const nodes = project.scene?.nodes;
  const rootId = project.scene?.rootId;
  if (!nodes || typeof nodes !== "object") {
    issues.push(issue("scene.missing_nodes", "scene.nodes", "Scene node map is required."));
    return issues;
  }
  const root = nodes[rootId];
  if (!root) {
    issues.push(issue("scene.missing_root", "scene.rootId", "Scene root does not exist.", rootId));
  } else {
    if (root.parentId !== null) {
      issues.push(issue(
        "scene.root_parent_not_null",
        "scene.nodes." + rootId + ".parentId",
        "Scene root parentId must be null.",
        rootId,
      ));
    }
    if (root.kind !== "group") {
      issues.push(issue(
        "scene.root_not_group",
        "scene.nodes." + rootId + ".kind",
        "Scene root kind must be group.",
        rootId,
      ));
    }
  }

  const allIds = new Map();
  const register = (id, path) => {
    if (!id) {
      issues.push(issue("identity.missing", path, "Stable ID is required."));
      return;
    }
    if (allIds.has(id)) issues.push(issue("identity.duplicate", path, "Duplicate stable ID " + id + ".", id));
    else allIds.set(id, path);
  };
  register(project.id, "id");
  for (const [nodeId, node] of Object.entries(nodes)) {
    register(node.id, "scene.nodes." + nodeId + ".id");
    if (node.id !== nodeId) issues.push(issue("scene.key_id_mismatch", "scene.nodes." + nodeId + ".id", "Node key and ID differ.", node.id));
    if (!["group", "part", "deformer", "bone"].includes(node.kind)) {
      issues.push(issue("scene.invalid_kind", "scene.nodes." + nodeId + ".kind", "Node kind is not supported.", nodeId));
    }
    if (typeof node.displayName !== "string" || !node.displayName.trim()) {
      issues.push(issue("scene.invalid_display_name", "scene.nodes." + nodeId + ".displayName", "Display name must not be empty.", nodeId));
    }
    if (!finite(node.opacity) || node.opacity < 0 || node.opacity > 1) {
      issues.push(issue("scene.invalid_opacity", "scene.nodes." + nodeId + ".opacity", "Opacity must be between 0 and 1.", nodeId));
    }
    if (!Array.isArray(node.children)) issues.push(issue("scene.invalid_children", "scene.nodes." + nodeId + ".children", "Children must be an array.", nodeId));
    if (node.parentId === null && nodeId !== rootId) issues.push(issue("scene.orphan", "scene.nodes." + nodeId + ".parentId", "Only the root may have no parent.", nodeId));
    if (node.parentId && !nodes[node.parentId]) issues.push(issue("scene.missing_parent", "scene.nodes." + nodeId + ".parentId", "Parent does not exist.", nodeId));
    for (const childId of node.children || []) {
      if (!nodes[childId]) issues.push(issue("scene.missing_child", "scene.nodes." + nodeId + ".children", "Child does not exist.", childId));
      else if (nodes[childId].parentId !== nodeId) issues.push(issue("scene.parent_child_mismatch", "scene.nodes." + nodeId + ".children", "Parent/child link is inconsistent.", childId));
    }
    const transform = node.transform;
    const values = [
      transform?.position?.x, transform?.position?.y, transform?.rotation,
      transform?.scale?.x, transform?.scale?.y, transform?.pivot?.x, transform?.pivot?.y,
    ];
    if (!values.every(finite)) issues.push(issue("transform.non_finite", "scene.nodes." + nodeId + ".transform", "Transform values must be finite.", nodeId));
    if (transform?.scale?.x === 0 || transform?.scale?.y === 0) issues.push(issue("transform.zero_scale", "scene.nodes." + nodeId + ".transform.scale", "Scale must not be zero.", nodeId));
  }

  const collections = [
    ["sourceAssets", project.sourceAssets],
    ["semanticSlots", project.semanticSlots],
    ["keyArts", project.keyArts],
    ["meshes", project.meshes],
    ["meshTopologies", project.meshTopologies],
    ["meshKeyforms", project.meshKeyforms],
    ["meshFormCorrectionKeyforms", project.meshFormCorrectionKeyforms],
    ["transitions", project.transitions],
    ["animation.clips", project.animation?.clips],
    ["animation.deformationSamples", project.animation?.deformationSamples],
    ["sequences", project.sequences],
  ];
  for (const [path, values] of collections) {
    if (!Array.isArray(values)) issues.push(issue("collection.invalid", path, path + " must be an array."));
    else values.forEach((value, index) => register(value?.id, path + "." + index + ".id"));
  }

  issues.push(...validateTemporalPrograms(project, register));
  issues.push(...validateTransitionDomain(project, register));
  issues.push(...validateAnimationClips(project));
  issues.push(...validateSequences(project, register));
  issues.push(...validateTemporalProgramOwnership(project));
  issues.push(...validateTemporalProgramOwnerTracks(project));
  issues.push(...validateClippingBindings(project, register));
  issues.push(...validateTransitionClipping(project));
  issues.push(...validateWarpDeformers(project, register));
  issues.push(...validateBones(project));
  issues.push(...validateBoneRotationConstraints(project, register));
  issues.push(...validateTwoBoneIkConstraints(project, register));
  issues.push(...validateSkinBindings(project, register));
  issues.push(...validateMeshFormCorrections(project, register));
  issues.push(...validateRigidBoneBindings(project, register, {
    enabledSkinTargetIds: enabledSkinTargetIds(project),
  }));

  if (nodes[rootId]) {
    const visiting = new Set();
    const visited = new Set();
    const walk = (nodeId) => {
      if (visiting.has(nodeId)) {
        issues.push(issue("scene.cycle", "scene.nodes." + nodeId, "Scene hierarchy contains a cycle.", nodeId));
        return;
      }
      if (visited.has(nodeId) || !nodes[nodeId]) return;
      visiting.add(nodeId);
      for (const childId of nodes[nodeId].children || []) walk(childId);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    walk(rootId);
    for (const nodeId of Object.keys(nodes)) {
      if (!visited.has(nodeId)) issues.push(issue("scene.unreachable", "scene.nodes." + nodeId, "Node is unreachable from root.", nodeId));
    }
  }
  return issues;
}

export function validationResult(project) {
  const issues = validateProject(project);
  return { valid: !issues.some((entry) => entry.severity === "error"), issues };
}
