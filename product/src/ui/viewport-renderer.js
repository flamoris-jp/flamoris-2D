import { getDeformedVertices, imageToScreen } from "../mesh.js";
import { sampleLoop } from "../animation.js";
import { transformPoint } from "../core/transforms.js";
import { EDITOR_MODES, isMeshAuthoringMode } from "./editor-modes.js";
import { renderEvaluatedComposition } from "../core/shared-composition-renderer.js";

export function renderEvaluatedTransitionViewport({
  evaluation,
  view,
  renderer,
  resolveArtwork,
}) {
  const result = renderEvaluatedComposition({
    evaluation,
    renderTarget: view,
    renderer,
    resolveArtwork,
  });
  if (result.failure) {
    return {
      unsupportedReasons: [`Evaluated render plan is invalid: ${result.failure.error.message || String(result.failure.error)}`],
      renderInstanceCount: 0,
    };
  }
  return {
    unsupportedReasons: result.unsupportedReasons,
    renderInstanceCount: result.renderInstanceCount,
  };
}

export function clearLayerCanvas(canvas) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

const blendMap = new Map([
  ["normal", "source-over"],
  ["pass through", "source-over"],
  ["multiply", "multiply"],
  ["screen", "screen"],
  ["overlay", "overlay"],
  ["darken", "darken"],
  ["lighten", "lighten"],
  ["color dodge", "color-dodge"],
  ["color burn", "color-burn"],
  ["hard light", "hard-light"],
  ["soft light", "soft-light"],
  ["difference", "difference"],
  ["exclusion", "exclusion"],
  ["hue", "hue"],
  ["saturation", "saturation"],
  ["color", "color"],
  ["luminosity", "luminosity"],
]);

