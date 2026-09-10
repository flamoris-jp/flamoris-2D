import { cloneProject } from "./project.js";

export const CLIP_LOOP_MODES = Object.freeze({
  ONCE: "once",
  LOOP: "loop",
});

export function compareAnimationClips(left, right) {
  return String(left.id) < String(right.id) ? -1 :
    String(left.id) > String(right.id) ? 1 : 0;
}

export function canonicalizeAnimationClips(clips = []) {
  return cloneProject(clips).sort(compareAnimationClips);
}

export function normalizeAnimationClip(clip) {
  return {
    ...cloneProject(clip),
    metadata: cloneProject(clip.metadata || {}),
  };
}

export function createAnimationClip({
  id,
  displayName,
  temporalProgramId,
  defaultLoopMode = CLIP_LOOP_MODES.ONCE,
  metadata = {},
}) {
  return normalizeAnimationClip({
    id,
    displayName,
    temporalProgramId,
    defaultLoopMode,
    metadata,
  });
}
