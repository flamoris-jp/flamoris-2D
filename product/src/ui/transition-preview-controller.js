import { TEMPORAL_TRACK_DEFINITIONS } from "../core/temporal.js";
import { cloneProject } from "../model/project.js";
import { projectTransitionPreviewDiagnostics } from "./transition-diagnostics-projection.js";

export const TRANSITION_VIEW_MODES = Object.freeze([
  "endpoint-a",
  "endpoint-b",
  "preview",
]);

export const TRANSITION_TRACK_KINDS = Object.freeze([
  "GeometryBlendTrack",
  "AppearanceTrack",
  "OpacityTrack",
  "PresenceTrack",
  "DrawOrderTrack",
  "ClippingTrack",
]);

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function clampTick(value, durationTicks) {
  const tick = Number(value);
  if (!Number.isSafeInteger(tick)) {
    throw new RangeError("Preview tick must be a safe integer.");
  }
  return Math.min(durationTicks, Math.max(0, tick));
}

function targetLabel(target) {
  if (target?.transitionDefault === true) return "transition-default";
  if (target?.semanticSlotId) return `SemanticSlot · ${target.semanticSlotId}`;
  if (target?.nodeId) return `Node · ${target.nodeId}`;
  return "unsupported target";
}

/**
 * Owns only transient Transition-preview workspace state. Persistent timing
 * edits are delegated to the existing animation.temporal.* command family.
 */
export class TransitionPreviewController {
  constructor(session, transitionAuthoring, {
    onChange = null,
    idFactory = defaultIdFactory(),
  } = {}) {
    this.session = session;
    this.transitionAuthoring = transitionAuthoring;
    this.onChange = onChange;
    this.idFactory = idFactory;
    this.viewMode = "endpoint-a";
    this.currentTick = 0;
    this.selectedTrackId = null;
    this.selectedKeyframe = null;
    this.evaluation = null;
    this.evaluationError = null;
    this.renderReport = null;
  }

  notify(reason) {
    this.onChange?.(reason, this);
  }

  activeTransition() {
    return this.transitionAuthoring.activeTransition();
  }

  activeProgram() {
    const transition = this.activeTransition();
    return transition
      ? this.session.query("animation.get_program", { programId: transition.temporalProgramId })
      : null;
  }

  selectViewMode(viewMode) {
    if (!TRANSITION_VIEW_MODES.includes(viewMode)) {
      throw new Error(`Unknown Transition view mode ${viewMode}.`);
    }
    this.viewMode = viewMode;
    if (viewMode === "endpoint-a") this.currentTick = 0;
    if (viewMode === "endpoint-b") this.currentTick = this.activeProgram()?.durationTicks ?? 0;
    if (viewMode === "preview") this.evaluate();
    this.notify("preview-mode");
  }

  setTick(timeTicks) {
    const program = this.activeProgram();
    if (!program) throw new Error("No active Transition TemporalProgram.");
    this.currentTick = clampTick(timeTicks, program.durationTicks);
    this.viewMode = "preview";
    this.evaluate();
    this.notify("preview-tick");
    return this.evaluation;
  }

  jumpToStart() {
    return this.setTick(0);
  }

  jumpToEnd() {
    const program = this.activeProgram();
    if (!program) throw new Error("No active Transition TemporalProgram.");
    return this.setTick(program.durationTicks);
  }

  evaluate() {
    const transition = this.activeTransition();
    const program = this.activeProgram();
    this.evaluation = null;
    this.evaluationError = null;
    this.renderReport = null;
    if (!transition || !program) return null;
    this.currentTick = clampTick(this.currentTick, program.durationTicks);
    try {
      this.evaluation = this.session.query("transition.evaluate", {
        transitionId: transition.id,
        timeTicks: this.currentTick,
      });
      return this.evaluation;
    } catch (error) {
      this.evaluationError = error;
      return null;
    }
  }

  projectChanged() {
    const program = this.activeProgram();
    if (!program) {
      this.currentTick = 0;
      this.evaluation = null;
      this.evaluationError = null;
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
      this.renderReport = null;
      return;
    }
    this.currentTick = clampTick(this.currentTick, program.durationTicks);
    if (this.viewMode === "preview") this.evaluate();
    const tracks = program.tracks;
    if (!tracks.some((track) => track.trackId === this.selectedTrackId)) {
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
    } else if (this.selectedKeyframe) {
      const selectedTrack = tracks.find((track) => track.trackId === this.selectedKeyframe.trackId);
      const selectedKeyframe = selectedTrack?.channels?.[this.selectedKeyframe.channel]?.keyframes
        .find((entry) => entry.id === this.selectedKeyframe.keyframeId);
      if (!selectedKeyframe) this.selectedKeyframe = null;
    }
  }

  activeTransitionChanged() {
    this.viewMode = "endpoint-a";
    this.currentTick = 0;
    this.selectedTrackId = null;
    this.selectedKeyframe = null;
    this.evaluation = null;
    this.evaluationError = null;
    this.renderReport = null;
  }

  setRenderReport(report) {
    const next = report ? cloneProject(report) : null;
    if (JSON.stringify(next) === JSON.stringify(this.renderReport)) return;
    this.renderReport = next;
    this.notify("preview-render-report");
  }

