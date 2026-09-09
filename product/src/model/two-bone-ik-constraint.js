import { cloneProject } from "./project.js";

export const IK_BEND_DIRECTIONS = Object.freeze(["clockwise", "counterclockwise"]);

export function createTwoBoneIkConstraint({
  id,
  rootBoneId,
  midBoneId,
  endBoneId,
  enabled = true,
  bendDirection = "counterclockwise",
}) {
  return cloneProject({
    id,
    rootBoneId,
    midBoneId,
    endBoneId,
    enabled,
    bendDirection,
  });
}
