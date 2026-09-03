const TRANSITION_MODES = new Set([
  "morph",
  "hold",
  "replace",
  "appear",
  "disappear",
  "occlusion",
]);

function problem(code, path, message, entityId = null, severity = "error", details = null) {
  return {
    code,
    path,
    message,
    entityId,
    severity,
    ...(details ? { details } : {}),
  };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function collection(project, name, issues) {
  const value = project[name];
  if (!Array.isArray(value)) {
    issues.push(problem("collection.invalid", name, name + " must be an array."));
    return [];
  }
  return value;
}

function descendants(project, rootNodeId) {
  const result = new Set();
  const visit = (nodeId) => {
    if (result.has(nodeId) || !project.scene?.nodes?.[nodeId]) return;
    result.add(nodeId);
    for (const childId of project.scene.nodes[nodeId].children || []) visit(childId);
  };
  visit(rootNodeId);
  return result;
}

export function keyArtMemberFor(keyArt, nodeId) {
  return (keyArt?.members || []).find((member) => member.nodeId === nodeId) || null;
}

export function semanticMappingFor(slot, keyArtId) {
  return (slot?.mappings || []).find((mapping) => mapping.keyArtId === keyArtId) || null;
}

export function validateTransitionDomain(project, register = () => {}) {
  const issues = [];
  const keyArts = collection(project, "keyArts", issues);
  const semanticSlots = collection(project, "semanticSlots", issues);
  const topologies = collection(project, "meshTopologies", issues);
  const keyforms = collection(project, "meshKeyforms", issues);
  const transitions = collection(project, "transitions", issues);
  const keyArtById = new Map(keyArts.map((entry) => [entry?.id, entry]));
  const slotById = new Map(semanticSlots.map((entry) => [entry?.id, entry]));
  const topologyById = new Map(topologies.map((entry) => [entry?.id, entry]));
  const keyformById = new Map(keyforms.map((entry) => [entry?.id, entry]));
  const programById = new Map((project.temporalPrograms || []).map((entry) => [entry?.id, entry]));

  for (const [index, keyArt] of keyArts.entries()) {
    const path = "keyArts." + index;
    if (!object(keyArt)) {
      issues.push(problem("KEYART_INVALID", path, "KeyArt must be an object."));
      continue;
    }
    if (unknownKeys(keyArt, ["id", "displayName", "rootNodeId", "sourceAssetId", "members", "metadata"]).length) {
      issues.push(problem("KEYART_INVALID", path, "KeyArt contains unsupported persistent fields.", keyArt.id));
    }
    if (!nonEmpty(keyArt.displayName)) {
      issues.push(problem("KEYART_INVALID", path + ".displayName", "KeyArt displayName is required.", keyArt.id));
    }
    if (keyArt.metadata != null && !object(keyArt.metadata)) {
      issues.push(problem("KEYART_INVALID", path + ".metadata", "KeyArt metadata must be an object.", keyArt.id));
    }
    if (!nonEmpty(keyArt.rootNodeId) || !project.scene?.nodes?.[keyArt.rootNodeId]) {
      issues.push(problem("KEYART_UNKNOWN_ROOT", path + ".rootNodeId", "KeyArt root node does not exist.", keyArt.id));
    }
    if (keyArt.sourceAssetId != null &&
      !(project.sourceAssets || []).some((asset) => asset.id === keyArt.sourceAssetId)) {
      issues.push(problem("KEYART_UNKNOWN_SOURCE", path + ".sourceAssetId", "KeyArt source asset does not exist.", keyArt.id));
    }
    if (keyArt.members != null && !Array.isArray(keyArt.members)) {
      issues.push(problem("KEYART_INVALID", path + ".members", "KeyArt members must be an array.", keyArt.id));
      continue;
    }
    const allowedNodes = descendants(project, keyArt.rootNodeId);
    const memberNodes = new Set();
    const drawOrders = new Map();
    for (const [memberIndex, member] of (keyArt.members || []).entries()) {
      const memberPath = path + ".members." + memberIndex;
      if (!object(member) || !nonEmpty(member.nodeId)) {
        issues.push(problem("KEYART_INVALID_MEMBER", memberPath, "KeyArt member requires nodeId.", keyArt.id));
        continue;
      }
      if (unknownKeys(member, ["nodeId", "appearanceId", "opacity", "presence", "drawOrder", "clipping"]).length) {
        issues.push(problem("KEYART_INVALID_MEMBER", memberPath, "KeyArt member contains unsupported persistent fields.", member.nodeId));
      }
      if (!project.scene?.nodes?.[member.nodeId] || !allowedNodes.has(member.nodeId)) {
        issues.push(problem("KEYART_UNKNOWN_MEMBER", memberPath + ".nodeId", "KeyArt member must be inside its root subtree.", member.nodeId));
      }
      if (memberNodes.has(member.nodeId)) {
        issues.push(problem("KEYART_DUPLICATE_MEMBER", memberPath + ".nodeId", "A node may appear only once in one KeyArt.", member.nodeId));
      }
      memberNodes.add(member.nodeId);
      if (!nonEmpty(member.appearanceId)) {
        issues.push(problem("KEYART_INVALID_MEMBER", memberPath + ".appearanceId", "KeyArt member appearanceId is required.", member.nodeId));
      }
      if (!finite(member.opacity) || member.opacity < 0 || member.opacity > 1) {
        issues.push(problem("KEYART_INVALID_MEMBER", memberPath + ".opacity", "Member opacity must be within 0..1.", member.nodeId));
      }
      if (!["present", "occluded", "absent"].includes(member.presence)) {
        issues.push(problem("KEYART_INVALID_MEMBER", memberPath + ".presence", "Member presence is invalid.", member.nodeId));
      }
      if (!Number.isSafeInteger(member.drawOrder)) {
        issues.push(problem("ANIMATION_INVALID_DRAW_ORDER", memberPath + ".drawOrder", "Member drawOrder must be a safe integer.", member.nodeId));
      } else {
        const previous = drawOrders.get(member.drawOrder);
        if (previous) {
          issues.push(problem(
            "TRANSITION_DRAW_ORDER_CONFLICT",
            memberPath + ".drawOrder",
            "KeyArt member drawOrder values must be unique.",
            keyArt.id,
            "error",
            { drawOrder: member.drawOrder, nodeIds: [previous, member.nodeId].sort() },
          ));
        } else drawOrders.set(member.drawOrder, member.nodeId);
      }
      const clipping = member.clipping;
      if (!object(clipping) || !Object.hasOwn(clipping, "sourceNodeId") ||
        (clipping.sourceNodeId !== null && !nonEmpty(clipping.sourceNodeId))) {
        issues.push(problem("TRANSITION_CLIPPING_REFERENCE_INVALID", memberPath + ".clipping", "Clipping must contain sourceNodeId as an ID or null.", member.nodeId));
      } else if (clipping.sourceNodeId !== null && !project.scene?.nodes?.[clipping.sourceNodeId]) {
        issues.push(problem("TRANSITION_CLIPPING_REFERENCE_INVALID", memberPath + ".clipping.sourceNodeId", "Clipping source node does not exist.", member.nodeId));
      }
    }
  }

  const mappedNodeKeys = new Map();
  for (const [index, slot] of semanticSlots.entries()) {
    const path = "semanticSlots." + index;
    if (!object(slot)) {
      issues.push(problem("SEMANTIC_SLOT_INVALID", path, "SemanticSlot must be an object."));
      continue;
    }
    if (unknownKeys(slot, ["id", "displayName", "role", "mappings", "metadata"]).length) {
      issues.push(problem("SEMANTIC_SLOT_INVALID", path, "SemanticSlot contains unsupported persistent fields.", slot.id));
    }
    if (slot.displayName != null && !nonEmpty(slot.displayName)) {
      issues.push(problem("SEMANTIC_SLOT_INVALID", path + ".displayName", "SemanticSlot displayName must not be blank.", slot.id));
    }
    if (slot.role != null && !nonEmpty(slot.role)) {
      issues.push(problem("SEMANTIC_SLOT_INVALID", path + ".role", "SemanticSlot role must be a non-blank string or null.", slot.id));
    }
    if (slot.metadata != null && !object(slot.metadata)) {
      issues.push(problem("SEMANTIC_SLOT_INVALID", path + ".metadata", "SemanticSlot metadata must be an object.", slot.id));
    }
    if (slot.mappings != null && !Array.isArray(slot.mappings)) {
      issues.push(problem("SEMANTIC_SLOT_INVALID", path + ".mappings", "SemanticSlot mappings must be an array.", slot.id));
      continue;
    }
    const keyArtsInSlot = new Set();
    for (const [mappingIndex, mapping] of (slot.mappings || []).entries()) {
      const mappingPath = path + ".mappings." + mappingIndex;
      if (!object(mapping) || !nonEmpty(mapping.keyArtId) || !nonEmpty(mapping.nodeId)) {
        issues.push(problem("SEMANTIC_MAPPING_INVALID", mappingPath, "Semantic mapping requires keyArtId and nodeId.", slot.id));
        continue;
      }
      if (unknownKeys(mapping, ["keyArtId", "nodeId"]).length) {
        issues.push(problem("SEMANTIC_MAPPING_INVALID", mappingPath, "Semantic mapping contains unsupported fields.", slot.id));
      }
      const keyArt = keyArtById.get(mapping.keyArtId);
      if (!keyArt) {
        issues.push(problem("SEMANTIC_MAPPING_UNKNOWN_KEYART", mappingPath + ".keyArtId", "Mapped KeyArt does not exist.", slot.id));
      }
      if (!project.scene?.nodes?.[mapping.nodeId]) {
        issues.push(problem("SEMANTIC_MAPPING_UNKNOWN_NODE", mappingPath + ".nodeId", "Mapped scene node does not exist.", slot.id));
      }
      if (keyArtsInSlot.has(mapping.keyArtId)) {
        issues.push(problem("SEMANTIC_MAPPING_DUPLICATE", mappingPath, "A SemanticSlot may map at most one node per KeyArt.", slot.id));
      }
      keyArtsInSlot.add(mapping.keyArtId);
      const nodeKey = mapping.keyArtId + "\u0000" + mapping.nodeId;
      const previousSlotId = mappedNodeKeys.get(nodeKey);
      if (previousSlotId && previousSlotId !== slot.id) {
        issues.push(problem(
          "SEMANTIC_MAPPING_DUPLICATE",
          mappingPath,
          "A KeyArt node may belong to at most one SemanticSlot.",
          mapping.nodeId,
          "error",
          { keyArtId: mapping.keyArtId, semanticSlotIds: [previousSlotId, slot.id].sort() },
        ));
      } else mappedNodeKeys.set(nodeKey, slot.id);
      if (keyArt && !keyArtMemberFor(keyArt, mapping.nodeId)) {
        issues.push(problem("SEMANTIC_MAPPING_NOT_MEMBER", mappingPath + ".nodeId", "Mapped node is not an authored member of the KeyArt.", mapping.nodeId));
      }
    }
  }

  for (const [index, topology] of topologies.entries()) {
    const path = "meshTopologies." + index;
    if (!object(topology) || !Array.isArray(topology.vertexIds) || !Array.isArray(topology.indices)) {
      issues.push(problem("MESH_TOPOLOGY_INVALID", path, "MeshTopology requires vertexIds and indices arrays.", topology?.id));
      continue;
    }
    if (unknownKeys(topology, ["id", "vertexIds", "indices", "vertexMetadata", "nextVertexSequence"]).length) {
      issues.push(problem("MESH_TOPOLOGY_INVALID", path, "MeshTopology contains unsupported persistent fields.", topology.id));
    }
    if (Object.hasOwn(topology, "nextVertexSequence") &&
      (!Number.isSafeInteger(topology.nextVertexSequence) || topology.nextVertexSequence < 1)) {
      issues.push(problem("MESH_TOPOLOGY_VERTEX_SEQUENCE_INVALID", path + ".nextVertexSequence", "MeshTopology nextVertexSequence must be a positive integer.", topology.id));
    } else if (Object.hasOwn(topology, "nextVertexSequence")) {
      const issuedMaximum = Math.max(0, ...topology.vertexIds.map((vertexId) => {
        const match = /^vtx_(\d+)$/.exec(vertexId);
        return match ? Number(match[1]) : 0;
      }));
      if (topology.nextVertexSequence <= issuedMaximum) {
        issues.push(problem("MESH_TOPOLOGY_VERTEX_SEQUENCE_INVALID", path + ".nextVertexSequence", "MeshTopology nextVertexSequence must be greater than every issued vtx_ ID.", topology.id));
      }
    }
    if (topology.vertexIds.length < 3 || topology.vertexIds.some((id) => !nonEmpty(id))) {
      issues.push(problem("MESH_TOPOLOGY_INVALID", path + ".vertexIds", "MeshTopology requires at least three stable vertex IDs.", topology.id));
    }
    topology.vertexIds.forEach((vertexId, vertexIndex) => {
      if (nonEmpty(vertexId)) register(vertexId, path + ".vertexIds." + vertexIndex);
    });
    if (new Set(topology.vertexIds).size !== topology.vertexIds.length) {
      issues.push(problem("MESH_TOPOLOGY_DUPLICATE_VERTEX", path + ".vertexIds", "MeshTopology vertex IDs must be unique.", topology.id));
    }
    const vertexMetadata = topology.vertexMetadata || {};
    if (!object(vertexMetadata)) {
      issues.push(problem("MESH_TOPOLOGY_VERTEX_METADATA_INVALID", path + ".vertexMetadata", "MeshTopology vertexMetadata must be an object.", topology.id));
    } else {
      const labels = new Map();
      for (const [vertexId, metadata] of Object.entries(vertexMetadata)) {
        const metadataPath = path + ".vertexMetadata." + vertexId;
        if (!topology.vertexIds.includes(vertexId)) {
          issues.push(problem("MESH_TOPOLOGY_MISSING_VERTEX_REFERENCE", metadataPath, "Vertex metadata references a missing or removed stable vertex ID.", topology.id));
          continue;
        }
        if (!object(metadata) || unknownKeys(metadata, ["semanticLabel"]).length ||
          !nonEmpty(metadata.semanticLabel)) {
          issues.push(problem("MESH_TOPOLOGY_VERTEX_METADATA_INVALID", metadataPath, "Vertex metadata requires one non-empty semanticLabel.", vertexId));
          continue;
        }
        const previous = labels.get(metadata.semanticLabel);
        if (previous) {
          issues.push(problem(
            "MESH_TOPOLOGY_DUPLICATE_SEMANTIC_LABEL",
            metadataPath + ".semanticLabel",
            "Non-empty semantic labels must be unique within one MeshTopology.",
            vertexId,
            "error",
            { semanticLabel: metadata.semanticLabel, vertexIds: [previous, vertexId].sort() },
          ));
        } else labels.set(metadata.semanticLabel, vertexId);
      }
    }
    if (topology.indices.length === 0 || topology.indices.length % 3 !== 0) {
      issues.push(problem("MESH_TOPOLOGY_INVALID_TRIANGLES", path + ".indices", "MeshTopology indices must contain complete triangles.", topology.id));
    }
    for (let offset = 0; offset < topology.indices.length; offset += 3) {
      const triangle = topology.indices.slice(offset, offset + 3);
      if (triangle.some((value) => !Number.isSafeInteger(value) || value < 0 || value >= topology.vertexIds.length)) {
        issues.push(problem("MESH_TOPOLOGY_INVALID_VERTEX_REFERENCE", path + ".indices." + offset, "Triangle references a missing topology vertex.", topology.id));
      } else if (new Set(triangle).size !== 3) {
        issues.push(problem("MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX", path + ".indices." + offset, "Triangle contains a repeated vertex.", topology.id));
      }
    }
  }

  const keyformKeys = new Set();
  for (const [index, keyform] of keyforms.entries()) {
    const path = "meshKeyforms." + index;
    if (!object(keyform)) {
      issues.push(problem("MESH_KEYFORM_INVALID", path, "MeshKeyform must be an object."));
      continue;
    }
    if (unknownKeys(keyform, ["id", "topologyId", "keyArtId", "semanticSlotId", "positions", "uvs"]).length) {
      issues.push(problem("MESH_KEYFORM_INVALID", path, "MeshKeyform contains unsupported persistent fields.", keyform.id));
    }
    const topology = topologyById.get(keyform.topologyId);
    if (!topology) issues.push(problem("MESH_KEYFORM_UNKNOWN_TOPOLOGY", path + ".topologyId", "MeshKeyform topology does not exist.", keyform.id));
    if (!keyArtById.has(keyform.keyArtId)) issues.push(problem("MESH_KEYFORM_UNKNOWN_KEYART", path + ".keyArtId", "MeshKeyform KeyArt does not exist.", keyform.id));
    if (!slotById.has(keyform.semanticSlotId)) issues.push(problem("MESH_KEYFORM_UNKNOWN_SLOT", path + ".semanticSlotId", "MeshKeyform SemanticSlot does not exist.", keyform.id));
    const expected = topology ? topology.vertexIds.length * 2 : null;
    if (!Array.isArray(keyform.positions) || keyform.positions.some((value) => !finite(value))) {
      issues.push(problem("MESH_KEYFORM_POSITIONS_INVALID", path + ".positions", "MeshKeyform positions must contain finite coordinate values.", keyform.id));
    } else if (expected !== null && keyform.positions.length !== expected) {
      issues.push(problem("MESH_KEYFORM_POSITION_COUNT_MISMATCH", path + ".positions", "MeshKeyform position count does not match its MeshTopology.", keyform.id));
    }
    if (!Array.isArray(keyform.uvs) || keyform.uvs.some((value) => !finite(value))) {
      issues.push(problem("MESH_KEYFORM_UVS_INVALID", path + ".uvs", "MeshKeyform UVs must contain finite coordinate values.", keyform.id));
    } else if (expected !== null && keyform.uvs.length !== expected) {
      issues.push(problem("MESH_KEYFORM_UV_COUNT_MISMATCH", path + ".uvs", "MeshKeyform UV count does not match its MeshTopology.", keyform.id));
    }
    if (topology && Array.isArray(keyform.positions) &&
      keyform.positions.length === expected && topology.indices.length % 3 === 0) {
      for (let offset = 0; offset < topology.indices.length; offset += 3) {
        const [a, b, c] = topology.indices.slice(offset, offset + 3);
        if ([a, b, c].some((vertexIndex) =>
          !Number.isSafeInteger(vertexIndex) ||
          vertexIndex < 0 ||
          vertexIndex >= topology.vertexIds.length)) continue;
        const area = Math.abs(
          (keyform.positions[b * 2] - keyform.positions[a * 2]) *
            (keyform.positions[c * 2 + 1] - keyform.positions[a * 2 + 1]) -
          (keyform.positions[b * 2 + 1] - keyform.positions[a * 2 + 1]) *
            (keyform.positions[c * 2] - keyform.positions[a * 2]),
        ) / 2;
        if (area <= 1e-8) {
          issues.push(problem("MESH_TOPOLOGY_TRIANGLE_ZERO_AREA", path + ".positions", "MeshKeyform contains a zero-area triangle.", keyform.id, "warning", { triangleOffset: offset }));
        } else if (area < 1e-4) {
          issues.push(problem("MESH_TOPOLOGY_TRIANGLE_NEAR_DEGENERATE", path + ".positions", "MeshKeyform contains a near-degenerate triangle.", keyform.id, "warning", { triangleOffset: offset, area }));
        }
      }
    }
    const key = keyform.topologyId + "\u0000" + keyform.keyArtId + "\u0000" + keyform.semanticSlotId;
    if (keyformKeys.has(key)) {
      issues.push(problem("MESH_KEYFORM_DUPLICATE", path, "Only one keyform may exist per topology, KeyArt, and SemanticSlot.", keyform.id));
    }
    keyformKeys.add(key);
  }

  const programOwners = new Map();
  for (const [index, transition] of transitions.entries()) {
    const path = "transitions." + index;
    if (!object(transition)) {
      issues.push(problem("TRANSITION_INVALID", path, "Transition must be an object."));
      continue;
    }
    if (unknownKeys(transition, ["id", "displayName", "fromKeyArtId", "toKeyArtId", "temporalProgramId", "partTransitions", "diagnosticOverrides"]).length) {
      issues.push(problem("TRANSITION_INVALID", path, "Transition contains unsupported persistent fields; duration belongs only to TemporalProgram.", transition.id));
    }
    if (!nonEmpty(transition.displayName)) issues.push(problem("TRANSITION_INVALID", path + ".displayName", "Transition displayName is required.", transition.id));
    const fromKeyArt = keyArtById.get(transition.fromKeyArtId);
    const toKeyArt = keyArtById.get(transition.toKeyArtId);
    if (!fromKeyArt) issues.push(problem("TRANSITION_UNKNOWN_KEYART", path + ".fromKeyArtId", "Transition source KeyArt does not exist.", transition.id));
    if (!toKeyArt) issues.push(problem("TRANSITION_UNKNOWN_KEYART", path + ".toKeyArtId", "Transition target KeyArt does not exist.", transition.id));
    if (transition.fromKeyArtId === transition.toKeyArtId) issues.push(problem("TRANSITION_SAME_KEYART", path, "Transition endpoints must be different KeyArts.", transition.id));
    if (!programById.has(transition.temporalProgramId)) {
      issues.push(problem("TRANSITION_UNKNOWN_PROGRAM", path + ".temporalProgramId", "Transition TemporalProgram does not exist.", transition.id));
    }
    const previousOwner = programOwners.get(transition.temporalProgramId);
    if (previousOwner) {
      issues.push(problem(
        "TRANSITION_PROGRAM_SHARED",
        path + ".temporalProgramId",
        "A TemporalProgram may be owned by only one Transition.",
        transition.temporalProgramId,
        "error",
        { transitionIds: [previousOwner, transition.id].sort() },
      ));
    } else programOwners.set(transition.temporalProgramId, transition.id);
    if (!Array.isArray(transition.partTransitions)) {
      issues.push(problem("TRANSITION_INVALID", path + ".partTransitions", "partTransitions must be an array.", transition.id));
      continue;
    }
    if (!Array.isArray(transition.diagnosticOverrides)) {
      issues.push(problem("TRANSITION_INVALID", path + ".diagnosticOverrides", "diagnosticOverrides must be an array.", transition.id));
    } else {
      const overrideKeys = new Set();
      for (const [overrideIndex, override] of transition.diagnosticOverrides.entries()) {
        const overridePath = path + ".diagnosticOverrides." + overrideIndex;
        if (!object(override) || !nonEmpty(override.key) || !nonEmpty(override.code) ||
          !nonEmpty(override.evidenceFingerprint)) {
          issues.push(problem("TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", overridePath, "Diagnostic override requires key, code, and evidenceFingerprint.", transition.id));
          continue;
        }
        if (unknownKeys(override, ["key", "code", "semanticSlotId", "timeTicks", "evidenceFingerprint"]).length) {
          issues.push(problem("TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", overridePath, "Diagnostic override contains unsupported persistent fields.", transition.id));
        }
        if (overrideKeys.has(override.key)) {
          issues.push(problem("TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", overridePath + ".key", "Diagnostic override keys must be unique.", transition.id));
        }
        overrideKeys.add(override.key);
        if (override.semanticSlotId != null && !slotById.has(override.semanticSlotId)) {
          issues.push(problem("TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", overridePath + ".semanticSlotId", "Diagnostic override SemanticSlot does not exist.", transition.id));
        }
        if (override.timeTicks != null && (!Number.isSafeInteger(override.timeTicks) || override.timeTicks < 0)) {
          issues.push(problem("TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", overridePath + ".timeTicks", "Diagnostic override timeTicks must be a non-negative safe integer.", transition.id));
        }
      }
    }
    const partSlots = new Set();
    for (const [partIndex, part] of transition.partTransitions.entries()) {
      const partPath = path + ".partTransitions." + partIndex;
      if (!object(part) || !nonEmpty(part.id)) {
        issues.push(problem("TRANSITION_INVALID_PART", partPath, "PartTransition requires a stable ID.", transition.id));
        continue;
      }
      if (unknownKeys(part, ["id", "semanticSlotId", "mode", "topologyId", "fromKeyformId", "toKeyformId", "configuration"]).length) {
        issues.push(problem("TRANSITION_INVALID_PART", partPath, "PartTransition contains unsupported persistent fields.", part.id));
      }
      if (!object(part.configuration)) {
        issues.push(problem("TRANSITION_INVALID_PART", partPath + ".configuration", "PartTransition configuration must be an object.", part.id));
      } else {
        if (unknownKeys(part.configuration, ["holdEndpoint", "compositeGroupId"]).length) {
          issues.push(problem("TRANSITION_INVALID_PART", partPath + ".configuration", "PartTransition configuration contains unsupported persistent fields.", part.id));
        }
        if (part.configuration.holdEndpoint != null &&
          (part.mode !== "hold" || !["from", "to"].includes(part.configuration.holdEndpoint))) {
          issues.push(problem("TRANSITION_INVALID_PART", partPath + ".configuration.holdEndpoint", "holdEndpoint is valid only for Hold and must be from or to.", part.id));
        }
        if (part.configuration.compositeGroupId != null &&
          (part.mode !== "replace" || !nonEmpty(part.configuration.compositeGroupId))) {
          issues.push(problem("TRANSITION_INVALID_PART", partPath + ".configuration.compositeGroupId", "compositeGroupId is valid only for Replace.", part.id));
        }
      }
      register(part.id, partPath + ".id");
      if (!slotById.has(part.semanticSlotId)) issues.push(problem("TRANSITION_UNKNOWN_SLOT", partPath + ".semanticSlotId", "PartTransition SemanticSlot does not exist.", part.id));
      if (partSlots.has(part.semanticSlotId)) issues.push(problem("TRANSITION_DUPLICATE_PART", partPath + ".semanticSlotId", "Transition may contain one PartTransition per SemanticSlot.", part.id));
      partSlots.add(part.semanticSlotId);
      if (!TRANSITION_MODES.has(part.mode)) issues.push(problem("TRANSITION_INVALID_MODE", partPath + ".mode", "Unknown persistent Transition mode.", part.id));
      const slot = slotById.get(part.semanticSlotId);
      const fromMapping = semanticMappingFor(slot, transition.fromKeyArtId);
      const toMapping = semanticMappingFor(slot, transition.toKeyArtId);
      const needsBoth = ["morph", "replace", "occlusion"].includes(part.mode);
      const mappingValid = !needsBoth || (fromMapping && toMapping);
      const appearValid = part.mode !== "appear" || (!fromMapping && Boolean(toMapping));
      const disappearValid = part.mode !== "disappear" || (Boolean(fromMapping) && !toMapping);
      const holdValid = part.mode !== "hold" || Boolean(fromMapping || toMapping);
      if (!mappingValid || !appearValid || !disappearValid || !holdValid) {
        issues.push(problem("TRANSITION_INVALID_MODE_FOR_MAPPING", partPath + ".mode", "Transition mode is incompatible with endpoint mappings.", part.id));
      }
      if (part.mode === "morph") {
        const topology = topologyById.get(part.topologyId);
        const fromKeyform = keyformById.get(part.fromKeyformId);
        const toKeyform = keyformById.get(part.toKeyformId);
        if (!topology) issues.push(problem("TRANSITION_TOPOLOGY_INCOMPATIBLE", partPath + ".topologyId", "Morph topology does not exist.", part.id));
        if (!fromKeyform || !toKeyform) {
          issues.push(problem("TRANSITION_MISSING_KEYFORM", partPath, "Morph requires endpoint MeshKeyforms.", part.id));
        } else if (fromKeyform.topologyId !== part.topologyId || toKeyform.topologyId !== part.topologyId ||
          fromKeyform.keyArtId !== transition.fromKeyArtId || toKeyform.keyArtId !== transition.toKeyArtId ||
          fromKeyform.semanticSlotId !== part.semanticSlotId || toKeyform.semanticSlotId !== part.semanticSlotId) {
          issues.push(problem("TRANSITION_TOPOLOGY_INCOMPATIBLE", partPath, "Morph keyforms must share the declared topology, SemanticSlot, and endpoint KeyArts.", part.id));
        }
      }
    }
  }
  return issues;
}

export { TRANSITION_MODES };
