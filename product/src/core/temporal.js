export const TIMEBASE_TICKS_PER_SECOND = 120000;

export const TEMPORAL_TRACK_DEFINITIONS = Object.freeze({
  GeometryBlendTrack: { channels: ["geometryWeight"], value: "unit-number", target: "transition" },
  AppearanceTrack: { channels: ["appearance"], value: "weights", target: "transition" },
  OpacityTrack: { channels: ["opacity"], value: "unit-number", target: "node-semantic-or-transition" },
  PresenceTrack: { channels: ["presence"], value: "presence", target: "node-semantic-or-transition", discrete: true },
  DrawOrderTrack: { channels: ["drawOrder"], value: "integer", target: "node-semantic-or-transition", discrete: true },
  ClippingTrack: { channels: ["clipping"], value: "clipping", target: "node-semantic-or-transition", discrete: true },
  TransformTrack: {
    channels: ["positionX", "positionY", "rotation", "scaleX", "scaleY"],
    value: "number",
    target: "node",
  },
  CameraTrack: {
    channels: ["positionX", "positionY", "rotation", "scale"],
    value: "number",
    target: "camera",
  },
  MeshDeformationTrack: {
    channels: ["deformation"],
    value: "deformation",
    target: "mesh",
  },
});

function gcd(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left;
}

export function normalizeFrameRate(frameRate) {
  const numerator = frameRate?.numerator;
  const denominator = frameRate?.denominator;
  if (!Number.isSafeInteger(numerator) || numerator <= 0 ||
    !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("Frame rate numerator and denominator must be positive safe integers.");
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function roundHalfUp(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError("Temporal rounding accepts non-negative values only.");
  }
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(label + " exceeds the safe integer range.");
  }
  return number;
}

export function frameToTicks(frameIndex, frameRate) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError("Frame index must be a non-negative safe integer.");
  }
  const rate = normalizeFrameRate(frameRate);
  const numerator = BigInt(frameIndex) * BigInt(TIMEBASE_TICKS_PER_SECOND) *
    BigInt(rate.denominator);
  const denominator = BigInt(rate.numerator);
  const exact = numerator % denominator === 0n;
  return {
    ticks: safeNumber(exact ? numerator / denominator : roundHalfUp(numerator, denominator), "Tick value"),
    exact,
  };
}

export function ticksToFrame(ticks, frameRate) {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError("Ticks must be a non-negative safe integer.");
  }
  const rate = normalizeFrameRate(frameRate);
  const numerator = BigInt(ticks) * BigInt(rate.numerator);
  const denominator = BigInt(TIMEBASE_TICKS_PER_SECOND) * BigInt(rate.denominator);
  const exact = numerator % denominator === 0n;
  return {
    frameIndex: safeNumber(exact ? numerator / denominator : roundHalfUp(numerator, denominator), "Frame index"),
    exact,
  };
}

export function secondsToTicks(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("Seconds must be a non-negative finite number.");
  }
  const ticks = Math.floor(seconds * TIMEBASE_TICKS_PER_SECOND + 0.5);
  if (!Number.isSafeInteger(ticks)) throw new RangeError("Tick value exceeds the safe integer range.");
  return ticks;
}

export function ticksToSeconds(ticks) {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError("Ticks must be a non-negative safe integer.");
  }
  return ticks / TIMEBASE_TICKS_PER_SECOND;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortTemporalProgram(program) {
  return canonicalize({
    ...structuredClone(program),
    tracks: [...program.tracks]
      .sort((a, b) => compareText(a.trackId, b.trackId))
      .map((track) => ({
        ...structuredClone(track),
        channels: Object.fromEntries(Object.entries(track.channels)
          .sort(([a], [b]) => compareText(a, b))
          .map(([name, channel]) => [name, {
            ...structuredClone(channel),
            keyframes: [...channel.keyframes].sort((a, b) =>
              a.timeTicks - b.timeTicks || compareText(a.id, b.id)),
          }])),
      })),
    events: [...program.events].sort((a, b) =>
      a.timeTicks - b.timeTicks || compareText(a.id, b.id)),
    regions: [...program.regions].sort((a, b) =>
      a.startTicks - b.startTicks || a.endTicks - b.endTicks || compareText(a.id, b.id)),
  });
}

function cubic(t, a, b) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
}

export function sampleBezier(progress, interpolation) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 60; index += 1) {
    const middle = (low + high) / 2;
    if (cubic(middle, interpolation.x1, interpolation.x2) < progress) low = middle;
    else high = middle;
  }
  return cubic((low + high) / 2, interpolation.y1, interpolation.y2);
}

function interpolateValue(from, to, progress) {
  if (typeof from === "number" && typeof to === "number") {
    return from + (to - from) * progress;
  }
  if (from && to && typeof from === "object" && typeof to === "object" &&
    !Array.isArray(from) && !Array.isArray(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    const result = {};
    for (const key of keys) {
      const left = from[key] ?? 0;
      const right = to[key] ?? 0;
      if (typeof left === "number" && typeof right === "number") {
        result[key] = left + (right - left) * progress;
      } else if (left === right) {
        result[key] = structuredClone(left);
      } else {
        return structuredClone(from);
      }
    }
    return result;
  }
  return structuredClone(from);
}

export function sampleKeyframes(keyframes, timeTicks) {
  if (!Number.isSafeInteger(timeTicks) || timeTicks < 0) {
    throw new RangeError("Sample time must be a non-negative integer tick.");
  }
  if (!keyframes.length) return null;
  const ordered = [...keyframes].sort((a, b) =>
    a.timeTicks - b.timeTicks || compareText(a.id, b.id));
  if (timeTicks <= ordered[0].timeTicks) return structuredClone(ordered[0].value);
  const last = ordered.at(-1);
  if (timeTicks >= last.timeTicks) return structuredClone(last.value);
  const nextIndex = ordered.findIndex((keyframe) => keyframe.timeTicks >= timeTicks);
  const next = ordered[nextIndex];
  if (next.timeTicks === timeTicks) return structuredClone(next.value);
  const previous = ordered[nextIndex - 1];
  const interpolation = previous.interpolationToNext;
  if (interpolation.kind === "step") return structuredClone(previous.value);
  const raw = (timeTicks - previous.timeTicks) / (next.timeTicks - previous.timeTicks);
  const progress = interpolation.kind === "bezier"
    ? sampleBezier(raw, interpolation)
    : raw;
  return interpolateValue(previous.value, next.value, progress);
}

export function sampleTemporalProgram(program, timeTicks) {
  if (!Number.isSafeInteger(timeTicks) || timeTicks < 0 || timeTicks > program.durationTicks) {
    throw new RangeError("Sample time must be within the TemporalProgram duration.");
  }
  const ordered = sortTemporalProgram(program);
  return {
    programId: program.id,
    timeTicks,
    tracks: ordered.tracks.map((track) => ({
      trackId: track.trackId,
      kind: track.kind,
      target: structuredClone(track.target),
      values: Object.fromEntries(Object.entries(track.channels).map(([name, channel]) =>
        [name, sampleKeyframes(channel.keyframes, timeTicks)])),
    })),
    events: ordered.events.filter((event) => event.timeTicks === timeTicks),
    regions: ordered.regions.filter((region) =>
      region.startTicks <= timeTicks && timeTicks <= region.endTicks),
  };
}