  selectTrack(trackId) {
    const program = this.activeProgram();
    if (trackId !== null && !program?.tracks.some((track) => track.trackId === trackId)) {
      throw new Error(`Unknown Transition track ${trackId}.`);
    }
    this.selectedTrackId = trackId;
    this.selectedKeyframe = null;
    this.notify("preview-track-selection");
  }

  selectKeyframe(trackId, channel, keyframeId) {
    if (keyframeId === null) {
      this.selectedKeyframe = null;
      this.notify("preview-keyframe-selection");
      return;
    }
    const track = this.activeProgram()?.tracks.find((entry) => entry.trackId === trackId);
    const keyframe = track?.channels?.[channel]?.keyframes.find((entry) => entry.id === keyframeId);
    if (!keyframe) throw new Error(`Unknown Transition keyframe ${keyframeId}.`);
    this.selectedTrackId = trackId;
    this.selectedKeyframe = { trackId, channel, keyframeId };
    this.notify("preview-keyframe-selection");
  }

  addTrack({
    kind,
    target,
    trackId = this.idFactory("track"),
  }) {
    if (!TRANSITION_TRACK_KINDS.includes(kind)) {
      throw new Error(`Track kind ${kind} is outside the focused Transition editor.`);
    }
    const program = this.activeProgram();
    if (!program) throw new Error("No active Transition TemporalProgram.");
    const definition = TEMPORAL_TRACK_DEFINITIONS[kind];
    const channels = Object.fromEntries(definition.channels.map((name) => [name, { keyframes: [] }]));
    const result = this.session.execute({
      type: "animation.temporal.add_track",
      payload: {
        programId: program.id,
        track: { trackId, version: 1, kind, target: cloneProject(target), channels },
      },
    }, { label: "Add Transition track" });
    this.selectedTrackId = trackId;
    this.selectedKeyframe = null;
    return result;
  }

  addKeyframe(trackId, channel, {
    timeTicks,
    value,
    interpolationToNext,
    id = this.idFactory("keyframe"),
  }) {
    const program = this.activeProgram();
    if (!program) throw new Error("No active Transition TemporalProgram.");
    const result = this.session.execute({
      type: "animation.temporal.add_keyframe",
      payload: {
        programId: program.id,
        trackId,
        channel,
        keyframe: { id, timeTicks, value: cloneProject(value), interpolationToNext: cloneProject(interpolationToNext) },
      },
    }, { label: "Add Transition keyframe" });
    this.selectedTrackId = trackId;
    this.selectedKeyframe = { trackId, channel, keyframeId: id };
    return result;
  }

  updateKeyframe(trackId, channel, keyframeId, keyframe) {
    const program = this.activeProgram();
    if (!program) throw new Error("No active Transition TemporalProgram.");
    return this.session.execute({
      type: "animation.temporal.update_keyframe",
      payload: {
        programId: program.id,
        trackId,
        channel,
        keyframeId,
        keyframe: cloneProject({ ...keyframe, id: keyframeId }),
      },
    }, { label: "Update Transition keyframe" });
  }

  removeKeyframe(trackId, channel, keyframeId) {
    const program = this.activeProgram();
    if (!program) throw new Error("No active Transition TemporalProgram.");
    const result = this.session.execute({
      type: "animation.temporal.remove_keyframe",
      payload: { programId: program.id, trackId, channel, keyframeId },
    }, { label: "Remove Transition keyframe" });
    if (this.selectedKeyframe?.keyframeId === keyframeId) this.selectedKeyframe = null;
    return result;
  }

  getState() {
    const transition = this.activeTransition();
    const program = this.activeProgram();
    const tracks = (program?.tracks || []).filter((track) =>
      TRANSITION_TRACK_KINDS.includes(track.kind));
    const selectedTrack = tracks.find((track) => track.trackId === this.selectedTrackId) || null;
    const validationDiagnostics = transition
      ? this.session.query("transition.get_diagnostics", { transitionId: transition.id })
      : [];
    const diagnosticState = projectTransitionPreviewDiagnostics({
      transitionId: transition?.id || null,
      validationDiagnostics,
      evaluation: this.evaluation,
      evaluationError: this.evaluationError,
      renderReport: this.renderReport,
    });
    return {
      viewMode: this.viewMode,
      currentTick: program ? clampTick(this.currentTick, program.durationTicks) : 0,
      normalizedProgress: program ? this.currentTick / program.durationTicks : 0,
      activeTransition: cloneProject(transition),
      program: cloneProject(program),
      tracks: cloneProject(tracks.map((track) => ({
        ...track,
        targetLabel: targetLabel(track.target),
        targetKind: track.target?.transitionDefault === true
          ? "default" : track.target?.semanticSlotId ? "semantic-override" : "node-override",
      }))),
      selectedTrack: cloneProject(selectedTrack),
      selectedTrackId: selectedTrack?.trackId || null,
      selectedKeyframe: cloneProject(this.selectedKeyframe),
      evaluation: this.evaluation,
      evaluationError: this.evaluationError,
      diagnostics: diagnosticState.diagnostics,
      authoritative: diagnosticState.authoritative,
      authorityReasons: diagnosticState.authorityReasons,
    };
  }
}
