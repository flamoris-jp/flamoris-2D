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

function pointAt(values, index) {
  return { x: values[index * 2], y: values[index * 2 + 1] };
}

function cross(left, right) {
  return left.x * right.y - left.y * right.x;
}

function subtract(left, right) {
  return { x: left.x - right.x, y: left.y - right.y };
}

function addScaled(left, right, amount) {
  return { x: left.x + right.x * amount, y: left.y + right.y * amount };
}

function squaredDistance(left, right) {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
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

export function interpolateWarpKeyforms(deformer, fromKeyform, toKeyform, amount) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
    throw new WarpDeformerEvaluationError(
      "Warp keyform interpolation weight must be between zero and one.",
      "DEFORMER_CONTROL_POINT_INVALID",
      { deformerId: deformer.id },
    );
  }
  const canonical = (keyform, endpoint) => {
    if (!keyform || keyform.deformerId !== deformer.id) {
      throw new WarpDeformerEvaluationError(
        `Warp ${endpoint} keyform is missing or belongs to another deformer.`,
        keyform ? "DEFORMER_KEYFORM_INCOMPATIBLE" : "DEFORMER_KEYFORM_MISSING",
        { deformerId: deformer.id, endpoint },
      );
    }
    const byId = new Map();
    for (const point of keyform.controlPoints || []) {
      if (byId.has(point.controlPointId) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new WarpDeformerEvaluationError(
          `Warp ${endpoint} keyform has invalid control points.`,
          "DEFORMER_CONTROL_POINT_INVALID",
          { deformerId: deformer.id, endpoint, controlPointId: point.controlPointId },
        );
      }
      byId.set(point.controlPointId, point);
    }
    if (byId.size !== deformer.controlPointIds.length ||
      deformer.controlPointIds.some((id) => !byId.has(id))) {
      throw new WarpDeformerEvaluationError(
        `Warp ${endpoint} keyform does not match the deformer topology.`,
        "DEFORMER_KEYFORM_INCOMPATIBLE",
        { deformerId: deformer.id, endpoint },
      );
    }
    return byId;
  };
  const from = canonical(fromKeyform, "from");
  const to = canonical(toKeyform, "to");
  return {
    deformerId: deformer.id,
    keyArtId: amount === 0 ? fromKeyform.keyArtId : amount === 1 ? toKeyform.keyArtId : null,
    controlPoints: deformer.controlPointIds.map((controlPointId) => ({
      controlPointId,
      x: lerp(from.get(controlPointId).x, to.get(controlPointId).x, amount),
      y: lerp(from.get(controlPointId).y, to.get(controlPointId).y, amount),
    })),
  };
}

function localLatticePositions(stage) {
  const points = evaluationTopology(stage.deformer, stage.controlPoints, stage.keyform);
  const base = [];
  const authored = [];
  for (let index = 0; index < stage.deformer.controlPointIds.length; index += 1) {
    const controlPoint = stage.controlPoints.find((entry) =>
      entry.id === stage.deformer.controlPointIds[index]);
    const basePoint = {
      x: stage.deformer.bounds.left + controlPoint.u *
        (stage.deformer.bounds.right - stage.deformer.bounds.left),
      y: stage.deformer.bounds.top + controlPoint.v *
        (stage.deformer.bounds.bottom - stage.deformer.bounds.top),
    };
    base.push(basePoint.x, basePoint.y);
    authored.push(basePoint.x + points[index].dx, basePoint.y + points[index].dy);
  }
  return { base, authored };
}

function solveQuadratic(a, b, c) {
  const epsilon = 1e-12;
  if (Math.abs(a) <= epsilon) return Math.abs(b) <= epsilon ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -epsilon) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function evaluateCell(values, columns, row, column, u, v) {
  const index = row * columns + column;
  const topLeft = pointAt(values, index);
  const topRight = pointAt(values, index + 1);
  const bottomLeft = pointAt(values, index + columns);
  const bottomRight = pointAt(values, index + columns + 1);
  return {
    x: bilerp(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x, u, v),
    y: bilerp(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y, u, v),
  };
}

function inverseCellCandidates(values, columns, row, column, point) {
  const index = row * columns + column;
  const a = pointAt(values, index);
  const b = subtract(pointAt(values, index + 1), a);
  const c = subtract(pointAt(values, index + columns), a);
  const d = subtract(subtract(pointAt(values, index + columns + 1), a), {
    x: b.x + c.x,
    y: b.y + c.y,
  });
  const q = subtract(point, a);
  const candidates = [];
  for (const v of solveQuadratic(-cross(c, d), cross(q, d) - cross(c, b), cross(q, b))) {
    const direction = addScaled(b, d, v);
    const numerator = (q.x - c.x * v) * direction.x + (q.y - c.y * v) * direction.y;
    const denominator = direction.x * direction.x + direction.y * direction.y;
    if (denominator > 1e-12) candidates.push({ u: numerator / denominator, v });
  }
  for (const u of solveQuadratic(-cross(b, d), cross(q, d) - cross(b, c), cross(q, c))) {
    const direction = addScaled(c, d, u);
    const numerator = (q.x - b.x * u) * direction.x + (q.y - b.y * u) * direction.y;
    const denominator = direction.x * direction.x + direction.y * direction.y;
    if (denominator > 1e-12) candidates.push({ u, v: numerator / denominator });
  }
  return candidates;
}

