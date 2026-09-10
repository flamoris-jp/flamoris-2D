import { CLIP_LOOP_MODES } from "./animation-clip.js";
import {
  TEMPORAL_TRACK_DEFINITIONS,
  sampleKeyframes,
  temporalChannelDefinition,
} from "../core/temporal.js";

const LOOP_NUMERIC_TOLERANCE = 1e-9;

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function numericEqual(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) &&
      Math.abs(left - right) <= LOOP_NUMERIC_TOLERANCE;
  }
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    return left.every((value, index) => numericEqual(value, right[index]));
  }
  if (object(left) && object(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] &&
        numericEqual(left[key], right[key]));
  }
  return Object.is(left, right);
}

function endpointValuesEqual(left, right, definition) {
  if (["number", "positive-number", "unit-number", "weights"].includes(definition?.value)) {
    return numericEqual(left, right);
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function loopedClipIds(project) {
  const clips = Array.isArray(project.animation?.clips) ? project.animation.clips : [];
  const result = new Set(clips
    .filter((clip) => clip?.defaultLoopMode === CLIP_LOOP_MODES.LOOP)
    .map((clip) => clip.id));
  for (const sequence of project.sequences || []) {
    const instances = Array.isArray(sequence?.clipInstances) ? sequence.clipInstances : [];
    for (const instance of instances) {
      if (instance?.loopMode === CLIP_LOOP_MODES.LOOP && typeof instance.clipId === "string") {
        result.add(instance.clipId);
      }
    }
  }
  return result;
}

export function validateAnimationClips(project) {
  const issues = [];
  const programs = new Set((project.temporalPrograms || []).map((program) => program?.id));
  const programById = new Map((project.temporalPrograms || []).map((program) => [program?.id, program]));
  const looping = loopedClipIds(project);
  if (!Array.isArray(project.animation?.clips)) {
    return [problem("collection.invalid", "animation.clips", "animation.clips must be an array.")];
  }

  [...project.animation.clips]
    .sort((left, right) => String(left?.id) < String(right?.id) ? -1 :
      String(left?.id) > String(right?.id) ? 1 : 0)
    .forEach((clip, clipIndex) => {
      const path = "animation.clips." + clipIndex;
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

      const program = programById.get(clip.temporalProgramId);
      if (!program || !looping.has(clip.id) || !Number.isSafeInteger(program.durationTicks) ||
        program.durationTicks <= 0 || !Array.isArray(program.tracks)) return;
      [...program.tracks]
        .sort((left, right) => String(left?.trackId) < String(right?.trackId) ? -1 :
          String(left?.trackId) > String(right?.trackId) ? 1 : 0)
        .forEach((track) => {
          const definition = TEMPORAL_TRACK_DEFINITIONS[track?.kind];
          if (!definition || !object(track.channels)) return;
          Object.keys(track.channels).sort().forEach((channelName) => {
            const channel = track.channels[channelName];
            if (!Array.isArray(channel?.keyframes)) return;
            try {
              const startValue = sampleKeyframes(channel.keyframes, 0);
              const endValue = sampleKeyframes(channel.keyframes, program.durationTicks);
              if (endpointValuesEqual(startValue, endValue,
                temporalChannelDefinition(track.kind, channelName))) return;
              issues.push(problem(
                "ANIMATION_LOOP_ENDPOINT_MISMATCH",
                path + ".temporalProgramId",
                "Loop endpoints differ; the seam is diagnosed and is not corrected.",
                clip.id,
                "warning",
                {
                  temporalProgramId: program.id,
                  trackId: track.trackId,
                  channel: channelName,
                  tolerance: LOOP_NUMERIC_TOLERANCE,
                  startValue,
                  endValue,
                },
              ));
            } catch {
              // Existing TemporalProgram diagnostics remain authoritative for
              // malformed channels that cannot be sampled safely.
            }
          });
        });
    });
  return issues;
}
