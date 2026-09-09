import { cloneProject } from "../model/project.js";
import { createBoneRotationConstraint } from "../model/bone-rotation-constraint.js";
import { CommandError } from "./errors.js";

function collection(project) {
  const values = project.rig?.boneRotationConstraints;
  if (!Array.isArray(values)) throw new CommandError(
    "Missing rig.boneRotationConstraints collection.", "collection.invalid");
  return values;
}

function indexFor(project, constraintId) {
  const index = collection(project).findIndex((entry) => entry.id === constraintId);
  if (index < 0) throw new CommandError(
    "BoneRotationConstraint does not exist.", "bone.rotation_constraint_not_found",
    { constraintId });
  return index;
}

function remove(project, constraintId) {
  const values = collection(project);
  const index = indexFor(project, constraintId);
  const [removed] = values.splice(index, 1);
  return {
    inverse: { type: "bone.restore_rotation_constraint",
      payload: { constraint: cloneProject(removed), index } },
    affectedIds: [removed.id, removed.boneId],
  };
}

export const boneConstraintCommandHandlers = {
  "bone.create_rotation_constraint": (project, payload) => {
    const created = createBoneRotationConstraint(payload.constraint);
    collection(project).push(created);
    return {
      inverse: { type: "bone.remove_rotation_constraint_internal",
        payload: { constraintId: created.id } },
      affectedIds: [created.id, created.boneId],
    };
  },
  "bone.remove_rotation_constraint": (project, payload) =>
    remove(project, payload.constraintId),
  "bone.remove_rotation_constraint_internal": (project, payload) =>
    remove(project, payload.constraintId),
  "bone.restore_rotation_constraint": (project, payload) => {
    const values = collection(project);
    const restored = createBoneRotationConstraint(payload.constraint);
    const index = Math.max(0, Math.min(values.length, payload.index));
    values.splice(index, 0, restored);
    return {
      inverse: { type: "bone.remove_rotation_constraint_internal",
        payload: { constraintId: restored.id } },
      affectedIds: [restored.id, restored.boneId],
    };
  },
  "bone.set_rotation_constraint_enabled": (project, payload) => {
    const current = collection(project)[indexFor(project, payload.constraintId)];
    const previous = current.enabled;
    current.enabled = payload.enabled;
    return {
      inverse: { type: "bone.set_rotation_constraint_enabled",
        payload: { constraintId: current.id, enabled: previous } },
      affectedIds: [current.id, current.boneId],
    };
  },
  "bone.set_rotation_constraint_bounds": (project, payload) => {
    const current = collection(project)[indexFor(project, payload.constraintId)];
    const previous = { minRotation: current.minRotation, maxRotation: current.maxRotation };
    current.minRotation = payload.minRotation;
    current.maxRotation = payload.maxRotation;
    return {
      inverse: { type: "bone.set_rotation_constraint_bounds",
        payload: { constraintId: current.id, ...previous } },
      affectedIds: [current.id, current.boneId],
    };
  },
};
