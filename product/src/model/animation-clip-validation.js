import { CLIP_LOOP_MODES } from "./animation-clip.js";

function problem(code, path, message, entityId = null, severity = "error", details = null) {
  return {
    code,
    path,
    message,
    entityId,
    severity,
    ...(details ? { details } : {}),
  };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index]);
}

export function validateAnimationClips(project) {
  const issues = [];
  const programs = new Set((project.temporalPrograms || []).map((program) => program?.id));
  if (!Array.isArray(project.animation?.clips)) {
    return [problem("collection.invalid", "animation.clips", "animation.clips must be an array.")];
  }

  [...project.animation.clips]
    .sort((left, right) => String(left?.id).localeCompare(String(right?.id)))
    .forEach((clip) => {
      const sourceIndex = project.animation.clips.indexOf(clip);
      const path = "animation.clips." + sourceIndex;
      if (!object(clip)) {
        issues.push(problem("ANIMATION_CLIP_INVALID", path, "AnimationClip must be an object."));
        return;
      }
      if (!exactKeys(clip, [
        "id", "displayName", "temporalProgramId", "defaultLoopMode", "metadata",
      ])) {
        issues.push(problem(
          "ANIMATION_CLIP_INVALID",
          path,
          "AnimationClip contains missing or unsupported persistent fields; duration belongs only to TemporalProgram.",
          clip.id,
        ));
      }
      if (typeof clip.displayName !== "string" || !clip.displayName.trim()) {
        issues.push(problem("ANIMATION_CLIP_INVALID", path + ".displayName",
          "AnimationClip displayName is required.", clip.id));
      }
      if (typeof clip.temporalProgramId !== "string" || !programs.has(clip.temporalProgramId)) {
        issues.push(problem("ANIMATION_CLIP_PROGRAM_REFERENCE_INVALID", path + ".temporalProgramId",
          "AnimationClip TemporalProgram does not exist.", clip.id));
      }
      if (![CLIP_LOOP_MODES.ONCE, CLIP_LOOP_MODES.LOOP].includes(clip.defaultLoopMode)) {
        issues.push(problem("ANIMATION_CLIP_LOOP_MODE_INVALID", path + ".defaultLoopMode",
          "AnimationClip defaultLoopMode must be once or loop.", clip.id));
      }
      if (!object(clip.metadata)) {
        issues.push(problem("ANIMATION_CLIP_INVALID", path + ".metadata",
          "AnimationClip metadata must be an object.", clip.id));
      }
    });
  return issues;
}
