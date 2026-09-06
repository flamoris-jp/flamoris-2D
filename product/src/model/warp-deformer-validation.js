import { isWarpGridPreset } from "./warp-deformer.js";

function problem(code, path, message, entityId = null) {
  return { code, path, message, entityId, severity: "error" };
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateWarpDeformers(project, register = () => {}) {
  const issues = [];
  const nodes = project.scene?.nodes || {};
  const rig = project.rig;
  if (!rig || typeof rig !== "object" || Array.isArray(rig)) {
    return [problem("collection.invalid", "rig", "Project rig must be an object.")];
  }
  const deformers = rig.deformers;
  const controlPoints = rig.warpControlPoints;
  const keyforms = rig.warpDeformerKeyforms;
  for (const [name, value] of [
    ["deformers", deformers],
    ["warpControlPoints", controlPoints],
    ["warpDeformerKeyforms", keyforms],
  ]) {
    if (!Array.isArray(value)) {
      issues.push(problem("collection.invalid", `rig.${name}`, `rig.${name} must be an array.`));
    }
  }
  if (!Array.isArray(deformers) || !Array.isArray(controlPoints) || !Array.isArray(keyforms)) {
    return issues;
  }

  const deformerById = new Map();
  for (const [index, deformer] of deformers.entries()) {
    const path = `rig.deformers.${index}`;
    if (!deformer?.id) {
      issues.push(problem("identity.missing", `${path}.id`, "Stable ID is required."));
      continue;
    }
    if (deformerById.has(deformer.id)) {
      issues.push(problem("identity.duplicate", `${path}.id`, `Duplicate stable ID ${deformer.id}.`, deformer.id));
    } else deformerById.set(deformer.id, deformer);
    const node = nodes[deformer.id];
    if (!node || node.kind !== "deformer") {
      issues.push(problem("DEFORMER_CHILD_REFERENCE_INVALID", `${path}.id`,
        "WarpDeformer must reference its DeformerNode with the same stable ID.", deformer.id));
    }
    if (!nodes[deformer.parentNodeId]) {
      issues.push(problem("DEFORMER_PARENT_MISSING", `${path}.parentNodeId`,
        "WarpDeformer parent node does not exist.", deformer.id));
    } else if (node && node.parentId !== deformer.parentNodeId) {
      issues.push(problem("DEFORMER_CHILD_REFERENCE_INVALID", `${path}.parentNodeId`,
        "WarpDeformer parent must match the Scene hierarchy.", deformer.id));
    }
    if (deformer.type !== "warp") {
      issues.push(problem("DEFORMER_TYPE_INVALID", `${path}.type`,
        "Only WarpDeformer is supported in Phase 6.", deformer.id));
    }
    if (typeof deformer.displayName !== "string" || !deformer.displayName.trim()) {
      issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", `${path}.displayName`,
        "WarpDeformer display name must not be empty.", deformer.id));
    } else if (node && node.displayName !== deformer.displayName) {
      issues.push(problem("DEFORMER_CHILD_REFERENCE_INVALID", `${path}.displayName`,
        "WarpDeformer display name must match its Scene node.", deformer.id));
    }
    if (!isWarpGridPreset(deformer.columns, deformer.rows)) {
      issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", `${path}.columns`,
        "Warp grid dimensions must use the 2x2, 3x3, or 4x4 presets.", deformer.id));
    }
    const bounds = deformer.bounds;
    if (![bounds?.left, bounds?.top, bounds?.right, bounds?.bottom].every(finite) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
      issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", `${path}.bounds`,
        "Warp bounds must be finite with positive width and height.", deformer.id));
    }
    if (!Array.isArray(deformer.controlPointIds) ||
      deformer.controlPointIds.length !== deformer.columns * deformer.rows ||
      new Set(deformer.controlPointIds).size !== deformer.controlPointIds.length) {
      issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", `${path}.controlPointIds`,
        "Warp topology requires one unique stable ID per grid point.", deformer.id));
    }
  }

  const controlPointById = new Map();
  for (const [index, point] of controlPoints.entries()) {
    const path = `rig.warpControlPoints.${index}`;
    register(point?.id, `${path}.id`);
    if (!point?.id || controlPointById.has(point.id)) {
      if (point?.id) issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", `${path}.id`,
        "WarpControlPoint stable IDs must be unique.", point.id));
      continue;
    }
    controlPointById.set(point.id, point);
    if (!deformerById.has(point.deformerId) || !finite(point.u) || !finite(point.v) ||
      point.u < 0 || point.u > 1 || point.v < 0 || point.v > 1) {
      issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", path,
        "WarpControlPoint must reference a deformer and have normalized finite coordinates.", point.id));
    }
  }

  for (const [index, deformer] of deformers.entries()) {
    if (!Array.isArray(deformer.controlPointIds) ||
      !isWarpGridPreset(deformer.columns, deformer.rows)) continue;
    for (const [pointIndex, pointId] of deformer.controlPointIds.entries()) {
      const point = controlPointById.get(pointId);
      const expectedU = (pointIndex % deformer.columns) / (deformer.columns - 1);
      const expectedV = Math.floor(pointIndex / deformer.columns) / (deformer.rows - 1);
      if (!point || point.deformerId !== deformer.id ||
        point.u !== expectedU || point.v !== expectedV) {
        issues.push(problem("DEFORMER_CONTROL_POINT_INVALID",
          `rig.deformers.${index}.controlPointIds.${pointIndex}`,
          "Warp control-point topology must match the canonical row-major regular grid.", deformer.id));
      }
    }
  }

  for (const [pointId, point] of controlPointById) {
    const owner = deformerById.get(point.deformerId);
    if (owner && !owner.controlPointIds.includes(pointId)) {
      issues.push(problem("DEFORMER_CONTROL_POINT_INVALID", `rig.warpControlPoints.${pointId}`,
        "WarpControlPoint is not part of its owner's canonical topology.", pointId));
    }
  }

  const keyformKeys = new Set();
  for (const [index, keyform] of keyforms.entries()) {
    const path = `rig.warpDeformerKeyforms.${index}`;
    const deformer = deformerById.get(keyform?.deformerId);
    const key = `${keyform?.deformerId || ""}\u0000${keyform?.keyArtId || ""}`;
    if (keyformKeys.has(key)) {
      issues.push(problem("DEFORMER_KEYFORM_INCOMPATIBLE", path,
        "A WarpDeformer may have only one keyform per Key Art.", keyform?.deformerId));
    }
    keyformKeys.add(key);
    if (!deformer || !(project.keyArts || []).some((entry) => entry.id === keyform?.keyArtId)) {
      issues.push(problem("DEFORMER_KEYFORM_INCOMPATIBLE", path,
        "WarpDeformerKeyform references a missing deformer or Key Art.", keyform?.deformerId));
      continue;
    }
    const positions = keyform.controlPoints;
    const positionIds = Array.isArray(positions)
      ? positions.map((entry) => entry?.controlPointId)
      : [];
    if (!Array.isArray(positions) || positions.length !== deformer.controlPointIds.length ||
      new Set(positionIds).size !== positionIds.length ||
      positionIds.some((id) => !deformer.controlPointIds.includes(id))) {
      issues.push(problem("DEFORMER_KEYFORM_INCOMPATIBLE", `${path}.controlPoints`,
        "WarpDeformerKeyform must contain every topology point exactly once.", deformer.id));
    }
    for (const [pointIndex, position] of (positions || []).entries()) {
      if (!finite(position?.x) || !finite(position?.y)) {
        issues.push(problem("DEFORMER_CONTROL_POINT_INVALID",
          `${path}.controlPoints.${pointIndex}`, "Warp keyform coordinates must be finite.", deformer.id));
      }
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.kind === "deformer" && !deformerById.has(node.id)) {
      issues.push(problem("DEFORMER_CHILD_REFERENCE_INVALID", `scene.nodes.${node.id}`,
        "DeformerNode requires matching rig deformer data.", node.id));
    }
  }

  for (const deformer of deformers) {
    const seen = new Set();
    let node = nodes[deformer.id];
    while (node?.parentId) {
      if (seen.has(node.id)) {
        issues.push(problem("DEFORMER_CYCLE", `scene.nodes.${node.id}`,
          "Deformer hierarchy contains a cycle.", deformer.id));
        break;
      }
      seen.add(node.id);
      node = nodes[node.parentId];
    }
  }

  return issues.sort((left, right) =>
    compareText(left.code, right.code) || compareText(left.entityId || "", right.entityId || "") ||
    compareText(left.path, right.path));
}

export function warpDeformerValidationResult(project) {
  const issues = validateWarpDeformers(project);
  return { valid: issues.length === 0, issues };
}
