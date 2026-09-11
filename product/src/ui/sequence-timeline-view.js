import { temporalChannelDefinition } from "../core/temporal.js";

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

function setValueUnlessEditing(element, value) {
  if (document.activeElement !== element) element.value = String(value ?? "");
}

function tickFromPointer(event, lane, durationTicks) {
  const bounds = lane.getBoundingClientRect();
  if (!bounds.width) return 0;
  const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  return Math.round(progress * durationTicks);
}

function parseValue(text, definition) {
  if (!text.trim()) throw new Error("Keyframe value is required.");
  if (["number", "positive-number", "unit-number", "integer"].includes(definition.value)) {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error("Keyframe value must be finite.");
    return definition.value === "integer" ? Math.trunc(value) : value;
  }
  if (definition.value === "presence") return text.trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("This typed channel requires a valid JSON value.");
  }
}

function keyframeText(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function appendBlockText(element, heading, label, detail) {
  const strong = document.createElement("strong");
  strong.textContent = heading;
  const span = document.createElement("span");
  span.textContent = label;
  const small = document.createElement("small");
  small.textContent = detail;
  element.append(strong, span, small);
}

function pointerDrag({ onMove, onCommit, onCancel }) {
  let moved = false;
  const move = (event) => {
    moved = true;
    onMove(event);
  };
  const finish = (event) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    if (moved) onCommit(event);
    else onCancel?.();
  };
  const cancel = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    onCancel?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", cancel, { once: true });
}

