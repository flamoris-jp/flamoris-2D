import { MESH_AUTHORING_MODES } from "./mesh-tool-controller.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function createMeshAuthoringView({ state, elements, setStatus }) {
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

  function render() {
    const toolState = controller()?.getState() || null;
    const topologyMode = toolState?.mode === MESH_AUTHORING_MODES.TOPOLOGY;
    const selected = toolState?.selectedVertex || null;
    const selectedCount = toolState?.selectedVertexIds.length || 0;
    const previousTool = elements.meshToolSelect.value;
    elements.meshToolSelect.replaceChildren(
      option("", "— Select tool —"),
      ...(toolState?.tools || []).map((tool) => option(tool.id, tool.label)),
    );
    elements.meshToolSelect.value = toolState?.activeToolId || previousTool || "";
    elements.meshToolSelect.disabled = !toolState?.topology;
    elements.vertexIdOverlayInput.checked = Boolean(toolState?.vertexIdOverlayVisible);
    elements.vertexIdOverlayInput.disabled = !toolState?.topology;
    elements.selectedVertexIdOutput.textContent = selected?.id || "—";
    elements.selectedVertexLabelOutput.textContent = selected?.semanticLabel || "—";
    if (document.activeElement !== elements.vertexSemanticLabelInput) {
      elements.vertexSemanticLabelInput.value = selected?.semanticLabel || "";
    }
    elements.vertexSemanticLabelInput.disabled = !topologyMode || selectedCount !== 1;
    elements.setVertexSemanticLabelButton.disabled = !topologyMode || selectedCount !== 1;
    elements.clearVertexSemanticLabelButton.disabled =
      !topologyMode || selectedCount !== 1 || !selected?.semanticLabel;
    elements.removeVertexButton.disabled = !topologyMode || selectedCount !== 1;
    elements.createTriangleButton.disabled = !topologyMode || selectedCount !== 3;
    elements.subdivideEdgeButton.disabled = !topologyMode || selectedCount !== 2;
    elements.meshTopologyImpact.dataset.mode = toolState?.mode || "none";
    elements.meshTopologyImpact.textContent = topologyMode
      ? `Shared Topology change — affects ${toolState.affectedKeyformIds.length} MeshKeyform(s): ${toolState.affectedKeyformIds.join(", ") || "none"}`
      : "Deform Mode — changes only the active MeshKeyform; topology commands are blocked.";
  }

  return { render };
}
