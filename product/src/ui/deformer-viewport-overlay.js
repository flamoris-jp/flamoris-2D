import {
  createWarpEvaluationStages,
  evaluateWarpStageLattice,
} from "../core/warp-deformer-evaluator.js";
import { invertAffine, worldTransformMatrix } from "../core/transforms.js";
import { imageToScreen } from "../mesh.js";

function resolvedParentStages(project, deformerId, keyArtId) {
  const resolved = createWarpEvaluationStages(project, deformerId, keyArtId, {
    spaceForDeformer: (id) => ({
      toDeformerLocal: invertAffine(worldTransformMatrix(project, id)),
      fromDeformerLocal: worldTransformMatrix(project, id),
    }),
  });
  if (resolved.diagnostics.length) return resolved;
  const stages = [];
  for (const stage of resolved.stages) {
    stages.push(stages.length ? evaluateWarpStageLattice(stage, stages) : stage);
  }
  return { stages, diagnostics: [] };
}

export function projectDeformerLattice({
  project,
  deformer,
  keyArtId,
  controlPoints,
  view,
}) {
  if (!project || !deformer || !keyArtId || !view) return { points: [], segments: [], diagnostics: [] };
  const parents = resolvedParentStages(project, deformer.id, keyArtId);
  if (parents.diagnostics.length) return { points: [], segments: [], diagnostics: parents.diagnostics };
  const stage = {
    deformer,
    controlPoints: deformer.controlPoints,
    keyform: { deformerId: deformer.id, keyArtId, controlPoints },
    toDeformerLocal: invertAffine(worldTransformMatrix(project, deformer.id)),
    fromDeformerLocal: worldTransformMatrix(project, deformer.id),
  };
  const evaluated = evaluateWarpStageLattice(stage, parents.stages);
  const points = deformer.controlPointIds.map((controlPointId, index) => {
    const documentPoint = {
      x: evaluated.evaluatedLattice.authored[index * 2],
      y: evaluated.evaluatedLattice.authored[index * 2 + 1],
    };
    return {
      controlPointId,
      document: documentPoint,
      screen: imageToScreen(documentPoint.x, documentPoint.y, view),
    };
  });
  const segments = [];
  for (let row = 0; row < deformer.rows; row += 1) {
    for (let column = 0; column < deformer.columns - 1; column += 1) {
      segments.push([row * deformer.columns + column, row * deformer.columns + column + 1]);
    }
  }
  for (let column = 0; column < deformer.columns; column += 1) {
    for (let row = 0; row < deformer.rows - 1; row += 1) {
      segments.push([row * deformer.columns + column, (row + 1) * deformer.columns + column]);
    }
  }
  return { points, segments, diagnostics: [] };
}

export function nearestDeformerControlPoint(projected, screenPoint, radius = 12) {
  let nearest = null;
  let distance = radius;
  for (const point of projected?.points || []) {
    const candidate = Math.hypot(point.screen.x - screenPoint.x, point.screen.y - screenPoint.y);
    if (candidate < distance) {
      nearest = point.controlPointId;
      distance = candidate;
    }
  }
  return nearest;
}
