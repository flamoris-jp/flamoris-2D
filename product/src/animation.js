export function clampDuration(value, fallback = 4) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? Math.min(30, Math.max(0.5, number)) : fallback;
}

export function captureOffsets(offsets) {
  return new Float32Array(offsets);
}

export function lerpOffsets(from, to, amount) {
  if (from.length !== to.length) throw new Error("Keyframe vertex counts do not match.");
  const t = Math.min(1, Math.max(0, amount));
  const result = new Float32Array(from.length);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = from[index] + (to[index] - from[index]) * t;
  }
  return result;
}

export function sampleLoop(keyframeA, keyframeB, time, duration) {
  const safeDuration = clampDuration(duration);
  const wrappedTime = ((time % safeDuration) + safeDuration) % safeDuration;
  const phase = wrappedTime / safeDuration;
  if (phase < 0.5) return lerpOffsets(keyframeA, keyframeB, phase * 2);
  return lerpOffsets(keyframeB, keyframeA, (phase - 0.5) * 2);
}
