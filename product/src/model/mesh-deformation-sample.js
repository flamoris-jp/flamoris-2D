import { cloneProject } from "./project.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MeshDeformationSampleCanonicalizationError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "MeshDeformationSampleCanonicalizationError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details = null) {
  throw new MeshDeformationSampleCanonicalizationError(message, code, details);
}

export function canonicalizeMeshDeformationOffsets(offsets) {
  if (!Array.isArray(offsets)) {
    fail("Mesh deformation offsets must be an array.", "ANIMATION_DEFORMATION_OFFSET_INVALID");
  }
  const seen = new Set();
  return offsets.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).sort().join("\0") !== ["dx", "dy", "vertexId"].join("\0") ||
      typeof entry.vertexId !== "string" || !entry.vertexId.trim()) {
      fail("Mesh deformation offset must contain a stable vertexId, dx, and dy.",
        "ANIMATION_DEFORMATION_OFFSET_INVALID");
    }
    if (seen.has(entry.vertexId)) {
      fail("Mesh deformation sample cannot contain duplicate stable vertex entries.",
        "ANIMATION_DEFORMATION_VERTEX_DUPLICATE", { vertexId: entry.vertexId });
    }
    seen.add(entry.vertexId);
    if (!Number.isFinite(entry.dx) || !Number.isFinite(entry.dy)) {
      fail("Mesh deformation offsets must be finite.",
        "ANIMATION_DEFORMATION_OFFSET_INVALID", { vertexId: entry.vertexId });
    }
    if (entry.dx === 0 && entry.dy === 0) return null;
    return { vertexId: entry.vertexId, dx: entry.dx, dy: entry.dy };
  }).filter(Boolean).sort((left, right) => compareText(left.vertexId, right.vertexId));
}

export function normalizeMeshDeformationSample(sample) {
  return {
    id: sample.id,
    meshId: sample.meshId,
    topologyId: sample.topologyId,
    offsets: cloneProject(canonicalizeMeshDeformationOffsets(sample.offsets)),
  };
}

export function canonicalizeMeshDeformationSamples(samples) {
  return [...samples]
    .map(normalizeMeshDeformationSample)
    .sort((left, right) => compareText(left.id, right.id));
}
