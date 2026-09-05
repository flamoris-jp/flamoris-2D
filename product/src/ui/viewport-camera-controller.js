import { createViewTransform, screenToImage } from "../mesh.js";
import { transformPoint } from "../core/transforms.js";

export function createViewportCameraController({
  state,
  elements,
  render,
  pixelRatio = () => globalThis.window?.devicePixelRatio || 1,
}) {
  if (!state || !elements?.viewportWrap || typeof render !== "function") {
    throw new TypeError("Viewport camera state, elements, and render callback are required.");
  }

  function updateZoomOutput() {
    const percent = state.view ? Math.round(state.view.scale * 100) : 100;
    elements.zoomOutput.textContent = `${percent}%`;
    elements.fitPartButton.disabled = !(
      state.mode === "psd" && state.editor?.selectedNodeId
    );
  }

  function selectedNodeDocumentBounds() {
    const selectedId = state.editor?.selectedNodeId;
    if (!selectedId) return null;
    const points = [];
    for (const part of state.psdParts) {
      if (!part.nodeId || !state.editor.isDescendantOrSelf(part.nodeId, selectedId)) {
        continue;
      }
      const node = state.editor.getNode(part.nodeId);
      if (!node.effectiveVisible) continue;
      const world = state.editor.worldTransform(part.nodeId);
      points.push(
        transformPoint(world, { x: part.left, y: part.top }),
        transformPoint(world, { x: part.right, y: part.top }),
        transformPoint(world, { x: part.right, y: part.bottom }),
        transformPoint(world, { x: part.left, y: part.bottom }),
      );
    }
    if (!points.length) return null;
    return {
      left: Math.min(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      right: Math.max(...points.map((point) => point.x)),
      bottom: Math.max(...points.map((point) => point.y)),
    };
  }

  function fitBoundsView(bounds, padding = 110) {
    if (!bounds) return;
    const rect = elements.viewportWrap.getBoundingClientRect();
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const availableWidth = Math.max(1, rect.width - padding * 2);
    const availableHeight = Math.max(1, rect.height - padding * 2);
    const scale = Math.min(availableWidth / width, availableHeight / height, 8);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;

    state.view = {
      scale,
      originX: rect.width / 2 - centerX * scale,
      originY: rect.height / 2 - centerY * scale,
    };
    state.cameraMode = "part";
    updateZoomOutput();
    render();
  }

  function fitDocumentView() {
    if (!state.documentWidth || !state.documentHeight) return;
    const rect = elements.viewportWrap.getBoundingClientRect();
    state.view = createViewTransform(
      rect.width,
      rect.height,
      state.documentWidth,
      state.documentHeight,
    );
    state.cameraMode = "all";
    updateZoomOutput();
    render();
  }

  function fitSelectedPartView() {
    fitBoundsView(selectedNodeDocumentBounds());
  }

  function zoomAtScreenPoint(screenX, screenY, factor) {
    if (!state.view) return;
    const before = screenToImage(screenX, screenY, state.view);
    const nextScale = Math.min(10, Math.max(0.03, state.view.scale * factor));
    state.view.scale = nextScale;
    state.view.originX = screenX - before.x * nextScale;
    state.view.originY = screenY - before.y * nextScale;
    state.cameraMode = "manual";
    updateZoomOutput();
    render();
  }

  function panViewBy(deltaX, deltaY) {
    if (!state.view) return;
    state.view.originX += deltaX;
    state.view.originY += deltaY;
    state.cameraMode = "manual";
    updateZoomOutput();
    render();
  }

  function resizeCanvases() {
    const rect = elements.viewportWrap.getBoundingClientRect();
    const ratio = pixelRatio();
    for (const canvas of [
      elements.backgroundBelowCanvas,
      elements.glCanvas,
      elements.foregroundCanvas,
      elements.overlayCanvas,
    ]) {
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    if (state.documentWidth && state.documentHeight) {
      const selectedBounds = state.cameraMode === "part"
        ? selectedNodeDocumentBounds()
        : null;
      if (selectedBounds) {
        fitBoundsView(selectedBounds);
        return;
      }
      if (state.cameraMode !== "manual") {
        state.view = createViewTransform(
          rect.width,
          rect.height,
          state.documentWidth,
          state.documentHeight,
        );
      }
    }
    updateZoomOutput();
    render();
  }

  return Object.freeze({
    fitDocumentView,
    fitSelectedPartView,
    panViewBy,
    resizeCanvases,
    selectedNodeDocumentBounds,
    updateZoomOutput,
    zoomAtScreenPoint,
  });
}
