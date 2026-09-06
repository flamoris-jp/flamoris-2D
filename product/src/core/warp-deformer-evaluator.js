import { invertAffine, transformPoint } from "./transforms.js";

const IDENTITY_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);

export class WarpDeformerEvaluationError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "WarpDeformerEvaluationError";
    this.code = code;
    this.details = details;
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function bilerp(topLeft, topRight, bottomLeft, bottomRight, x, y) {
  return lerp(lerp(topLeft, topRight, x), lerp(bottomLeft, bottomRight, x), y);
}

function assertFinitePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new WarpDeformerEvaluationError(
      "Warp evaluation requires finite point coordinates.",
      "DEFORMER_CONTROL_POINT_INVALID",
    );
  }
}

function evaluationTopology(deformer, controlPoints, keyform) {
  const topologyById = new Map(controlPoints.map((point) => [point.id, point]));
  const positionById = new Map(keyform.controlPoints.map((point) => [point.controlPointId, point]));
  return deformer.controlPointIds.map((id) => {
    const topology = topologyById.get(id);
    const position = positionById.get(id);
    if (!topology || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new WarpDeformerEvaluationError(
        `Warp keyform is incompatible at control point ${id}.`,
        "DEFORMER_KEYFORM_INCOMPATIBLE",
        { deformerId: deformer.id, controlPointId: id },
      );
    }
    const baseX = deformer.bounds.left + topology.u * (deformer.bounds.right - deformer.bounds.left);
    const baseY = deformer.bounds.top + topology.v * (deformer.bounds.bottom - deformer.bounds.top);
    return { dx: position.x - baseX, dy: position.y - baseY };
  });
}

export function evaluateWarpPoint({ deformer, controlPoints, keyform }, point) {
  assertFinitePoint(point);
  const width = deformer.bounds.right - deformer.bounds.left;
  const height = deformer.bounds.bottom - deformer.bounds.top;
  if (!(width > 0) || !(height > 0)) {
    throw new WarpDeformerEvaluationError(
      "Warp bounds must have positive finite dimensions.",
      "DEFORMER_CONTROL_POINT_INVALID",
      { deformerId: deformer.id },
    );
  }
  const normalizedX = clamp01((point.x - deformer.bounds.left) / width);
  const normalizedY = clamp01((point.y - deformer.bounds.top) / height);
  const scaledX = normalizedX * (deformer.columns - 1);
  const scaledY = normalizedY * (deformer.rows - 1);
  const column = Math.min(Math.floor(scaledX), deformer.columns - 2);
  const row = Math.min(Math.floor(scaledY), deformer.rows - 2);
  const cellX = scaledX - column;
  const cellY = scaledY - row;
  const points = evaluationTopology(deformer, controlPoints, keyform);
  const index = row * deformer.columns + column;
  const topLeft = points[index];
  const topRight = points[index + 1];
  const bottomLeft = points[index + deformer.columns];
  const bottomRight = points[index + deformer.columns + 1];
  return {
    x: point.x + bilerp(topLeft.dx, topRight.dx, bottomLeft.dx, bottomRight.dx, cellX, cellY),
    y: point.y + bilerp(topLeft.dy, topRight.dy, bottomLeft.dy, bottomRight.dy, cellX, cellY),
  };
}

export function evaluateWarpPoints(stage, positions) {
  if (!Array.isArray(positions) && !ArrayBuffer.isView(positions)) {
    throw new TypeError("Warp positions must be a flat numeric array.");
  }
  if (positions.length % 2 !== 0) {
    throw new TypeError("Warp positions must contain x/y pairs.");
  }
  const toLocal = stage.toDeformerLocal || IDENTITY_AFFINE;
  const fromLocal = stage.fromDeformerLocal || invertAffine(toLocal);
  const result = [];
  for (let index = 0; index < positions.length; index += 2) {
    const local = transformPoint(toLocal, { x: positions[index], y: positions[index + 1] });
    const deformed = evaluateWarpPoint(stage, local);
    const output = transformPoint(fromLocal, deformed);
    result.push(output.x, output.y);
  }
  return result;
}

export function evaluateWarpStages(positions, stages) {
  return stages.reduce((current, stage) => evaluateWarpPoints(stage, current), [...positions]);
}

export function warpDeformerAncestors(project, nodeId) {
  const ancestors = [];
  const visited = new Set();
  let node = project.scene.nodes[nodeId];
  if (!node) throw new WarpDeformerEvaluationError(
    `Unknown Scene node ${nodeId}.`, "DEFORMER_CHILD_REFERENCE_INVALID", { nodeId });
  while (node.parentId) {
    if (visited.has(node.id)) throw new WarpDeformerEvaluationError(
      "Deformer hierarchy contains a cycle.", "DEFORMER_CYCLE", { nodeId });
    visited.add(node.id);
    node = project.scene.nodes[node.parentId];
    if (!node) throw new WarpDeformerEvaluationError(
      "Deformer hierarchy references a missing parent.", "DEFORMER_PARENT_MISSING", { nodeId });
    if (node.kind === "deformer") ancestors.push(node.id);
  }
  return ancestors.reverse();
}

export function createWarpEvaluationStages(project, nodeId, keyArtId, {
  spaceForDeformer = () => ({}),
} = {}) {
  const stages = [];
  const diagnostics = [];
  for (const deformerId of warpDeformerAncestors(project, nodeId)) {
    const deformer = project.rig.deformers.find((entry) => entry.id === deformerId);
    const keyform = project.rig.warpDeformerKeyforms.find((entry) =>
      entry.deformerId === deformerId && entry.keyArtId === keyArtId);
    if (!deformer) {
      diagnostics.push({
        code: "DEFORMER_CHILD_REFERENCE_INVALID", deformerId, nodeId,
        message: "DeformerNode has no matching WarpDeformer.",
      });
      continue;
    }
    if (!keyform) {
      diagnostics.push({
        code: "DEFORMER_KEYFORM_MISSING", deformerId, keyArtId, nodeId,
        message: "WarpDeformer has no keyform for this Key Art.",
      });
      continue;
    }
    stages.push({
      deformer,
      controlPoints: project.rig.warpControlPoints.filter((point) => point.deformerId === deformerId),
      keyform,
      ...spaceForDeformer(deformerId),
    });
  }
  return { stages, diagnostics };
}
