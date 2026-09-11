import { secondsToTicks, ticksToSeconds } from "../core/temporal.js";
import {
  TIMELINE_PLAYBACK_MODES,
  TransientPlaybackClock,
} from "./timeline-primitives.js";

export const PLAYBACK_MODES = TIMELINE_PLAYBACK_MODES;

function assertPlaybackMode(mode) {
  if (!PLAYBACK_MODES.includes(mode)) throw new Error(`Unknown playback mode ${mode}.`);
}

/**
 * Projects the current A/B Transition endpoints into a generic states[] strip.
 * The persistent domain remains A/B-only; callers and the view must not infer
 * the number of markers from endpoint names.
 */
export function projectKeyStateStrip({
  states,
  currentTick,
  durationTicks,
  activeStateId = null,
  interactionMode = "preview",
}) {
  if (!Array.isArray(states)) throw new TypeError("Key State Strip states must be an array.");
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 0) {
    throw new RangeError("Key State Strip duration must be a non-negative safe integer.");
  }
  const ids = new Set();
  const projectedStates = states.map((state) => {
    if (!state?.id || ids.has(state.id)) throw new Error("Key State Strip state IDs must be unique.");
    if (!Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick > durationTicks) {
      throw new RangeError(`Key State ${state.id} tick is outside the strip duration.`);
    }
    ids.add(state.id);
    return {
      ...state,
      progress: durationTicks ? state.tick / durationTicks : 0,
      active: interactionMode === "edit" && state.id === activeStateId,
    };
  });
  const tick = Math.min(durationTicks, Math.max(0, currentTick));
  return {
    states: projectedStates,
    currentTick: tick,
    durationTicks,
    progress: durationTicks ? tick / durationTicks : 0,
    percentage: durationTicks ? tick / durationTicks * 100 : 0,
    activeStateId: interactionMode === "edit" ? activeStateId : null,
    interactionMode,
  };
}

/**
 * Owns only State Strip workspace state and interaction coordination. Tick
 * evaluation remains delegated to the existing TransitionPreviewController;
 * endpoint editing remains delegated to EndpointMeshController.
 */
export class KeyStateStripController {
  constructor(transitionPreview, endpointMesh, {
    onChange = null,
    onEndpointEdit = null,
    onPreview = null,
    scheduleFrame,
    cancelFrame,
    meshTools = null,
  } = {}) {
    this.transitionPreview = transitionPreview;
    this.endpointMesh = endpointMesh;
    this.onChange = onChange;
    this.onEndpointEdit = onEndpointEdit;
    this.onPreview = onPreview;
    this.meshTools = meshTools;
    this.clock = new TransientPlaybackClock({
      onTick: (tick) => {
        const evaluation = this.transitionPreview.setTick(tick);
        this.onPreview?.(evaluation);
      },
      onStateChange: (reason) => this.notify(
        reason === "frame" ? "key-state-playback-frame" : "key-state-playback",
      ),
      ...(scheduleFrame ? { scheduleFrame } : {}),
      ...(cancelFrame ? { cancelFrame } : {}),
    });
  }

  notify(reason) { this.onChange?.(reason, this); }

  states() {
    const state = this.transitionPreview.getState();
    const transition = state.activeTransition;
    if (!transition || !state.program) return [];
    return [
      { id: "endpoint-a", label: "A", tick: 0, endpoint: "from", keyArtId: transition.fromKeyArtId },
      { id: "endpoint-b", label: "B", tick: state.program.durationTicks, endpoint: "to", keyArtId: transition.toKeyArtId },
    ];
  }

  selectState(stateId) {
    const state = this.states().find((entry) => entry.id === stateId);
    if (!state) throw new Error(`Unknown Key State ${stateId}.`);
    this.pause();
    this.transitionPreview.selectViewMode(state.id);
    this.endpointMesh.selectEndpoint(state.endpoint);
    this.meshTools?.setMode("deform");
    this.onEndpointEdit?.(state);
    this.notify("key-state-edit");
    return state;
  }

  scrubToTick(timeTicks) {
    this.pause();
    this.endpointMesh.exitEditing();
    const evaluation = this.transitionPreview.setTick(timeTicks);
    this.onPreview?.(evaluation);
    this.notify("key-state-preview");
    return evaluation;
  }

  setDurationTicks(durationTicks) {
    this.pause();
    const result = this.transitionPreview.setDurationTicks(durationTicks);
    this.notify("key-state-duration");
    return result;
  }

  setDurationSeconds(seconds) {
    const durationTicks = secondsToTicks(seconds);
    if (durationTicks <= 0) throw new RangeError("Duration must be greater than zero seconds.");
    return this.setDurationTicks(durationTicks);
  }

  setPlaybackMode(mode) {
    assertPlaybackMode(mode);
    this.clock.setMode(mode);
    this.notify("key-state-playback-mode");
  }

  play(startTimeMs = null) {
    if (!this.transitionPreview.activeProgram()) throw new Error("No active Transition TemporalProgram.");
    this.endpointMesh.exitEditing();
    this.clock.play({
      durationTicks: this.transitionPreview.activeProgram().durationTicks,
      startTick: 0,
      startTimeMs,
    });
  }

  pause() {
    this.clock.pause();
  }

  advance(timestampMs) {
    this.clock.advance(timestampMs);
  }

  getState() {
    const preview = this.transitionPreview.getState();
    const endpointState = this.endpointMesh.getState();
    const activeEndpoint = endpointState.activeEndpoint;
    const activeStateId = endpointState.editingEnabled &&
      preview.viewMode === "endpoint-a" && activeEndpoint === "from"
      ? "endpoint-a"
      : endpointState.editingEnabled &&
        preview.viewMode === "endpoint-b" && activeEndpoint === "to"
        ? "endpoint-b"
        : null;
    const durationTicks = preview.program?.durationTicks || 0;
    return {
      ...projectKeyStateStrip({
        states: this.states(),
        currentTick: preview.currentTick,
        durationTicks,
        activeStateId,
        interactionMode: preview.viewMode === "preview"
          ? "preview" : activeStateId ? "edit" : "idle",
      }),
      durationSeconds: ticksToSeconds(durationTicks),
      playing: this.clock.playing,
      playbackMode: this.clock.mode,
      evaluation: preview.evaluation,
    };
  }
}
