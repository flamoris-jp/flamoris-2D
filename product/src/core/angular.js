const TWO_PI = Math.PI * 2;

/**
 * Returns the signed shortest arc used by the Phase 7 Bone evaluator.
 * Exact positive and negative half-turns retain their original sign.
 */
export function shortestBoneRotationDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

export function interpolateBoneCompatibleAngle(from, to, amount) {
  return from + shortestBoneRotationDelta(from, to) * amount;
}
