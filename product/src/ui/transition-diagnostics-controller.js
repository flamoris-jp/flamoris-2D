import { cloneProject } from "../model/project.js";

function currentDiagnostic(previewState, diagnosticKey) {
  return previewState.diagnostics.find((entry) => entry.key === diagnosticKey) || null;
}

/**
 * Owns transient diagnostic selection/focus only. Domain reads stay on Query
 * paths and navigation delegates to existing transient authoring controllers.
 */
export class TransitionDiagnosticsController {
  constructor(session, transitionAuthoring, endpointMesh, transitionPreview, {
    onChange = null,
  } = {}) {
    this.session = session;
    this.transitionAuthoring = transitionAuthoring;
    this.endpointMesh = endpointMesh;
    this.transitionPreview = transitionPreview;
    this.onChange = onChange;
    this.selectedDiagnosticKey = null;
  }

  notify(reason) {
    this.onChange?.(reason, this);
  }

  activeTransitionChanged() {
    this.selectedDiagnosticKey = null;
  }

  getState() {
    const previewState = this.transitionPreview.getState();
    const selectedDiagnostic = this.selectedDiagnosticKey
      ? currentDiagnostic(previewState, this.selectedDiagnosticKey) : null;
    return {
      transitionId: previewState.activeTransition?.id || null,
      diagnostics: cloneProject(previewState.diagnostics),
      authoritative: previewState.authoritative,
      authorityReasons: [...previewState.authorityReasons],
      selectedDiagnosticKey: this.selectedDiagnosticKey,
      selectedDiagnostic: cloneProject(selectedDiagnostic),
      selectedDiagnosticMissing: Boolean(this.selectedDiagnosticKey && !selectedDiagnostic),
    };
  }

  selectDiagnostic(diagnosticKey) {
    this.selectedDiagnosticKey = diagnosticKey;
    this.notify("diagnostic-selection");
  }

  focusDiagnostic(diagnosticKey) {
    const previewState = this.transitionPreview.getState();
    const diagnostic = currentDiagnostic(previewState, diagnosticKey);
    this.selectedDiagnosticKey = diagnosticKey;
    if (!diagnostic) {
      this.notify("diagnostic-target-missing");
      return { focused: false, missing: true, diagnostic: null };
    }

    const target = diagnostic.target || {};
    let focused = false;
    let missing = false;
    if (target.semanticSlotId) {
      const exists = this.session.query("semantic_slot.list")
        .some((entry) => entry.id === target.semanticSlotId);
      if (exists) {
        this.transitionAuthoring.selectSemanticSlot(target.semanticSlotId);
        focused = true;
      } else missing = true;
    }
    if (target.endpoint) {
      this.endpointMesh.selectEndpoint(target.endpoint);
      this.transitionPreview.selectViewMode(target.endpoint === "from" ? "endpoint-a" : "endpoint-b");
      focused = true;
    }
    if (target.trackId) {
      const track = this.transitionPreview.getState().tracks
        .find((entry) => entry.trackId === target.trackId);
      if (!track) missing = true;
      else {
        this.transitionPreview.selectTrack(target.trackId);
        focused = true;
        if (target.keyframeId && target.channel) {
          const keyframe = track.channels?.[target.channel]?.keyframes
            .find((entry) => entry.id === target.keyframeId);
          if (keyframe) this.transitionPreview.selectKeyframe(
            target.trackId,
            target.channel,
            target.keyframeId,
          );
          else missing = true;
        }
      }
    }
    if (target.preview || diagnostic.source === "renderer") {
      this.transitionPreview.selectViewMode("preview");
      focused = true;
    }
    this.notify(missing ? "diagnostic-target-missing" : "diagnostic-focus");
    return { focused, missing, diagnostic: cloneProject(diagnostic) };
  }
}
