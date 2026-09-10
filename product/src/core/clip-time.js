import { roundHalfUpRatio } from "./temporal.js";

function safeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + " must be a non-negative safe integer.");
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(label + " must be a positive safe integer.");
  }
  return value;
}

export function rawClipLocalTick(instance, sequenceTick) {
  safeNonNegativeInteger(sequenceTick, "Sequence tick");
  safeNonNegativeInteger(instance.startTicks, "ClipInstance startTicks");
  safeNonNegativeInteger(instance.sourceOffsetTicks, "ClipInstance sourceOffsetTicks");
  const numerator = positiveSafeInteger(instance.playbackRate?.numerator,
    "Playback numerator");
  const denominator = positiveSafeInteger(instance.playbackRate?.denominator,
    "Playback denominator");
  if (sequenceTick < instance.startTicks) {
    throw new RangeError("Sequence tick precedes the ClipInstance placement.");
  }
  const elapsed = BigInt(sequenceTick) - BigInt(instance.startTicks);
  const exactNumerator = BigInt(instance.sourceOffsetTicks) * BigInt(denominator) +
    elapsed * BigInt(numerator);
  return roundHalfUpRatio(exactNumerator, BigInt(denominator));
}

export function euclideanModulo(value, modulus) {
  safeNonNegativeInteger(value, "Modulo value");
  positiveSafeInteger(modulus, "Modulo divisor");
  const result = ((BigInt(value) % BigInt(modulus)) + BigInt(modulus)) % BigInt(modulus);
  return Number(result);
}

export function projectClipInstanceTick(instance, sequenceTick, clipDurationTicks) {
  safeNonNegativeInteger(sequenceTick, "Sequence tick");
  safeNonNegativeInteger(clipDurationTicks, "AnimationClip duration");
  const active = sequenceTick >= instance.startTicks && sequenceTick < instance.endTicks;
  const base = {
    active,
    clipInstanceId: instance.id,
    clipId: instance.clipId,
    loopMode: instance.loopMode,
  };
  if (!active) return base;
  const rawLocalTick = rawClipLocalTick(instance, sequenceTick);
  if (instance.loopMode === "once") {
    if (rawLocalTick > clipDurationTicks) {
      throw new RangeError("Once ClipInstance local tick exceeds the AnimationClip duration.");
    }
    return { ...base, rawLocalTick, localTick: rawLocalTick };
  }
  if (instance.loopMode === "loop") {
    if (clipDurationTicks <= 0) {
      throw new RangeError("Loop AnimationClip duration must be positive.");
    }
    return {
      ...base,
      rawLocalTick,
      localTick: euclideanModulo(rawLocalTick, clipDurationTicks),
    };
  }
  throw new RangeError("ClipInstance loopMode must be once or loop.");
}
