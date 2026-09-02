import { cloneProject } from "../model/project.js";
import { CommandError } from "./errors.js";

function listFor(project, name) {
  const list = project[name];
  if (!Array.isArray(list)) throw new CommandError("Missing collection " + name + ".", "collection.invalid");
  return list;
}

function indexFor(project, name, id, code) {
  const index = listFor(project, name).findIndex((entry) => entry.id === id);
  if (index < 0) throw new CommandError("Unknown " + name + " entity " + id + ".", code, { id });
  return index;
}

function entityFor(project, name, id, code) {
  return listFor(project, name)[indexFor(project, name, id, code)];
}

function assertNewId(project, id) {
  const used = [
    project.id,
    ...Object.keys(project.scene?.nodes || {}),
    ...[
      "sourceAssets", "semanticSlots", "keyArts", "meshes", "meshTopologies",
      "meshKeyforms", "transitions", "temporalPrograms",
    ].flatMap((name) => (project[name] || []).map((entry) => entry.id)),
  ];
  if (used.includes(id)) throw new CommandError("Stable ID already exists.", "identity.duplicate", { id });
}

function insert(list, value, index) {
  list.splice(Math.max(0, Math.min(list.length, index)), 0, cloneProject(value));
}

function normalizedKeyArt(keyArt) {
  return {
    ...cloneProject(keyArt),
    members: cloneProject(keyArt.members || []),
    metadata: cloneProject(keyArt.metadata || {}),
  };
}

function normalizedSlot(slot) {
  return {
    ...cloneProject(slot),
    mappings: cloneProject(slot.mappings || []),
    metadata: cloneProject(slot.metadata || {}),
  };
}

function normalizedTransition(transition) {
  return {
    ...cloneProject(transition),
    partTransitions: cloneProject(transition.partTransitions || []),
    diagnosticOverrides: cloneProject(transition.diagnosticOverrides || []),
  };
}

function createEntity(collection, normalizer, notFoundCode) {
  return (project, payload) => {
    const value = normalizer(payload.entity);
    assertNewId(project, value.id);
    listFor(project, collection).push(value);
    return {
      inverse: { type: collection + ".remove_internal", payload: { id: value.id } },
      affectedIds: [value.id],
    };
  };
}

function removeEntity(collection, restoreType, notFoundCode) {
  return (project, payload) => {
    const list = listFor(project, collection);
    const index = indexFor(project, collection, payload.id, notFoundCode);
    const [entity] = list.splice(index, 1);
    return {
      inverse: { type: restoreType, payload: { entity, index } },
      affectedIds: [entity.id],
    };
  };
}

function restoreEntity(collection, removeType) {
  return (project, payload) => {
    insert(listFor(project, collection), payload.entity, payload.index);
    return {
      inverse: { type: removeType, payload: { id: payload.entity.id } },
      affectedIds: [payload.entity.id],
    };
  };
}

function updateEntity(collection, normalizer, notFoundCode, updateType, idKey = "id", entityKey = "entity") {
  return (project, payload) => {
    const list = listFor(project, collection);
    const index = indexFor(project, collection, payload.id, notFoundCode);
    const next = normalizer(payload.entity);
    if (next.id !== payload.id) throw new CommandError("Updates must preserve stable identity.", "identity.changed");
    const previous = cloneProject(list[index]);
    list[index] = next;
    return {
      inverse: { type: updateType, payload: { [idKey]: previous.id, [entityKey]: previous } },
      affectedIds: [next.id],
    };
  };
}

const identity = (value) => cloneProject(value);

