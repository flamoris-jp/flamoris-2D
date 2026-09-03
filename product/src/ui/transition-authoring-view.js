import { PART_TRANSITION_MODES } from "./transition-authoring-controller.js";

const STATUS_LABELS = {
  mapped: "Mapped",
  "a-only": "A only",
  "b-only": "B only",
  "missing-invalid": "Missing / invalid",
  unmapped: "Unmapped",
};

function option(value, label, { disabled = false } = {}) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  element.disabled = disabled;
  return element;
}

function setOptions(select, options, value = "") {
  select.replaceChildren(...options);
  select.value = value ?? "";
}

function memberLabel(member) {
  return member.node
    ? `${member.node.displayName} (${member.node.id})`
    : `[Missing node] ${member.nodeId}`;
}

export function createTransitionAuthoringView({ state, elements, setStatus }) {
  function controller() {
    return state.editor?.transitionAuthoring || null;
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

  elements.activeTransitionSelect.addEventListener("change", () => {
    act(() => controller()?.selectTransition(
      elements.activeTransitionSelect.value || null,
    ));
  });

  elements.createTransitionButton.addEventListener("click", () => {
    act(() => {
      const editor = controller();
      if (!editor) return null;
      const fromKeyArtId = elements.transitionFromKeyArtSelect.value;
      const toKeyArtId = elements.transitionToKeyArtSelect.value;
      const keyArts = editor.getState().keyArts;
      const from = keyArts.find((entry) => entry.id === fromKeyArtId);
      const to = keyArts.find((entry) => entry.id === toKeyArtId);
      const result = editor.createTransitionWithProgram({
        displayName: `${from?.displayName || "A"} → ${to?.displayName || "B"}`,
        fromKeyArtId,
        toKeyArtId,
        durationTicks: Number(elements.transitionDurationInput.value),
      });
      setStatus("TransitionとTemporalProgramを1件のUndo操作として作成しました");
      return result;
    });
  });

  for (const [endpoint, select] of [
    ["from", elements.transitionFromKeyArtSelect],
    ["to", elements.transitionToKeyArtSelect],
  ]) {
    select.addEventListener("change", () => {
      const editor = controller();
      if (!editor?.activeTransition()) return;
      act(() => editor.setEndpoint(endpoint, select.value));
    });
  }

  elements.semanticSlotSelect.addEventListener("change", () => {
    act(() => controller()?.selectSemanticSlot(
      elements.semanticSlotSelect.value || null,
    ));
  });

  function bindMapping(select, endpoint) {
    select.addEventListener("change", () => {
      act(() => {
        const editor = controller();
        const authoring = editor?.getState();
        const keyArtId = authoring?.endpoints?.[endpoint].id;
        if (!editor || !keyArtId) return null;
        return select.value
          ? editor.mapNode(keyArtId, select.value)
          : editor.unmapNode(keyArtId);
      });
    });
  }
  bindMapping(elements.semanticFromNodeSelect, "from");
  bindMapping(elements.semanticToNodeSelect, "to");

  elements.partTransitionModeSelect.addEventListener("change", () => {
    if (!elements.partTransitionModeSelect.value) return;
    act(() => controller()?.setPartMode(elements.partTransitionModeSelect.value, {
      holdEndpoint: elements.holdEndpointSelect.value,
      compositeGroupId: elements.replaceCompositeGroupInput.value.trim(),
    }));
  });
  elements.holdEndpointSelect.addEventListener("change", () => {
    if (elements.partTransitionModeSelect.value !== "hold") return;
    act(() => controller()?.setPartMode("hold", {
      holdEndpoint: elements.holdEndpointSelect.value,
    }));
  });
  elements.replaceCompositeGroupInput.addEventListener("change", () => {
    if (elements.partTransitionModeSelect.value !== "replace") return;
    act(() => controller()?.setPartMode("replace", {
      compositeGroupId: elements.replaceCompositeGroupInput.value.trim(),
    }));
  });

  function renderKeyArts(authoring) {
    elements.keyArtList.replaceChildren();
    for (const keyArt of authoring.keyArts) {
      const item = document.createElement("li");
      item.textContent = `${keyArt.displayName} · ${keyArt.members.length} members`;
      item.title = keyArt.id;
      item.addEventListener("click", () => act(() =>
        controller()?.selectKeyArt(keyArt.id)));
      if (keyArt.id === authoring.selectedKeyArtId) item.classList.add("selected");
      elements.keyArtList.append(item);
    }
    if (!authoring.keyArts.length) {
      const empty = document.createElement("li");
      empty.className = "panel-empty";
      empty.textContent = "Key Artがありません";
      elements.keyArtList.append(empty);
    }
  }

  function renderEndpointSelect(select, keyArts, endpoint) {
    const previous = select.value;
    const options = [option("", "— Key Art —")];
    options.push(...keyArts.map((keyArt) => option(keyArt.id, keyArt.displayName)));
    if (endpoint?.missing) {
      options.push(option(endpoint.id, `[Missing] ${endpoint.id}`));
    }
    setOptions(select, options, endpoint?.id || previous || "");
  }

  function renderMapping(select, endpoint, mapping) {
    const options = [option("", "— Unmapped —")];
    for (const member of endpoint?.keyArt?.members || []) {
      options.push(option(member.nodeId, memberLabel(member)));
    }
    if (mapping?.mapping && !options.some((entry) => entry.value === mapping.mapping.nodeId)) {
      options.push(option(mapping.mapping.nodeId, `[Missing / invalid] ${mapping.mapping.nodeId}`));
    }
    setOptions(select, options, mapping?.mapping?.nodeId || "");
    select.disabled = !endpoint?.keyArt;
  }

  function render() {
    const editor = controller();
    elements.transitionAuthoringPanel.classList.toggle("unavailable", !editor);
    if (!editor) {
      setOptions(elements.activeTransitionSelect, [option("", "— No Project —")]);
      elements.createTransitionButton.disabled = true;
      elements.semanticSlotSelect.disabled = true;
      elements.partTransitionModeSelect.disabled = true;
      elements.transitionEndpointStatus.textContent = "Projectを開くとAuthoringを開始できます";
      return;
    }
    const authoring = editor.getState();
    const transitionOptions = [option("", "— Select Transition —")];
    transitionOptions.push(...authoring.transitions.map((transition) =>
      option(transition.id, transition.displayName)));
    if (authoring.activeTransitionMissing) {
      transitionOptions.push(option(
        authoring.activeTransitionId,
        `[Removed] ${authoring.activeTransitionId}`,
        { disabled: true },
      ));
    }
    setOptions(
      elements.activeTransitionSelect,
      transitionOptions,
      authoring.activeTransition?.id || "",
    );
    elements.activeTransitionSelect.disabled = !authoring.transitions.length;

    const draftFrom = authoring.keyArts[0]?.id || "";
    const draftTo = authoring.keyArts.find((entry) => entry.id !== draftFrom)?.id || "";
    renderEndpointSelect(
      elements.transitionFromKeyArtSelect,
      authoring.keyArts,
      authoring.endpoints?.from || (draftFrom ? { id: draftFrom } : null),
    );
    renderEndpointSelect(
      elements.transitionToKeyArtSelect,
      authoring.keyArts,
      authoring.endpoints?.to || (draftTo ? { id: draftTo } : null),
    );
    const fromId = elements.transitionFromKeyArtSelect.value;
    const toId = elements.transitionToKeyArtSelect.value;
    elements.createTransitionButton.disabled = authoring.keyArts.length < 2 || !fromId || !toId || fromId === toId;
    elements.transitionDurationInput.disabled = authoring.keyArts.length < 2;
    elements.transitionEndpointStatus.textContent = authoring.activeTransitionMissing
      ? `Selected Transition is currently absent: ${authoring.activeTransitionId}`
      : authoring.activeTransition
        ? `A ${authoring.endpoints.from.missing ? "missing" : "ready"} · B ${authoring.endpoints.to.missing ? "missing" : "ready"}`
        : "A/Bを選び、New Transitionでatomic作成";
    renderKeyArts(authoring);

    const slotOptions = [option("", "— Select SemanticSlot —")];
    slotOptions.push(...authoring.semanticSlots.map((slot) =>
      option(slot.id, `${slot.displayName || slot.id} · ${STATUS_LABELS[slot.status]}`)));
    setOptions(
      elements.semanticSlotSelect,
      slotOptions,
      authoring.selectedSemanticSlot?.id || "",
    );
    elements.semanticSlotSelect.disabled = !authoring.activeTransition || !authoring.semanticSlots.length;

    const slot = authoring.selectedSemanticSlot;
    elements.semanticMappingStatus.textContent = slot
      ? STATUS_LABELS[slot.status]
      : "SemanticSlotを選択";
    elements.semanticMappingStatus.dataset.status = slot?.status || "none";
    renderMapping(elements.semanticFromNodeSelect, authoring.endpoints?.from, slot?.from);
    renderMapping(elements.semanticToNodeSelect, authoring.endpoints?.to, slot?.to);
    elements.semanticFromNodeSelect.disabled ||= !slot;
    elements.semanticToNodeSelect.disabled ||= !slot;

    const modeOptions = [option("", "— No PartTransition —")];
    for (const mode of PART_TRANSITION_MODES) {
      modeOptions.push(option(mode, mode, {
        disabled: !slot?.availableModes?.[mode] && slot?.partTransition?.mode !== mode,
      }));
    }
    setOptions(
      elements.partTransitionModeSelect,
      modeOptions,
      slot?.partTransition?.mode || "",
    );
    elements.partTransitionModeSelect.disabled = !slot;
    const mode = slot?.partTransition?.mode || "";
    elements.holdConfiguration.hidden = mode !== "hold";
    elements.replaceConfiguration.hidden = mode !== "replace";
    elements.morphConfiguration.hidden = mode !== "morph";
    elements.holdEndpointSelect.value = slot?.partTransition?.configuration?.holdEndpoint || "from";
    elements.replaceCompositeGroupInput.value = slot?.partTransition?.configuration?.compositeGroupId || "";
    elements.morphConfiguration.textContent = slot?.morphReferences
      ? `Topology ${slot.morphReferences.topologyId} · endpoint keyforms ready`
      : "Topology / endpoint keyforms are unavailable (Phase 2C-2)";
  }

  return { render };
}
