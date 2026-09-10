import { CLIP_LOOP_MODES } from "./animation-clip.js";
import { canonicalizeClipInstances } from "./clip-instance.js";
import { rawClipLocalTick } from "../core/clip-time.js";

function problem(code, path, message, entityId = null, details = null) {
  return {
    code,
    path,
    message,
    entityId,
    severity: "error",
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

function gcd(left, right) {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function validateSequenceClipInstances(
  project,
  sequence,
  sequencePath,
  sequenceProgram,
  register = () => {},
) {
  const issues = [];
  if (!Array.isArray(sequence.clipInstances)) {
    return [problem("SEQUENCE_INVALID", sequencePath + ".clipInstances",
      "clipInstances must be an array.", sequence.id)];
  }
  const clipById = new Map((project.animation?.clips || []).map((clip) => [clip?.id, clip]));
  const programById = new Map((project.temporalPrograms || []).map((program) => [program?.id, program]));

  canonicalizeClipInstances(sequence.clipInstances).forEach((instance, instanceIndex) => {
    const path = sequencePath + ".clipInstances." + instanceIndex;
    if (!object(instance)) {
      issues.push(problem("ANIMATION_CLIP_INSTANCE_INVALID", path,
        "ClipInstance must be an object.", sequence.id));
      return;
    }
    register(instance.id, path + ".id");
    if (!exactKeys(instance, [
      "id", "clipId", "startTicks", "endTicks", "sourceOffsetTicks", "playbackRate",
      "loopMode", "weight", "layer", "enabled",
    ])) {
      issues.push(problem("ANIMATION_CLIP_INSTANCE_INVALID", path,
        "ClipInstance contains missing or unsupported persistent fields.", instance.id));
    }
    const clip = clipById.get(instance.clipId);
    const clipProgram = programById.get(clip?.temporalProgramId);
    if (!clip) {
      issues.push(problem("ANIMATION_CLIP_REFERENCE_INVALID", path + ".clipId",
        "ClipInstance AnimationClip does not exist.", instance.id,
        { clipId: instance.clipId }));
    }
    const placementValid = Number.isSafeInteger(instance.startTicks) &&
      Number.isSafeInteger(instance.endTicks) && instance.startTicks >= 0 &&
      instance.startTicks < instance.endTicks &&
      (!sequenceProgram || instance.endTicks <= sequenceProgram.durationTicks);
    if (!placementValid) {
      issues.push(problem("ANIMATION_CLIP_INSTANCE_PLACEMENT_INVALID", path,
        "ClipInstance must satisfy 0 <= startTicks < endTicks <= Sequence duration.",
        instance.id));
    }
    if (!Number.isSafeInteger(instance.sourceOffsetTicks) || instance.sourceOffsetTicks < 0) {
      issues.push(problem("ANIMATION_CLIP_SOURCE_OFFSET_INVALID", path + ".sourceOffsetTicks",
        "sourceOffsetTicks must be a non-negative safe integer.", instance.id));
    }
    const rate = instance.playbackRate;
    const rateShapeValid = object(rate) && exactKeys(rate, ["numerator", "denominator"]);
    const rateValuesValid = rateShapeValid && Number.isSafeInteger(rate.numerator) &&
      Number.isSafeInteger(rate.denominator) && rate.numerator > 0 && rate.denominator > 0;
    if (!rateValuesValid) {
      issues.push(problem("ANIMATION_CLIP_PLAYBACK_RATE_INVALID", path + ".playbackRate",
        "playbackRate must contain positive safe-integer numerator and denominator.", instance.id));
    } else if (gcd(rate.numerator, rate.denominator) !== 1) {
      issues.push(problem("ANIMATION_CLIP_PLAYBACK_RATE_NONCANONICAL", path + ".playbackRate",
        "playbackRate must be persisted as a reduced rational.", instance.id));
    }
    if (![CLIP_LOOP_MODES.ONCE, CLIP_LOOP_MODES.LOOP].includes(instance.loopMode)) {
      issues.push(problem("ANIMATION_CLIP_LOOP_MODE_INVALID", path + ".loopMode",
        "ClipInstance loopMode must be once or loop.", instance.id));
    }
    if (typeof instance.weight !== "number" || !Number.isFinite(instance.weight) ||
      instance.weight < 0 || instance.weight > 1) {
      issues.push(problem("ANIMATION_CLIP_WEIGHT_INVALID", path + ".weight",
        "ClipInstance weight must be finite and within 0..1.", instance.id));
    }
    if (!Number.isSafeInteger(instance.layer)) {
      issues.push(problem("ANIMATION_CLIP_LAYER_INVALID", path + ".layer",
        "ClipInstance layer must be a safe integer.", instance.id));
    }
    if (typeof instance.enabled !== "boolean") {
      issues.push(problem("ANIMATION_CLIP_INSTANCE_INVALID", path + ".enabled",
        "ClipInstance enabled must be boolean.", instance.id));
    }

    if (!clipProgram || !placementValid || !rateValuesValid ||
      !Number.isSafeInteger(instance.sourceOffsetTicks) || instance.sourceOffsetTicks < 0 ||
      ![CLIP_LOOP_MODES.ONCE, CLIP_LOOP_MODES.LOOP].includes(instance.loopMode)) return;

    if (instance.loopMode === CLIP_LOOP_MODES.ONCE) {
      if (instance.sourceOffsetTicks > clipProgram.durationTicks) {
        issues.push(problem("ANIMATION_CLIP_SOURCE_OFFSET_INVALID", path + ".sourceOffsetTicks",
          "Once sourceOffsetTicks must be within the inclusive clip duration.", instance.id,
          { clipDurationTicks: clipProgram.durationTicks }));
        return;
      }
      try {
        const lastRawLocal = rawClipLocalTick(instance, instance.endTicks - 1);
        if (lastRawLocal > clipProgram.durationTicks) {
          issues.push(problem("ANIMATION_CLIP_ONCE_OVERRUN", path,
            "Once ClipInstance exceeds the clip duration at its last active tick.", instance.id,
            { lastRawLocal, clipDurationTicks: clipProgram.durationTicks }));
        }
      } catch (error) {
        issues.push(problem("ANIMATION_CLIP_LOCAL_TIME_OVERFLOW", path,
          "ClipInstance local-time projection exceeds the safe integer range.", instance.id,
          { cause: error.message }));
      }
    } else {
      if (clipProgram.durationTicks <= 0 || instance.sourceOffsetTicks >= clipProgram.durationTicks) {
        issues.push(problem("ANIMATION_CLIP_LOOP_OFFSET_INVALID", path + ".sourceOffsetTicks",
          "Loop sourceOffsetTicks must be within [0, clipDurationTicks).", instance.id,
          { clipDurationTicks: clipProgram.durationTicks }));
        return;
      }
      try {
        rawClipLocalTick(instance, instance.endTicks - 1);
      } catch (error) {
        issues.push(problem("ANIMATION_CLIP_LOCAL_TIME_OVERFLOW", path,
          "ClipInstance local-time projection exceeds the safe integer range.", instance.id,
          { cause: error.message }));
      }
    }
  });
  return issues;
}
