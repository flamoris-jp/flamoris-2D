function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unchanged(mesh, diagnostics = []) {
  return { mesh: { ...mesh, positions: [...(mesh?.positions || [])] }, diagnostics };
}

function diagnostic(code, message, details = {}) {
  return { code, message, correctionId: details.correctionId || null,
    topologyId: details.topologyId || null, vertexId: details.vertexId || null,
    ...(details.details ? { details: details.details } : {}) };
}

function validateInput(mesh, topology, keyforms) {
  const issues = [];
  if (!topology || !Array.isArray(topology.vertexIds) ||
    mesh?.positions?.length !== topology.vertexIds.length * 2) {
    issues.push(diagnostic("MESH_FORM_CORRECTION_TOPOLOGY_INVALID",
      "Form correction requires one finite x/y position per stable topology vertex.",
      { topologyId: topology?.id || null }));
  }
  if (![...(mesh?.positions || [])].every(Number.isFinite)) {
    issues.push(diagnostic("MESH_FORM_CORRECTION_POSITION_INVALID",
      "Form correction requires finite mesh positions.", { topologyId: topology?.id || null }));
  }
  for (const keyform of keyforms.filter(Boolean)) {
    if (keyform.topologyId !== topology?.id) issues.push(diagnostic(
      "MESH_FORM_CORRECTION_TOPOLOGY_INCOMPATIBLE",
      "Form correction topology does not match evaluated geometry.",
      { correctionId: keyform.id, topologyId: topology?.id || null,
        details: { correctionTopologyId: keyform.topologyId } }));
  }
  return issues.sort((left, right) => compareText(left.code, right.code) ||
    compareText(left.correctionId || "", right.correctionId || ""));
}

function offsets(keyform, topology, issues) {
  const values = new Map();
  if (!keyform) return values;
  const allowed = new Set(topology.vertexIds);
  for (const entry of keyform.vertexOffsets || []) {
    if (!allowed.has(entry.vertexId)) {
      issues.push(diagnostic("MESH_FORM_CORRECTION_VERTEX_MISSING",
        "Form correction references a stable vertex outside evaluated topology.",
        { correctionId: keyform.id, topologyId: topology.id, vertexId: entry.vertexId }));
      continue;
    }
    if (values.has(entry.vertexId)) {
      issues.push(diagnostic("MESH_FORM_CORRECTION_VERTEX_DUPLICATE",
        "Form correction contains a duplicate stable vertex entry.",
        { correctionId: keyform.id, topologyId: topology.id, vertexId: entry.vertexId }));
      continue;
    }
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) {
      issues.push(diagnostic("MESH_FORM_CORRECTION_OFFSET_INVALID",
        "Form correction offsets must be finite.",
        { correctionId: keyform.id, topologyId: topology.id, vertexId: entry.vertexId }));
      continue;
    }
    values.set(entry.vertexId, entry);
  }
  return values;
}

export function evaluateMeshFormCorrection({ mesh, topology, keyform }) {
  if (!keyform) return unchanged(mesh);
  const issues = validateInput(mesh, topology, [keyform]);
  const values = topology ? offsets(keyform, topology, issues) : new Map();
  if (issues.length) return unchanged(mesh, issues);
  const positions = [...mesh.positions];
  topology.vertexIds.forEach((vertexId, index) => {
    const offset = values.get(vertexId);
    if (!offset) return;
    positions[index * 2] += offset.x;
    positions[index * 2 + 1] += offset.y;
  });
  return { mesh: { ...mesh, positions }, diagnostics: [] };
}

export function evaluateInterpolatedMeshFormCorrection({
  mesh, topology, fromKeyform, toKeyform, geometryWeight,
}) {
  if (!fromKeyform && !toKeyform) return unchanged(mesh);
  const issues = validateInput(mesh, topology, [fromKeyform, toKeyform]);
  if (fromKeyform && toKeyform &&
    (fromKeyform.semanticSlotId !== toKeyform.semanticSlotId ||
      fromKeyform.topologyId !== toKeyform.topologyId)) {
    issues.push(diagnostic("MESH_FORM_CORRECTION_TRANSITION_INCOMPATIBLE",
      "Morph endpoint form corrections require compatible topology and SemanticSlot.",
      { correctionId: fromKeyform.id, topologyId: topology?.id || null,
        details: { fromCorrectionId: fromKeyform.id, toCorrectionId: toKeyform.id } }));
  }
  const from = topology ? offsets(fromKeyform, topology, issues) : new Map();
  const to = topology ? offsets(toKeyform, topology, issues) : new Map();
  if (issues.length) return unchanged(mesh, issues.sort((left, right) =>
    compareText(left.code, right.code) || compareText(left.vertexId || "", right.vertexId || "")));
  const weight = Math.min(1, Math.max(0, geometryWeight));
  const positions = [...mesh.positions];
  topology.vertexIds.forEach((vertexId, index) => {
    const a = from.get(vertexId) || { x: 0, y: 0 };
    const b = to.get(vertexId) || { x: 0, y: 0 };
    positions[index * 2] += a.x + (b.x - a.x) * weight;
    positions[index * 2 + 1] += a.y + (b.y - a.y) * weight;
  });
  return { mesh: { ...mesh, positions }, diagnostics: [] };
}
