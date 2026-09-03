import { getDeformedVertices, imageToScreen } from "../mesh.js";
import { sampleLoop } from "../animation.js";
import { transformPoint } from "../core/transforms.js";
import { EDITOR_MODES } from "./editor-modes.js";

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
    if (state.mode === "psd" && state.editorMode !== EDITOR_MODES.EDIT) return;

    context.lineWidth = state.editorMode === EDITOR_MODES.EDIT ? 1.5 : 1;
    context.strokeStyle = state.editorMode === EDITOR_MODES.EDIT
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
    if (endpoint) {
      context.fillStyle = "rgba(12, 26, 25, .82)";
      context.fillRect(14, 14, 190, 28);
      context.fillStyle = "#ffca67";
      context.font = "700 12px ui-monospace, monospace";
      context.fillText(`EDIT ENDPOINT ${endpoint.endpoint === "from" ? "A" : "B"}`, 24, 33);
    }
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
    const vertices = getDeformedVertices(state.mesh, previewOffsets);
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