export function createViewportRenderer({
  state,
  elements,
  renderer,
  duration,
  selectedPart,
  selectedPartIndex,
  selectedNodeDocumentBounds,
  endpointContext = () => null,
  transitionPreviewContext = () => null,
  autoMeshPreviewContext = () => null,
  correspondencePreviewContext = () => null,
}) {
  function screenPointForPart(x, y) {
    const basePoint = {
      x: x + state.partOffset.x,
      y: y + state.partOffset.y,
    };
    const part = selectedPart();
    const documentPoint = state.editor && part?.nodeId
      ? transformPoint(state.editor.worldTransform(part.nodeId), basePoint)
      : basePoint;
    return imageToScreen(documentPoint.x, documentPoint.y, state.view);
  }

  function drawOverlay(vertices) {
    const canvas = elements.overlayCanvas;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!state.mesh || !state.view || vertices.length === 0) return;
    if (state.mode === "psd" && !isMeshAuthoringMode(state.editorMode)) return;

    context.lineWidth = isMeshAuthoringMode(state.editorMode) ? 1.5 : 1;
    context.strokeStyle = isMeshAuthoringMode(state.editorMode)
      ? "rgba(255, 202, 103, 0.72)"
      : "rgba(129, 221, 205, 0.48)";
    context.beginPath();
    for (let index = 0; index < state.mesh.indices.length; index += 3) {
      const triangle = state.mesh.indices.slice(index, index + 3);
      triangle.forEach((vertexIndex, triangleIndex) => {
        const point = screenPointForPart(
          vertices[vertexIndex * 2],
          vertices[vertexIndex * 2 + 1],
        );
        if (triangleIndex === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      const firstIndex = triangle[0];
      const first = screenPointForPart(
        vertices[firstIndex * 2],
        vertices[firstIndex * 2 + 1],
      );
      context.lineTo(first.x, first.y);
    }
    context.stroke();

    for (let index = 0; index < vertices.length / 2; index += 1) {
      const point = screenPointForPart(vertices[index * 2], vertices[index * 2 + 1]);
      context.beginPath();
      context.arc(point.x, point.y, state.selected.has(index) ? 5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = state.selected.has(index) ? "#ffca67" : "#eafdf9";
      context.fill();
      context.strokeStyle = state.selected.has(index) ? "#4f3412" : "#183a37";
      context.stroke();
    }
    const endpoint = endpointContext();
    const meshToolState = state.editor?.meshTools.getState() || null;
    if (endpoint?.topology && meshToolState) {
      context.save();
      context.font = "600 10px ui-monospace, monospace";
      context.textBaseline = "bottom";
      for (let index = 0; index < vertices.length / 2; index += 1) {
        if (!meshToolState.vertexIdOverlayVisible && !state.selected.has(index)) continue;
        const vertexId = endpoint.topology.vertexIds[index];
        if (!vertexId) continue;
        const point = screenPointForPart(vertices[index * 2], vertices[index * 2 + 1]);
        const semanticLabel = endpoint.topology.vertexMetadata?.[vertexId]?.semanticLabel;
        const label = semanticLabel ? `${vertexId} · ${semanticLabel}` : vertexId;
        const width = context.measureText(label).width + 8;
        context.fillStyle = "rgba(12, 26, 25, .88)";
        context.fillRect(point.x + 7, point.y - 17, width, 15);
        context.fillStyle = state.selected.has(index) ? "#ffca67" : "#eafdf9";
        context.fillText(label, point.x + 11, point.y - 4);
      }
      context.restore();
    }
    if (endpoint) {
      context.fillStyle = "rgba(12, 26, 25, .82)";
      context.fillRect(14, 14, 230, 28);
      context.fillStyle = "#ffca67";
      context.font = "700 12px ui-monospace, monospace";
      const mode = state.editorMode === EDITOR_MODES.TOPOLOGY
        ? "TOPOLOGY EDIT"
        : `DEFORM ENDPOINT ${endpoint.endpoint === "from" ? "A" : "B"}`;
      context.fillText(mode, 24, 33);
    }
    drawAutoMeshPreview(context);
    drawCorrespondencePreview(context, endpoint, vertices);
  }

  function drawCorrespondencePreview(context, endpoint, vertices) {
    const correspondence = correspondencePreviewContext();
    if (!endpoint || (!correspondence?.previewActive && !correspondence?.pendingVertexId)) return;
    const indexById = new Map((endpoint.topology?.vertexIds || [])
      .map((vertexId, index) => [vertexId, index]));
    context.save();
    context.font = "700 10px ui-monospace, monospace";
    context.textBaseline = "middle";
    let sourceWorld = null;
    let targetWorld = null;
    try {
      sourceWorld = state.editor?.endpointMesh.endpointWorldTransform(correspondence.sourceEndpoint);
      targetWorld = state.editor?.endpointMesh.endpointWorldTransform(correspondence.targetEndpoint);
    } catch (_error) {
      // Invalid/missing endpoint mappings are reported by the controller. The
      // viewport simply omits the optional displacement line.
    }
    for (const pin of correspondence.pins || []) {
      const index = indexById.get(pin.vertexId);
      if (!Number.isSafeInteger(index) || index * 2 + 1 >= vertices.length) continue;
      const point = screenPointForPart(vertices[index * 2], vertices[index * 2 + 1]);
      if (pin.source && sourceWorld && targetWorld) {
        const sourceDocument = transformPoint(sourceWorld, pin.source);
        const targetDocument = transformPoint(targetWorld, pin.target);
        const sourcePoint = imageToScreen(sourceDocument.x, sourceDocument.y, state.view);
        const targetPoint = imageToScreen(targetDocument.x, targetDocument.y, state.view);
        context.beginPath();
        context.moveTo(sourcePoint.x, sourcePoint.y);
        context.lineTo(targetPoint.x, targetPoint.y);
        context.setLineDash([4, 3]);
        context.strokeStyle = "rgba(125, 168, 255, .72)";
        context.lineWidth = 1.25;
        context.stroke();
        context.setLineDash([]);
      }
      context.beginPath();
      context.arc(point.x, point.y, pin.vertexId === correspondence.selectedPinId ? 8 : 6, 0, Math.PI * 2);
      context.fillStyle = pin.vertexId === correspondence.selectedPinId
        ? "rgba(255, 202, 103, .34)" : "rgba(125, 168, 255, .32)";
      context.fill();
      context.strokeStyle = pin.vertexId === correspondence.selectedPinId ? "#ffca67" : "#7da8ff";
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = "#e5ebff";
      context.fillText(pin.vertexId, point.x + 10, point.y);
    }
    context.fillStyle = "rgba(12, 26, 25, .9)";
    context.fillRect(14, 48, 290, 25);
    context.fillStyle = correspondence.previewActive ? "#ffca67" : "#7da8ff";
    context.fillText(correspondence.previewActive
      ? `CORRESPONDENCE PREVIEW · ${correspondence.pinCount} PINS · READ ONLY`
      : `PLACE TARGET ANCHOR · ${correspondence.pendingVertexId}`,
    23, 60.5);
    context.restore();
  }

  function drawAutoMeshPreview(context) {
    const candidate = autoMeshPreviewContext()?.candidate;
    if (!candidate || !state.view || state.editorMode !== EDITOR_MODES.TOPOLOGY) return;
    const part = selectedPart();
    const world = part?.nodeId && state.editor
      ? state.editor.worldTransform(part.nodeId)
      : [1, 0, 0, 1, 0, 0];
    const screen = (index) => {
      const local = { x: candidate.positions[index * 2], y: candidate.positions[index * 2 + 1] };
      const point = transformPoint(world, local);
      return imageToScreen(point.x, point.y, state.view);
    };
    context.save();
    context.strokeStyle = "rgba(91, 224, 255, .88)";
    context.lineWidth = 1.5;
    context.setLineDash([4, 3]);
    context.beginPath();
    for (let offset = 0; offset < candidate.indices.length; offset += 3) {
      const triangle = candidate.indices.slice(offset, offset + 3);
      triangle.forEach((vertexIndex, index) => {
        const point = screen(vertexIndex);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      const first = screen(triangle[0]);
      context.lineTo(first.x, first.y);
    }
    context.stroke();
    context.setLineDash([]);
    for (let index = 0; index < candidate.positions.length / 2; index += 1) {
      const point = screen(index);
      context.beginPath();
      context.arc(point.x, point.y, candidate.vertexKinds[index] === "corner" ? 4.5 : 3, 0, Math.PI * 2);
      context.fillStyle = candidate.vertexKinds[index] === "corner"
        ? "#ffca67"
        : candidate.vertexKinds[index] === "interior" ? "#7da8ff" : "#5be0ff";
      context.fill();
    }
    context.restore();
  }

  function drawTransformGizmo() {
    if (
      state.editorMode !== EDITOR_MODES.OBJECT ||
      !state.editor?.selectedNodeId ||
      !state.view
    ) return;
    const bounds = selectedNodeDocumentBounds();
    if (!bounds) return;
    const node = state.editor.getNode(state.editor.selectedNodeId);
    const context = elements.overlayCanvas.getContext("2d");
    const topLeft = imageToScreen(bounds.left, bounds.top, state.view);
    const bottomRight = imageToScreen(bounds.right, bounds.bottom, state.view);
    const pivotDocument = transformPoint(
      state.editor.worldTransform(node.id),
      node.transform.pivot,
    );
    const pivot = imageToScreen(pivotDocument.x, pivotDocument.y, state.view);
    context.save();
    context.strokeStyle = node.locked ? "#9a8060" : "#ffca67";
    context.fillStyle = "rgba(255, 202, 103, .12)";
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.strokeRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
    context.setLineDash([]);
    context.beginPath();
    context.arc(pivot.x, pivot.y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(pivot.x - 10, pivot.y);
    context.lineTo(pivot.x + 10, pivot.y);
    context.moveTo(pivot.x, pivot.y - 10);
    context.lineTo(pivot.x, pivot.y + 10);
    context.stroke();
    context.fillStyle = "#ffdc8e";
    context.font = "10px ui-monospace, monospace";
    context.fillText(state.editor.activeTool, topLeft.x + 5, topLeft.y - 7);
    context.restore();
  }

  function drawPsdPart(context, part) {
    if (!part.canvas || !state.view || !part.nodeId || !state.editor) return;
    const node = state.editor.getNode(part.nodeId);
    if (!node.effectiveVisible) return;
    const world = state.editor.worldTransform(part.nodeId);
    const scale = state.view.scale;
    context.save();
    context.globalAlpha = part.opacity;
    context.globalCompositeOperation = blendMap.get(part.blendMode) || "source-over";
    context.transform(
      world[0] * scale,
      world[1] * scale,
      world[2] * scale,
      world[3] * scale,
      state.view.originX + world[4] * scale,
      state.view.originY + world[5] * scale,
    );
    context.drawImage(part.canvas, part.left, part.top);
    context.restore();
  }

  function drawPsdBackgrounds() {
    clearLayerCanvas(elements.backgroundBelowCanvas);
    clearLayerCanvas(elements.foregroundCanvas);
    if (state.mode !== "psd" || !state.view) return;

    const ratio = window.devicePixelRatio || 1;
    const below = elements.backgroundBelowCanvas.getContext("2d");
    const above = elements.foregroundCanvas.getContext("2d");
    below.setTransform(ratio, 0, 0, ratio, 0, 0);
    above.setTransform(ratio, 0, 0, ratio, 0, 0);

    const activeIndex = selectedPartIndex();
    const endpoint = endpointContext();
    const endpointMembers = endpoint
      ? new Set(endpoint.keyArt.members.map((member) => member.nodeId))
      : null;
    for (let index = 0; index < state.psdParts.length; index += 1) {
      if (endpointMembers && !endpointMembers.has(state.psdParts[index].nodeId)) continue;
      if (index === activeIndex && state.mesh) continue;
      const target = activeIndex >= 0 && index > activeIndex ? above : below;
      drawPsdPart(target, state.psdParts[index]);
    }
  }

  function render() {
    const transitionPreview = transitionPreviewContext();
    if (transitionPreview?.viewMode === "preview") {
      clearLayerCanvas(elements.backgroundBelowCanvas);
      clearLayerCanvas(elements.foregroundCanvas);
      clearLayerCanvas(elements.overlayCanvas);
      if (!state.view || !transitionPreview.evaluation) {
        state.editor?.transitionPreview.setRenderReport({
          unsupportedReasons: [state.view
            ? "Transition evaluation is unavailable."
            : "Viewport transform is unavailable."],
          renderInstanceCount: 0,
        });
        renderer.render(new Float32Array(), { originX: 0, originY: 0, scale: 1 });
        return;
      }
      const resolveArtwork = (nodeId) =>
        state.psdParts.find((part) => part.nodeId === nodeId)?.canvas || null;
      const report = renderEvaluatedTransitionViewport({
        evaluation: transitionPreview.evaluation,
        view: state.view,
        renderer,
        resolveArtwork,
      });
      state.editor?.transitionPreview.setRenderReport(report);
      return;
    }
    drawPsdBackgrounds();
    if (!state.mesh || !state.view) {
      renderer.render(
        new Float32Array(),
        { originX: 0, originY: 0, scale: 1 },
        { x: 0, y: 0 },
      );
      drawOverlay(new Float32Array());
      drawTransformGizmo();
      return;
    }
    const previewOffsets = state.previewMode && state.keyframes.a && state.keyframes.b
      ? sampleLoop(state.keyframes.a, state.keyframes.b, state.currentTime, duration())
      : state.mesh.vertexOffsets;
    const correspondence = correspondencePreviewContext();
    const vertices = correspondence?.previewActive
      ? new Float32Array(correspondence.candidatePositions)
      : getDeformedVertices(state.mesh, previewOffsets);
    const part = selectedPart();
    const world = part?.nodeId && state.editor
      ? state.editor.worldTransform(part.nodeId)
      : [1, 0, 0, 1, 0, 0];
    const visible = part?.nodeId && state.editor
      ? state.editor.getNode(part.nodeId).effectiveVisible
      : true;
    renderer.render(vertices, state.view, state.partOffset, world, visible);
    drawOverlay(visible ? vertices : new Float32Array());
    drawTransformGizmo();
  }

  return { render, screenPointForPart };
}
