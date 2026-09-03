import { getDeformedVertices, screenToImage } from "../mesh.js";
import {
  createTransformGesture,
  pickNodeAtDocumentPoint,
  screenToMeshLocal,
} from "./canvas-interaction.js";
import {
  editorModeShortcutAction,
  projectHistoryShortcutAction,
} from "./editor-shortcuts.js";
import {
  canvasInteractionRoute,
  dragSelectedVertices,
  EDITOR_MODES,
  objectSelectionForMode,
  updateVertexSelection,
} from "./editor-modes.js";

export function bindViewportInteractions({
  state,
  elements,
  viewportRenderer,
  returnToEdit,
  zoomAtScreenPoint,
  panViewBy,
  setEditorMode,
  undoProject,
  redoProject,
  render,
  setStatus,
  selectedPart,
  endpointMesh = () => null,
  meshTools = () => null,
  loadFile,
  windowTarget = window,
}) {
  function pointerPosition(event) {
    const rect = elements.overlayCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function screenToPart(screenPoint) {
    const part = selectedPart();
    const worldTransform = state.mode === "psd" && part?.nodeId && state.editor
      ? state.editor.worldTransform(part.nodeId)
      : null;
    return screenToMeshLocal(screenPoint, state.view, {
      worldTransform,
      partOffset: state.partOffset,
    });
  }

  function nearestVertex(screenPoint, radius = 12) {
    if (!state.mesh) return -1;
    const vertices = getDeformedVertices(state.mesh);
    let nearest = -1;
    let nearestDistance = radius;
    for (let index = 0; index < vertices.length / 2; index += 1) {
      const point = viewportRenderer.screenPointForPart(
        vertices[index * 2],
        vertices[index * 2 + 1],
      );
      const distance = Math.hypot(point.x - screenPoint.x, point.y - screenPoint.y);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  elements.overlayCanvas.addEventListener("wheel", (event) => {
    if (!state.view) return;
    event.preventDefault();
    const point = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAtScreenPoint(point.x, point.y, factor);
  }, { passive: false });

  windowTarget.addEventListener("keydown", (event) => {
    const historyAction = projectHistoryShortcutAction(event);
    if (state.editor && historyAction) {
      event.preventDefault();
      if (historyAction === "redo") redoProject();
      else undoProject();
      return;
    }
    if (editorModeShortcutAction(event) && state.mode === "psd") {
      event.preventDefault();
      setEditorMode(state.editorMode === EDITOR_MODES.OBJECT
        ? EDITOR_MODES.DEFORM
        : EDITOR_MODES.OBJECT);
      return;
    }
    if (event.code === "Space" && !event.repeat) {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement;
      if (!editingText) {
        state.spacePressed = true;
        elements.viewportWrap.classList.add("pan-ready");
        event.preventDefault();
      }
    }
  });

  windowTarget.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      state.spacePressed = false;
      elements.viewportWrap.classList.remove("pan-ready");
    }
  });

  function handlePointerDown(event) {
    if (state.previewMode) returnToEdit();

    const screenPoint = pointerPosition(event);
    const route = canvasInteractionRoute({
      contentMode: state.mode,
      editorMode: state.editorMode,
      button: event.button,
      panRequested: state.spacePressed,
    });

    if (route === "pan") {
      state.pan = {
        pointerId: event.pointerId,
        last: screenPoint,
      };
      elements.overlayCanvas.setPointerCapture(event.pointerId);
      elements.viewportWrap.classList.add("panning");
      event.preventDefault();
      return;
    }

    if (route === "object" && state.editor) {
      const documentPoint = screenToImage(screenPoint.x, screenPoint.y, state.view);
      const pickedNodeId = pickNodeAtDocumentPoint(
        state.psdParts,
        state.editor,
        documentPoint,
      );
      const selectedNodeId = state.editor.selectedNodeId;
      const pickedInsideSelection = pickedNodeId && selectedNodeId &&
        state.editor.isDescendantOrSelf(pickedNodeId, selectedNodeId);
      if (selectedNodeId && pickedInsideSelection) {
        const node = state.editor.selectedNode();
        const drag = state.editor.beginTransformDrag(
          `${state.editor.activeTool} ${node.displayName}`,
        );
        if (drag) {
          state.transformGesture = {
            pointerId: event.pointerId,
            gesture: createTransformGesture(
              state.editor.session.project,
              node,
              state.editor.activeTool,
              documentPoint,
            ),
          };
          elements.overlayCanvas.setPointerCapture(event.pointerId);
          setStatus(`${node.displayName}・${state.editor.activeTool}中`);
        }
        return;
      }
      state.editor.selectNode(objectSelectionForMode(
        state.editorMode,
        state.editor.selectedNodeId,
        pickedNodeId,
      ));
      return;
    }

    if (route !== "mesh") return;

    const vertexIndex = nearestVertex(screenPoint);
    const tools = meshTools();
    state.selected = updateVertexSelection(
      state.selected,
      vertexIndex,
      event.shiftKey,
    );
    tools?.selectVertexByIndex(vertexIndex, event.shiftKey);
    if (vertexIndex < 0) {
      if (state.editorMode === EDITOR_MODES.TOPOLOGY &&
        tools?.activeToolId === "topology.add") {
        const partPoint = screenToPart(screenPoint);
        const part = selectedPart();
        const width = Math.max(1, part?.width || 1);
        const height = Math.max(1, part?.height || 1);
        try {
          tools.execute("topology.add", {
            position: partPoint,
            uv: {
              x: Math.min(1, Math.max(0, (partPoint.x - (part?.left || 0)) / width)),
              y: Math.min(1, Math.max(0, (partPoint.y - (part?.top || 0)) / height)),
            },
          });
          setStatus("共有MeshTopologyへvertexを追加し、全MeshKeyformを更新しました");
        } catch (error) {
          setStatus(error.message || String(error));
        }
      }
      render();
      return;
    }
    if (state.editorMode === EDITOR_MODES.TOPOLOGY) {
      render();
      return;
    }
    const partPoint = screenToPart(screenPoint);
    state.drag = { last: partPoint };
    elements.overlayCanvas.setPointerCapture(event.pointerId);
    render();
  }

  elements.overlayCanvas.addEventListener("pointerdown", handlePointerDown);

  elements.overlayCanvas.addEventListener("pointermove", (event) => {
    const screenPoint = pointerPosition(event);

    if (state.pan && state.pan.pointerId === event.pointerId) {
      panViewBy(
        screenPoint.x - state.pan.last.x,
        screenPoint.y - state.pan.last.y,
      );
      state.pan.last = screenPoint;
      return;
    }

    if (
      state.transformGesture?.pointerId === event.pointerId &&
      state.editor?.transformDrag
    ) {
      const documentPoint = screenToImage(screenPoint.x, screenPoint.y, state.view);
      state.editor.previewTransform(
        state.transformGesture.gesture.update(documentPoint),
      );
      return;
    }

    if (!state.drag || state.selected.size === 0) return;
    const partPoint = screenToPart(screenPoint);
    dragSelectedVertices(state.mesh, state.selected, state.drag.last, partPoint);
    state.drag.last = partPoint;
    render();
  });

  function endDrag(event) {
    if (state.drag) {
      const endpoint = endpointMesh();
      const tools = meshTools();
      if (endpoint?.getState().editingEnabled && endpoint.activeKeyform()) {
        if (event.type !== "pointercancel") {
          const positions = [...getDeformedVertices(state.mesh)];
          if (tools) tools.execute("deform.move", { positions });
          else endpoint.commitActiveMeshPositions(positions);
          setStatus(`${state.selected.size}頂点をendpoint MeshKeyformへ反映しました`);
        } else {
          state.mesh.vertexOffsets.fill(0);
          render();
        }
      } else setStatus(`${state.selected.size}頂点を変形中`);
    }
    if (state.transformGesture?.pointerId === event.pointerId) {
      state.transformGesture = null;
      if (event.type === "pointercancel") state.editor?.cancelTransformDrag();
      else {
        state.editor?.commitTransformDrag();
        setStatus("Gizmo操作を1件のUndo履歴として適用しました");
      }
    }
    state.drag = null;
    state.pan = null;
    elements.viewportWrap.classList.remove("panning");
  }
  elements.overlayCanvas.addEventListener("pointerup", endDrag);
  elements.overlayCanvas.addEventListener("pointercancel", endDrag);

  for (const type of ["dragenter", "dragover"]) {
    elements.viewportWrap.addEventListener(type, (event) => {
      event.preventDefault();
      elements.viewportWrap.classList.add("drag-over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    elements.viewportWrap.addEventListener(type, (event) => {
      event.preventDefault();
      elements.viewportWrap.classList.remove("drag-over");
    });
  }
  elements.viewportWrap.addEventListener("drop", (event) => {
    loadFile(event.dataTransfer.files?.[0]);
  });

  return { handlePointerDown, nearestVertex, screenToPart };
}
