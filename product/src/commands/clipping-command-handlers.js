import { cloneProject } from "../model/project.js";
import { CommandError } from "./errors.js";

function collection(project) {
  if (!Array.isArray(project.clippingBindings)) {
    throw new CommandError("Missing clippingBindings collection.", "collection.invalid");
  }
  return project.clippingBindings;
}

function bindingIndex(project, bindingId) {
  const index = collection(project).findIndex((binding) => binding.id === bindingId);
  if (index < 0) {
    throw new CommandError(
      "Unknown ClippingBinding " + bindingId + ".",
      "clipping.not_found",
      { bindingId },
    );
  }
  return index;
}

function binding(project, bindingId) {
  return collection(project)[bindingIndex(project, bindingId)];
}

function normalizedBinding(value) {
  return {
    id: value.id,
    targetNodeId: value.targetNodeId,
    sourceNodeId: value.sourceNodeId,
    mode: value.mode,
    enabled: value.enabled,
  };
}

function removeBinding(project, bindingId) {
  const bindings = collection(project);
  const index = bindingIndex(project, bindingId);
  const [removed] = bindings.splice(index, 1);
  return {
    inverse: {
      type: "clipping.restore",
      payload: { binding: cloneProject(removed), index },
    },
    affectedIds: [removed.id, removed.targetNodeId, removed.sourceNodeId],
  };
}

export const clippingCommandHandlers = {
  "clipping.create": (project, payload) => {
    const next = normalizedBinding(payload.binding);
    collection(project).push(next);
    return {
      inverse: {
        type: "clipping.remove_internal",
        payload: { bindingId: next.id },
      },
      affectedIds: [next.id, next.targetNodeId, next.sourceNodeId],
    };
  },
  "clipping.set_source": (project, payload) => {
    const current = binding(project, payload.bindingId);
    const previousSourceNodeId = current.sourceNodeId;
    current.sourceNodeId = payload.sourceNodeId;
    return {
      inverse: {
        type: "clipping.set_source",
        payload: { bindingId: current.id, sourceNodeId: previousSourceNodeId },
      },
      affectedIds: [current.id, current.targetNodeId, previousSourceNodeId, payload.sourceNodeId],
    };
  },
  "clipping.set_enabled": (project, payload) => {
    const current = binding(project, payload.bindingId);
    const previousEnabled = current.enabled;
    current.enabled = payload.enabled;
    return {
      inverse: {
        type: "clipping.set_enabled",
        payload: { bindingId: current.id, enabled: previousEnabled },
      },
      affectedIds: [current.id, current.targetNodeId, current.sourceNodeId],
    };
  },
  "clipping.remove": (project, payload) => removeBinding(project, payload.bindingId),
  "clipping.remove_internal": (project, payload) => removeBinding(project, payload.bindingId),
  "clipping.restore": (project, payload) => {
    const bindings = collection(project);
    const index = Math.max(0, Math.min(bindings.length, payload.index));
    const restored = normalizedBinding(payload.binding);
    bindings.splice(index, 0, restored);
    return {
      inverse: {
        type: "clipping.remove_internal",
        payload: { bindingId: restored.id },
      },
      affectedIds: [restored.id, restored.targetNodeId, restored.sourceNodeId],
    };
  },
};
