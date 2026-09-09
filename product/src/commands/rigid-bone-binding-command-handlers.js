import { cloneProject } from "../model/project.js";
import { createRigidBoneBinding } from "../model/rigid-bone-binding.js";
import { CommandError } from "./errors.js";

function collection(project) {
  const bindings = project.rig?.rigidBoneBindings;
  if (!Array.isArray(bindings)) {
    throw new CommandError(
      "Missing rig.rigidBoneBindings collection.",
      "collection.invalid",
    );
  }
  return bindings;
}

function bindingIndex(project, bindingId) {
  const index = collection(project).findIndex((binding) => binding.id === bindingId);
  if (index < 0) {
    throw new CommandError(
      "RigidBoneBinding does not exist.",
      "rigid_binding.not_found",
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
      type: "bone.restore_rigid_binding",
      payload: { binding: cloneProject(removed), index },
    },
    affectedIds: [removed.id, removed.targetNodeId, removed.boneId],
  };
}

export const rigidBoneBindingCommandHandlers = {
  "bone.create_rigid_binding": (project, payload) => {
    const created = createRigidBoneBinding(payload.binding);
    collection(project).push(created);
    return {
      inverse: {
        type: "bone.remove_rigid_binding_internal",
        payload: { bindingId: created.id },
      },
      affectedIds: [created.id, created.targetNodeId, created.boneId],
    };
  },

  "bone.set_rigid_binding_bone": (project, payload) => {
    const current = binding(project, payload.bindingId);
    const previousBoneId = current.boneId;
    current.boneId = payload.boneId;
    return {
      inverse: {
        type: "bone.set_rigid_binding_bone",
        payload: { bindingId: current.id, boneId: previousBoneId },
      },
      affectedIds: [current.id, current.targetNodeId, previousBoneId, payload.boneId],
    };
  },

  "bone.set_rigid_binding_enabled": (project, payload) => {
    const current = binding(project, payload.bindingId);
    const previousEnabled = current.enabled;
    current.enabled = payload.enabled;
    return {
      inverse: {
        type: "bone.set_rigid_binding_enabled",
        payload: { bindingId: current.id, enabled: previousEnabled },
      },
      affectedIds: [current.id, current.targetNodeId, current.boneId],
    };
  },

  "bone.remove_rigid_binding": (project, payload) =>
    removeBinding(project, payload.bindingId),
  "bone.remove_rigid_binding_internal": (project, payload) =>
    removeBinding(project, payload.bindingId),

  "bone.restore_rigid_binding": (project, payload) => {
    const bindings = collection(project);
    const restored = createRigidBoneBinding(payload.binding);
    const index = Math.max(0, Math.min(bindings.length, payload.index));
    bindings.splice(index, 0, restored);
    return {
      inverse: {
        type: "bone.remove_rigid_binding_internal",
        payload: { bindingId: restored.id },
      },
      affectedIds: [restored.id, restored.targetNodeId, restored.boneId],
    };
  },
};

