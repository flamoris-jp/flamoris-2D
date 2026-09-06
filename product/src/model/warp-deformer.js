import { cloneProject } from "./project.js";

export const WARP_GRID_PRESETS = Object.freeze([2, 3, 4]);

export function isWarpGridDimension(value) {
  return Number.isInteger(value) && WARP_GRID_PRESETS.includes(value);
}

export function createRegularWarpControlPoints({
  deformerId,
  columns,
  rows,
  controlPointIds,
}) {
  if (!isWarpGridDimension(columns) || !isWarpGridDimension(rows)) {
    throw new TypeError("Warp grid dimensions must use the 2x2, 3x3, or 4x4 presets.");
  }
  if (!Array.isArray(controlPointIds) || controlPointIds.length !== columns * rows) {
    throw new TypeError("Warp grid requires one stable ID per control point.");
  }
  return controlPointIds.map((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id,
      deformerId,
      u: column / (columns - 1),
      v: row / (rows - 1),
    };
  });
}

export function createWarpDeformer({
  id,
  displayName,
  parentNodeId,
  columns,
  rows,
  bounds,
  controlPointIds,
}) {
  const deformer = {
    id,
    type: "warp",
    displayName,
    parentNodeId,
    columns,
    rows,
    bounds: cloneProject(bounds),
    controlPointIds: [...controlPointIds],
  };
  return {
    deformer,
    controlPoints: createRegularWarpControlPoints({
      deformerId: id,
      columns,
      rows,
      controlPointIds,
    }),
  };
}

export function defaultWarpKeyformControlPoints(deformer, controlPoints) {
  const byId = new Map(controlPoints.map((point) => [point.id, point]));
  const width = deformer.bounds.right - deformer.bounds.left;
  const height = deformer.bounds.bottom - deformer.bounds.top;
  return deformer.controlPointIds.map((controlPointId) => {
    const point = byId.get(controlPointId);
    if (!point) throw new Error(`Missing WarpControlPoint ${controlPointId}.`);
    return {
      controlPointId,
      x: deformer.bounds.left + point.u * width,
      y: deformer.bounds.top + point.v * height,
    };
  });
}
