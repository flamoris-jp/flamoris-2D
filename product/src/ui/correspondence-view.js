function endpointLabel(endpoint) {
  return endpoint === "from" ? "A" : "B";
}

export function createCorrespondenceView({
  state,
  elements,
  setStatus,
  onEndpointChange = null,
}) {
  const controller = () => state.editor?.correspondencePreview || null;

  function act(action) {
    try {
      return action();
    } catch (error) {
      console.error(error);
      setStatus(`${error.code ? `${error.code}: ` : ""}${error.message || String(error)}`);
      render();
      return null;
    }
  }

  function editSource() {
    const correspondence = controller()?.getState();
    if (!correspondence) return;
    controller().clearPreview();
    state.editor.endpointMesh.selectEndpoint(correspondence.sourceEndpoint);
    state.editor.meshTools.setMode("deform");
    onEndpointChange?.();
  }

  elements.correspondenceDirectionSelect.addEventListener("change", () => act(() => {
    const [source, target] = elements.correspondenceDirectionSelect.value.split("-");
    controller()?.setDirection(source, target);
    editSource();
  }));
  elements.correspondenceEditSourceButton.addEventListener("click", () => act(editSource));
  elements.correspondencePlacePinButton.addEventListener("click", () => act(() => {
    const selected = state.editor?.meshTools.getState().selectedVertex;
    if (!selected) throw new Error("source側でStable Vertexを1個選択してください。");
    controller()?.beginPinPlacement(selected.id);
    onEndpointChange?.();
    setStatus(`${selected.id} のtarget anchor位置をviewportでクリックしてください`);
  }));
  elements.correspondenceMovePinButton.addEventListener("click", () => act(() => {
    const selectedPinId = controller()?.getState().selectedPinId;
    if (!selectedPinId) throw new Error("移動するpinを選択してください。");
    controller().beginPinPlacement(selectedPinId);
    onEndpointChange?.();
    setStatus(`${selectedPinId} のtarget anchorを再配置してください`);
  }));
  elements.correspondenceRemovePinButton.addEventListener("click", () => act(() =>
    controller()?.removePin()));
  elements.correspondenceClearPinsButton.addEventListener("click", () => act(() =>
    controller()?.clearWorkspace()));
  elements.correspondencePresetSelect.addEventListener("change", () => act(() =>
    controller()?.setPreset(elements.correspondencePresetSelect.value)));
  elements.correspondenceSolveButton.addEventListener("click", () => act(() => {
    const result = controller()?.solve();
    onEndpointChange?.();
    setStatus(result?.previewActive
      ? `Correspondence preview: ${result.pinCount} pins · read-only`
      : result?.diagnostics[0]?.message || "Correspondence solve failed.");
    return result;
  }));
  elements.correspondenceApplyButton.addEventListener("click", () => act(() => {
    const result = controller()?.apply(state.editor?.meshTools);
    onEndpointChange?.();
    setStatus("Correspondence solveを1件のUndo操作としてtarget MeshKeyformへ適用しました");
    return result;
  }));
  elements.correspondenceCancelPreviewButton.addEventListener("click", () => act(() => {
    controller()?.clearPreview();
    editSource();
  }));

  function render() {
    const correspondence = controller()?.getState() || null;
    const toolState = state.editor?.meshTools.getState() || null;
    const transitionPreview = state.editor?.transitionPreview.getState().viewMode === "preview";
    const available = Boolean(correspondence?.topologyId &&
      correspondence.sourceKeyformId && correspondence.targetKeyformId);
    const sourceLabel = correspondence ? endpointLabel(correspondence.sourceEndpoint) : "A";
    const targetLabel = correspondence ? endpointLabel(correspondence.targetEndpoint) : "B";
    elements.correspondencePanel.hidden = !available;
    elements.correspondenceDirectionSelect.value = correspondence
      ? `${correspondence.sourceEndpoint}-${correspondence.targetEndpoint}`
      : "from-to";
    elements.correspondenceDirectionSelect.disabled = transitionPreview || Boolean(correspondence?.previewActive);
    elements.correspondencePresetSelect.value = correspondence?.preset || "normal";
    elements.correspondencePresetSelect.disabled = transitionPreview || Boolean(correspondence?.previewActive);
    const selectedVertex = toolState?.selectedVertex || null;
    elements.correspondenceSelectedVertexOutput.textContent = selectedVertex
      ? `${selectedVertex.id}${selectedVertex.semanticLabel ? ` · ${selectedVertex.semanticLabel}` : ""}`
      : "—";
    elements.correspondencePinCountOutput.textContent = String(correspondence?.pinCount || 0);
    elements.correspondenceEditSourceButton.textContent = `Edit source ${sourceLabel}`;
    elements.correspondenceEditSourceButton.disabled = transitionPreview;
    elements.correspondencePlacePinButton.disabled = transitionPreview ||
      Boolean(correspondence?.previewActive) || !selectedVertex;
    elements.correspondenceMovePinButton.disabled = transitionPreview ||
      Boolean(correspondence?.previewActive) || !correspondence?.selectedPinId;
    elements.correspondenceRemovePinButton.disabled = transitionPreview ||
      Boolean(correspondence?.previewActive) || !correspondence?.selectedPinId;
    elements.correspondenceClearPinsButton.disabled = transitionPreview ||
      Boolean(correspondence?.previewActive) || !correspondence?.pinCount;
    elements.correspondenceSolveButton.disabled = transitionPreview ||
      Boolean(correspondence?.previewActive) || !correspondence?.pinCount;
    elements.correspondenceApplyButton.disabled = transitionPreview || !correspondence?.previewActive;
    elements.correspondenceCancelPreviewButton.disabled = !correspondence?.previewActive &&
      !correspondence?.pendingVertexId;
    elements.correspondencePins.replaceChildren(...(correspondence?.pins || []).map((pin) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = pin.vertexId === correspondence.selectedPinId ? "selected" : "secondary";
      button.textContent = `${pin.vertexId}${pin.semanticLabel ? ` · ${pin.semanticLabel}` : ""} → (${pin.target.x.toFixed(2)}, ${pin.target.y.toFixed(2)})`;
      button.addEventListener("click", () => controller()?.selectPin(pin.vertexId));
      item.append(button);
      return item;
    }));
    elements.correspondenceStatus.dataset.mode = correspondence?.previewActive ? "preview" : "edit";
    elements.correspondenceStatus.textContent = correspondence?.previewActive
      ? `Preview: ${sourceLabel} → ${targetLabel} · read-only candidate`
      : correspondence?.pendingVertexId
      ? `Placing: ${correspondence.pendingVertexId} on target ${targetLabel}`
      : `Pins: ${sourceLabel} → ${targetLabel} · source vertex IDs are authoritative`;
    elements.correspondenceDiagnostics.replaceChildren(...(correspondence?.diagnostics || []).map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.code}: ${entry.message}`;
      return item;
    }));
  }

  return { render };
}