export const transitionCommandHandlers = {
  "keyart.create": (project, payload) => createEntity("keyArts", normalizedKeyArt)(project, { entity: payload.keyArt }),
  "keyart.update": (project, payload) => updateEntity("keyArts", normalizedKeyArt, "keyart.not_found", "keyart.update", "keyArtId", "keyArt")(project, {
    id: payload.keyArtId,
    entity: payload.keyArt,
  }),
  "keyart.remove": (project, payload) => removeEntity("keyArts", "keyart.restore", "keyart.not_found")(project, { id: payload.keyArtId }),
  "keyArts.remove_internal": removeEntity("keyArts", "keyart.restore", "keyart.not_found"),
  "keyart.restore": restoreEntity("keyArts", "keyArts.remove_internal"),

  "semantic_slot.create": (project, payload) => createEntity("semanticSlots", normalizedSlot)(project, { entity: payload.semanticSlot }),
  "semantic_slot.update": (project, payload) => updateEntity("semanticSlots", normalizedSlot, "semantic_slot.not_found", "semantic_slot.update", "semanticSlotId", "semanticSlot")(project, {
    id: payload.semanticSlotId,
    entity: payload.semanticSlot,
  }),
  "semantic_slot.remove": (project, payload) => removeEntity("semanticSlots", "semantic_slot.restore", "semantic_slot.not_found")(project, { id: payload.semanticSlotId }),
  "semanticSlots.remove_internal": removeEntity("semanticSlots", "semantic_slot.restore", "semantic_slot.not_found"),
  "semantic_slot.restore": restoreEntity("semanticSlots", "semanticSlots.remove_internal"),
  "semantic_slot.map_node": (project, payload) => {
    const slot = entityFor(project, "semanticSlots", payload.semanticSlotId, "semantic_slot.not_found");
    slot.mappings ||= [];
    if (slot.mappings.some((entry) => entry.keyArtId === payload.keyArtId)) {
      throw new CommandError("SemanticSlot already has a mapping for this KeyArt.", "SEMANTIC_MAPPING_DUPLICATE");
    }
    const owner = (project.semanticSlots || []).find((entry) =>
      entry.id !== slot.id && (entry.mappings || []).some((mapping) =>
        mapping.keyArtId === payload.keyArtId && mapping.nodeId === payload.nodeId));
    if (owner) throw new CommandError("KeyArt node is already mapped to another SemanticSlot.", "SEMANTIC_MAPPING_DUPLICATE");
    const mapping = { keyArtId: payload.keyArtId, nodeId: payload.nodeId };
    slot.mappings.push(mapping);
    return {
      inverse: {
        type: "semantic_slot.unmap_node",
        payload: { semanticSlotId: slot.id, keyArtId: payload.keyArtId },
      },
      affectedIds: [slot.id, payload.keyArtId, payload.nodeId],
    };
  },
  "semantic_slot.unmap_node": (project, payload) => {
    const slot = entityFor(project, "semanticSlots", payload.semanticSlotId, "semantic_slot.not_found");
    const index = (slot.mappings || []).findIndex((entry) => entry.keyArtId === payload.keyArtId);
    if (index < 0) throw new CommandError("Semantic mapping does not exist.", "semantic_mapping.not_found");
    const [mapping] = slot.mappings.splice(index, 1);
    return {
      inverse: {
        type: "semantic_slot.restore_mapping",
        payload: { semanticSlotId: slot.id, mapping, index },
      },
      affectedIds: [slot.id, mapping.keyArtId, mapping.nodeId],
    };
  },
  "semantic_slot.restore_mapping": (project, payload) => {
    const slot = entityFor(project, "semanticSlots", payload.semanticSlotId, "semantic_slot.not_found");
    insert(slot.mappings, payload.mapping, payload.index);
    return {
      inverse: {
        type: "semantic_slot.unmap_node",
        payload: { semanticSlotId: slot.id, keyArtId: payload.mapping.keyArtId },
      },
      affectedIds: [slot.id, payload.mapping.keyArtId, payload.mapping.nodeId],
    };
  },

  "mesh_topology.create": (project, payload) => createEntity("meshTopologies", identity)(project, { entity: payload.topology }),
  "mesh_topology.remove": (project, payload) => removeEntity("meshTopologies", "mesh_topology.restore", "mesh_topology.not_found")(project, { id: payload.topologyId }),
  "meshTopologies.remove_internal": removeEntity("meshTopologies", "mesh_topology.restore", "mesh_topology.not_found"),
  "mesh_topology.restore": restoreEntity("meshTopologies", "meshTopologies.remove_internal"),

  "mesh_keyform.create": (project, payload) => createEntity("meshKeyforms", identity)(project, { entity: payload.keyform }),
  "mesh_keyform.update": (project, payload) => updateEntity("meshKeyforms", identity, "mesh_keyform.not_found", "mesh_keyform.update", "keyformId", "keyform")(project, {
    id: payload.keyformId,
    entity: payload.keyform,
  }),
  "mesh_keyform.remove": (project, payload) => removeEntity("meshKeyforms", "mesh_keyform.restore", "mesh_keyform.not_found")(project, { id: payload.keyformId }),
  "meshKeyforms.remove_internal": removeEntity("meshKeyforms", "mesh_keyform.restore", "mesh_keyform.not_found"),
  "mesh_keyform.restore": restoreEntity("meshKeyforms", "meshKeyforms.remove_internal"),

  "transition.create": (project, payload) => createEntity("transitions", normalizedTransition)(project, { entity: payload.transition }),
  "transition.update": (project, payload) => updateEntity("transitions", normalizedTransition, "transition.not_found", "transition.update", "transitionId", "transition")(project, {
    id: payload.transitionId,
    entity: payload.transition,
  }),
  "transition.remove": (project, payload) => removeEntity("transitions", "transition.restore", "transition.not_found")(project, { id: payload.transitionId }),
  "transitions.remove_internal": removeEntity("transitions", "transition.restore", "transition.not_found"),
  "transition.restore": restoreEntity("transitions", "transitions.remove_internal"),
  "transition.set_part_mode": (project, payload) => {
    const transition = entityFor(project, "transitions", payload.transitionId, "transition.not_found");
    const index = transition.partTransitions.findIndex((entry) => entry.semanticSlotId === payload.semanticSlotId);
    const previous = index < 0 ? null : cloneProject(transition.partTransitions[index]);
    const next = {
      id: payload.partTransitionId,
      semanticSlotId: payload.semanticSlotId,
      mode: payload.mode,
      topologyId: previous?.topologyId ?? null,
      fromKeyformId: previous?.fromKeyformId ?? null,
      toKeyformId: previous?.toKeyformId ?? null,
      configuration: cloneProject(payload.configuration || previous?.configuration || {}),
    };
    if (previous && previous.id !== next.id) {
      throw new CommandError("PartTransition updates must preserve stable identity.", "identity.changed");
    }
    if (index < 0) transition.partTransitions.push(next);
    else transition.partTransitions[index] = next;
    return {
      inverse: previous
        ? { type: "transition.restore_part", payload: { transitionId: transition.id, part: previous, index } }
        : { type: "transition.remove_part", payload: { transitionId: transition.id, semanticSlotId: next.semanticSlotId } },
      affectedIds: [transition.id, next.id, next.semanticSlotId],
    };
  },
  "transition.set_part_topology": (project, payload) => {
    const transition = entityFor(project, "transitions", payload.transitionId, "transition.not_found");
    const index = transition.partTransitions.findIndex((entry) => entry.semanticSlotId === payload.semanticSlotId);
    if (index < 0) throw new CommandError("PartTransition does not exist.", "transition.part_not_found");
    const previous = cloneProject(transition.partTransitions[index]);
    transition.partTransitions[index] = {
      ...transition.partTransitions[index],
      topologyId: payload.topologyId,
      fromKeyformId: payload.fromKeyformId,
      toKeyformId: payload.toKeyformId,
    };
    return {
      inverse: { type: "transition.restore_part", payload: { transitionId: transition.id, part: previous, index } },
      affectedIds: [transition.id, previous.id, payload.topologyId, payload.fromKeyformId, payload.toKeyformId],
    };
  },
  "transition.remove_part": (project, payload) => {
    const transition = entityFor(project, "transitions", payload.transitionId, "transition.not_found");
    const index = transition.partTransitions.findIndex((entry) => entry.semanticSlotId === payload.semanticSlotId);
    if (index < 0) throw new CommandError("PartTransition does not exist.", "transition.part_not_found");
    const [part] = transition.partTransitions.splice(index, 1);
    return {
      inverse: { type: "transition.restore_part", payload: { transitionId: transition.id, part, index } },
      affectedIds: [transition.id, part.id, part.semanticSlotId],
    };
  },
  "transition.restore_part": (project, payload) => {
    const transition = entityFor(project, "transitions", payload.transitionId, "transition.not_found");
    const currentIndex = transition.partTransitions.findIndex((entry) => entry.semanticSlotId === payload.part.semanticSlotId);
    const previous = currentIndex < 0 ? null : cloneProject(transition.partTransitions[currentIndex]);
    if (currentIndex >= 0) transition.partTransitions.splice(currentIndex, 1);
    insert(transition.partTransitions, payload.part, payload.index);
    return {
      inverse: previous
        ? { type: "transition.restore_part", payload: { transitionId: transition.id, part: previous, index: currentIndex } }
        : { type: "transition.remove_part", payload: { transitionId: transition.id, semanticSlotId: payload.part.semanticSlotId } },
      affectedIds: [transition.id, payload.part.id, payload.part.semanticSlotId],
    };
  },
  "transition.set_diagnostic_override": (project, payload) => {
    const transition = entityFor(project, "transitions", payload.transitionId, "transition.not_found");
    const index = transition.diagnosticOverrides.findIndex((entry) => entry.key === payload.override.key);
    const previous = index < 0 ? null : cloneProject(transition.diagnosticOverrides[index]);
    if (index < 0) transition.diagnosticOverrides.push(cloneProject(payload.override));
    else transition.diagnosticOverrides[index] = cloneProject(payload.override);
    return {
      inverse: previous
        ? { type: "transition.set_diagnostic_override", payload: { transitionId: transition.id, override: previous } }
        : { type: "transition.clear_diagnostic_override", payload: { transitionId: transition.id, key: payload.override.key } },
      affectedIds: [transition.id],
    };
  },
  "transition.clear_diagnostic_override": (project, payload) => {
    const transition = entityFor(project, "transitions", payload.transitionId, "transition.not_found");
    const index = transition.diagnosticOverrides.findIndex((entry) => entry.key === payload.key);
    if (index < 0) throw new CommandError("Diagnostic override does not exist.", "transition.override_not_found");
    const [override] = transition.diagnosticOverrides.splice(index, 1);
    return {
      inverse: { type: "transition.set_diagnostic_override", payload: { transitionId: transition.id, override } },
      affectedIds: [transition.id],
    };
  },
};
