import {
  clampGridSize,
  createViewTransform,
  findAlphaBounds,
  generateGridMesh,
  getDeformedVertices,
  imageToScreen,
  moveVertices,
  resetDeformation,
  screenToImage,
} from "./mesh.js";
import { captureOffsets, clampDuration, sampleLoop } from "./animation.js";
import { MeshRenderer } from "./renderer.js";
import { collectPsdParts } from "./psd.js";
import { createProjectFromPsd } from "./io/psd-project.js";
import { createIdFactory, createProject } from "./model/project.js";
import {
  createRecoveryStore,
  parseProjectDocument,
} from "./io/project-json.js";
import { ProjectDocumentController } from "./io/project-files.js";
import { createPsdReimportReview } from "./io/psd-reimport-review.js";
import {
  createAutosaveScheduler,
  createPreferencesStore,
} from "./preferences.js";
import { EditorSession } from "./commands/editor.js";
import {
  bindPsdPartsToProject,
  EditorUiAdapter,
} from "./ui/editor-adapter.js";
import {
  createTransformGesture,
  pickNodeAtDocumentPoint,
} from "./ui/canvas-interaction.js";
import { transformPoint } from "./core/transforms.js";
import {
  projectHistoryShortcutAction,
} from "./ui/editor-shortcuts.js";
import { createBrowserProjectWriter } from "./ui/browser-project-files.js";
import { ReimportRenderHistory } from "./ui/reimport-render-history.js";

