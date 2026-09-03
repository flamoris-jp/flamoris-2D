import { TEMPORAL_TRACK_DEFINITIONS } from "../core/temporal.js";
import { TRANSITION_TRACK_KINDS } from "./transition-preview-controller.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function replaceOptions(select, options, value = "") {
  select.replaceChildren(...options);
  select.value = value;
}

function keyframeValueText(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseKeyframeValue(text, valueType) {
  if (["unit-number", "number", "integer"].includes(valueType)) {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error("Keyframe value must be a finite number.");
    return value;
  }
  if (valueType === "presence") return text.trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Appearance / clipping values must be valid JSON.");
  }
}

function interpolationFromElements(elements) {
  if (elements.keyframeInterpolationSelect.value !== "bezier") {
    return { kind: elements.keyframeInterpolationSelect.value };
  }
  return {
    kind: "bezier",
    x1: Number(elements.keyframeBezierX1Input.value),
    y1: Number(elements.keyframeBezierY1Input.value),
    x2: Number(elements.keyframeBezierX2Input.value),
    y2: Number(elements.keyframeBezierY2Input.value),
  };
}

export function createTransitionPreviewView({
  state,
  elements,
  setStatus,
  onViewModeChange,
}) {
  function controller() {
    return state.editor?.transitionPreview || null;
  }

  function act(action) {
    try {
      const result = action();
      render();
      return result;
    } catch (error) {
      console.error(error);
      setStatus(error.message || String(error));
      render();
      return null;
    }
  }

  for (const [mode, button] of [
    ["endpoint-a", elements.transitionViewAButton],
    ["endpoint-b", elements.transitionViewBButton],
    ["preview", elements.transitionViewPreviewButton],
  ]) {
    button.addEventListener("click", () => act(() => {
      controller()?.selectViewMode(mode);
      onViewModeChange(mode);
    }));
  }

  function scrubToInput() {
    act(() => controller()?.setTick(Number(elements.transitionPreviewTickInput.value)));
  }
  elements.transitionPreviewSlider.addEventListener("input", () => act(() =>
    controller()?.setTick(Number(elements.transitionPreviewSlider.value))));
  elements.transitionPreviewTickInput.addEventListener("change", scrubToInput);
  elements.transitionPreviewStartButton.addEventListener("click", () => act(() => controller()?.jumpToStart()));
  elements.transitionPreviewEndButton.addEventListener("click", () => act(() => controller()?.jumpToEnd()));

  elements.transitionTrackSelect.addEventListener("change", () => act(() =>
    controller()?.selectTrack(elements.transitionTrackSelect.value || null)));
  elements.transitionAddTrackButton.addEventListener("click", () => act(() => {
    const preview = controller();
    const authoring = state.editor?.transitionAuthoring.getState();
    const semanticSlotId = authoring?.selectedSemanticSlot?.id;
    const target = elements.transitionTrackTargetSelect.value === "default"
      ? { transitionDefault: true }
      : { semanticSlotId };
    if (!target.transitionDefault && !semanticSlotId) {
      throw new Error("Select a SemanticSlot before adding an override track.");
    }
    preview?.addTrack({ kind: elements.transitionTrackKindSelect.value, target });
    setStatus("Transition-owned typed trackを追加しました");
  }));

  elements.transitionKeyframeSelect.addEventListener("change", () => act(() => {
    const [trackId, channel, keyframeId] = elements.transitionKeyframeSelect.value.split("\u001f");
    if (keyframeId) controller()?.selectKeyframe(trackId, channel, keyframeId);
    else controller()?.selectKeyframe(null, null, null);
  }));
  elements.keyframeInterpolationSelect.addEventListener("change", renderBezierInputs);

  function keyframeDraft(selectedTrack) {
    const channel = selectedTrack ? Object.keys(selectedTrack.channels)[0] : null;
    const definition = selectedTrack ? TEMPORAL_TRACK_DEFINITIONS[selectedTrack.kind] : null;
    return {
      channel,
      timeTicks: Number(elements.keyframeTickInput.value),
      value: parseKeyframeValue(elements.keyframeValueInput.value, definition?.value),
      interpolationToNext: interpolationFromElements(elements),
    };
  }

  elements.addTransitionKeyframeButton.addEventListener("click", () => act(() => {
    const preview = controller();
    const selectedTrack = preview?.getState().selectedTrack;
    if (!selectedTrack) throw new Error("Select a typed track first.");
    const draft = keyframeDraft(selectedTrack);
    preview.addKeyframe(selectedTrack.trackId, draft.channel, draft);
    setStatus("Typed keyframeを追加しました");
  }));
  elements.updateTransitionKeyframeButton.addEventListener("click", () => act(() => {
    const preview = controller();
    const previewState = preview?.getState();
    const selection = previewState?.selectedKeyframe;
    if (!selection) throw new Error("Select a keyframe first.");
    preview.updateKeyframe(selection.trackId, selection.channel, selection.keyframeId,
      keyframeDraft(previewState.selectedTrack));
    setStatus("Typed keyframeを更新しました");
  }));
  elements.removeTransitionKeyframeButton.addEventListener("click", () => act(() => {
    const preview = controller();
    const selection = preview?.getState().selectedKeyframe;
    if (!selection) throw new Error("Select a keyframe first.");
    preview.removeKeyframe(selection.trackId, selection.channel, selection.keyframeId);
    setStatus("Typed keyframeを削除しました");
  }));

  function renderBezierInputs() {
    elements.keyframeBezierControls.hidden = elements.keyframeInterpolationSelect.value !== "bezier";
  }

  function renderKeyframeEditor(previewState) {
    const track = previewState.selectedTrack;
    const choices = [option("", "— Select keyframe —")];
    if (track) {
      for (const [channel, channelState] of Object.entries(track.channels)) {
        for (const keyframe of channelState.keyframes) {
          choices.push(option(
            [track.trackId, channel, keyframe.id].join("\u001f"),
            `${channel} · ${keyframe.timeTicks} ticks · ${keyframe.id}`,
          ));
        }
      }
    }
    const selection = previewState.selectedKeyframe;
    replaceOptions(elements.transitionKeyframeSelect, choices, selection
      ? [selection.trackId, selection.channel, selection.keyframeId].join("\u001f") : "");
    const keyframe = selection
      ? track?.channels?.[selection.channel]?.keyframes.find((entry) => entry.id === selection.keyframeId)
      : null;
    if (keyframe) {
      elements.keyframeTickInput.value = String(keyframe.timeTicks);
      elements.keyframeValueInput.value = keyframeValueText(keyframe.value);
      elements.keyframeInterpolationSelect.value = keyframe.interpolationToNext.kind;
      if (keyframe.interpolationToNext.kind === "bezier") {
        for (const name of ["x1", "y1", "x2", "y2"]) {
          elements[`keyframeBezier${name.toUpperCase()}Input`].value = String(keyframe.interpolationToNext[name]);
        }
      }
    } else {
      elements.keyframeTickInput.value = String(previewState.currentTick);
      elements.keyframeValueInput.value = "";
      elements.keyframeInterpolationSelect.value = TEMPORAL_TRACK_DEFINITIONS[track?.kind]?.discrete
        ? "step" : "linear";
    }
    const discrete = Boolean(TEMPORAL_TRACK_DEFINITIONS[track?.kind]?.discrete);
    for (const interpolationOption of elements.keyframeInterpolationSelect.options) {
      interpolationOption.disabled = discrete && interpolationOption.value !== "step";
    }
    const disabled = !track;
    elements.transitionKeyframeSelect.disabled = disabled || choices.length === 1;
    elements.keyframeTickInput.disabled = disabled;
    elements.keyframeValueInput.disabled = disabled;
    elements.keyframeInterpolationSelect.disabled = disabled;
    elements.addTransitionKeyframeButton.disabled = disabled;
    elements.updateTransitionKeyframeButton.disabled = !keyframe;
    elements.removeTransitionKeyframeButton.disabled = !keyframe;
    renderBezierInputs();
  }

  function render() {
    const preview = controller();
    elements.transitionPreviewCard.hidden = !preview;
    if (!preview) return;
    const previewState = preview.getState();
    const enabled = Boolean(previewState.activeTransition && previewState.program);
    for (const [mode, button] of [
      ["endpoint-a", elements.transitionViewAButton],
      ["endpoint-b", elements.transitionViewBButton],
      ["preview", elements.transitionViewPreviewButton],
    ]) {
      button.disabled = !enabled;
      button.classList.toggle("selected", previewState.viewMode === mode);
    }
    const duration = previewState.program?.durationTicks || 0;
    elements.transitionPreviewSlider.max = String(duration);
    elements.transitionPreviewSlider.value = String(previewState.currentTick);
    elements.transitionPreviewSlider.disabled = !enabled;
    elements.transitionPreviewTickInput.max = String(duration);
    elements.transitionPreviewTickInput.value = String(previewState.currentTick);
    elements.transitionPreviewTickInput.disabled = !enabled;
    elements.transitionPreviewStartButton.disabled = !enabled;
    elements.transitionPreviewEndButton.disabled = !enabled;
    elements.transitionPreviewProgress.textContent = enabled
      ? `${previewState.currentTick} / ${duration} ticks · ${(previewState.normalizedProgress * 100).toFixed(2)}%`
      : "Select an active Transition";

    const previewActive = previewState.viewMode === "preview";
    elements.transitionPreviewAuthority.textContent = !previewActive
      ? "Endpoint view · authority applies to Transition Preview"
      : previewState.authoritative ? "Authoritative preview" : "Non-authoritative preview";
    elements.transitionPreviewAuthority.dataset.authority = !previewActive
      ? "idle" : previewState.authoritative ? "yes" : "no";
    elements.transitionPreviewReasons.replaceChildren(...previewState.authorityReasons.map((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      return item;
    }));

    replaceOptions(elements.transitionTrackSelect, [
      option("", "— Select typed track —"),
      ...previewState.tracks.map((track) => option(
        track.trackId,
        `${track.targetKind === "default" ? "DEFAULT" : "OVERRIDE"} · ${track.kind} · ${track.targetLabel}`,
      )),
    ], previewState.selectedTrackId || "");
    elements.transitionTrackSelect.disabled = !enabled || !previewState.tracks.length;
    replaceOptions(elements.transitionTrackKindSelect,
      TRANSITION_TRACK_KINDS.map((kind) => option(kind, kind)),
      elements.transitionTrackKindSelect.value || TRANSITION_TRACK_KINDS[0]);
    elements.transitionTrackKindSelect.disabled = !enabled;
    elements.transitionTrackTargetSelect.disabled = !enabled;
    elements.transitionAddTrackButton.disabled = !enabled;
    renderKeyframeEditor(previewState);
  }

  return { render };
}
