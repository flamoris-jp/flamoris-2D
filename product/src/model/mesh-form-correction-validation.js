function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(code, path, message, entityId = null, details = null) {
  return { code, path, message, entityId, severity: "error", ...(details ? { details } : {}) };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function exactKeys(value, expected) {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function meshFormCorrectionsReferencingTopology(project, topologyId) {
  return [...(project.meshFormCorrectionKeyforms || [])]
    .filter((entry) => entry?.topologyId === topologyId)
    .sort((left, right) => compareText(left.id, right.id));
}

export function meshFormCorrectionsForContext(project, {
  topologyId, keyArtId, semanticSlotId,
}) {
  return [...(project.meshFormCorrectionKeyforms || [])]
    .filter((entry) => entry?.topologyId === topologyId &&
      entry?.keyArtId === keyArtId && entry?.semanticSlotId === semanticSlotId)
    .sort((left, right) => compareText(left.id, right.id));
}

export function meshFormCorrectionForContext(project, context) {
  return meshFormCorrectionsForContext(project, context)[0] || null;
}

export function validateMeshFormCorrections(project) {
  const values = project.meshFormCorrectionKeyforms;
  if (!Array.isArray(values)) return [issue(
    "collection.invalid", "meshFormCorrectionKeyforms",
    "meshFormCorrectionKeyforms must be an array.",
  )];
  const issues = [];
  const topologies = new Map((project.meshTopologies || []).map((entry) => [entry?.id, entry]));
  const keyArts = new Set((project.keyArts || []).map((entry) => entry?.id));
  const slots = new Set((project.semanticSlots || []).map((entry) => entry?.id));
  const contexts = new Map();
  for (const [index, value] of values.entries()) {
    const path = `meshFormCorrectionKeyforms.${index}`;
    if (!object(value)) {
      issues.push(issue("MESH_FORM_CORRECTION_INVALID", path,
        "MeshFormCorrectionKeyform must be an object."));
      continue;
    }
    if (!nonEmpty(value.id)) issues.push(issue("identity.missing", `${path}.id`,
      "MeshFormCorrectionKeyform stable ID is required."));
    if (!exactKeys(value, ["id", "topologyId", "keyArtId", "semanticSlotId", "vertexOffsets"])) {
      issues.push(issue("MESH_FORM_CORRECTION_INVALID", path,
        "MeshFormCorrectionKeyform contains missing or unsupported persistent fields.", value.id || null));
    }
    const topology = topologies.get(value.topologyId);
    if (!topology) issues.push(issue("MESH_FORM_CORRECTION_TOPOLOGY_MISSING", `${path}.topologyId`,
      "Mesh form correction topology does not exist.", value.id || null,
      { topologyId: value.topologyId ?? null }));
    if (!keyArts.has(value.keyArtId)) issues.push(issue("MESH_FORM_CORRECTION_KEY_ART_MISSING", `${path}.keyArtId`,
      "Mesh form correction Key Art does not exist.", value.id || null,
      { keyArtId: value.keyArtId ?? null }));
    if (!slots.has(value.semanticSlotId)) issues.push(issue("MESH_FORM_CORRECTION_SEMANTIC_SLOT_MISSING", `${path}.semanticSlotId`,
      "Mesh form correction SemanticSlot does not exist.", value.id || null,
      { semanticSlotId: value.semanticSlotId ?? null }));
    const context = `${value.topologyId}\u0000${value.keyArtId}\u0000${value.semanticSlotId}`;
    if (contexts.has(context)) issues.push(issue("MESH_FORM_CORRECTION_CONTEXT_DUPLICATE", path,
      "Only one MeshFormCorrectionKeyform may exist for a topology, Key Art, and SemanticSlot.",
      value.id || null, { correctionIds: [contexts.get(context), value.id].sort(compareText) }));
    else contexts.set(context, value.id);
    const compatible = (project.meshKeyforms || []).some((keyform) =>
      keyform.topologyId === value.topologyId && keyform.keyArtId === value.keyArtId &&
      keyform.semanticSlotId === value.semanticSlotId);
    if (!compatible) issues.push(issue("MESH_FORM_CORRECTION_CONTEXT_INCOMPATIBLE", path,
      "Mesh form correction requires a compatible MeshKeyform context.", value.id || null,
      { topologyId: value.topologyId, keyArtId: value.keyArtId, semanticSlotId: value.semanticSlotId }));
    if (!Array.isArray(value.vertexOffsets)) {
      issues.push(issue("MESH_FORM_CORRECTION_VERTEX_INVALID", `${path}.vertexOffsets`,
        "Mesh form correction vertexOffsets must be an array.", value.id || null));
      continue;
    }
    const vertexIds = new Set(topology?.vertexIds || []);
    const seen = new Set();
    let previous = null;
    for (const [offsetIndex, entry] of value.vertexOffsets.entries()) {
      const offsetPath = `${path}.vertexOffsets.${offsetIndex}`;
      if (!object(entry) || !exactKeys(entry, ["vertexId", "x", "y"])) {
        issues.push(issue("MESH_FORM_CORRECTION_VERTEX_INVALID", offsetPath,
          "Vertex offset must contain only vertexId, x, and y.", value.id || null));
        continue;
      }
      if (!vertexIds.has(entry.vertexId)) issues.push(issue("MESH_FORM_CORRECTION_VERTEX_MISSING", `${offsetPath}.vertexId`,
        "Mesh form correction references a stable vertex outside its topology.", value.id || null,
        { topologyId: value.topologyId, vertexId: entry.vertexId ?? null }));
      if (seen.has(entry.vertexId)) issues.push(issue("MESH_FORM_CORRECTION_VERTEX_DUPLICATE", `${offsetPath}.vertexId`,
        "Mesh form correction contains a duplicate stable vertex entry.", value.id || null,
        { vertexId: entry.vertexId }));
      seen.add(entry.vertexId);
      if (previous !== null && compareText(previous, entry.vertexId) > 0) issues.push(issue(
        "MESH_FORM_CORRECTION_VERTEX_ORDER_INVALID", `${path}.vertexOffsets`,
        "Mesh form correction entries must use canonical stable vertex-ID order.", value.id || null));
      previous = entry.vertexId;
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) issues.push(issue(
        "MESH_FORM_CORRECTION_OFFSET_INVALID", offsetPath,
        "Mesh form correction offsets must be finite.", value.id || null,
        { vertexId: entry.vertexId }));
      else if (entry.x === 0 && entry.y === 0) issues.push(issue(
        "MESH_FORM_CORRECTION_ZERO_OFFSET", offsetPath,
        "Sparse form correction must omit explicit zero offsets.", value.id || null,
        { vertexId: entry.vertexId }));
    }
  }
  return issues.sort((left, right) => compareText(left.code, right.code) ||
    compareText(left.entityId || "", right.entityId || "") || compareText(left.path, right.path) ||
    compareText(JSON.stringify(left.details || {}), JSON.stringify(right.details || {})));
}

export function meshFormCorrectionValidationResult(project) {
  const issues = validateMeshFormCorrections(project);
  return { valid: issues.length === 0, issues };
}
