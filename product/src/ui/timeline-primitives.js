import {
  TIMEBASE_TICKS_PER_SECOND,
  normalizeFrameRate,
  ticksToFrame,
  ticksToSeconds,
} from "../core/temporal.js";

export const TIMELINE_DISPLAY_UNITS = Object.freeze(["ticks", "seconds", "frames"]);
export const TIMELINE_PLAYBACK_MODES = Object.freeze(["once", "loop"]);

export function clampTimelineTick(value, durationTicks) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Timeline tick must be a safe integer.");
  }
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 0) {
    throw new RangeError("Timeline duration must be a non-negative safe integer.");
  }
  return Math.min(durationTicks, Math.max(0, value));
}

export function projectTimelineItems(items, durationTicks, {
  selectedId = null,
  previewById = null,
} = {}) {
  if (!Array.isArray(items)) throw new TypeError("Timeline items must be an array.");
  const ids = new Set();
  return items.map((item) => {
    if (!item?.id || ids.has(item.id)) throw new Error("Timeline item IDs must be unique.");
    ids.add(item.id);
    const preview = previewById?.get(item.id) || item;
    if (!Number.isSafeInteger(preview.startTicks) ||
      !Number.isSafeInteger(preview.endTicks) ||
      preview.startTicks < 0 || preview.startTicks >= preview.endTicks ||
      preview.endTicks > durationTicks) {
      throw new RangeError(`Timeline item ${item.id} is outside the duration.`);
    }
    return {
      ...structuredClone(item),
      startTicks: preview.startTicks,
      endTicks: preview.endTicks,
      startProgress: durationTicks ? preview.startTicks / durationTicks : 0,
      endProgress: durationTicks ? preview.endTicks / durationTicks : 0,
      widthProgress: durationTicks ?
        (preview.endTicks - preview.startTicks) / durationTicks : 0,
      selected: item.id === selectedId,
      previewing: preview !== item,
    };
  });
}

export function projectTimelineTime(timeTicks, unit, frameRate) {
  if (!TIMELINE_DISPLAY_UNITS.includes(unit)) {
    throw new Error(`Unknown timeline display unit ${unit}.`);
  }
  if (!Number.isSafeInteger(timeTicks) || timeTicks < 0) {
    throw new RangeError("Timeline display tick must be a non-negative safe integer.");
  }
  if (unit === "ticks") {
    return { unit, value: timeTicks, exact: true, label: `${timeTicks} ticks` };
  }
  if (unit === "seconds") {
    const seconds = ticksToSeconds(timeTicks);
    return {
      unit,
      value: seconds,
      exact: true,
      label: `${seconds.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "")} s · ${timeTicks} ticks`,
    };
  }
  const rate = normalizeFrameRate(frameRate);
  const frame = ticksToFrame(timeTicks, rate);
  return {
    unit,
    value: frame.frameIndex,
    exact: frame.exact,
    frameRate: rate,
    label: `${frame.exact ? "" : "≈"}${frame.frameIndex} f @ ${rate.numerator}/${rate.denominator} · ${timeTicks} ticks`,
  };
}

function defaultScheduleFrame(callback) {
  return requestAnimationFrame(callback);
}

function defaultCancelFrame(handle) {
  cancelAnimationFrame(handle);
}

/**
 * Shared transient wall-clock projection for Transition and Sequence preview.
 * It owns no Project state; every produced time is an integer canonical tick.
 */
export class TransientPlaybackClock {
  constructor({
    onTick,
    onStateChange = null,
    scheduleFrame = defaultScheduleFrame,
    cancelFrame = defaultCancelFrame,
  }) {
    if (typeof onTick !== "function") throw new TypeError("Playback clock requires onTick.");
    this.onTick = onTick;
    this.onStateChange = onStateChange;
    this.scheduleFrame = scheduleFrame;
    this.cancelFrame = cancelFrame;
    this.playing = false;
    this.mode = "once";
    this.durationTicks = 0;
    this.startTick = 0;
    this.startedAtMs = null;
    this.frameHandle = null;
  }

  setMode(mode) {
    if (!TIMELINE_PLAYBACK_MODES.includes(mode)) {
      throw new Error(`Unknown playback mode ${mode}.`);
    }
    this.mode = mode;
    this.onStateChange?.("mode", this);
  }

  play({ durationTicks, startTick = 0, startTimeMs = null } = {}) {
    if (!Number.isSafeInteger(durationTicks) || durationTicks <= 0) {
      throw new RangeError("Playback duration must be a positive safe integer.");
    }
    this.pause();
    this.durationTicks = durationTicks;
    this.startTick = clampTimelineTick(startTick, durationTicks);
    this.startedAtMs = startTimeMs;
    this.playing = true;
    this.onTick(this.startTick);
    if (this.mode === "once" && this.startTick === durationTicks) {
      this.playing = false;
      this.startedAtMs = null;
      this.onStateChange?.("stopped", this);
      return;
    }
    this.frameHandle = this.scheduleFrame((timestamp) => this.advance(timestamp));
    this.onStateChange?.("started", this);
  }

  pause() {
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle);
    const changed = this.playing || this.frameHandle !== null;
    this.frameHandle = null;
    this.playing = false;
    this.startedAtMs = null;
    if (changed) this.onStateChange?.("paused", this);
  }

  advance(timestampMs) {
    if (!this.playing) return;
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError("Playback clock must provide finite milliseconds.");
    }
    if (this.startedAtMs === null) this.startedAtMs = timestampMs;
    const elapsedTicks = Math.max(0, Math.floor(
      (timestampMs - this.startedAtMs) * TIMEBASE_TICKS_PER_SECOND / 1000,
    ));
    const absoluteTick = this.startTick + elapsedTicks;
    const tick = this.mode === "loop"
      ? absoluteTick % this.durationTicks
      : Math.min(this.durationTicks, absoluteTick);
    this.onTick(tick);
    if (this.mode === "once" && tick === this.durationTicks) {
      this.playing = false;
      this.frameHandle = null;
      this.startedAtMs = null;
      this.onStateChange?.("stopped", this);
      return;
    }
    this.frameHandle = this.scheduleFrame((timestamp) => this.advance(timestamp));
    this.onStateChange?.("frame", this);
  }
}
