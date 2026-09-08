import { cloneProject } from "./project.js";

export function identityBonePoseDelta() {
  return { x: 0, y: 0, rotation: 0 };
}

export function createBone({
  id,
  parentNodeId,
  restLocalTransform,
  length,
  enabled = true,
}) {
  return {
    id,
    parentNodeId,
    restLocalTransform: cloneProject(restLocalTransform),
    length,
    enabled,
  };
}

export function createBonePoseKeyform({ boneId, keyArtId, localDelta }) {
  return {
    boneId,
    keyArtId,
    localDelta: cloneProject(localDelta),
  };
}
