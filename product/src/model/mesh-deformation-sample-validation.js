function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(code, path, message, entityId = null, details = null) {
  return { code, path, message, entityId, severity: "error", ...(details ? { details } : {}) };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!object(value)) return false;
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function validateMeshDeformationSamples(project) {
  const samples = project.animation?.deformationSamples;
  if (!Array.isArray(samples)) return [issue(
    "collection.invalid",
    "animation.deformationSamples",
    "animation.deformationSamples must be an array.",
  )];
  const issues = [];
  const meshes = new Set((project.meshes || []).map((entry) => entry?.id));
  const topologies = new Map((project.meshTopologies || []).map((entry) => [entry?.id, entry]));
  samples.forEach((sample, sampleIndex) => {
    const path = "animation.deformationSamples." + sampleIndex;
    if (!object(sample)) {
      issues.push(issue("ANIMATION_DEFORMATION_SAMPLE_INVALID", path,
        "MeshDeformationSample must be an object."));
      return;
    }
    if (!exactKeys(sample, ["id", "meshId", "topologyId", "offsets"])) {
      issues.push(issue("ANIMATION_DEFORMATION_SAMPLE_INVALID", path,
        "MeshDeformationSample contains missing or unsupported persistent fields.", sample.id || null));
    }
    if (typeof sample.id !== "string" || !sample.id.trim()) {
      issues.push(issue("identity.missing", path + ".id",
        "MeshDeformationSample stable ID is required."));
    }
    if (!meshes.has(sample.meshId)) {
      issues.push(issue("ANIMATION_TRACK_TARGET_INVALID", path + ".meshId",
        "MeshDeformationSample mesh does not exist.", sample.id || null,
        { meshId: sample.meshId ?? null }));
    }
    const topology = topologies.get(sample.topologyId);
    if (!topology) {
      issues.push(issue("ANIMATION_TOPOLOGY_INCOMPATIBLE", path + ".topologyId",
        "MeshDeformationSample topology does not exist.", sample.id || null,
        { topologyId: sample.topologyId ?? null }));
    }
    if (!Array.isArray(sample.offsets)) {
      issues.push(issue("ANIMATION_DEFORMATION_OFFSET_INVALID", path + ".offsets",
        "MeshDeformationSample offsets must be an array.", sample.id || null));
      return;
    }
    const vertexIds = new Set(topology?.vertexIds || []);
    const seen = new Set();
    let previousVertexId = null;
    sample.offsets.forEach((offset, offsetIndex) => {
      const offsetPath = path + ".offsets." + offsetIndex;
      if (!exactKeys(offset, ["vertexId", "dx", "dy"]) ||
        typeof offset.vertexId !== "string" || !offset.vertexId.trim()) {
        issues.push(issue("ANIMATION_DEFORMATION_OFFSET_INVALID", offsetPath,
          "Mesh deformation offset must contain only stable vertexId, dx, and dy.", sample.id || null));
        return;
      }
      if (!vertexIds.has(offset.vertexId)) {
        issues.push(issue("ANIMATION_TOPOLOGY_INCOMPATIBLE", offsetPath + ".vertexId",
          "Mesh deformation offset references a vertex outside its topology.", sample.id || null,
          { topologyId: sample.topologyId, vertexId: offset.vertexId }));
      }
      if (seen.has(offset.vertexId)) {
        issues.push(issue("ANIMATION_DEFORMATION_VERTEX_DUPLICATE", offsetPath + ".vertexId",
          "Mesh deformation sample contains a duplicate stable vertex entry.", sample.id || null,
          { vertexId: offset.vertexId }));
      }
      seen.add(offset.vertexId);
      if (previousVertexId !== null && compareText(previousVertexId, offset.vertexId) > 0) {
        issues.push(issue("ANIMATION_DEFORMATION_VERTEX_ORDER_INVALID", path + ".offsets",
          "Mesh deformation offsets must use canonical stable vertex-ID order.", sample.id || null));
      }
      previousVertexId = offset.vertexId;
      if (!Number.isFinite(offset.dx) || !Number.isFinite(offset.dy)) {
        issues.push(issue("ANIMATION_DEFORMATION_OFFSET_INVALID", offsetPath,
          "Mesh deformation dx and dy must be finite.", sample.id || null,
          { vertexId: offset.vertexId }));
      } else if (offset.dx === 0 && offset.dy === 0) {
        issues.push(issue("ANIMATION_DEFORMATION_OFFSET_INVALID", offsetPath,
          "Sparse mesh deformation samples must omit explicit zero offsets.", sample.id || null,
          { vertexId: offset.vertexId }));
      }
    });
  });
  return issues.sort((left, right) => compareText(left.code, right.code) ||
    compareText(left.entityId || "", right.entityId || "") || compareText(left.path, right.path) ||
    compareText(JSON.stringify(left.details || {}), JSON.stringify(right.details || {})));
}
