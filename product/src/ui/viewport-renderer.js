import { getDeformedVertices, imageToScreen } from "../mesh.js";
import { sampleLoop } from "../animation.js";
import { transformPoint } from "../core/transforms.js";
import { EDITOR_MODES, isMeshAuthoringMode } from "./editor-modes.js";
import { renderEvaluatedComposition } from "../core/shared-composition-renderer.js";
import { projectDeformerLattice } from "./deformer-viewport-overlay.js";
import { projectBoneOverlay } from "./bone-viewport-overlay.js";
import { projectWeightOverlay } from "./weight-viewport-overlay.js";
import { evaluateMeshFormCorrection } from "../core/mesh-form-correction-evaluator.js";
import { projectTwoBoneIkOverlay } from "./two-bone-ik-viewport-overlay.js";

export function renderEvaluatedViewport({
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

export const renderEvaluatedTransitionViewport = renderEvaluatedViewport;

export function clearLayerCanvas(canvas) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

export function createViewportDocumentRenderTarget({
  view,
  documentWidth,
  documentHeight,
  viewportWidth,
  viewportHeight,
}) {
  if (!view) return null;
  const target = { ...view };
  if (Number.isFinite(viewportWidth) && viewportWidth > 0) {
    target.viewportWidth = viewportWidth;
  }
  if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
    target.viewportHeight = viewportHeight;
  }
  if (Number.isFinite(documentWidth) && documentWidth > 0 &&
    Number.isFinite(documentHeight) && documentHeight > 0 &&
    Number.isFinite(view.scale) && view.scale > 0) {
    target.clipRect = {
      x: view.originX,
      y: view.originY,
      width: documentWidth * view.scale,
      height: documentHeight * view.scale,
    };
  }
  return target;
}

export function clipCanvasContextToRenderTarget(context, renderTarget) {
  const clip = renderTarget?.clipRect;
  if (!clip) return false;
  context.beginPath();
  context.rect(clip.x, clip.y, clip.width, clip.height);
  context.clip();
  return true;
}

export function clippingMaskOverlayTriangles(evaluation, targetNodeId, view) {
  if (!evaluation || !targetNodeId || !view) return [];
  const instances = (evaluation.evaluatedParts || [])
    .flatMap((part) => part.renderInstances || [])
    .sort((left, right) => left.renderInstanceId.localeCompare(right.renderInstanceId));
  const byId = new Map(instances.map((instance) => [instance.renderInstanceId, instance]));
  const result = [];
  for (const target of instances.filter((instance) =>
    instance.sourceNodeId === targetNodeId && instance.clipping?.sourceRenderInstanceId)) {
    const source = byId.get(target.clipping.sourceRenderInstanceId);
    if (!source) continue;
    for (let index = 0; index < source.mesh.indices.length; index += 3) {
      result.push(source.mesh.indices.slice(index, index + 3).map((vertexIndex) => {
        const documentPoint = transformPoint(source.transform, {
          x: source.mesh.positions[vertexIndex * 2],
          y: source.mesh.positions[vertexIndex * 2 + 1],
        });
        return imageToScreen(documentPoint.x, documentPoint.y, view);
      }));
    }
  }
  return result;
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
  clippingAuthoringContext = () => null,
  deformerAuthoringContext = () => null,
  boneAuthoringContext = () => null,
  weightAuthoringContext = () => null,
  formCorrectionAuthoringContext = () => null,
  twoBoneIkAuthoringContext = () => null,
}) {
  // This is deliberately viewport-transient. Weight/Form Correction pointer
  // input uses it only to pick the stable vertex corresponding to what is
  // currently drawn; evaluated positions never enter Project state.
  let evaluatedMeshPositions = new Float32Array();

  function viewportRenderTarget() {
    return createViewportDocumentRenderTarget({
      view: state.view,
      documentWidth: state.documentWidth,
      documentHeight: state.documentHeight,
      viewportWidth: elements.glCanvas.clientWidth,
      viewportHeight: elements.glCanvas.clientHeight,
    });
  }

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

    let weightByVertex = new Map();
    if (state.editorMode === EDITOR_MODES.WEIGHT) {
      const authoring = weightAuthoringContext();
      const endpoint = endpointContext();
      if (authoring?.activeBindingId && authoring.activeBoneId && endpoint?.topology) {
        const binding = state.editor.session.query("skin.get_binding", {
          bindingId: authoring.activeBindingId,
        });
        const preview = new Map(authoring.previewVertexWeights.map((entry) =>
          [entry.vertexId, entry]));
        const projected = projectWeightOverlay({
          topology: endpoint.topology,
          positions: vertices,
          binding: { ...binding, vertexWeights: binding.vertexWeights.map((entry) =>
            preview.get(entry.vertexId) || entry) },
          boneId: authoring.activeBoneId,
          view: { originX: 0, originY: 0, scale: 1 },
        });
        weightByVertex = new Map(projected.vertices.map((entry) => [entry.vertexId, entry]));
      }
    }
    const endpointForVertices = endpointContext();
    for (let index = 0; index < vertices.length / 2; index += 1) {
      const point = screenPointForPart(vertices[index * 2], vertices[index * 2 + 1]);
      const vertexId = endpointForVertices?.topology?.vertexIds?.[index];
      const weight = weightByVertex.get(vertexId);
      context.beginPath();
      context.arc(point.x, point.y, state.selected.has(index) ? 5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = state.selected.has(index) ? "#ffca67" : weight?.color || "#eafdf9";
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
        : state.editorMode === EDITOR_MODES.WEIGHT
          ? "WEIGHT AUTHORING"
          : state.editorMode === EDITOR_MODES.FORM_CORRECTION
            ? "FORM CORRECTION"
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
      state.editor?.selectedNode()?.kind === "bone" ||
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

    const renderTarget = viewportRenderTarget();
    below.save();
    above.save();
    clipCanvasContextToRenderTarget(below, renderTarget);
    clipCanvasContextToRenderTarget(above, renderTarget);

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
    below.restore();
    above.restore();
  }

  function drawClippingMaskVisualization(evaluation) {
    const clipping = clippingAuthoringContext();
    if (!clipping?.showMask || !clipping.targetNodeId) return;
    const triangles = clippingMaskOverlayTriangles(
      evaluation,
      clipping.targetNodeId,
      state.view,
    );
    if (!triangles.length) return;
    const context = elements.overlayCanvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "rgba(74, 222, 200, 0.22)";
    context.strokeStyle = "rgba(129, 255, 232, 0.9)";
    context.lineWidth = 1.5;
    for (const triangle of triangles) {
      context.beginPath();
      context.moveTo(triangle[0].x, triangle[0].y);
      context.lineTo(triangle[1].x, triangle[1].y);
      context.lineTo(triangle[2].x, triangle[2].y);
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  function drawDeformerOverlay() {
    const authoring = deformerAuthoringContext();
    if (!authoring?.available || !authoring.activeKeyArt || !state.view) return;
    const projected = projectDeformerLattice({
      project: state.editor.session.project,
      deformer: authoring.deformer,
      keyArtId: authoring.activeKeyArt.id,
      controlPoints: authoring.controlPoints,
      view: state.view,
    });
    if (!projected.points.length) return;
    const selected = new Set(authoring.selectedControlPointIds);
    const context = elements.overlayCanvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(91, 224, 255, .86)";
    context.beginPath();
    for (const [from, to] of projected.segments) {
      context.moveTo(projected.points[from].screen.x, projected.points[from].screen.y);
      context.lineTo(projected.points[to].screen.x, projected.points[to].screen.y);
    }
    context.stroke();
    for (const point of projected.points) {
      const active = selected.has(point.controlPointId);
      const hovered = authoring.hoverControlPointId === point.controlPointId;
      context.beginPath();
      context.arc(point.screen.x, point.screen.y, active ? 6 : hovered ? 5 : 4, 0, Math.PI * 2);
      context.fillStyle = active ? "#ffca67" : hovered ? "#b9fff2" : "#5be0ff";
      context.fill();
      context.strokeStyle = active ? "#4f3412" : "#123d43";
      context.stroke();
    }
    if (authoring.boxSelection) {
      let from = authoring.boxSelection.from;
      let to = authoring.boxSelection.to;
      if (authoring.boxSelection.coordinateSpace !== "screen") {
        const world = state.editor.worldTransform(authoring.deformer.id);
        const fromDocument = transformPoint(world, from);
        const toDocument = transformPoint(world, to);
        from = imageToScreen(fromDocument.x, fromDocument.y, state.view);
        to = imageToScreen(toDocument.x, toDocument.y, state.view);
      }
      context.setLineDash([4, 3]);
      context.strokeStyle = "rgba(255, 202, 103, .9)";
      context.fillStyle = "rgba(255, 202, 103, .12)";
      context.fillRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      context.strokeRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      context.setLineDash([]);
    }
    context.fillStyle = "rgba(12, 26, 25, .9)";
    context.fillRect(14, 14, 270, 28);
    context.fillStyle = "#5be0ff";
    context.font = "700 12px ui-monospace, monospace";
    context.fillText(
      `WARP · KEY ART ${authoring.activeKeyArt.endpoint === "from" ? "A" : "B"} · ${authoring.activeKeyArt.displayName}`,
      24,
      33,
    );
    context.restore();
  }

  function projectedBones() {
    const authoring = boneAuthoringContext();
    return authoring?.selectedBoneId && state.view
      ? projectBoneOverlay({
        project: state.editor.session.project,
        authoring,
        view: state.view,
      })
      : { bones: [], ghosts: [], diagnostics: [] };
  }

  function drawBoneOverlay() {
    const authoring = boneAuthoringContext();
    if (!authoring?.selectedBoneId || !state.view) return;
    const projected = projectedBones();
    const context = elements.overlayCanvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgba(174, 198, 218, .45)";
    for (const ghost of projected.ghosts) {
      context.beginPath();
      context.moveTo(ghost.head.x, ghost.head.y);
      context.lineTo(ghost.tip.x, ghost.tip.y);
      context.stroke();
    }
    context.setLineDash([]);
    for (const bone of projected.bones) {
      if (bone.parentLink) {
        context.beginPath();
        context.moveTo(bone.parentLink.from.x, bone.parentLink.from.y);
        context.lineTo(bone.parentLink.to.x, bone.parentLink.to.y);
        context.strokeStyle = "rgba(91, 224, 255, .42)";
        context.lineWidth = 1.25;
        context.stroke();
      }
      context.beginPath();
      context.moveTo(bone.body[0].x, bone.body[0].y);
      bone.body.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.fillStyle = bone.selected
        ? "rgba(255, 202, 103, .42)" : bone.hovered
          ? "rgba(185, 255, 242, .35)" : "rgba(91, 224, 255, .24)";
      context.strokeStyle = bone.selected ? "#ffca67" : "#5be0ff";
      context.lineWidth = bone.selected ? 2 : 1.5;
      context.fill();
      context.stroke();
      for (const point of [bone.head, bone.tip]) {
        context.beginPath();
        context.arc(point.x, point.y, bone.selected ? 5 : 3.5, 0, Math.PI * 2);
        context.fillStyle = bone.selected ? "#ffca67" : "#eafdf9";
        context.fill();
        context.stroke();
      }
      if (bone.selected) {
        context.beginPath();
        context.moveTo(bone.head.x, bone.head.y);
        context.lineTo(bone.rotationHandle.x, bone.rotationHandle.y);
        context.strokeStyle = "rgba(255, 202, 103, .72)";
        context.stroke();
        context.beginPath();
        context.arc(bone.rotationHandle.x, bone.rotationHandle.y, 5, 0, Math.PI * 2);
        context.fillStyle = "#ffca67";
        context.fill();
        context.stroke();
      }
    }
    context.fillStyle = "rgba(12, 26, 25, .9)";
    context.fillRect(14, 14, 270, 28);
    context.fillStyle = authoring.mode === "pose" ? "#ffca67" : "#5be0ff";
    context.font = "700 12px ui-monospace, monospace";
    context.fillText(
      `BONE ${authoring.mode === "pose" ? "POSE" : "EDIT"} · ${authoring.activeKeyArt?.displayName || "NO KEY ART"}`,
      24,
      33,
    );
    context.restore();
  }

  function projectedIk() {
    const authoring = twoBoneIkAuthoringContext();
    if (state.editorMode !== EDITOR_MODES.IK || !authoring?.activeConstraintId ||
      !authoring.activeKeyArtId || !state.view) {
      return { joints: [], segments: [], target: null, diagnostics: [] };
    }
    const projected = state.editor.session.query("bone.get_two_bone_ik_pose", {
      constraintId: authoring.activeConstraintId,
      keyArtId: authoring.activeKeyArtId,
    });
    return projectTwoBoneIkOverlay({
      authoring,
      chain: projected.chain,
      view: state.view,
    });
  }

  function drawIkOverlay() {
    const overlay = projectedIk();
    if (!overlay.target) return;
    const context = elements.overlayCanvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.strokeStyle = "#ffca67";
    context.lineWidth = 3;
    for (const segment of overlay.segments) {
      context.beginPath();
      context.moveTo(segment.from.x, segment.from.y);
      context.lineTo(segment.to.x, segment.to.y);
      context.stroke();
    }
    for (const joint of overlay.joints) {
      context.beginPath();
      context.arc(joint.screen.x, joint.screen.y, joint.kind === "mid" ? 5 : 4, 0, Math.PI * 2);
      context.fillStyle = joint.kind === "mid" ? "#5be0ff" : "#eafdf9";
      context.fill();
      context.stroke();
    }
    const target = overlay.target.screen;
    context.beginPath();
    context.arc(target.x, target.y, 8, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 202, 103, .24)";
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(target.x - 12, target.y);
    context.lineTo(target.x + 12, target.y);
    context.moveTo(target.x, target.y - 12);
    context.lineTo(target.x, target.y + 12);
    context.stroke();
    context.fillStyle = "rgba(12, 26, 25, .9)";
    context.fillRect(14, 14, 270, 28);
    context.fillStyle = "#ffca67";
    context.font = "700 12px ui-monospace, monospace";
    context.fillText("TWO-BONE IK · DRAG TARGET", 24, 33);
    context.restore();
  }

  function render() {
    const transitionPreview = transitionPreviewContext();
    if (transitionPreview?.viewMode === "preview") {
      evaluatedMeshPositions = new Float32Array();
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
        view: viewportRenderTarget(),
        renderer,
        resolveArtwork,
      });
      state.editor?.transitionPreview.setRenderReport(report);
      drawClippingMaskVisualization(transitionPreview.evaluation);
      return;
    }
    drawPsdBackgrounds();
    if (!state.mesh || !state.view) {
      evaluatedMeshPositions = new Float32Array();
      renderer.render(
        new Float32Array(),
        state.view
          ? viewportRenderTarget()
          : { originX: 0, originY: 0, scale: 1 },
        { x: 0, y: 0 },
      );
      drawOverlay(new Float32Array());
      drawDeformerOverlay();
      drawBoneOverlay();
      drawIkOverlay();
      drawTransformGizmo();
      return;
    }
    const previewOffsets = state.previewMode && state.keyframes.a && state.keyframes.b
      ? sampleLoop(state.keyframes.a, state.keyframes.b, state.currentTime, duration())
      : state.mesh.vertexOffsets;
    const correspondence = correspondencePreviewContext();
    let vertices = correspondence?.previewActive
      ? new Float32Array(correspondence.candidatePositions)
      : getDeformedVertices(state.mesh, previewOffsets);
    if ([EDITOR_MODES.WEIGHT, EDITOR_MODES.FORM_CORRECTION].includes(state.editorMode)) {
      const endpoint = endpointContext();
      const transition = state.editor?.transitionAuthoring.activeTransition();
      const program = transition
        ? state.editor.session.query("animation.get_program", {
          programId: transition.temporalProgramId,
        }) : null;
      const evaluation = transition && endpoint
        ? state.editor.session.query("transition.evaluate", {
          transitionId: transition.id,
          timeTicks: endpoint.endpoint === "from" ? 0 : program.durationTicks,
        }) : null;
      const evaluatedInstance = evaluation?.evaluatedParts
        .find((entry) => entry.semanticSlotId === endpoint?.semanticSlotId)
        ?.renderInstances.find((entry) => entry.sourceNodeId === endpoint.nodeId);
      if (evaluatedInstance?.mesh.positions.length === vertices.length) {
        vertices = new Float32Array(evaluatedInstance.mesh.positions);
      }
    }
    if (state.editorMode === EDITOR_MODES.FORM_CORRECTION) {
      const endpoint = endpointContext();
      const authoring = formCorrectionAuthoringContext();
      if (endpoint?.topology && authoring?.keyArtId && authoring.gestureActive) {
        const persistent = state.editor.session.query("mesh_form.get_for_context", {
          topologyId: authoring.topologyId,
          keyArtId: authoring.keyArtId,
          semanticSlotId: authoring.semanticSlotId,
        });
        const before = new Map((persistent?.vertexOffsets || []).map((entry) => [entry.vertexId, entry]));
        const after = new Map(authoring.previewVertexOffsets.map((entry) => [entry.vertexId, entry]));
        const vertexOffsets = [...new Set([...before.keys(), ...after.keys()])]
          .map((vertexId) => ({
            vertexId,
            x: (after.get(vertexId)?.x || 0) - (before.get(vertexId)?.x || 0),
            y: (after.get(vertexId)?.y || 0) - (before.get(vertexId)?.y || 0),
          }))
          .filter((entry) => entry.x !== 0 || entry.y !== 0);
        const keyform = { id: "transient", topologyId: authoring.topologyId,
          keyArtId: authoring.keyArtId, semanticSlotId: authoring.semanticSlotId,
          vertexOffsets };
        vertices = new Float32Array(evaluateMeshFormCorrection({
          mesh: { positions: [...vertices] }, topology: endpoint.topology, keyform,
        }).mesh.positions);
      }
    }
    const part = selectedPart();
    const world = part?.nodeId && state.editor
      ? state.editor.worldTransform(part.nodeId)
      : [1, 0, 0, 1, 0, 0];
    const visible = part?.nodeId && state.editor
      ? state.editor.getNode(part.nodeId).effectiveVisible
      : true;
    evaluatedMeshPositions = new Float32Array(vertices);
    renderer.render(vertices, viewportRenderTarget(), state.partOffset, world, visible);
    drawOverlay(visible ? vertices : new Float32Array());
    drawDeformerOverlay();
    drawBoneOverlay();
    drawIkOverlay();
    drawTransformGizmo();
  }

  return {
    render,
    screenPointForPart,
    evaluatedMeshPositions() {
      return evaluatedMeshPositions;
    },
    projectedDeformerLattice() {
      const authoring = deformerAuthoringContext();
      return authoring?.available && authoring.activeKeyArt && state.view
        ? projectDeformerLattice({
          project: state.editor.session.project,
          deformer: authoring.deformer,
          keyArtId: authoring.activeKeyArt.id,
          controlPoints: authoring.controlPoints,
          view: state.view,
        })
        : { points: [], segments: [], diagnostics: [] };
    },
    projectedBoneOverlay: projectedBones,
    projectedTwoBoneIkOverlay: projectedIk,
  };
}
