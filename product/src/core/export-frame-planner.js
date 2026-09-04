import {
  TIMEBASE_TICKS_PER_SECOND,
  frameToTicks,
  normalizeFrameRate,
} from "./temporal.js";

export const EXPORT_FRAME_BOUNDARY_CONTRACT = Object.freeze({
  start: "inclusive",
  end: "exclusive",
});

function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(label + " exceeds the safe integer range.");
  }
  return number;
}

function ceilDivide(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Maps a finite TemporalProgram duration to the canonical frame grid.
 *
 * Export samples the half-open interval [0, durationTicks). Frame zero is
 * always tick zero, while a frame whose rational timestamp is exactly the
 * duration boundary is not emitted. Tick projection delegates to frameToTicks
 * so export shares the established non-negative round-half-up convention.
 */
export class ExportFramePlanner {
  constructor({ durationTicks, frameRate }) {
    if (!Number.isSafeInteger(durationTicks) || durationTicks <= 0) {
      throw new RangeError("Export durationTicks must be a positive safe integer.");
    }
    const normalizedRate = normalizeFrameRate(frameRate);
    const frameCount = safeNumber(ceilDivide(
      BigInt(durationTicks) * BigInt(normalizedRate.numerator),
      BigInt(TIMEBASE_TICKS_PER_SECOND) * BigInt(normalizedRate.denominator),
    ), "Export frame count");

    this.durationTicks = durationTicks;
    this.frameRate = Object.freeze(normalizedRate);
    this.frameCount = frameCount;
    Object.freeze(this);
  }

  frameAt(frameIndex) {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= this.frameCount) {
      throw new RangeError("Export frame index must be within the planned frame range.");
    }
    const projection = frameToTicks(frameIndex, this.frameRate);
    return Object.freeze({
      frameIndex,
      timeTicks: projection.ticks,
      exact: projection.exact,
    });
  }

  firstFrame() {
    return this.frameAt(0);
  }

  lastFrame() {
    return this.frameAt(this.frameCount - 1);
  }

  *frames() {
    for (let frameIndex = 0; frameIndex < this.frameCount; frameIndex += 1) {
      yield this.frameAt(frameIndex);
    }
  }

  describe() {
    return Object.freeze({
      durationTicks: this.durationTicks,
      timebaseTicksPerSecond: TIMEBASE_TICKS_PER_SECOND,
      frameRate: this.frameRate,
      frameCount: this.frameCount,
      boundary: EXPORT_FRAME_BOUNDARY_CONTRACT,
      firstFrame: this.firstFrame(),
      lastFrame: this.lastFrame(),
    });
  }
}

export function planExportFrames(input) {
  return new ExportFramePlanner(input);
}
