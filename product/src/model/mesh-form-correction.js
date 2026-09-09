import { cloneProject } from "./project.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MeshFormCorrectionCanonicalizationError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "MeshFormCorrectionCanonicalizationError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details = null) {
  throw new MeshFormCorrectionCanonicalizationError(message, code, details);
}

export function canonicalizeMeshFormVertexOffsets(vertexOffsets) {
  if (!Array.isArray(vertexOffsets)) {
    fail("Mesh form correction vertexOffsets must be an array.",
      "MESH_FORM_CORRECTION_VERTEX_INVALID");
  }
  const seen = new Set();
  return vertexOffsets.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof entry.vertexId !== "string" || !entry.vertexId.trim()) {
      fail("Mesh form correction requires a stable vertex ID.",
        "MESH_FORM_CORRECTION_VERTEX_INVALID");
    }
    if (seen.has(entry.vertexId)) {
      fail("Mesh form correction cannot contain duplicate stable vertex entries.",
        "MESH_FORM_CORRECTION_VERTEX_DUPLICATE", { vertexId: entry.vertexId });
    }
    seen.add(entry.vertexId);
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) {
      fail("Mesh form correction offsets must be finite.",
        "MESH_FORM_CORRECTION_OFFSET_INVALID", { vertexId: entry.vertexId });
    }
    if (entry.x === 0 && entry.y === 0) return null;
    return { vertexId: entry.vertexId, x: entry.x, y: entry.y };
  }).filter(Boolean).sort((left, right) => compareText(left.vertexId, right.vertexId));
}

export function createMeshFormCorrectionKeyform({
  id,
  topologyId,
  keyArtId,
  semanticSlotId,
  vertexOffsets = [],
}) {
  return {
    id,
    topologyId,
    keyArtId,
    semanticSlotId,
    vertexOffsets: cloneProject(canonicalizeMeshFormVertexOffsets(vertexOffsets)),
  };
}
