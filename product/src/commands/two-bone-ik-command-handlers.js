import { cloneProject } from "../model/project.js";
import { createTwoBoneIkConstraint } from "../model/two-bone-ik-constraint.js";
import { CommandError } from "./errors.js";

function collection(project) {
  const values = project.rig?.twoBoneIkConstraints;
  if (!Array.isArray(values)) throw new CommandError(
    "Missing rig.twoBoneIkConstraints collection.", "collection.invalid");
  return values;
}

function indexFor(project, constraintId) {
  const index = collection(project).findIndex((entry) => entry.id === constraintId);
  if (index < 0) throw new CommandError(
    "TwoBoneIkConstraint does not exist.", "bone.two_bone_ik_not_found", { constraintId });
  return index;
}

function remove(project, constraintId) {
  const values = collection(project);
  const index = indexFor(project, constraintId);
  const [removed] = values.splice(index, 1);
  return {
    inverse: { type: "bone.restore_two_bone_ik",
      payload: { constraint: cloneProject(removed), index } },
    affectedIds: [removed.id, removed.rootBoneId, removed.midBoneId, removed.endBoneId],
  };
}

export const twoBoneIkCommandHandlers = {
  "bone.create_two_bone_ik": (project, payload) => {
    const created = createTwoBoneIkConstraint(payload.constraint);
    collection(project).push(created);
    return {
      inverse: { type: "bone.remove_two_bone_ik_internal",
        payload: { constraintId: created.id } },
      affectedIds: [created.id, created.rootBoneId, created.midBoneId, created.endBoneId],
    };
  },
  "bone.remove_two_bone_ik": (project, payload) => remove(project, payload.constraintId),
  "bone.remove_two_bone_ik_internal": (project, payload) =>
    remove(project, payload.constraintId),
  "bone.restore_two_bone_ik": (project, payload) => {
    const values = collection(project);
    const restored = createTwoBoneIkConstraint(payload.constraint);
    const index = Math.max(0, Math.min(values.length, payload.index));
    values.splice(index, 0, restored);
    return {
      inverse: { type: "bone.remove_two_bone_ik_internal",
        payload: { constraintId: restored.id } },
      affectedIds: [restored.id, restored.rootBoneId, restored.midBoneId, restored.endBoneId],
    };
  },
  "bone.set_two_bone_ik_enabled": (project, payload) => {
    const current = collection(project)[indexFor(project, payload.constraintId)];
    const previous = current.enabled;
    current.enabled = payload.enabled;
    return {
      inverse: { type: "bone.set_two_bone_ik_enabled",
        payload: { constraintId: current.id, enabled: previous } },
      affectedIds: [current.id, current.endBoneId],
    };
  },
  "bone.set_two_bone_ik_bend_direction": (project, payload) => {
    const current = collection(project)[indexFor(project, payload.constraintId)];
    const previous = current.bendDirection;
    current.bendDirection = payload.bendDirection;
    return {
      inverse: { type: "bone.set_two_bone_ik_bend_direction",
        payload: { constraintId: current.id, bendDirection: previous } },
      affectedIds: [current.id, current.rootBoneId, current.midBoneId, current.endBoneId],
    };
  },
};
