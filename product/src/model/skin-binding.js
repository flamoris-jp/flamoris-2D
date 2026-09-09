import { cloneProject } from "./project.js";

export const SKIN_WEIGHT_SUM_TOLERANCE = 1e-6;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class SkinBindingCanonicalizationError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "SkinBindingCanonicalizationError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details = null) {
  throw new SkinBindingCanonicalizationError(message, code, details);
}

export function canonicalizeSkinInfluences(influences, {
  tolerance = SKIN_WEIGHT_SUM_TOLERANCE,
  vertexId = null,
} = {}) {
  if (!Array.isArray(influences) || influences.length < 1 || influences.length > 4) {
    fail(
      "A weighted vertex requires one to four Bone influences.",
      "SKIN_BINDING_INFLUENCE_COUNT_INVALID",
      { vertexId, influenceCount: Array.isArray(influences) ? influences.length : null },
    );
  }
  const seen = new Set();
  const sorted = influences.map((influence) => {
    if (!influence || typeof influence !== "object" || Array.isArray(influence) ||
      typeof influence.boneId !== "string" || !influence.boneId.trim()) {
      fail("Skin influence Bone ID is required.", "BONE_NODE_MISSING", { vertexId });
    }
    if (seen.has(influence.boneId)) {
      fail(
        "A weighted vertex cannot reference the same Bone more than once.",
        "SKIN_BINDING_INFLUENCE_DUPLICATE",
        { vertexId, boneId: influence.boneId },
      );
    }
    seen.add(influence.boneId);
    if (!Number.isFinite(influence.weight) || !(influence.weight > 0) ||
      influence.weight > 1) {
      fail(
        "Skin influence weight must be finite, greater than zero, and at most one.",
        "SKIN_BINDING_WEIGHT_INVALID",
        { vertexId, boneId: influence.boneId, weight: influence.weight ?? null },
      );
    }
    return { boneId: influence.boneId, weight: influence.weight };
  }).sort((left, right) => compareText(left.boneId, right.boneId));
  const sum = sorted.reduce((total, influence) => total + influence.weight, 0);
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > tolerance) {
    fail(
      `Skin influence weights must sum to 1 within ${tolerance}.`,
      "SKIN_BINDING_WEIGHT_NOT_NORMALIZED",
      { vertexId, sum, tolerance },
    );
  }
  let normalizedSum = 0;
  return sorted.map((influence, index) => {
    const weight = index === sorted.length - 1
      ? 1 - normalizedSum
      : influence.weight / sum;
    if (!Number.isFinite(weight) || !(weight > 0)) {
      fail(
        "Canonical skin influence weight must remain finite and positive.",
        "SKIN_BINDING_WEIGHT_INVALID",
        { vertexId, boneId: influence.boneId, weight },
      );
    }
    normalizedSum += weight;
    return { boneId: influence.boneId, weight };
  });
}

export function canonicalizeSkinVertexWeights(vertexWeights, options = {}) {
  if (!Array.isArray(vertexWeights)) {
    fail("SkinBinding vertexWeights must be an array.", "SKIN_BINDING_VERTEX_INVALID");
  }
  const seen = new Set();
  return vertexWeights.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof entry.vertexId !== "string" || !entry.vertexId.trim()) {
      fail("Skin weight stable vertex ID is required.", "SKIN_BINDING_VERTEX_INVALID");
    }
    if (seen.has(entry.vertexId)) {
      fail(
        "SkinBinding cannot contain duplicate stable vertex entries.",
        "SKIN_BINDING_VERTEX_DUPLICATE",
        { vertexId: entry.vertexId },
      );
    }
    seen.add(entry.vertexId);
    return {
      vertexId: entry.vertexId,
      influences: canonicalizeSkinInfluences(entry.influences, {
        ...options,
        vertexId: entry.vertexId,
      }),
    };
  }).sort((left, right) => compareText(left.vertexId, right.vertexId));
}

export function createSkinBinding({
  id,
  targetNodeId,
  topologyId,
  enabled = true,
  vertexWeights = [],
}) {
  return {
    id,
    targetNodeId,
    topologyId,
    enabled,
    vertexWeights: cloneProject(canonicalizeSkinVertexWeights(vertexWeights)),
  };
}