export function createSequenceTimelineView({
  state,
  elements,
  setStatus,
  onSequencePreview = null,
}) {
  function controller() {
    return state.editor?.sequenceTimeline || null;
  }

  function act(action, success = null) {
    try {
      const result = action();
      if (success) setStatus(success);
      render();
      onSequencePreview?.();
      return result;
    } catch (error) {
      console.error(error);
      setStatus(error.message || String(error));
      render();
      return null;
    }
  }

  elements.sequenceSelect.addEventListener("change", () => act(() =>
    controller()?.selectSequence(elements.sequenceSelect.value || null)));
  elements.createSequenceButton.addEventListener("click", () => act(() => {
    const keyArtId = elements.sequenceHoldKeyArtSelect.value;
    if (!keyArtId) throw new Error("Create a Key Art before creating a Sequence.");
    return controller()?.createSequence({
      displayName: elements.sequenceNameInput.value.trim() || "Sequence",
      durationTicks: Number(elements.sequenceDurationTicksInput.value) || 120000,
      keyArtId,
    });
  }, "Sequence と初期 Hold を一つの transaction で作成しました"));
  elements.renameSequenceButton.addEventListener("click", () => act(() =>
    controller()?.renameSequence(elements.sequenceNameInput.value.trim()), "Sequence を更新しました"));
  elements.sequenceDurationTicksInput.addEventListener("change", () => {
    if (!controller()?.getState().sequence) return;
    act(() => controller().setSequenceDuration(Number(elements.sequenceDurationTicksInput.value)),
      "Sequence duration と終端境界を一つの transaction で更新しました");
  });
  elements.removeSequenceButton.addEventListener("click", () => act(() =>
    controller()?.removeSequence(), "Sequence と owned program を削除しました"));

  elements.sequenceStartButton.addEventListener("click", () => act(() => controller()?.jumpToStart()));
  elements.sequenceEndButton.addEventListener("click", () => act(() => controller()?.jumpToEnd()));
  elements.sequencePlayButton.addEventListener("click", () => act(() => controller()?.play()));
  elements.sequencePauseButton.addEventListener("click", () => act(() => controller()?.pause()));
  elements.sequencePlaybackModeSelect.addEventListener("change", () => act(() =>
    controller()?.setPlaybackMode(elements.sequencePlaybackModeSelect.value)));
  elements.sequenceDisplayUnitSelect.addEventListener("change", () => act(() =>
    controller()?.setDisplayUnit(elements.sequenceDisplayUnitSelect.value)));
  elements.sequencePlayheadInput.addEventListener("input", () => act(() =>
    controller()?.scrubToTick(Number(elements.sequencePlayheadInput.value))));
  elements.sequenceTickInput.addEventListener("change", () => act(() =>
    controller()?.scrubToTick(Number(elements.sequenceTickInput.value))));

  elements.insertSequenceHoldButton.addEventListener("click", () => act(() =>
    controller()?.insertHold({
      keyArtId: elements.sequenceHoldKeyArtSelect.value,
      startTicks: Number(elements.sequenceViewStartInput.value),
      endTicks: Number(elements.sequenceViewEndInput.value),
    }), "KeyArtHold を一つの transaction で挿入しました"));
  elements.insertSequenceTransitionButton.addEventListener("click", () => act(() =>
    controller()?.insertTransition({
      transitionId: elements.sequenceTransitionSelect.value,
      startTicks: Number(elements.sequenceViewStartInput.value),
      endTicks: Number(elements.sequenceViewEndInput.value),
    }), "TransitionInstance と隣接境界を一つの transaction で更新しました"));
  elements.updateSequenceViewItemButton.addEventListener("click", () => act(() => {
    const timelineState = controller()?.getState();
    const item = timelineState?.viewItems.find((entry) => entry.id === timelineState.selectedViewItemId);
    if (!item) throw new Error("Select a ViewLane item first.");
    return controller().updateViewItem(item.id, {
      startTicks: Number(elements.sequenceViewStartInput.value),
      endTicks: Number(elements.sequenceViewEndInput.value),
      referenceId: item.kind === "KeyArtHold"
        ? elements.sequenceHoldKeyArtSelect.value : elements.sequenceTransitionSelect.value,
    });
  }, "ViewLane item と隣接境界を一つの transaction で更新しました"));
  elements.moveSequenceViewEarlierButton.addEventListener("click", () => act(() => {
    const id = controller()?.getState().selectedViewItemId;
    if (!id) throw new Error("Select a ViewLane item first.");
    return controller().moveViewItem(id, "earlier");
  }, "ViewLane placement を更新しました"));
  elements.moveSequenceViewLaterButton.addEventListener("click", () => act(() => {
    const id = controller()?.getState().selectedViewItemId;
    if (!id) throw new Error("Select a ViewLane item first.");
    return controller().moveViewItem(id, "later");
  }, "ViewLane placement を更新しました"));
  elements.removeSequenceViewItemButton.addEventListener("click", () => act(() => {
    const id = controller()?.getState().selectedViewItemId;
    if (!id) throw new Error("Select a ViewLane item first.");
    return controller().removeViewItem(id);
  }, "ViewLane item を隣接区間へ統合しました"));

  elements.animationClipSelect.addEventListener("change", () => act(() =>
    controller()?.selectClip(elements.animationClipSelect.value || null)));
  elements.createAnimationClipButton.addEventListener("click", () => act(() =>
    controller()?.createClip({
      displayName: elements.animationClipNameInput.value.trim() || "Animation Clip",
      durationTicks: Number(elements.animationClipDurationInput.value),
      defaultLoopMode: elements.animationClipDefaultLoopSelect.value,
    }), "AnimationClip と owned program を作成しました"));
  elements.updateAnimationClipButton.addEventListener("click", () => act(() =>
    controller()?.updateClip({
      displayName: elements.animationClipNameInput.value.trim(),
      defaultLoopMode: elements.animationClipDefaultLoopSelect.value,
    }, { durationTicks: Number(elements.animationClipDurationInput.value) }),
  "AnimationClip を更新しました"));
  elements.removeAnimationClipButton.addEventListener("click", () => act(() =>
    controller()?.removeClip(), "AnimationClip と owned program を削除しました"));
  elements.addClipInstanceButton.addEventListener("click", () => act(() =>
    controller()?.addClipInstance(), "ClipInstance を追加しました"));

  elements.updateClipInstanceButton.addEventListener("click", () => act(() => {
    const instance = controller()?.getState().selectedClipInstance;
    if (!instance) throw new Error("Select a ClipInstance first.");
    return controller().commitClipInstance(instance.id, {
      startTicks: Number(elements.clipInstanceStartInput.value),
      endTicks: Number(elements.clipInstanceEndInput.value),
      sourceOffsetTicks: Number(elements.clipInstanceOffsetInput.value),
      playbackRate: {
        numerator: Number(elements.clipInstanceRateNumeratorInput.value),
        denominator: Number(elements.clipInstanceRateDenominatorInput.value),
      },
      loopMode: elements.clipInstanceLoopSelect.value,
      weight: Number(elements.clipInstanceWeightInput.value),
      layer: Number(elements.clipInstanceLayerInput.value),
      enabled: elements.clipInstanceEnabledInput.checked,
    }, "Edit ClipInstance");
  }, "ClipInstance の trim / retime / loop 設定を更新しました"));
  elements.removeClipInstanceButton.addEventListener("click", () => act(() =>
    controller()?.removeClipInstance(), "ClipInstance を削除しました"));

  elements.editSequenceProgramButton.addEventListener("click", () => act(() =>
    controller()?.editSequenceProgram()));
  elements.editClipProgramButton.addEventListener("click", () => act(() => {
    const clipId = controller()?.getState().selectedClipId;
    if (!clipId) throw new Error("Select an AnimationClip first.");
    return controller().selectClip(clipId, { editProgram: true });
  }));
  elements.sequenceTrackSelect.addEventListener("change", () => act(() =>
    controller()?.selectTrack(elements.sequenceTrackSelect.value || null)));
  elements.sequenceTrackKindSelect.addEventListener("change", () => renderTrackTargets());
  elements.addSequenceTrackButton.addEventListener("click", () => act(() => {
    if (!elements.sequenceTrackTargetSelect.value) throw new Error("Choose a stable typed target.");
    return controller()?.addTrack(elements.sequenceTrackKindSelect.value,
      JSON.parse(elements.sequenceTrackTargetSelect.value));
  }, "animation.temporal.add_track で typed track を追加しました"));
  elements.removeSequenceTrackButton.addEventListener("click", () => act(() =>
    controller()?.removeTrack(), "animation.temporal.remove_track で削除しました"));
  elements.sequenceChannelSelect.addEventListener("change", () => renderKeyframes());
  elements.sequenceKeyframeSelect.addEventListener("change", () => act(() => {
    const track = controller()?.getState().selectedTrack;
    const channel = elements.sequenceChannelSelect.value;
    const keyframeId = elements.sequenceKeyframeSelect.value;
    if (track && channel && keyframeId) controller().selectKeyframe(track.trackId, channel, keyframeId);
  }));
  elements.sequenceKeyframeInterpolationSelect.addEventListener("change", () => {
    elements.sequenceKeyframeBezierControls.hidden =
      elements.sequenceKeyframeInterpolationSelect.value !== "bezier";
  });

  function keyframeDraft(timelineState) {
    const track = timelineState.selectedTrack;
    const channel = elements.sequenceChannelSelect.value;
    const definition = track ? temporalChannelDefinition(track.kind, channel) : null;
    if (!definition) throw new Error("Choose a typed channel.");
    const kind = definition.discrete ? "step" : elements.sequenceKeyframeInterpolationSelect.value;
    return {
      track,
      channel,
      timeTicks: Number(elements.sequenceKeyframeTickInput.value),
      value: parseValue(elements.sequenceKeyframeValueInput.value, definition),
      interpolationKind: kind,
      bezier: {
        x1: Number(elements.sequenceBezierX1Input.value),
        y1: Number(elements.sequenceBezierY1Input.value),
        x2: Number(elements.sequenceBezierX2Input.value),
        y2: Number(elements.sequenceBezierY2Input.value),
      },
    };
  }

  elements.addSequenceKeyframeButton.addEventListener("click", () => act(() => {
    const timelineState = controller()?.getState();
    const draft = keyframeDraft(timelineState);
    return controller().addKeyframe(draft.track.trackId, draft.channel, {
      timeTicks: timelineState.currentTick,
      value: draft.value,
      interpolationKind: draft.interpolationKind,
      bezier: draft.bezier,
    });
  }, "playhead に typed keyframe を追加しました"));
  elements.updateSequenceKeyframeButton.addEventListener("click", () => act(() => {
    const timelineState = controller()?.getState();
    const selection = timelineState?.selectedKeyframe;
    if (!selection) throw new Error("Select a keyframe first.");
    const draft = keyframeDraft(timelineState);
    return controller().updateKeyframe(selection.trackId, selection.channel,
      selection.keyframeId, {
        timeTicks: draft.timeTicks,
        value: draft.value,
        interpolationToNext: draft.interpolationKind === "bezier"
          ? { kind: "bezier", ...draft.bezier } : { kind: draft.interpolationKind },
      });
  }, "typed keyframe を更新しました"));
  elements.removeSequenceKeyframeButton.addEventListener("click", () => act(() => {
    const selection = controller()?.getState().selectedKeyframe;
    if (!selection) throw new Error("Select a keyframe first.");
    return controller().removeKeyframe(selection.trackId, selection.channel, selection.keyframeId);
  }, "typed keyframe を削除しました"));

  elements.sequenceClipLane.addEventListener("dragover", (event) => event.preventDefault());
  elements.sequenceClipLane.addEventListener("drop", (event) => {
    event.preventDefault();
    const clipId = event.dataTransfer?.getData("application/x-flamoris-animation-clip");
    const timelineState = controller()?.getState();
    if (!clipId || !timelineState?.sequence) return;
    const startTicks = tickFromPointer(event, elements.sequenceClipLane,
      timelineState.sequence.durationTicks);
    act(() => controller().addClipInstance({ clipId, startTicks }),
      "Drop 位置へ ClipInstance を追加しました");
  });

  function viewItemElement(item, timelineState, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sequence-block ${item.kind === "KeyArtHold" ? "hold" : "transition"}`;
    button.classList.toggle("selected", item.selected);
    button.classList.toggle("previewing", item.previewing);
    button.style.left = `${item.startProgress * 100}%`;
    button.style.width = `${item.widthProgress * 100}%`;
    button.dataset.viewItemId = item.id;
    button.title = `${item.kind} · ${item.referenceId} · ${item.startTicks}–${item.endTicks} ticks`;
    appendBlockText(button, item.kind === "KeyArtHold" ? "Hold" : "Transition",
      item.referenceName, `${item.startTicks}–${item.endTicks}`);
    button.addEventListener("click", () => act(() => controller()?.selectViewItem(item.id)));
    if (index < timelineState.viewItems.length - 1) {
      const handle = document.createElement("i");
      handle.className = "sequence-boundary-handle";
      handle.title = "Drag shared boundary · one history unit on release";
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const right = timelineState.viewItems[index + 1];
        pointerDrag({
          onMove(moveEvent) {
            act(() => controller().previewViewBoundary(item.id, right.id,
              tickFromPointer(moveEvent, elements.sequenceViewLane, timelineState.sequence.durationTicks)));
          },
          onCommit() { act(() => controller().commitViewBoundary(), "ViewLane boundary を確定しました"); },
          onCancel() { controller().cancelViewPreview(); },
        });
      });
      button.append(handle);
    }
    return button;
  }

  function clipInstanceElement(instance, timelineState) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sequence-block clip-instance";
    button.classList.toggle("selected", instance.selected);
    button.classList.toggle("previewing", instance.previewing);
    button.style.left = `${instance.startProgress * 100}%`;
    button.style.width = `${instance.widthProgress * 100}%`;
    button.style.top = `${6 + Math.max(0, instance.layer) * 29}px`;
    button.dataset.clipInstanceId = instance.id;
    button.title = `${instance.clipId} · ${instance.startTicks}–${instance.endTicks} · layer ${instance.layer}`;
    appendBlockText(button, instance.clipName, "",
      `${instance.startTicks}–${instance.endTicks} · ${instance.loopMode} · L${instance.layer}`);
    button.addEventListener("click", () => act(() => controller()?.selectClipInstance(instance.id)));
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const originalStart = instance.startTicks;
      const duration = instance.endTicks - instance.startTicks;
      pointerDrag({
        onMove(moveEvent) {
          const bounds = elements.sequenceClipLane.getBoundingClientRect();
          const delta = Math.round((moveEvent.clientX - startX) / bounds.width *
            timelineState.sequence.durationTicks);
          const startTicks = Math.min(timelineState.sequence.durationTicks - duration,
            Math.max(0, originalStart + delta));
          act(() => controller().previewClipInstance(instance.id,
            { startTicks, endTicks: startTicks + duration }));
        },
        onCommit() { act(() => controller().commitClipInstance(instance.id), "ClipInstance move を確定しました"); },
        onCancel() { act(() => controller().selectClipInstance(instance.id)); },
      });
    });
    return button;
  }

  function keyframeElement(keyframe, track, channel, timelineState) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sequence-keyframe-marker";
    button.classList.toggle("selected", timelineState.selectedKeyframe?.keyframeId === keyframe.id);
    button.style.left = `${timelineState.program.durationTicks ? keyframe.timeTicks / timelineState.program.durationTicks * 100 : 0}%`;
    button.dataset.keyframeId = keyframe.id;
    button.title = `${channel} · ${keyframe.timeTicks} ticks · ${keyframe.id}`;
    button.textContent = "◆";
    button.addEventListener("click", () => act(() =>
      controller().selectKeyframe(track.trackId, channel, keyframe.id)));
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      pointerDrag({
        onMove(moveEvent) {
          act(() => controller().previewKeyframeTime(track.trackId, channel, keyframe.id,
            tickFromPointer(moveEvent, elements.sequenceKeyframeLane,
              timelineState.program.durationTicks)));
        },
        onCommit() { act(() => controller().commitKeyframePreview(), "Keyframe move を確定しました"); },
        onCancel() { act(() => controller().selectKeyframe(track.trackId, channel, keyframe.id)); },
      });
    });
    return button;
  }

  function renderTrackTargets() {
    const timeline = controller();
    const kind = elements.sequenceTrackKindSelect.value;
    const choices = timeline && kind ? timeline.targetOptions(kind) : [];
    replaceOptions(elements.sequenceTrackTargetSelect,
      choices.map((entry) => option(JSON.stringify(entry.target), entry.label)),
      choices.length ? JSON.stringify(choices[0].target) : "");
    elements.sequenceTrackTargetSelect.disabled = choices.length === 0;
  }

  function renderKeyframes(timelineState = controller()?.getState()) {
    const track = timelineState?.selectedTrack;
    const channelNames = track ? Object.keys(track.channels) : [];
    const currentChannel = channelNames.includes(elements.sequenceChannelSelect.value)
      ? elements.sequenceChannelSelect.value : channelNames[0] || "";
    replaceOptions(elements.sequenceChannelSelect,
      channelNames.map((channel) => option(channel, channel)), currentChannel);
    const keyframes = currentChannel ? track.channels[currentChannel].keyframes : [];
    const selectedId = timelineState?.selectedKeyframe?.channel === currentChannel
      ? timelineState.selectedKeyframe.keyframeId : "";
    replaceOptions(elements.sequenceKeyframeSelect,
      [option("", "— Select keyframe —"), ...keyframes.map((keyframe) =>
        option(keyframe.id, `${keyframe.timeTicks} ticks · ${keyframe.id}`))], selectedId);
    elements.sequenceKeyframeLane.replaceChildren(...keyframes.map((keyframe) =>
      keyframeElement(keyframe, track, currentChannel, timelineState)));
    const selected = timelineState?.selectedKeyframeValue;
    if (selected && timelineState.selectedKeyframe.channel === currentChannel) {
      setValueUnlessEditing(elements.sequenceKeyframeTickInput, selected.timeTicks);
      setValueUnlessEditing(elements.sequenceKeyframeValueInput, keyframeText(selected.value));
      elements.sequenceKeyframeInterpolationSelect.value = selected.interpolationToNext.kind;
      if (selected.interpolationToNext.kind === "bezier") {
        for (const name of ["X1", "Y1", "X2", "Y2"]) {
          elements[`sequenceBezier${name}Input`].value = String(
            selected.interpolationToNext[name.toLowerCase()]);
        }
      }
    } else {
      setValueUnlessEditing(elements.sequenceKeyframeTickInput, timelineState?.currentTick || 0);
      setValueUnlessEditing(elements.sequenceKeyframeValueInput, "");
    }
    const definition = track && currentChannel
      ? temporalChannelDefinition(track.kind, currentChannel) : null;
    if (definition?.discrete) elements.sequenceKeyframeInterpolationSelect.value = "step";
    for (const entry of elements.sequenceKeyframeInterpolationSelect.options) {
      entry.disabled = Boolean(definition?.discrete && entry.value !== "step");
    }
    elements.sequenceKeyframeBezierControls.hidden =
      elements.sequenceKeyframeInterpolationSelect.value !== "bezier";
    elements.addSequenceKeyframeButton.disabled = !definition;
    elements.updateSequenceKeyframeButton.disabled = !selected;
    elements.removeSequenceKeyframeButton.disabled = !selected;
  }

  function render() {
    const timeline = controller();
    elements.sequenceTimelinePanel.classList.toggle("unavailable", !timeline);
    if (!timeline) return;
    const timelineState = timeline.getState();
    replaceOptions(elements.sequenceSelect,
      [option("", "— Select Sequence —"), ...timelineState.sequences.map((sequence) =>
        option(sequence.id, `${sequence.displayName} · ${sequence.id}`))],
      timelineState.selectedSequenceId || "");
    const sequence = timelineState.sequence;
    setValueUnlessEditing(elements.sequenceNameInput, sequence?.displayName || "Sequence");
    setValueUnlessEditing(elements.sequenceDurationTicksInput, sequence?.durationTicks || 120000);
    const active = Boolean(sequence);
    elements.renameSequenceButton.disabled = !active;
    elements.removeSequenceButton.disabled = !active;
    for (const element of [elements.sequenceStartButton, elements.sequencePlayButton,
      elements.sequenceEndButton, elements.sequencePlaybackModeSelect,
      elements.sequenceDisplayUnitSelect, elements.sequencePlayheadInput,
      elements.sequenceTickInput]) element.disabled = !active;
    elements.sequencePauseButton.disabled = !timelineState.playing;
    elements.sequencePlayButton.disabled = !active || timelineState.playing;
    elements.sequencePlaybackModeSelect.value = timelineState.playbackMode;
    elements.sequenceDisplayUnitSelect.value = timelineState.displayUnit;
    elements.sequencePlayheadInput.max = String(sequence?.durationTicks || 0);
    elements.sequencePlayheadInput.value = String(timelineState.currentTick);
    elements.sequenceTickInput.max = String(sequence?.durationTicks || 0);
    setValueUnlessEditing(elements.sequenceTickInput, timelineState.currentTick);
    elements.sequenceTimeOutput.textContent = timelineState.timeDisplay.label;
    elements.sequenceTimelineContext.textContent = timelineState.ownerContext
      ? `${timelineState.ownerContext.kind} · ${timelineState.ownerContext.displayName}`
      : "No active owner";

    elements.sequenceViewLane.replaceChildren(...timelineState.viewItems.map((item, index) =>
      viewItemElement(item, timelineState, index)));
    elements.sequenceClipLane.replaceChildren(...timelineState.clipInstances.map((instance) =>
      clipInstanceElement(instance, timelineState)));
    const selectedView = timelineState.viewItems.find((entry) => entry.selected) || null;
    if (selectedView) {
      setValueUnlessEditing(elements.sequenceViewStartInput, selectedView.startTicks);
      setValueUnlessEditing(elements.sequenceViewEndInput, selectedView.endTicks);
    } else {
      setValueUnlessEditing(elements.sequenceViewStartInput, timelineState.currentTick);
      setValueUnlessEditing(elements.sequenceViewEndInput,
        Math.min(sequence?.durationTicks || 1, timelineState.currentTick + 1));
    }
    const keyArts = state.editor.session.query("keyart.list");
    replaceOptions(elements.sequenceHoldKeyArtSelect,
      keyArts.map((entry) => option(entry.id, `${entry.displayName} · ${entry.id}`)),
      selectedView?.kind === "KeyArtHold" ? selectedView.referenceId : keyArts[0]?.id || "");
    const transitions = state.editor.session.query("transition.list");
    replaceOptions(elements.sequenceTransitionSelect,
      transitions.map((entry) => option(entry.id, `${entry.displayName} · ${entry.id}`)),
      selectedView?.kind === "TransitionInstance" ? selectedView.referenceId : transitions[0]?.id || "");
    for (const element of [elements.insertSequenceHoldButton,
      elements.insertSequenceTransitionButton]) element.disabled = !active;
    for (const element of [elements.updateSequenceViewItemButton,
      elements.moveSequenceViewEarlierButton, elements.moveSequenceViewLaterButton,
      elements.removeSequenceViewItemButton]) element.disabled = !selectedView;

    replaceOptions(elements.animationClipSelect,
      [option("", "— Select clip —"), ...timelineState.clips.map((entry) =>
        option(entry.id, `${entry.displayName} · ${entry.id}`))], timelineState.selectedClipId || "");
    elements.animationClipLibrary.replaceChildren(...timelineState.clips.map((clip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clip-library-item secondary";
      button.classList.toggle("selected", clip.selected);
      button.draggable = true;
      button.dataset.clipId = clip.id;
      button.textContent = `${clip.displayName} · ${clip.durationTicks} ticks`;
      button.title = `Drag ${clip.id} to the Clip lane`;
      button.addEventListener("click", () => act(() => timeline.selectClip(clip.id)));
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-flamoris-animation-clip", clip.id);
        event.dataTransfer?.setData("text/plain", clip.id);
      });
      return button;
    }));
    const selectedClip = timelineState.selectedClip;
    setValueUnlessEditing(elements.animationClipNameInput, selectedClip?.displayName || "Animation Clip");
    setValueUnlessEditing(elements.animationClipDurationInput, selectedClip?.durationTicks || 120000);
    elements.animationClipDefaultLoopSelect.value = selectedClip?.defaultLoopMode || "once";
    elements.updateAnimationClipButton.disabled = !selectedClip;
    elements.removeAnimationClipButton.disabled = !selectedClip;
    elements.addClipInstanceButton.disabled = !active || !selectedClip;

    const instance = timelineState.selectedClipInstance;
    for (const [element, value] of [
      [elements.clipInstanceStartInput, instance?.startTicks],
      [elements.clipInstanceEndInput, instance?.endTicks],
      [elements.clipInstanceOffsetInput, instance?.sourceOffsetTicks],
      [elements.clipInstanceRateNumeratorInput, instance?.playbackRate.numerator],
      [elements.clipInstanceRateDenominatorInput, instance?.playbackRate.denominator],
      [elements.clipInstanceWeightInput, instance?.weight],
      [elements.clipInstanceLayerInput, instance?.layer],
    ]) setValueUnlessEditing(element, value ?? "");
    elements.clipInstanceLoopSelect.value = instance?.loopMode || "once";
    elements.clipInstanceEnabledInput.checked = instance?.enabled ?? false;
    for (const element of [elements.clipInstanceStartInput, elements.clipInstanceEndInput,
      elements.clipInstanceOffsetInput, elements.clipInstanceLoopSelect,
      elements.clipInstanceRateNumeratorInput, elements.clipInstanceRateDenominatorInput,
      elements.clipInstanceWeightInput, elements.clipInstanceLayerInput,
      elements.clipInstanceEnabledInput, elements.updateClipInstanceButton,
      elements.removeClipInstanceButton]) element.disabled = !instance;

    elements.sequenceProgramContext.textContent = timelineState.ownerContext
      ? `${timelineState.ownerContext.kind}-owned · ${timelineState.ownerContext.displayName} · ${timelineState.program?.id || "missing program"}`
      : "No owner selected";
    elements.editSequenceProgramButton.disabled = !active;
    elements.editClipProgramButton.disabled = !selectedClip;
    replaceOptions(elements.sequenceTrackSelect,
      [option("", "— Select track —"), ...timelineState.tracks.map((track) =>
        option(track.trackId, `${track.kind} · ${track.targetLabel} · ${track.trackId}`))],
      timelineState.selectedTrackId || "");
    replaceOptions(elements.sequenceTrackKindSelect,
      timelineState.allowedTrackKinds.map((kind) => option(kind, kind)),
      timelineState.allowedTrackKinds.includes(elements.sequenceTrackKindSelect.value)
        ? elements.sequenceTrackKindSelect.value : timelineState.allowedTrackKinds[0] || "");
    renderTrackTargets();
    elements.addSequenceTrackButton.disabled = !timelineState.program ||
      timelineState.allowedTrackKinds.length === 0 || !elements.sequenceTrackTargetSelect.value;
    elements.removeSequenceTrackButton.disabled = !timelineState.selectedTrack;
    renderKeyframes(timelineState);

    const operationIssues = timelineState.operationError?.issues || [];
    const diagnostics = [...timelineState.diagnostics, ...operationIssues];
    elements.sequenceDiagnosticsList.replaceChildren(...(diagnostics.length
      ? diagnostics.map((diagnostic) => {
        const item = document.createElement("li");
        item.dataset.severity = diagnostic.severity || "error";
        const strong = document.createElement("strong");
        strong.textContent = diagnostic.code || "TIMELINE_EDIT_REJECTED";
        const span = document.createElement("span");
        span.textContent = diagnostic.message;
        item.append(strong, span);
        return item;
      })
      : [Object.assign(document.createElement("li"), {
        textContent: timelineState.operationError?.message ||
          (active ? "No timeline diagnostics" : "Select a Sequence"),
      })]));
  }

  return { render };
}