const elements = {
  projectTitle: document.querySelector("#projectTitle"),
  fileMenu: document.querySelector("#fileMenu"),
  fileActions: [...document.querySelectorAll("[data-file-action]")],
  projectOpenInput: document.querySelector("#projectOpenInput"),
  reimportPsdInput: document.querySelector("#reimportPsdInput"),
  unsavedDialog: document.querySelector("#unsavedDialog"),
  recoveryDialog: document.querySelector("#recoveryDialog"),
  recoveryDialogMessage: document.querySelector("#recoveryDialogMessage"),
  preferencesDialog: document.querySelector("#preferencesDialog"),
  autosaveEnabledInput: document.querySelector("#autosaveEnabledInput"),
  autosaveIntervalInput: document.querySelector("#autosaveIntervalInput"),
  recoveryVersionsInput: document.querySelector("#recoveryVersionsInput"),
  incrementalWidthInput: document.querySelector("#incrementalWidthInput"),
  saveAfterMajorInput: document.querySelector("#saveAfterMajorInput"),
  recoveryNotificationInput: document.querySelector("#recoveryNotificationInput"),
  savePreferencesButton: document.querySelector("#savePreferencesButton"),
  reimportDialog: document.querySelector("#reimportDialog"),
  reimportTableBody: document.querySelector("#reimportTableBody"),
  reimportCurrentPreview: document.querySelector("#reimportCurrentPreview"),
  reimportNewPreview: document.querySelector("#reimportNewPreview"),
  reimportSummary: document.querySelector("#reimportSummary"),
  applyReimportButton: document.querySelector("#applyReimportButton"),
  fileInput: document.querySelector("#fileInput"),
  partInfo: document.querySelector("#partInfo"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  sceneSearchInput: document.querySelector("#sceneSearchInput"),
  sceneTree: document.querySelector("#sceneTree"),
  inspectorEmpty: document.querySelector("#inspectorEmpty"),
  inspectorForm: document.querySelector("#inspectorForm"),
  inspectorKind: document.querySelector("#inspectorKind"),
  displayNameInput: document.querySelector("#displayNameInput"),
  visibilityInput: document.querySelector("#visibilityInput"),
  lockedInput: document.querySelector("#lockedInput"),
  nodeIdOutput: document.querySelector("#nodeIdOutput"),
  parentOutput: document.querySelector("#parentOutput"),
  columnsInput: document.querySelector("#columnsInput"),
  rowsInput: document.querySelector("#rowsInput"),
  generateButton: document.querySelector("#generateButton"),
  resetButton: document.querySelector("#resetButton"),
  captureAButton: document.querySelector("#captureAButton"),
  captureBButton: document.querySelector("#captureBButton"),
  durationInput: document.querySelector("#durationInput"),
  timeSlider: document.querySelector("#timeSlider"),
  timeOutput: document.querySelector("#timeOutput"),
  playButton: document.querySelector("#playButton"),
  editButton: document.querySelector("#editButton"),
  keyframeStatus: document.querySelector("#keyframeStatus"),
  viewportWrap: document.querySelector("#viewportWrap"),
  backgroundBelowCanvas: document.querySelector("#backgroundBelowCanvas"),
  glCanvas: document.querySelector("#glCanvas"),
  foregroundCanvas: document.querySelector("#foregroundCanvas"),
  overlayCanvas: document.querySelector("#overlayCanvas"),
  emptyState: document.querySelector("#emptyState"),
  status: document.querySelector("#status"),
  fitAllButton: document.querySelector("#fitAllButton"),
  fitPartButton: document.querySelector("#fitPartButton"),
  zoomOutput: document.querySelector("#zoomOutput"),
  transformTools: [...document.querySelectorAll("[data-transform-tool]")],
  transformInputs: [...document.querySelectorAll("[data-transform-path]")],
};

const state = {
  mode: "empty",
  image: null,
  imageData: null,
  mesh: null,
  view: null,
  documentWidth: 0,
  documentHeight: 0,
  partOffset: { x: 0, y: 0 },
  psdParts: [],
  editor: null,
  transformGesture: null,
  selected: new Set(),
  drag: null,
  keyframes: { a: null, b: null },
  currentTime: 0,
  previewMode: false,
  playing: false,
  animationFrame: null,
  playbackStartedAt: 0,
  cameraMode: "all",
  pan: null,
  spacePressed: false,
  documentController: null,
  autosaveScheduler: null,
  reimportReview: null,
  reimportParts: [],
  selectedReimportRowId: null,
  renderAssetHistory: null,
  recoveryRestored: false,
};

const preferencesStore = createPreferencesStore(localStorage);
let preferences = preferencesStore.load();
let recoveryStore = createRecoveryStore(localStorage, {
  maxVersions: preferences.recoveryVersions,
});
const projectWriter = createBrowserProjectWriter();

let renderer;
try {
  renderer = new MeshRenderer(elements.glCanvas);
} catch (error) {
  elements.status.textContent = error.message;
  throw error;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function selectedPartIndex() {
  if (!state.editor?.selectedNodeId) return -1;
  return state.psdParts.findIndex(
    (part) => part.nodeId === state.editor.selectedNodeId,
  );
}

function selectedPart() {
  const index = selectedPartIndex();
  return index >= 0 ? state.psdParts[index] : null;
}

function updateZoomOutput() {
  const percent = state.view ? Math.round(state.view.scale * 100) : 100;
  elements.zoomOutput.textContent = `${percent}%`;
  elements.fitPartButton.disabled = !(
    state.mode === "psd" && state.editor?.selectedNodeId
  );
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

function fitBoundsView(bounds, padding = 110) {
  if (!bounds) return;
  const rect = elements.viewportWrap.getBoundingClientRect();
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, rect.width - padding * 2);
  const availableHeight = Math.max(1, rect.height - padding * 2);

  // Editing can zoom much closer than the whole-document fit.
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

function selectedPartDocumentBounds() {
  return selectedNodeDocumentBounds();
}

function selectedNodeDocumentBounds() {
  const selectedId = state.editor?.selectedNodeId;
  if (!selectedId) return null;
  const points = [];
  for (const part of state.psdParts) {
    if (
      !part.nodeId ||
      !state.editor.isDescendantOrSelf(part.nodeId, selectedId)
    ) continue;
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

function fitSelectedPartView() {
  const bounds = selectedPartDocumentBounds();
  if (!bounds) return;
  fitBoundsView(bounds);
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

function updateButtons() {
  const enabled = Boolean(state.image);
  elements.generateButton.disabled = !enabled;
  elements.resetButton.disabled = !state.mesh;
  elements.captureAButton.disabled = !state.mesh;
  elements.captureBButton.disabled = !state.mesh;
  const complete = Boolean(state.keyframes.a && state.keyframes.b);
  elements.playButton.disabled = !complete;
  elements.timeSlider.disabled = !complete;
  elements.editButton.disabled = !state.previewMode;
  elements.captureAButton.classList.toggle("recorded", Boolean(state.keyframes.a));
  elements.captureBButton.classList.toggle("recorded", Boolean(state.keyframes.b));
  elements.keyframeStatus.textContent = `A ${state.keyframes.a ? "●" : "―"}　B ${state.keyframes.b ? "●" : "―"}`;
  elements.playButton.textContent = state.playing ? "Ⅱ 一時停止" : "▶ プレビュー";
}

function duration() {
  return clampDuration(elements.durationInput.value);
}

function updateTimeDisplay() {
  elements.timeSlider.value = String(state.currentTime);
  elements.timeOutput.value = `${state.currentTime.toFixed(2)}s`;
  elements.timeOutput.textContent = `${state.currentTime.toFixed(2)}s`;
}

function stopPlayback() {
  state.playing = false;
  if (state.animationFrame !== null) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  updateButtons();
}

function returnToEdit() {
  stopPlayback();
  state.previewMode = false;
  state.currentTime = 0;
  updateTimeDisplay();
  updateButtons();
  render();
}

function clearKeyframes() {
  stopPlayback();
  state.keyframes = { a: null, b: null };
  state.previewMode = false;
  state.currentTime = 0;
  updateTimeDisplay();
}

function clearLayerCanvas(canvas) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

function resizeCanvases() {
  const rect = elements.viewportWrap.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  for (const canvas of [elements.backgroundBelowCanvas, elements.glCanvas, elements.foregroundCanvas, elements.overlayCanvas]) {
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }
  if (state.documentWidth && state.documentHeight) {
    if (state.cameraMode === "part" && selectedPartDocumentBounds()) {
      fitBoundsView(selectedPartDocumentBounds());
      return;
    }
    if (state.cameraMode !== "manual") {
      state.view = createViewTransform(rect.width, rect.height, state.documentWidth, state.documentHeight);
    }
  }
  updateZoomOutput();
  render();
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

  context.lineWidth = 1;
  context.strokeStyle = "rgba(129, 221, 205, 0.48)";
  context.beginPath();
  for (let index = 0; index < state.mesh.indices.length; index += 3) {
    const triangle = state.mesh.indices.slice(index, index + 3);
    triangle.forEach((vertexIndex, triangleIndex) => {
      const point = screenPointForPart(vertices[vertexIndex * 2], vertices[vertexIndex * 2 + 1]);
      if (triangleIndex === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    const firstIndex = triangle[0];
    const first = screenPointForPart(vertices[firstIndex * 2], vertices[firstIndex * 2 + 1]);
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
}

function drawTransformGizmo() {
  if (!state.editor?.selectedNodeId || !state.view) return;
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

  const selectedIndex = selectedPartIndex();
  for (let index = 0; index < state.psdParts.length; index += 1) {
    if (index === selectedIndex && state.mesh) continue;
    const target = selectedIndex >= 0 && index > selectedIndex ? above : below;
    drawPsdPart(target, state.psdParts[index]);
  }
}

function render() {
  drawPsdBackgrounds();
  if (!state.mesh || !state.view) {
    renderer.render(new Float32Array(), { originX: 0, originY: 0, scale: 1 }, { x: 0, y: 0 });
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

function createMesh() {
  if (!state.imageData || !state.image) return;
  const columns = clampGridSize(elements.columnsInput.value);
  const rows = clampGridSize(elements.rowsInput.value);
  elements.columnsInput.value = String(columns);
  elements.rowsInput.value = String(rows);
  const bounds = findAlphaBounds(state.imageData);
  if (!bounds) {
    setStatus("透明部分しかないパーツです");
    return;
  }
  state.mesh = generateGridMesh(bounds, state.image.width, state.image.height, columns, rows);
  state.selected.clear();
  clearKeyframes();
  renderer.setMesh(state.mesh);
  updateButtons();
  render();
  const count = state.mesh.baseVertices.length / 2;
  const part = selectedPart();
  const prefix = state.mode === "psd" && part
    ? `${part.name}・`
    : "";
  setStatus(`${prefix}${columns} × ${rows} グリッド・${count}頂点`);
}

function setEditableImage(image, documentWidth, documentHeight, offsetX = 0, offsetY = 0) {
  const contextCanvas = document.createElement("canvas");
  contextCanvas.width = image.width;
  contextCanvas.height = image.height;
  const context = contextCanvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  state.image = image;
  state.imageData = context.getImageData(0, 0, image.width, image.height);
  state.documentWidth = documentWidth;
  state.documentHeight = documentHeight;
  state.partOffset = { x: offsetX, y: offsetY };
  if (!state.view) {
    state.view = createViewTransform(
      elements.viewportWrap.clientWidth,
      elements.viewportWrap.clientHeight,
      documentWidth,
      documentHeight,
    );
  }
  renderer.setTexture(image);
}

function clearMeshEditing() {
  state.image = null;
  state.imageData = null;
  state.mesh = null;
  state.partOffset = { x: 0, y: 0 };
  state.selected.clear();
  clearKeyframes();
  renderer.clearMesh();
  updateButtons();
}

async function loadImage(source, label) {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("PNGを読み込めませんでした"));
  });
  image.src = source;
  await loaded;

  state.mode = "png";
  state.psdParts = [];
  state.autosaveScheduler?.stop();
  state.autosaveScheduler = null;
  state.documentController = null;
  state.renderAssetHistory = null;
  state.recoveryRestored = false;
  state.editor = null;
  elements.sceneSearchInput.value = "";
  renderEditorUi();
  elements.projectTitle.textContent = label;
  elements.partInfo.textContent = "単一PNGモード";
  clearLayerCanvas(elements.backgroundBelowCanvas);
  clearLayerCanvas(elements.foregroundCanvas);
  state.cameraMode = "all";
  state.view = null;
  setEditableImage(image, image.width, image.height);
  elements.emptyState.hidden = true;
  createMesh();
  setStatus(`${label}・${image.width} × ${image.height}px`);
}

function syncSelectedPsdPart() {
  clearMeshEditing();
  const part = selectedPart();
  if (!part?.canvas) {
    state.documentWidth ||= 1;
    state.documentHeight ||= 1;
    const node = state.editor?.selectedNode();
    elements.partInfo.textContent = node
      ? `${node.displayName}・${node.kind}`
      : `${state.psdParts.length} parts・全体表示`;
    render();
    return;
  }
  setEditableImage(part.canvas, state.documentWidth, state.documentHeight, part.left, part.top);
  elements.partInfo.textContent = `${part.name}・x ${part.left} / y ${part.top}・${part.width} × ${part.height}`;
  createMesh();
}

function renderSceneTree() {
  elements.sceneTree.replaceChildren();
  elements.sceneSearchInput.disabled = !state.editor;
  if (!state.editor) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "PSDを読み込むと階層を表示します";
    elements.sceneTree.append(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "tree-children";
  const filtered = Boolean(state.editor.filterText.trim());
  const appendNode = (node, parent, depth) => {
    const item = document.createElement("li");
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-selected", String(node.id === state.editor.selectedNodeId));
    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = `${depth * 13}px`;
    row.dataset.nodeId = node.id;
    if (node.id === state.editor.selectedNodeId) row.classList.add("selected");
    if (!node.effectiveVisible) row.classList.add("effectively-hidden");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle";
    toggle.textContent = node.kind === "group"
      ? (state.editor.expandedNodeIds.has(node.id) ? "▾" : "▸")
      : "·";
    toggle.disabled = node.kind !== "group";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editor.toggleExpanded(node.id);
    });

    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "tree-state";
    visibility.textContent = node.visible ? "◉" : "○";
    visibility.title = node.visible ? "非表示にする" : "表示する";
    visibility.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editor.setVisibility(node.id, !node.visible);
    });

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.displayName;
    label.title = `${node.displayName} (${node.id})`;
    const lock = document.createElement("span");
    lock.className = node.locked ? "tree-lock" : "tree-kind";
    lock.textContent = node.locked ? "◆" : (node.kind === "group" ? "G" : "P");

    row.append(toggle, visibility, label, lock);
    row.addEventListener("click", () => state.editor.selectNode(node.id));
    item.append(row);
    parent.append(item);
    if (
      node.children.length &&
      (filtered || state.editor.expandedNodeIds.has(node.id))
    ) {
      const children = document.createElement("ul");
      children.className = "tree-children";
      node.children.forEach((child) => appendNode(child, children, depth + 1));
      item.append(children);
    }
  };
  appendNode(state.editor.getTree(), list, 0);
  elements.sceneTree.append(list);
  elements.sceneTree.querySelector(".tree-row.selected")?.scrollIntoView({ block: "nearest" });
}

function renderInspector() {
  const node = state.editor?.selectedNode();
  elements.inspectorEmpty.hidden = Boolean(node);
  elements.inspectorForm.hidden = !node;
  elements.inspectorKind.textContent = node ? node.kind : "未選択";
  if (!node) return;
  elements.displayNameInput.value = node.displayName;
  elements.visibilityInput.checked = node.visible;
  elements.lockedInput.checked = node.locked;
  elements.nodeIdOutput.textContent = node.id;
  const parent = node.parentId
    ? state.editor.session.query("scene.get_node", { nodeId: node.parentId })
    : null;
  elements.parentOutput.textContent = parent
    ? `${parent.displayName} (${parent.id})`
    : "— root —";
  for (const input of elements.transformInputs) {
    const [section, key] = input.dataset.transformPath.split(".");
    let value = key ? node.transform[section][key] : node.transform[section];
    if (input.dataset.transformUnit === "degrees") value = value * 180 / Math.PI;
    input.value = String(Number(value.toFixed(4)));
  }
}

function renderEditorUi() {
  renderSceneTree();
  renderInspector();
  elements.undoButton.disabled = !state.editor?.canUndo;
  elements.redoButton.disabled = !state.editor?.canRedo;
  const undoTitle = state.editor?.undoLabel
    ? `Undo: ${state.editor.undoLabel}`
    : "Undo: No operation";
  const redoTitle = state.editor?.redoLabel
    ? `Redo: ${state.editor.redoLabel}`
    : "Redo: No operation";
  elements.undoButton.title = undoTitle;
  elements.redoButton.title = redoTitle;
  elements.undoButton.setAttribute("aria-label", undoTitle);
  elements.redoButton.setAttribute("aria-label", redoTitle);
  const fileName = state.documentController?.currentFileName ||
    state.editor?.session.project.displayName || "Untitled";
  const extension = fileName.toLocaleLowerCase().endsWith(".fl2d") ? "" : ".fl2d";
  const dirty = state.editor?.session.isDirty ? " *" : "";
  const recovered = state.recoveryRestored ? " · Recovered" : "";
  elements.projectTitle.textContent = `${fileName}${extension}${dirty}${recovered}`;
  elements.transformTools.forEach((button) => {
    button.disabled = !state.editor?.selectedNodeId;
    button.classList.toggle(
      "active",
      button.dataset.transformTool === (state.editor?.activeTool || "translate"),
    );
  });
  updateZoomOutput();
}

function handleEditorChange(reason) {
  if (reason === "selection") syncSelectedPsdPart();
  renderEditorUi();
  render();
}

function attachProject(project, {
  fileName = null,
  metadata = {},
  parts = [],
  mode = "project",
  saved = true,
  recovered = false,
} = {}) {
  state.autosaveScheduler?.stop();
  const session = new EditorSession(project);
  if (!saved) session.savedRevision = -1;
  const editor = new EditorUiAdapter(session, { onChange: handleEditorChange });
  recoveryStore = createRecoveryStore(localStorage, {
    maxVersions: preferences.recoveryVersions,
  });
  state.documentController = new ProjectDocumentController(session, {
    writer: projectWriter,
    currentFileName: fileName,
    metadata,
    recovery: recoveryStore,
    incrementalWidth: preferences.incrementalSaveWidth,
  });
  state.autosaveScheduler = createAutosaveScheduler({
    session,
    recovery: recoveryStore,
    preferences,
  });
  state.editor = editor;
  state.recoveryRestored = recovered;
  state.renderAssetHistory = new ReimportRenderHistory(editor, {
    getParts: () => state.psdParts,
    setParts(nextParts) {
      state.psdParts = nextParts;
      clearMeshEditing();
    },
  });
  state.mode = mode;
  state.documentWidth = project.canvas.width;
  state.documentHeight = project.canvas.height;
  state.psdParts = parts;
  state.view = createViewTransform(
    elements.viewportWrap.clientWidth,
    elements.viewportWrap.clientHeight,
    project.canvas.width,
    project.canvas.height,
  );
  state.cameraMode = "all";
  elements.sceneSearchInput.value = "";
  clearMeshEditing();
  renderEditorUi();
  elements.partInfo.textContent = parts.length
    ? `${parts.length} parts・${project.canvas.width} × ${project.canvas.height}`
    : `${project.canvas.width} × ${project.canvas.height}・source render未読込`;
  elements.emptyState.hidden = true;
  render();
}

async function confirmProjectReplacement() {
  if (!state.editor?.session.isDirty) return true;
  const choice = await new Promise((resolve) => {
    const close = () => {
      elements.unsavedDialog.removeEventListener("close", close);
      resolve(elements.unsavedDialog.returnValue || "cancel");
    };
    elements.unsavedDialog.addEventListener("close", close);
    elements.unsavedDialog.returnValue = "cancel";
    elements.unsavedDialog.showModal();
  });
  if (choice === "cancel") return false;
  if (choice === "save") return Boolean(await performSave("save"));
  return choice === "discard";
}

async function loadPsd(file) {
  if (!window.agPsd?.readPsd) {
    throw new Error("ag-psdを読み込めません。npm install を確認してね。");
  }

  setStatus("PSDを解析中…");
  const buffer = await file.arrayBuffer();
  const psd = window.agPsd.readPsd(buffer, {
    skipThumbnail: true,
    logMissingFeatures: true,
  });

  const project = createProjectFromPsd(psd, {
    fileName: file.name,
    projectName: file.name,
  });
  const allParts = collectPsdParts(psd.children || []);
  const parts = bindPsdPartsToProject(
    allParts.filter((part) => part.canvas && part.width > 0 && part.height > 0),
    project,
  );
  if (parts.length === 0) throw new Error("表示できるPSDパーツが見つかりませんでした");
  attachProject(project, { parts, mode: "psd", saved: false });
  setStatus(`${file.name}・${parts.length}パーツ・Editor Core接続済み`);
}

async function loadFile(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith(".psd")) {
      if (!await confirmProjectReplacement()) return;
      await loadPsd(file);
      return;
    }
    if (lower.endsWith(".png") || file.type === "image/png") {
      if (!await confirmProjectReplacement()) return;
      const url = URL.createObjectURL(file);
      try {
        await loadImage(url, file.name);
      } finally {
        URL.revokeObjectURL(url);
      }
      return;
    }
    throw new Error("PNGかPSDを選んでね");
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
}

function pointerPosition(event) {
  const rect = elements.overlayCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToPart(screenPoint) {
  const documentPoint = screenToImage(screenPoint.x, screenPoint.y, state.view);
  return {
    x: documentPoint.x - state.partOffset.x,
    y: documentPoint.y - state.partOffset.y,
  };
}

function nearestVertex(screenPoint, radius = 12) {
  if (!state.mesh) return -1;
  const vertices = getDeformedVertices(state.mesh);
  let nearest = -1;
  let nearestDistance = radius;
  for (let index = 0; index < vertices.length / 2; index += 1) {
    const point = screenPointForPart(vertices[index * 2], vertices[index * 2 + 1]);
    const distance = Math.hypot(point.x - screenPoint.x, point.y - screenPoint.y);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function requestedFileName(suggestedName) {
  const value = window.prompt(".fl2d filename", suggestedName);
  return value?.trim() || null;
}

async function performSave(action) {
  if (!state.documentController) return false;
  try {
    let result;
    if (action === "save") {
      if (!state.documentController.currentFileName) return performSave("save-as");
      result = await state.documentController.save();
    } else if (action === "save-as") {
      const name = requestedFileName(
        state.documentController.currentFileName ||
        `${state.editor.session.project.displayName}.fl2d`,
      );
      if (!name) return false;
      result = await state.documentController.saveAs(name);
    } else if (action === "save-incremental") {
      result = await state.documentController.saveIncremental(
        projectWriter.knownFileNames(),
      );
    } else if (action === "save-copy") {
      const name = requestedFileName(
        `${state.editor.session.project.displayName}_copy.fl2d`,
      );
      if (!name) return false;
      result = await state.documentController.saveCopy(name);
    }
    if (action !== "save-copy") state.recoveryRestored = false;
    renderEditorUi();
    setStatus(`${result.fileName} を保存しました`);
    return result;
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
    return false;
  }
}

async function createNewProject() {
  if (!await confirmProjectReplacement()) return;
  const project = createProject({
    name: "Untitled",
    width: 1920,
    height: 1080,
    idFactory: createIdFactory(`new-${Date.now()}`),
  });
  attachProject(project, { saved: false });
  setStatus("新しいProjectを作成しました");
}

async function openProjectFile(file) {
  if (!file || !await confirmProjectReplacement()) return;
  try {
    const parsed = parseProjectDocument(await file.text());
    attachProject(parsed.project, {
      fileName: file.name,
      metadata: parsed.metadata,
      saved: true,
    });
    setStatus(`${file.name} を開きました。PSD renderはRe-import時に再選択できます`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
}

async function chooseProjectFile() {
  if (typeof window.showOpenFilePicker !== "function") {
    elements.projectOpenInput.click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "FLAMORIS 2D Project",
        accept: { "application/x-flamoris-2d+json": [".fl2d"] },
      }],
    });
    const file = await handle.getFile();
    projectWriter.rememberHandle(file.name, handle);
    await openProjectFile(file);
  } catch (error) {
    if (error.name !== "AbortError") setStatus(error.message || String(error));
  }
}

function openPreferences() {
  elements.autosaveEnabledInput.checked = preferences.autosaveEnabled;
  elements.autosaveIntervalInput.value = String(preferences.autosaveIntervalSeconds);
  elements.recoveryVersionsInput.value = String(preferences.recoveryVersions);
  elements.incrementalWidthInput.value = String(preferences.incrementalSaveWidth);
  elements.saveAfterMajorInput.checked = preferences.saveAfterMajorOperations;
  elements.recoveryNotificationInput.checked = preferences.showRecoveryNotification;
  elements.preferencesDialog.showModal();
}

function savePreferences() {
  preferences = preferencesStore.save({
    autosaveEnabled: elements.autosaveEnabledInput.checked,
    autosaveIntervalSeconds: Number(elements.autosaveIntervalInput.value),
    recoveryVersions: Number(elements.recoveryVersionsInput.value),
    incrementalSaveWidth: Number(elements.incrementalWidthInput.value),
    saveAfterMajorOperations: elements.saveAfterMajorInput.checked,
    showRecoveryNotification: elements.recoveryNotificationInput.checked,
  });
  if (state.editor) {
    state.autosaveScheduler?.stop();
    recoveryStore = createRecoveryStore(localStorage, {
      maxVersions: preferences.recoveryVersions,
    });
    state.documentController.recovery = recoveryStore;
    state.documentController.incrementalWidth = preferences.incrementalSaveWidth;
    state.autosaveScheduler = createAutosaveScheduler({
      session: state.editor.session,
      recovery: recoveryStore,
      preferences,
    });
  }
  setStatus("Preferencesを保存しました");
}

function projectNodeLabel(project, nodeId) {
  return nodeId ? project.scene.nodes[nodeId]?.displayName || nodeId : "—";
}

function updateReimportPreview(row) {
  const currentPart = state.psdParts.find((part) => part.nodeId === row.currentNodeId);
  const importedPart = state.reimportParts.find((part) => part.nodeId === row.importedNodeId);
  elements.reimportCurrentPreview.src = currentPart?.canvas?.toDataURL?.() || "";
  elements.reimportNewPreview.src = importedPart?.canvas?.toDataURL?.() || "";
}

function renderReimportReview() {
  const review = state.reimportReview;
  elements.reimportTableBody.replaceChildren();
  if (!review) return;
  for (const row of review.rows) {
    const tr = document.createElement("tr");
    if (row.id === state.selectedReimportRowId) tr.classList.add("selected");
    const values = [
      row.status,
      projectNodeLabel(review.currentProject, row.currentNodeId),
    ];
    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    const matchCell = document.createElement("td");
    const matchSelect = document.createElement("select");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = row.importedNodeId ? "Current selection" : "Select…";
    matchSelect.append(empty);
    for (const node of Object.values(review.importedProject.scene.nodes)) {
      if (!review.isCompatibleImportedNode(row, node.id)) continue;
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = node.displayName;
      option.selected = node.id === row.importedNodeId;
      matchSelect.append(option);
    }
    matchSelect.addEventListener("change", (event) => {
      event.stopPropagation();
      try {
        review.setMatch(row.id, matchSelect.value);
        state.selectedReimportRowId = row.id;
        renderReimportReview();
      } catch (error) {
        setStatus(error.message);
        renderReimportReview();
      }
    });
    matchCell.append(matchSelect);
    tr.append(matchCell);
    const source = document.createElement("td");
    source.textContent = `${row.matchSource} · ${row.explanation}`;
    tr.append(source);
    const actionCell = document.createElement("td");
    const action = document.createElement("select");
    for (const [value, label] of [
      ["update", "Keep / Update"], ["add", "Mark as New"],
      ["keep", "Keep Existing"], ["remove", "Remove Existing"],
      ["ignore", "Ignore"], ["reset", "Reset to Auto"],
      ["unresolved", "Resolve…"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === row.action;
      action.append(option);
    }
    action.addEventListener("change", (event) => {
      event.stopPropagation();
      try {
        if (action.value === "add") review.markAsNew(row.id);
        else if (action.value === "keep") review.keepExisting(row.id);
        else if (action.value === "remove") review.removeExisting(row.id);
        else if (action.value === "ignore") review.ignore(row.id);
        else if (action.value === "reset") review.resetToAuto(row.id);
        else if (action.value === "update" && row.importedNodeId) {
          review.setMatch(row.id, row.importedNodeId);
        }
      } catch (error) {
        setStatus(error.message);
      }
      renderReimportReview();
    });
    actionCell.append(action);
    tr.append(actionCell);
    tr.addEventListener("click", () => {
      state.selectedReimportRowId = row.id;
      updateReimportPreview(row);
      renderReimportReview();
    });
    elements.reimportTableBody.append(tr);
  }
  const summary = review.summary;
  elements.reimportSummary.textContent =
    `Update ${summary.update} · Add ${summary.add} · Keep ${summary.keep} · ` +
    `Remove ${summary.remove} · Unresolved ${summary.unresolved}`;
  elements.applyReimportButton.disabled = !review.canApply;
  const selected = review.rows.find((row) => row.id === state.selectedReimportRowId);
  if (selected) updateReimportPreview(selected);
}

async function analyzePsdReimport(file) {
  if (!file || !state.editor) return;
  try {
    setStatus("PSD Re-importを解析中…");
    const psd = window.agPsd.readPsd(await file.arrayBuffer(), {
      skipThumbnail: true,
      logMissingFeatures: true,
    });
    const review = createPsdReimportReview(state.editor.session.project, psd, {
      fileName: file.name,
      projectName: state.editor.session.project.displayName,
      idFactory: createIdFactory(`reimport-${Date.now()}`),
      baseRevision: state.editor.session.currentRevision,
    });
    const parts = bindPsdPartsToProject(
      collectPsdParts(psd.children || []).filter((part) =>
        part.canvas && part.width > 0 && part.height > 0),
      review.importedProject,
    );
    state.reimportReview = review;
    state.reimportParts = parts;
    state.selectedReimportRowId = review.rows[0]?.id || null;
    renderReimportReview();
    elements.reimportDialog.showModal();
    setStatus("PSD Re-import: Review中（Projectは未変更）");
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
}

function applyReviewedReimport() {
  const review = state.reimportReview;
  if (!review?.canApply) return;
  try {
    state.renderAssetHistory.apply(review, state.reimportParts);
    state.documentWidth = state.editor.session.project.canvas.width;
    state.documentHeight = state.editor.session.project.canvas.height;
    if (preferences.saveAfterMajorOperations) state.autosaveScheduler?.checkpoint();
    elements.reimportDialog.close("apply");
    renderEditorUi();
    render();
    setStatus("PSD Re-importを1件のUndo操作として適用しました");
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
}

function undoProject() {
  const result = state.renderAssetHistory?.undo() || state.editor?.undo();
  if (result && state.editor?.selectedNodeId) syncSelectedPsdPart();
  return result;
}

function redoProject() {
  const result = state.renderAssetHistory?.redo() || state.editor?.redo();
  if (result && state.editor?.selectedNodeId) syncSelectedPsdPart();
  return result;
}

elements.fileInput.addEventListener("change", async () => {
  await loadFile(elements.fileInput.files?.[0]);
  elements.fileInput.value = "";
});
elements.projectOpenInput.addEventListener("change", async () => {
  await openProjectFile(elements.projectOpenInput.files?.[0]);
  elements.projectOpenInput.value = "";
});
elements.reimportPsdInput.addEventListener("change", async () => {
  await analyzePsdReimport(elements.reimportPsdInput.files?.[0]);
  elements.reimportPsdInput.value = "";
});
elements.savePreferencesButton.addEventListener("click", savePreferences);
elements.applyReimportButton.addEventListener("click", (event) => {
  event.preventDefault();
  applyReviewedReimport();
});
elements.fileActions.forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.fileAction;
    elements.fileMenu.open = false;
    if (action === "new") await createNewProject();
    else if (action === "open") await chooseProjectFile();
    else if (action === "save" || action === "save-as" ||
      action === "save-incremental" || action === "save-copy") {
      await performSave(action);
    } else if (action === "import-psd") elements.fileInput.click();
    else if (action === "reimport-psd") elements.reimportPsdInput.click();
    else if (action === "preferences") openPreferences();
  });
});
elements.sceneSearchInput.addEventListener("input", () => {
  state.editor?.setFilter(elements.sceneSearchInput.value);
});
elements.undoButton.addEventListener("click", undoProject);
elements.redoButton.addEventListener("click", redoProject);
elements.transformTools.forEach((button) => {
  button.addEventListener("click", () => {
    state.editor?.setActiveTool(button.dataset.transformTool);
  });
});

function commitInspectorEdit(action) {
  try {
    action();
    setStatus("Editor Coreへ変更を適用しました");
  } catch (error) {
    console.error(error);
    renderInspector();
    setStatus(error.message || String(error));
  }
}

elements.displayNameInput.addEventListener("change", () => {
  commitInspectorEdit(() => {
    state.editor?.renameSelected(elements.displayNameInput.value);
  });
});
elements.visibilityInput.addEventListener("change", () => {
  const nodeId = state.editor?.selectedNodeId;
  if (nodeId) state.editor.setVisibility(nodeId, elements.visibilityInput.checked);
});
elements.lockedInput.addEventListener("change", () => {
  const nodeId = state.editor?.selectedNodeId;
  if (nodeId) state.editor.setLocked(nodeId, elements.lockedInput.checked);
});
elements.transformInputs.forEach((input) => {
  input.addEventListener("change", () => {
    commitInspectorEdit(() => {
      const node = state.editor?.selectedNode();
      if (!node) return;
      let value = Number(input.value);
      if (!Number.isFinite(value)) throw new Error("有限の数値を入力してください。");
      if (input.dataset.transformUnit === "degrees") value = value * Math.PI / 180;
      const transform = structuredClone(node.transform);
      const [section, key] = input.dataset.transformPath.split(".");
      if (key) transform[section][key] = value;
      else transform[section] = value;
      state.editor.setSelectedTransform(transform, "Inspector transform");
    });
  });
});
elements.generateButton.addEventListener("click", createMesh);
elements.resetButton.addEventListener("click", () => {
  returnToEdit();
  resetDeformation(state.mesh);
  state.selected.clear();
  setStatus("変形をリセットしました");
  render();
});

function captureKeyframe(name) {
  stopPlayback();
  state.previewMode = false;
  state.keyframes[name] = captureOffsets(state.mesh.vertexOffsets);
  state.currentTime = 0;
  updateTimeDisplay();
  updateButtons();
  setStatus(`キーフレーム${name.toUpperCase()}を記録しました`);
  render();
}

elements.captureAButton.addEventListener("click", () => captureKeyframe("a"));
elements.captureBButton.addEventListener("click", () => captureKeyframe("b"));

function playbackFrame(now) {
  if (!state.playing) return;
  const clipDuration = duration();
  state.currentTime = ((now - state.playbackStartedAt) / 1000) % clipDuration;
  updateTimeDisplay();
  render();
  state.animationFrame = requestAnimationFrame(playbackFrame);
}

elements.playButton.addEventListener("click", () => {
  if (state.playing) {
    stopPlayback();
    return;
  }
  state.previewMode = true;
  state.playing = true;
  state.playbackStartedAt = performance.now() - state.currentTime * 1000;
  updateButtons();
  state.animationFrame = requestAnimationFrame(playbackFrame);
  setStatus("A → B → A を無音プレビュー中");
});

elements.editButton.addEventListener("click", returnToEdit);
elements.timeSlider.addEventListener("input", () => {
  stopPlayback();
  state.previewMode = true;
  state.currentTime = Number(elements.timeSlider.value);
  updateTimeDisplay();
  updateButtons();
  render();
});
elements.durationInput.addEventListener("change", () => {
  const value = duration();
  elements.durationInput.value = String(value);
  elements.timeSlider.max = String(value);
  state.currentTime = Math.min(state.currentTime, value);
  updateTimeDisplay();
  render();
});

elements.fitAllButton.addEventListener("click", fitDocumentView);
elements.fitPartButton.addEventListener("click", fitSelectedPartView);

elements.overlayCanvas.addEventListener("wheel", (event) => {
  if (!state.view) return;
  event.preventDefault();
  const point = pointerPosition(event);
  const factor = Math.exp(-event.deltaY * 0.0015);
  zoomAtScreenPoint(point.x, point.y, factor);
}, { passive: false });

window.addEventListener("keydown", (event) => {
  const historyAction = projectHistoryShortcutAction(event);
  if (state.editor && historyAction) {
    event.preventDefault();
    if (historyAction === "redo") redoProject();
    else undoProject();
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

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    state.spacePressed = false;
    elements.viewportWrap.classList.remove("pan-ready");
  }
});

elements.overlayCanvas.addEventListener("pointerdown", (event) => {
  if (state.previewMode) returnToEdit();

  const screenPoint = pointerPosition(event);

  // Middle mouse, or Space + left mouse = viewport pan.
  if (event.button === 1 || (event.button === 0 && state.spacePressed)) {
    state.pan = {
      pointerId: event.pointerId,
      last: screenPoint,
    };
    elements.overlayCanvas.setPointerCapture(event.pointerId);
    elements.viewportWrap.classList.add("panning");
    event.preventDefault();
    return;
  }

  if (event.button === 0 && state.editor && state.mode === "psd") {
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
    state.editor.selectNode(pickedNodeId);
    return;
  }

  const vertexIndex = nearestVertex(screenPoint);
  if (vertexIndex < 0) {
    if (!event.shiftKey) state.selected.clear();
    render();
    return;
  }
  if (event.shiftKey) {
    if (state.selected.has(vertexIndex)) state.selected.delete(vertexIndex);
    else state.selected.add(vertexIndex);
  } else if (!state.selected.has(vertexIndex)) {
    state.selected.clear();
    state.selected.add(vertexIndex);
  }
  const partPoint = screenToPart(screenPoint);
  state.drag = { last: partPoint };
  elements.overlayCanvas.setPointerCapture(event.pointerId);
  render();
});

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
  moveVertices(state.mesh, state.selected, partPoint.x - state.drag.last.x, partPoint.y - state.drag.last.y);
  state.drag.last = partPoint;
  render();
});

function endDrag(event) {
  if (state.drag) setStatus(`${state.selected.size}頂点を変形中`);
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
elements.viewportWrap.addEventListener("drop", (event) => loadFile(event.dataTransfer.files?.[0]));

new ResizeObserver(resizeCanvases).observe(elements.viewportWrap);
window.addEventListener("beforeunload", (event) => {
  if (!state.editor?.session.isDirty) return;
  event.preventDefault();
  event.returnValue = "";
});
updateButtons();
updateZoomOutput();
resizeCanvases();
elements.recoveryDialog.addEventListener("close", () => {
  if (elements.recoveryDialog.returnValue !== "restore") {
    setStatus("Recoveryは現在のProjectへ復元していません");
    return;
  }
  try {
    const recoveredProject = recoveryStore.load();
    if (!recoveredProject) {
      setStatus("復元できるRecovery snapshotがありません");
      return;
    }
    attachProject(recoveredProject, {
      saved: false,
      recovered: true,
      mode: "project",
    });
    setStatus(
      "前回の未保存Projectを復元しました（未保存）。" +
      "PSD renderはRe-importで再接続できます",
    );
  } catch (error) {
    console.error(error);
    setStatus("Recovery snapshotを復元できませんでした");
  }
});
const recoveryCount = recoveryStore.list().length;
if (preferences.showRecoveryNotification && recoveryCount) {
  elements.recoveryDialogMessage.textContent =
    `Recovery snapshotが${recoveryCount}件あります。` +
    "最新の未保存Projectを復元しますか？";
  elements.recoveryDialog.returnValue = "dismiss";
  elements.recoveryDialog.showModal();
  setStatus(
    `Recovery snapshotが${recoveryCount}件あります` +
    "（現在のProjectには未復元）",
  );
}
