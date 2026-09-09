import { cloneProject } from "./project.js";

export function createBoneRotationConstraint({
  id,
  boneId,
  enabled = true,
  minRotation,
  maxRotation,
}) {
  return cloneProject({
    id,
    boneId,
    enabled,
    minRotation,
    maxRotation,
  });
}
