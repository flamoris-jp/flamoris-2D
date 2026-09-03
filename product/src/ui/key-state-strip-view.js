export function createKeyStateStripView({
  state,
  elements,
  setStatus,
  onEndpointEdit,
  onPreview,
}) {
  const controller = () => state.editor?.keyStateStrip || null;

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

  elements.keyStatePlayheadInput.addEventListener("input", () => act(() => {
    const result = controller()?.scrubToTick(Number(elements.keyStatePlayheadInput.value));
    onPreview?.();
    return result;
  }));
  elements.keyStateDurationSecondsInput.addEventListener("change", () => act(() => {
    const result = controller()?.setDurationSeconds(Number(elements.keyStateDurationSecondsInput.value));
    setStatus("Transition durationを通常のCommandとして更新しました");
    return result;
  }));
  elements.keyStatePlaybackModeSelect.addEventListener("change", () => act(() =>
    controller()?.setPlaybackMode(elements.keyStatePlaybackModeSelect.value)));
  elements.keyStatePlayButton.addEventListener("click", () => act(() => {
    controller()?.play();
    onPreview?.();
  }));
  elements.keyStatePauseButton.addEventListener("click", () => act(() =>
    controller()?.pause()));

  function marker(stateProjection) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-state-marker";
    button.dataset.stateId = stateProjection.id;
    button.style.left = `${stateProjection.progress * 100}%`;
    button.setAttribute("aria-label", `Edit Key State ${stateProjection.label}`);
    button.title = `${stateProjection.label} · ${stateProjection.tick} ticks`;
    button.textContent = stateProjection.label;
    button.classList.toggle("selected", stateProjection.active);
    button.addEventListener("click", () => act(() => {
      const selected = controller()?.selectState(stateProjection.id);
      onEndpointEdit?.(selected);
      return selected;
    }));
    return button;
  }

  function render() {
    const strip = controller();
    elements.keyStateStrip.hidden = !strip;
    if (!strip) return;
    const stripState = strip.getState();
    const enabled = stripState.durationTicks > 0 && stripState.states.length > 0;
    elements.keyStateMarkers.replaceChildren(...stripState.states.map(marker));
    elements.keyStatePlayheadInput.max = String(stripState.durationTicks);
    elements.keyStatePlayheadInput.value = String(stripState.currentTick);
    elements.keyStatePlayheadInput.disabled = !enabled;
    if (document.activeElement !== elements.keyStateDurationSecondsInput) {
      elements.keyStateDurationSecondsInput.value = String(stripState.durationSeconds);
    }
    elements.keyStateDurationSecondsInput.disabled = !enabled || stripState.playing;
    elements.keyStatePlaybackModeSelect.value = stripState.playbackMode;
    elements.keyStatePlaybackModeSelect.disabled = !enabled || stripState.playing;
    elements.keyStatePlayButton.disabled = !enabled || stripState.playing;
    elements.keyStatePauseButton.disabled = !stripState.playing;
    elements.keyStateInteractionStatus.dataset.mode = stripState.interactionMode;
    elements.keyStateInteractionStatus.textContent = stripState.interactionMode === "edit"
      ? `Editing: ${stripState.states.find((entry) => entry.active)?.label || "endpoint"}`
      : stripState.interactionMode === "preview"
        ? `Preview: ${stripState.percentage.toFixed(1)}% · ${stripState.currentTick} ticks`
        : "Select A or B marker to edit · move the playhead to preview";
  }

  return { render };
}
