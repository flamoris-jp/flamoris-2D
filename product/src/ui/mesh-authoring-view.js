import { MESH_AUTHORING_MODES } from "./mesh-tool-controller.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function createMeshAuthoringView({
  state,
  elements,
  setStatus,
  autoMeshPreview,
  selectedPart,
  onAutoMeshApplied = null,
}) {
  const controller = () => state.editor?.meshTools || null;

  function act(action) {
    try {
      return action();
    } catch (error) {
      console.error(error);
      setStatus(error.message || String(error));
      render();
      return null;
    }
  }

  elements.meshToolSelect.addEventListener("change", () => act(() => {
    if (!elements.meshToolSelect.value) return null;
    return controller()?.setActiveTool(elements.meshToolSelect.value);
  }));
  elements.vertexIdOverlayInput.addEventListener("change", () =>
    controller()?.setVertexIdOverlayVisible(elements.vertexIdOverlayInput.checked));
  elements.setVertexSemanticLabelButton.addEventListener("click", () => act(() => {
    const semanticLabel = elements.vertexSemanticLabelInput.value.trim();
    if (!semanticLabel) throw new Error("Semantic Labelを入力してください。");
    const result = controller()?.execute("topology.set-label", { semanticLabel });
    setStatus(`Vertex labelを ${semanticLabel} に設定しました`);
    return result;
  }));
  elements.clearVertexSemanticLabelButton.addEventListener("click", () => act(() =>
    controller()?.execute("topology.clear-label")));
  elements.removeVertexButton.addEventListener("click", () => act(() =>
    controller()?.execute("topology.remove")));
  elements.createTriangleButton.addEventListener("click", () => act(() =>
    controller()?.execute("topology.connect")));
  elements.subdivideEdgeButton.addEventListener("click", () => act(() =>
    controller()?.execute("topology.subdivide")));
  function generateAutoMeshPreview() {
    const part = selectedPart();
    if (!part?.canvas) throw new Error("Select a PSD render part with alpha data first.");
    const context = part.canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, part.canvas.width, part.canvas.height);
    const preview = autoMeshPreview.generate(imageData, {
      settings: {
        alphaThreshold: Number(elements.autoMeshAlphaThresholdInput.value),
        density: Number(elements.autoMeshDensityInput.value),
        cornerSensitivity: Number(elements.autoMeshCornerSensitivityInput.value),
        interiorDensity: Number(elements.autoMeshInteriorDensityInput.value),
      },
      localBounds: { left: part.left, top: part.top, width: part.width, height: part.height },
    });
    setStatus(preview.candidate
      ? `Contour AutoMesh preview: ${preview.vertexCount} vertices / ${preview.triangleCount} triangles`
      : preview.diagnostics[0]?.message || "AutoMesh preview failed.");
    return preview;
  }

  elements.meshGeneratorSelect.addEventListener("change", () => render());
  elements.autoMeshPreviewButton.addEventListener("click", () => act(generateAutoMeshPreview));
  for (const input of [
    elements.autoMeshAlphaThresholdInput,
    elements.autoMeshDensityInput,
    elements.autoMeshCornerSensitivityInput,
    elements.autoMeshInteriorDensityInput,
  ]) input.addEventListener("input", () => {
    if (autoMeshPreview.getState().candidate) act(generateAutoMeshPreview);
  });
  elements.autoMeshApplyButton.addEventListener("click", () => act(() => {
    const result = autoMeshPreview.apply(controller(), {
      replaceExisting: elements.autoMeshReplaceExistingInput.checked,
    });
    onAutoMeshApplied?.();
    setStatus("Contour AutoMeshを1件のUndo操作として適用しました");
    return result;
  }));

  function render() {
    const toolState = controller()?.getState() || null;
    const topologyMode = toolState?.mode === MESH_AUTHORING_MODES.TOPOLOGY;
    const previewMode = state.editor?.transitionPreview.getState().viewMode === "preview";
    const selected = toolState?.selectedVertex || null;
    const selectedCount = toolState?.selectedVertexIds.length || 0;
    const generator = elements.meshGeneratorSelect.value;
    const autoMeshState = autoMeshPreview.getState();
    const previousTool = elements.meshToolSelect.value;
    elements.meshToolSelect.replaceChildren(
      option("", "— Select tool —"),
      ...(toolState?.tools || []).map((tool) => option(tool.id, tool.label)),
    );
    elements.meshToolSelect.value = toolState?.activeToolId || previousTool || "";
    elements.meshToolSelect.disabled = !toolState?.topology || previewMode;
    elements.vertexIdOverlayInput.checked = Boolean(toolState?.vertexIdOverlayVisible);
    elements.vertexIdOverlayInput.disabled = !toolState?.topology || previewMode;
    elements.selectedVertexIdOutput.textContent = selected?.id || "—";
    elements.selectedVertexLabelOutput.textContent = selected?.semanticLabel || "—";
    if (document.activeElement !== elements.vertexSemanticLabelInput) {
      elements.vertexSemanticLabelInput.value = selected?.semanticLabel || "";
    }
    elements.vertexSemanticLabelInput.disabled = previewMode || !topologyMode || selectedCount !== 1;
    elements.setVertexSemanticLabelButton.disabled = previewMode || !topologyMode || selectedCount !== 1;
    elements.clearVertexSemanticLabelButton.disabled =
      previewMode || !topologyMode || selectedCount !== 1 || !selected?.semanticLabel;
    elements.removeVertexButton.disabled = previewMode || !topologyMode || selectedCount !== 1;
    elements.createTriangleButton.disabled = previewMode || !topologyMode || selectedCount !== 3;
    elements.subdivideEdgeButton.disabled = previewMode || !topologyMode || selectedCount !== 2;
    elements.autoMeshPanel.hidden = !topologyMode;
    elements.contourAutoMeshSettings.hidden = generator !== "contour";
    elements.gridGeneratorHint.hidden = generator !== "grid";
    elements.autoMeshPreviewButton.disabled = previewMode || !topologyMode || !selectedPart()?.canvas;
    elements.autoMeshApplyButton.disabled = previewMode || !topologyMode || !autoMeshState.candidate;
    elements.autoMeshSummary.textContent = autoMeshState.candidate
      ? `${autoMeshState.vertexCount} vertices · ${autoMeshState.triangleCount} triangles · transient preview`
      : "No candidate preview";
    const autoMeshDiagnostics = [...autoMeshState.diagnostics];
    if (autoMeshState.candidate && toolState?.topology) autoMeshDiagnostics.push({
      code: "AUTOMESH_EXISTING_AUTHORED_TOPOLOGY",
      message: `Apply replaces this topology and ${toolState.affectedKeyformIds.length} attached MeshKeyform(s). Explicit consent is required.`,
    });
    elements.autoMeshDiagnostics.replaceChildren(...autoMeshDiagnostics.map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.code}: ${entry.message}`;
      return item;
    }));
    elements.meshTopologyImpact.dataset.mode = toolState?.mode || "none";
    elements.meshTopologyImpact.textContent = previewMode
      ? "Preview is read-only — endpoint deformation and topology commands are blocked."
      : topologyMode
      ? `Shared Topology change — affects ${toolState.affectedKeyformIds.length} MeshKeyform(s): ${toolState.affectedKeyformIds.join(", ") || "none"}`
      : "Deform Mode — changes only the active MeshKeyform; topology commands are blocked.";
  }

  return { render };
}