function mapPointBetweenLattices(stage, source, target, point) {
  let best = null;
  for (let row = 0; row < stage.deformer.rows - 1; row += 1) {
    for (let column = 0; column < stage.deformer.columns - 1; column += 1) {
      for (const candidate of inverseCellCandidates(
        source, stage.deformer.columns, row, column, point,
      )) {
        const u = clamp01(candidate.u);
        const v = clamp01(candidate.v);
        const projectedSource = evaluateCell(
          source, stage.deformer.columns, row, column, u, v,
        );
        const distance = squaredDistance(point, projectedSource);
        const candidateResult = { row, column, u, v, projectedSource, distance };
        if (!best || distance < best.distance - 1e-10 ||
          (Math.abs(distance - best.distance) <= 1e-10 &&
            (row < best.row || row === best.row && column < best.column))) {
          best = candidateResult;
        }
      }
    }
  }
  if (!best) throw new WarpDeformerEvaluationError(
    "Warp lattice mapping is not evaluable.",
    "DEFORMER_KEYFORM_INCOMPATIBLE",
    { deformerId: stage.deformer.id },
  );
  const projectedTarget = evaluateCell(
    target, stage.deformer.columns, best.row, best.column, best.u, best.v,
  );
  return {
    x: point.x + projectedTarget.x - best.projectedSource.x,
    y: point.y + projectedTarget.y - best.projectedSource.y,
  };
}

function evaluateWarpedLatticePoint(stage, point) {
  const { base, authored } = stage.evaluatedLattice;
  return mapPointBetweenLattices(stage, base, authored, point);
}

/**
 * Deterministically maps a point from a stage's deformed cage back into its
 * undeformed input space. Bilinear cells are solved analytically; no frame
 * history or iterative approximation is involved.
 */
export function invertWarpPoint(stage, point) {
  assertFinitePoint(point);
  const toLocal = stage.toDeformerLocal || IDENTITY_AFFINE;
  const fromLocal = stage.fromDeformerLocal || invertAffine(toLocal);
  const localPoint = transformPoint(toLocal, point);
  const lattice = stage.evaluatedLattice || localLatticePositions(stage);
  const undeformed = mapPointBetweenLattices(
    stage, lattice.authored, lattice.base, localPoint,
  );
  return transformPoint(fromLocal, undeformed);
}

export function invertWarpStages(point, stages) {
  let current = { ...point };
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    current = invertWarpPoint(stages[index], current);
  }
  return current;
}

export function evaluateWarpPoint(stage, point) {
  const { deformer, controlPoints, keyform } = stage;
  assertFinitePoint(point);
  if (stage.evaluatedLattice) return evaluateWarpedLatticePoint(stage, point);
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
  let current = [...positions];
  const resolvedStages = [];
  for (const stage of stages) {
    const resolved = resolvedStages.length
      ? evaluateWarpStageLattice(stage, resolvedStages)
      : stage;
    current = evaluateWarpPoints(resolved, current);
    resolvedStages.push(resolved);
  }
  return current;
}

/**
 * Projects a child lattice through all already-resolved parent stages. The
 * resulting cage remains non-affine, so child evaluation uses the projected
 * base and authored control positions rather than an approximated transform.
 */
export function evaluateWarpStageLattice(stage, parentStages) {
  const local = localLatticePositions(stage);
  const fromLocal = stage.fromDeformerLocal || invertAffine(stage.toDeformerLocal || IDENTITY_AFFINE);
  let base = [];
  let authored = [];
  for (let index = 0; index < local.base.length; index += 2) {
    const basePoint = transformPoint(fromLocal, { x: local.base[index], y: local.base[index + 1] });
    const authoredPoint = transformPoint(fromLocal, {
      x: local.authored[index], y: local.authored[index + 1],
    });
    base.push(basePoint.x, basePoint.y);
    authored.push(authoredPoint.x, authoredPoint.y);
  }
  for (const parent of parentStages) {
    base = evaluateWarpPoints(parent, base);
    authored = evaluateWarpPoints(parent, authored);
  }
  return {
    ...stage,
    toDeformerLocal: IDENTITY_AFFINE,
    fromDeformerLocal: IDENTITY_AFFINE,
    evaluatedLattice: { base, authored },
  };
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
