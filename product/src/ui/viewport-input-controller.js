import { getDeformedVertices, screenToImage } from "../mesh.js";
import { nearestDeformerControlPoint, unprojectDeformerDocumentPoint } from "./deformer-viewport-overlay.js";
import { createBoneAuthoringSpace, nearestBoneHandle } from "./bone-viewport-overlay.js";
import { hitTwoBoneIkTarget } from "./two-bone-ik-viewport-overlay.js";
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
  meshContext = endpointMesh,
  meshTools = () => null,
  correspondencePreview = () => null,
  deformerAuthoring = () => null,
  boneAuthoring = () => null,
  weightAuthoring = () => null,
  formCorrectionAuthoring = () => null,
  twoBoneIkAuthoring = () => null,
  loadFile,
  windowTarget = window,
}) {
  let deformerGesture = null;
  let boneGesture = null;
  let weightGesture = null;
  let formGesture = null;
  let ikGesture = null;
  function angleDelta(from, to) {
    const fullTurn = Math.PI * 2;
    let delta = (to - from) % fullTurn;
    if (delta > Math.PI) delta -= fullTurn;
    if (delta < -Math.PI) delta += fullTurn;
    return delta;
  }
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

  function screenToActiveDeformer(screenPoint) {
    const authoring = deformerAuthoring();
    const authoringState = authoring?.getState();
    if (!authoringState?.available || !authoringState.activeKeyArt) return null;
    const documentPoint = screenToImage(screenPoint.x, screenPoint.y, state.view);
    return unprojectDeformerDocumentPoint({
      project: state.editor.session.project,
      deformer: authoringState.deformer,
      keyArtId: authoringState.activeKeyArt.id,
      documentPoint,
    }).point;
  }

  function nearestVertex(screenPoint, radius = 12) {
    if (!state.mesh) return -1;
    // Weight and Form Correction are drawn from the canonical endpoint
    // evaluation (Warp -> Bone/Skin -> Form Correction). Hit testing must use
    // that same transient display geometry, while the index still resolves
    // through the stable MeshTopology vertex ID below.
    const displayed = [EDITOR_MODES.WEIGHT, EDITOR_MODES.FORM_CORRECTION]
      .includes(state.editorMode)
      ? viewportRenderer.evaluatedMeshPositions?.()
      : null;
    const vertices = displayed?.length === state.mesh.baseVertices.length
      ? displayed
      : getDeformedVertices(state.mesh);
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

  function beginDeformerGesture(event, screenPoint) {
    const deformer = deformerAuthoring();
    const deformerState = deformer?.getState();
    if (!deformerState?.available || !deformerState.activeKeyArt) return false;
    const pickedControlPointId = nearestDeformerControlPoint(
      viewportRenderer.projectedDeformerLattice(),
      screenPoint,
    );
    const localPoint = screenToActiveDeformer(screenPoint);
    if (pickedControlPointId) {
      if (!localPoint) return false;
      deformer.selectControlPoint(pickedControlPointId, {
        additive: event.shiftKey,
        toggle: event.shiftKey,
      });
      if (deformer.getState().selectedControlPointIds.length) {
        deformer.beginDrag();
        deformerGesture = { kind: "drag", pointerId: event.pointerId, start: localPoint };
      }
    } else {
      deformer.beginBoxSelection(screenPoint, "screen");
      deformerGesture = {
        kind: "box", pointerId: event.pointerId, start: screenPoint, additive: event.shiftKey,
      };
    }
    elements.overlayCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    render();
    return true;
  }

  function beginBoneGesture(event, screenPoint) {
    const authoring = boneAuthoring();
    const authoringState = authoring?.getState();
    if (!authoringState?.selectedBoneId) return false;
    const picked = nearestBoneHandle(viewportRenderer.projectedBoneOverlay(), screenPoint);
    if (!picked) return false;
    if (authoringState.mode === "pose" && !authoringState.activeKeyArt) {
      setStatus("Bone Poseにはactive Key Artを明示的に選択してください");
      return true;
    }
    if (picked.boneId !== authoringState.selectedBoneId) {
      state.editor.selectNode(picked.boneId);
    }
    const overlay = viewportRenderer.projectedBoneOverlay();
    const bone = overlay.bones.find((entry) => entry.boneId === picked.boneId);
    const selectedState = authoring.getState();
    const current = selectedState.editableValue;
    if (!bone || !current) return false;
    const documentPoint = screenToImage(screenPoint.x, screenPoint.y, state.view);
    const head = screenToImage(bone.head.x, bone.head.y, state.view);
    const kind = picked.kind === "tip" && selectedState.mode === "edit"
      ? "length" : picked.kind === "head" ? "translate" : "rotation";
    const space = createBoneAuthoringSpace({
      project: state.editor.session.project,
      authoring: selectedState,
      boneId: picked.boneId,
    });
    if (!space.toLocal) {
      const diagnostic = space.diagnostics[0];
      setStatus(`${diagnostic?.code ? `${diagnostic.code}: ` : ""}${
        diagnostic?.message || "Bone authoring space could not be resolved."
      }`);
      return true;
    }
    const localPoint = space.toLocal(documentPoint);
    const localHead = space.toLocal(head);
    authoring.beginGesture();
    boneGesture = {
      pointerId: event.pointerId,
      kind,
      initial: current,
      toLocal: space.toLocal,
      start: localPoint,
      head: localHead,
      startAngle: Math.atan2(localPoint.y - localHead.y, localPoint.x - localHead.x),
    };
    elements.overlayCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    render();
    return true;
  }

  function beginIkGesture(event, screenPoint) {
    if (state.editorMode !== EDITOR_MODES.IK) return false;
    const authoring = twoBoneIkAuthoring();
    const overlay = viewportRenderer.projectedTwoBoneIkOverlay();
    if (!authoring || !hitTwoBoneIkTarget(overlay, screenPoint)) return false;
    try {
      authoring.beginTargetDrag(overlay.target.document);
      ikGesture = { pointerId: event.pointerId };
      elements.overlayCanvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      render();
    } catch (error) {
      setStatus(error.message || String(error));
    }
    return true;
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

    if (route === "object" && state.editor && beginIkGesture(event, screenPoint)) return;

    if (route === "object" && state.editor && state.editorMode !== EDITOR_MODES.IK &&
      beginBoneGesture(event, screenPoint)) return;

    if (["object", "mesh"].includes(route) && state.editor &&
      beginDeformerGesture(event, screenPoint)) return;

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
      if (state.editorMode === EDITOR_MODES.OBJECT && selectedNodeId && pickedInsideSelection) {
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

    const correspondence = correspondencePreview();
    const correspondenceState = correspondence?.getState();
    if (correspondenceState?.pendingVertexId) {
      try {
        const local = endpointMesh().screenToEndpointKeyformLocal(
          correspondenceState.targetEndpoint,
          screenPoint,
          state.view,
        );
        correspondence.placePendingPin(local);
        setStatus(`${correspondenceState.pendingVertexId} のtarget anchorを追加しました`);
      } catch (error) {
        setStatus(`${error.code ? `${error.code}: ` : ""}${error.message || String(error)}`);
      }
      render();
      return;
    }

    if (state.editor?.transitionPreview?.getState().viewMode === "preview" ||
      correspondenceState?.previewActive) {
      setStatus(correspondenceState?.previewActive
        ? "Correspondence Previewはread-onlyです。ApplyまたはCancelしてください。"
        : "Preview中間状態はread-onlyです。Key State markerを選んでendpointを編集してください。");
      return;
    }

    const vertexIndex = nearestVertex(screenPoint);
    const tools = meshContext()?.getState().editingEnabled ? meshTools() : null;
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
    const topology = tools?.activeTopology();
    const vertexId = topology?.vertexIds?.[vertexIndex] || null;
    if (state.editorMode === EDITOR_MODES.WEIGHT) {
      const authoring = weightAuthoring();
      try {
        authoring.setSelectedVertex(vertexId);
        authoring.beginStroke();
        authoring.previewStroke([vertexId]);
        weightGesture = { pointerId: event.pointerId };
        elements.overlayCanvas.setPointerCapture(event.pointerId);
      } catch (error) { setStatus(error.message || String(error)); }
      render();
      return;
    }
    if (state.editorMode === EDITOR_MODES.FORM_CORRECTION) {
      const authoring = formCorrectionAuthoring();
      try {
        authoring.selectVertex(vertexId, event.shiftKey);
        authoring.beginGesture();
        formGesture = { pointerId: event.pointerId, start: screenToPart(screenPoint) };
        elements.overlayCanvas.setPointerCapture(event.pointerId);
      } catch (error) { setStatus(error.message || String(error)); }
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

    const deformer = deformerAuthoring();
    const bone = boneAuthoring();
    if (ikGesture?.pointerId === event.pointerId) {
      const target = screenToImage(screenPoint.x, screenPoint.y, state.view);
      try { twoBoneIkAuthoring().previewTarget(target); }
      catch (error) { setStatus(error.message || String(error)); }
      render();
      return;
    }
    if (weightGesture?.pointerId === event.pointerId) {
      const index = nearestVertex(screenPoint);
      const topology = meshTools()?.activeTopology();
      const vertexId = topology?.vertexIds?.[index];
      if (vertexId) {
        try { weightAuthoring().previewStroke([vertexId]); }
        catch (error) { setStatus(error.message || String(error)); }
      }
      render();
      return;
    }
    if (formGesture?.pointerId === event.pointerId) {
      const point = screenToPart(screenPoint);
      try { formCorrectionAuthoring().previewGesture({
        x: point.x - formGesture.start.x,
        y: point.y - formGesture.start.y,
      }); } catch (error) { setStatus(error.message || String(error)); }
      render();
      return;
    }
    if (boneGesture?.pointerId === event.pointerId) {
      const documentPoint = screenToImage(screenPoint.x, screenPoint.y, state.view);
      try {
        const localPoint = boneGesture.toLocal(documentPoint);
        if (boneGesture.kind === "translate") bone.previewGesture({
          x: boneGesture.initial.x + localPoint.x - boneGesture.start.x,
          y: boneGesture.initial.y + localPoint.y - boneGesture.start.y,
        });
        else if (boneGesture.kind === "length") bone.previewGesture({
          length: Math.max(0.001, Math.hypot(
            localPoint.x - boneGesture.head.x,
            localPoint.y - boneGesture.head.y,
          )),
        });
        else {
          const angle = Math.atan2(
            localPoint.y - boneGesture.head.y,
            localPoint.x - boneGesture.head.x,
          );
          bone.previewGesture({
            rotation: boneGesture.initial.rotation + angleDelta(boneGesture.startAngle, angle),
          });
        }
      } catch (error) {
        setStatus(`${error.code ? `${error.code}: ` : ""}${error.message || String(error)}`);
      }
      render();
      return;
    }
    if (deformerGesture?.pointerId === event.pointerId) {
      const localPoint = screenToActiveDeformer(screenPoint);
      if (deformerGesture.kind === "drag") {
        if (!localPoint) return;
        deformer.previewDrag({
          x: localPoint.x - deformerGesture.start.x,
          y: localPoint.y - deformerGesture.start.y,
        });
      } else deformer.previewBoxSelection(screenPoint);
      render();
      return;
    }
    if (deformer?.getState().available) {
      deformer.setHover(nearestDeformerControlPoint(
        viewportRenderer.projectedDeformerLattice(),
        screenPoint,
      ));
    }
    if (bone?.getState().selectedBoneId) {
      bone.setHover(nearestBoneHandle(
        viewportRenderer.projectedBoneOverlay(), screenPoint,
      )?.boneId || null);
    }

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
    if (ikGesture?.pointerId === event.pointerId) {
      const authoring = twoBoneIkAuthoring();
      if (event.type === "pointercancel") authoring.cancelTargetDrag();
      else {
        authoring.commitTargetDrag();
        setStatus("IK solveをroot/mid Bone poseへ1件のUndo履歴としてbakeしました");
      }
      ikGesture = null;
      render();
      return;
    }
    if (weightGesture?.pointerId === event.pointerId) {
      const authoring = weightAuthoring();
      if (event.type === "pointercancel") authoring.cancelStroke();
      else {
        authoring.commitStroke();
        setStatus("Weight strokeを1件のUndo履歴として適用しました");
      }
      weightGesture = null;
      render();
      return;
    }
    if (formGesture?.pointerId === event.pointerId) {
      const authoring = formCorrectionAuthoring();
      if (event.type === "pointercancel") authoring.cancelGesture();
      else {
        authoring.commitGesture();
        setStatus("Form Correctionを1件のUndo履歴として適用しました");
      }
      formGesture = null;
      render();
      return;
    }
    if (boneGesture?.pointerId === event.pointerId) {
      const bone = boneAuthoring();
      if (event.type === "pointercancel") bone.cancelGesture();
      else {
        bone.commitGesture();
        setStatus("Bone操作を1件のUndo履歴として適用しました");
      }
      boneGesture = null;
      render();
      return;
    }
    if (deformerGesture?.pointerId === event.pointerId) {
      const deformer = deformerAuthoring();
      if (event.type === "pointercancel") {
        if (deformerGesture.kind === "drag") deformer.cancelDrag();
        else deformer.clearWorkspace();
      } else if (deformerGesture.kind === "drag") {
        deformer.commitDrag();
        setStatus("Warp操作を1件のUndo履歴として適用しました");
      } else {
        const points = viewportRenderer.projectedDeformerLattice().points.map((point) => ({
          controlPointId: point.controlPointId,
          x: point.screen.x,
          y: point.screen.y,
        }));
        deformer.commitBoxSelection({ additive: deformerGesture.additive, points });
        setStatus("Warp control pointsを範囲選択しました");
      }
      deformerGesture = null;
      render();
      return;
    }
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
