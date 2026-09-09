import { cloneProject } from "../model/project.js";
import {
  canonicalizeSkinInfluences,
  createSkinBinding,
} from "../model/skin-binding.js";
import { CommandError } from "./errors.js";

function collection(project) {
  const bindings = project.rig?.skinBindings;
  if (!Array.isArray(bindings)) {
    throw new CommandError("Missing rig.skinBindings collection.", "collection.invalid");
  }
  return bindings;
}

function bindingIndex(project, bindingId) {
  const index = collection(project).findIndex((binding) => binding.id === bindingId);
  if (index < 0) {
    throw new CommandError(
      "SkinBinding does not exist.",
      "skin_binding.not_found",
      { bindingId },
    );
  }
  return index;
}

function binding(project, bindingId) {
  return collection(project)[bindingIndex(project, bindingId)];
}

function removeBinding(project, bindingId) {
  const bindings = collection(project);
  const index = bindingIndex(project, bindingId);
  const [removed] = bindings.splice(index, 1);
  return {
    inverse: {
      type: "skin.restore_binding",
      payload: { binding: cloneProject(removed), index },
    },
    affectedIds: [
      removed.id,
      removed.targetNodeId,
      removed.topologyId,
      ...removed.vertexWeights.flatMap((entry) => [
        entry.vertexId,
        ...entry.influences.map((influence) => influence.boneId),
      ]),
    ],
  };
}

function clearVertexWeights(project, bindingId, vertexId) {
  const current = binding(project, bindingId);
  const index = current.vertexWeights.findIndex((entry) => entry.vertexId === vertexId);
  if (index < 0) {
    throw new CommandError(
      "SkinBinding has no weights for this stable vertex ID.",
      "skin_binding.vertex_weights_not_found",
      { bindingId, vertexId },
    );
  }
  const [removed] = current.vertexWeights.splice(index, 1);
  return {
    inverse: {
      type: "skin.set_vertex_weights",
      payload: {
        bindingId: current.id,
        vertexId: removed.vertexId,
        influences: cloneProject(removed.influences),
      },
    },
    affectedIds: [
      current.id,
      current.targetNodeId,
      current.topologyId,
      vertexId,
      ...removed.influences.map((influence) => influence.boneId),
    ],
  };
}

export const skinBindingCommandHandlers = {
  "skin.create_binding": (project, payload) => {
    const created = createSkinBinding(payload.binding);
    collection(project).push(created);
    return {
      inverse: {
        type: "skin.remove_binding_internal",
        payload: { bindingId: created.id },
      },
      affectedIds: [created.id, created.targetNodeId, created.topologyId],
    };
  },

  "skin.remove_binding": (project, payload) =>
    removeBinding(project, payload.bindingId),
  "skin.remove_binding_internal": (project, payload) =>
    removeBinding(project, payload.bindingId),

  "skin.restore_binding": (project, payload) => {
    const bindings = collection(project);
    const restored = createSkinBinding(payload.binding);
    const index = Math.max(0, Math.min(bindings.length, payload.index));
    bindings.splice(index, 0, restored);
    return {
      inverse: {
        type: "skin.remove_binding_internal",
        payload: { bindingId: restored.id },
      },
      affectedIds: [restored.id, restored.targetNodeId, restored.topologyId],
    };
  },

  "skin.set_enabled": (project, payload) => {
    const current = binding(project, payload.bindingId);
    const previous = current.enabled;
    current.enabled = payload.enabled;
    return {
      inverse: {
        type: "skin.set_enabled",
        payload: { bindingId: current.id, enabled: previous },
      },
      affectedIds: [current.id, current.targetNodeId, current.topologyId],
    };
  },

  "skin.set_vertex_weights": (project, payload) => {
    const current = binding(project, payload.bindingId);
    const influences = canonicalizeSkinInfluences(payload.influences, {
      vertexId: payload.vertexId,
    });
    const index = current.vertexWeights.findIndex((entry) =>
      entry.vertexId === payload.vertexId);
    const previous = index >= 0 ? cloneProject(current.vertexWeights[index]) : null;
    const next = { vertexId: payload.vertexId, influences };
    if (index >= 0) current.vertexWeights[index] = next;
    else current.vertexWeights.push(next);
    current.vertexWeights.sort((left, right) => left.vertexId < right.vertexId ? -1 :
      left.vertexId > right.vertexId ? 1 : 0);
    return {
      inverse: previous
        ? {
          type: "skin.set_vertex_weights",
          payload: {
            bindingId: current.id,
            vertexId: previous.vertexId,
            influences: previous.influences,
          },
        }
        : {
          type: "skin.clear_vertex_weights",
          payload: { bindingId: current.id, vertexId: payload.vertexId },
        },
      affectedIds: [
        current.id,
        current.targetNodeId,
        current.topologyId,
        payload.vertexId,
        ...influences.map((influence) => influence.boneId),
      ],
    };
  },

  "skin.clear_vertex_weights": (project, payload) =>
    clearVertexWeights(project, payload.bindingId, payload.vertexId),
};
