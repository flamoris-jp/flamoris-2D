import { cloneProject } from "../model/project.js";
import {
  canonicalizeAnimationClips,
  normalizeAnimationClip,
} from "../model/animation-clip.js";
import { CommandError } from "./errors.js";

function clipIndex(project, clipId) {
  const index = project.animation.clips.findIndex((entry) => entry.id === clipId);
  if (index < 0) {
    throw new CommandError("Unknown AnimationClip.", "animation.clip_not_found", { clipId });
  }
  return index;
}

function sortClips(project) {
  project.animation.clips = canonicalizeAnimationClips(project.animation.clips);
}

export const animationClipCommandHandlers = {
  "animation.clip.create": (project, payload) => {
    const clip = normalizeAnimationClip(payload.clip);
    if (project.animation.clips.some((entry) => entry.id === clip.id)) {
      throw new CommandError("AnimationClip ID already exists.", "identity.duplicate",
        { clipId: clip.id });
    }
    project.animation.clips.push(clip);
    sortClips(project);
    return {
      inverse: { type: "animation.clip.remove_internal", payload: { clipId: clip.id } },
      affectedIds: [clip.id, clip.temporalProgramId],
    };
  },

  "animation.clip.update": (project, payload) => {
    const index = clipIndex(project, payload.clipId);
    const previous = cloneProject(project.animation.clips[index]);
    const next = normalizeAnimationClip(payload.clip);
    if (next.id !== payload.clipId) {
      throw new CommandError("AnimationClip updates must preserve stable identity.",
        "identity.changed");
    }
    if (next.temporalProgramId !== previous.temporalProgramId) {
      throw new CommandError(
        "AnimationClip TemporalProgram ownership cannot be reassigned by animation.clip.update.",
        "animation.clip_temporal_program_immutable",
        {
          clipId: previous.id,
          temporalProgramId: previous.temporalProgramId,
          requestedTemporalProgramId: next.temporalProgramId,
        },
      );
    }
    project.animation.clips[index] = next;
    sortClips(project);
    return {
      inverse: { type: "animation.clip.update", payload: { clipId: previous.id, clip: previous } },
      affectedIds: [next.id, next.temporalProgramId],
    };
  },

  "animation.clip.remove": (project, payload) => {
    const index = clipIndex(project, payload.clipId);
    const [clip] = project.animation.clips.splice(index, 1);
    return {
      inverse: { type: "animation.clip.restore", payload: { clip, index } },
      affectedIds: [clip.id, clip.temporalProgramId],
    };
  },

  "animation.clip.remove_internal": (project, payload) =>
    animationClipCommandHandlers["animation.clip.remove"](project, payload),

  "animation.clip.restore": (project, payload) => {
    project.animation.clips.splice(payload.index, 0, normalizeAnimationClip(payload.clip));
    sortClips(project);
    return {
      inverse: { type: "animation.clip.remove_internal", payload: { clipId: payload.clip.id } },
      affectedIds: [payload.clip.id, payload.clip.temporalProgramId],
    };
  },
};
