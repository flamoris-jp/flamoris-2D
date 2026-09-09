const TWO_PI = Math.PI * 2;

export function normalizeMirrorRotation(rotation) {
  let value = rotation % TWO_PI;
  if (value > Math.PI) value -= TWO_PI;
  if (value < -Math.PI) value += TWO_PI;
  return Object.is(value, -0) ? 0 : value;
}

/** Mirrors a rest transform across an explicit parent-local vertical axis. */
export function mirrorBoneRestTransform(restLocalTransform, axisX = 0) {
  if (!restLocalTransform || ![restLocalTransform.x, restLocalTransform.y,
    restLocalTransform.rotation, axisX].every(Number.isFinite)) {
    throw new TypeError("Bone rest mirror inputs must be finite.");
  }
  return {
    x: axisX * 2 - restLocalTransform.x,
    y: restLocalTransform.y,
    rotation: normalizeMirrorRotation(Math.PI - restLocalTransform.rotation),
  };
}

/** Mirrors an authored local delta without inventing or changing Bone IDs. */
export function mirrorBonePoseDelta(localDelta) {
  if (!localDelta || ![localDelta.x, localDelta.y, localDelta.rotation]
    .every(Number.isFinite)) {
    throw new TypeError("Bone pose mirror inputs must be finite.");
  }
  return {
    x: -localDelta.x,
    y: localDelta.y,
    rotation: normalizeMirrorRotation(-localDelta.rotation),
  };
}
