const EPSILON = 1e-12;
const DIRECTIONS = new Set(["clockwise", "counterclockwise"]);

function diagnostic(code, message, details = null) {
  return { code, message, ...(details ? { details } : {}) };
}

function point(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function limitedRotation(value, limit, role) {
  if (!limit) return { value, limited: false, diagnostic: null };
  if (!Number.isFinite(limit.minRotation) || !Number.isFinite(limit.maxRotation) ||
    limit.minRotation > limit.maxRotation) {
    return { value, limited: false, diagnostic: diagnostic(
      "TWO_BONE_IK_ROTATION_LIMIT_INVALID",
      "IK rotation limits must be finite and ordered.", { role },
    ) };
  }
  const next = clamp(value, limit.minRotation, limit.maxRotation);
  return { value: next, limited: next !== value, diagnostic: null };
}

/**
 * Pure analytic planar two-link solve. bendDirection names the side of the
 * root->target ray on which the elbow lies: counterclockwise is positive
 * signed area, clockwise is negative. Rotations are returned as the root
 * angle in the supplied coordinate frame and the mid Bone's local angle.
 */
export function solveTwoBoneIk({
  root,
  target,
  firstLength,
  secondLength,
  bendDirection,
  rotationLimits = null,
}) {
  const diagnostics = [];
  if (!point(root) || !point(target) || !Number.isFinite(firstLength) ||
    !Number.isFinite(secondLength) || firstLength <= EPSILON || secondLength <= EPSILON) {
    diagnostics.push(diagnostic("TWO_BONE_IK_DEGENERATE_CHAIN",
      "Two-bone IK requires finite points and two positive segment lengths."));
    return { solution: null, diagnostics };
  }
  if (!DIRECTIONS.has(bendDirection)) {
    diagnostics.push(diagnostic("TWO_BONE_IK_BEND_DIRECTION_INVALID",
      "bendDirection must be clockwise or counterclockwise."));
    return { solution: null, diagnostics };
  }

  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const requestedDistance = Math.hypot(dx, dy);
  const maximumDistance = firstLength + secondLength;
  const minimumDistance = Math.abs(firstLength - secondLength);
  const solvedDistance = clamp(requestedDistance, minimumDistance, maximumDistance);
  const targetAngle = requestedDistance > EPSILON ? Math.atan2(dy, dx) : 0;
  let rootRotation;
  let midRotation;

  if (solvedDistance <= EPSILON && Math.abs(firstLength - secondLength) <= EPSILON) {
    rootRotation = 0;
    midRotation = bendDirection === "counterclockwise" ? -Math.PI : Math.PI;
  } else {
    const cosine = clamp(
      (solvedDistance ** 2 - firstLength ** 2 - secondLength ** 2) /
        (2 * firstLength * secondLength),
      -1,
      1,
    );
    const magnitude = Math.acos(cosine);
    // A negative local elbow angle places the elbow on the positive
    // (counterclockwise) side of the root->target ray.
    midRotation = bendDirection === "counterclockwise" ? -magnitude : magnitude;
    rootRotation = targetAngle - Math.atan2(
      secondLength * Math.sin(midRotation),
      firstLength + secondLength * Math.cos(midRotation),
    );
  }

  const rootLimit = limitedRotation(rootRotation, rotationLimits?.root || null, "root");
  const midLimit = limitedRotation(midRotation, rotationLimits?.mid || null, "mid");
  for (const result of [rootLimit, midLimit]) {
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  }
  if (diagnostics.length) return { solution: null, diagnostics };
  rootRotation = rootLimit.value;
  midRotation = midLimit.value;
  const elbow = {
    x: root.x + firstLength * Math.cos(rootRotation),
    y: root.y + firstLength * Math.sin(rootRotation),
  };
  const endAngle = rootRotation + midRotation;
  const end = {
    x: elbow.x + secondLength * Math.cos(endAngle),
    y: elbow.y + secondLength * Math.sin(endAngle),
  };
  const reach = requestedDistance > maximumDistance
    ? "extended" : requestedDistance < minimumDistance ? "folded" : "reachable";
  return {
    solution: {
      rootRotation,
      midRotation,
      elbow,
      end,
      requestedDistance,
      solvedDistance,
      reach,
      limited: rootLimit.limited || midLimit.limited,
    },
    diagnostics: [],
  };
}
