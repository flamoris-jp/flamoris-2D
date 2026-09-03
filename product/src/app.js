import {
  createViewTransform,
  screenToImage,
} from "./mesh.js";
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
import { transformPoint } from "./core/transforms.js";
import {
  EDITOR_MODES,
  editModeAvailability,
  isMeshAuthoringMode,
} from "./ui/editor-modes.js";
import { createBrowserProjectWriter } from "./ui/browser-project-files.js";
import {
  createDesktopProjectWriter,
  desktopFileFromPayload,
} from "./ui/desktop-project-files.js";
import {
  hydratePsdRenderAssets,
  serializePsdRenderAssets,
} from "./ui/psd-render-assets.js";
import { ReimportRenderHistory } from "./ui/reimport-render-history.js";
import {
  clearLayerCanvas,
  createViewportRenderer,
} from "./ui/viewport-renderer.js";
import { createSceneEditorView } from "./ui/scene-editor-view.js";
import { bindViewportInteractions } from "./ui/viewport-input-controller.js";
import { queryAppElements } from "./ui/app-elements.js";
import { createReimportReviewView } from "./ui/reimport-review-view.js";
import { createMeshEditingController } from "./ui/mesh-editing-controller.js";
import { createTransitionAuthoringView } from "./ui/transition-authoring-view.js";
import { createTransitionPreviewView } from "./ui/transition-preview-view.js";
import { createTransitionDiagnosticsView } from "./ui/transition-diagnostics-view.js";

const desktopApi = window.flamorisDesktop || null;
const appStorage = desktopApi?.storage || localStorage;

const elements = queryAppElements(document);

const state = {
  mode: "empty",
  editorMode: EDITOR_MODES.OBJECT,
  editTargetNodeId: null,
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

const preferencesStore = createPreferencesStore(appStorage);
let preferences = preferencesStore.load();
let recoveryStore = createRecoveryStore(appStorage, {
  maxVersions: preferences.recoveryVersions,
});
const projectWriter = desktopApi
  ? createDesktopProjectWriter(desktopApi)
  : createBrowserProjectWriter();

let renderer;
try {
  renderer = new MeshRenderer(elements.glCanvas);
} catch (error) {
  elements.status.textContent = error.message;
  throw error;
}

const meshEditingController = createMeshEditingController({
  state,
  elements,
  renderer,
  selectedPart,
  setStatus,
  render: () => render(),
});
const {
  clearMeshEditing,
  createMesh,
  returnToEdit,
  setEditableImage,
  updateButtons,
} = meshEditingController;

const viewportRenderer = createViewportRenderer({
  state,
  elements,
  renderer,
  duration: meshEditingController.duration,
  selectedPart,
  selectedPartIndex,
  selectedNodeDocumentBounds,
  endpointContext: activeEndpointContext,
  transitionPreviewContext: () => state.editor?.transitionPreview.getState() || null,
});

const sceneEditorView = createSceneEditorView({
  state,
  elements,
  desktopApi,
  setStatus,
  updateEditorModeUi,
  updateZoomOutput,
});

const reimportReviewView = createReimportReviewView({
  state,
  elements,
  setStatus,
});

const transitionAuthoringView = createTransitionAuthoringView({
  state,
  elements,
  setStatus,
  onEndpointContextChange: () => syncEndpointMeshViewport(),
});

const transitionPreviewView = createTransitionPreviewView({
  state,
  elements,
  setStatus,
  onViewModeChange: (mode) => {
    if (mode === "preview") {
      state.editor?.endpointMesh.exitEditing();
      render();
      return;
    }
    state.editor?.endpointMesh.selectEndpoint(mode === "endpoint-a" ? "from" : "to");
    syncEndpointMeshViewport();
  },
});

const transitionDiagnosticsView = createTransitionDiagnosticsView({
  state,
  elements,
  setStatus,
});

function setStatus(message) {
  elements.status.textContent = message;
}

function selectedPartIndex() {
  const endpoint = activeEndpointContext();
  if (endpoint) return state.psdParts.findIndex((part) => part.nodeId === endpoint.nodeId);
  const targetNodeId = isMeshAuthoringMode(state.editorMode)
    ? state.editTargetNodeId
    : state.editor?.selectedNodeId;
  if (!targetNodeId) return -1;
  return state.psdParts.findIndex(
    (part) => part.nodeId === targetNodeId,
  );
}

function activeEndpointContext() {
  const controller = state.editor?.endpointMesh;
  const endpointState = controller?.getState();
  if (!controller || !endpointState?.editingEnabled || !endpointState.selectedSemanticSlot) return null;
  const endpoint = endpointState.activeEndpoint;
  const mapping = endpointState.selectedSemanticSlot[endpoint]?.mapping;
  const keyArt = endpointState.endpoints?.[endpoint]?.keyArt;
  if (!mapping || !keyArt) return null;
  return {
    endpoint,
    nodeId: mapping.nodeId,
    keyArt,
    keyform: endpointState.activeKeyform,
    topology: endpointState.topologies.find((entry) =>
      entry.id === endpointState.activeKeyform?.topologyId) || null,
    worldTransform: controller.activeEndpointWorldTransform(),
  };
}

function syncEndpointMeshViewport() {
  const context = activeEndpointContext();
  if (!context) {
    renderEditorUi();
    render();
    return;
  }
  const part = state.psdParts.find((entry) => entry.nodeId === context.nodeId);
  if (!part?.canvas) {
    clearMeshEditing();
    setStatus("Active endpoint artwork render is missing. Re-import the PSD render asset.");
    renderEditorUi();
    render();
    return;
  }
  clearMeshEditing();
  setEditableImage(
    part.canvas,
    state.documentWidth,
    state.documentHeight,
    context.keyform ? 0 : part.left,
    context.keyform ? 0 : part.top,
  );
  if (context.keyform && context.topology) {
    state.mesh = {
      columns: 0,
      rows: 0,
      baseVertices: new Float32Array(context.keyform.positions),
      vertexOffsets: new Float32Array(context.keyform.positions.length),
      uvs: new Float32Array(context.keyform.uvs),
      indices: new Uint32Array(context.topology.indices),
    };
    renderer.setMesh(state.mesh);
  } else createMesh();
  state.editorMode = EDITOR_MODES.DEFORM;
  state.editor?.meshTools.setMode(EDITOR_MODES.DEFORM);
  state.editTargetNodeId = context.nodeId;
  state.selected.clear();
  elements.partInfo.textContent = `${context.endpoint === "from" ? "A" : "B"} · ${part.name} · endpoint mesh`;
  updateEditorModeUi();
  renderEditorUi();
  render();
}

function selectedPart() {
  const index = selectedPartIndex();
  return index >= 0 ? state.psdParts[index] : null;
}

function currentEditModeAvailability() {
  const selectedNode = state.editor?.selectedNode() || null;
  return editModeAvailability({
    contentMode: state.mode,
    selectedNodeId: state.editor?.selectedNodeId || null,
    selectedPart: selectedPart(),
    selectedNode,
    mesh: state.mesh,
  });
}

function updateEditorModeUi() {
  elements.editorModeSelect.value = state.editorMode;
  elements.editorModeSelect.disabled = state.mode !== "psd";
  elements.editorModeSelect.title = state.mode === "png"
    ? "単一PNGは既存のmesh editingを使用します"
    : "TabでObject/Deform Modeを切り替え。Topology EditはModeメニューから選択";
  const editing = isMeshAuthoringMode(state.editorMode);
  elements.viewportWrap.classList.toggle("edit-mode", editing);
  const transformToolbar = elements.transformTools[0]?.parentElement;
  if (transformToolbar) transformToolbar.hidden = editing;
}

function setEditorMode(requestedMode) {
  if (state.mode === "png") {
    state.editorMode = EDITOR_MODES.DEFORM;
    state.editTargetNodeId = null;
    updateEditorModeUi();
    return true;
  }
  if (isMeshAuthoringMode(requestedMode)) {
    const availability = currentEditModeAvailability();
    if (!availability.allowed) {
      state.editorMode = EDITOR_MODES.OBJECT;
      state.editTargetNodeId = null;
      updateEditorModeUi();
      setStatus(availability.reason);
      render();
      return false;
    }
    state.editorMode = requestedMode === EDITOR_MODES.TOPOLOGY
      ? EDITOR_MODES.TOPOLOGY
      : EDITOR_MODES.DEFORM;
    state.editor.meshTools.setMode(state.editorMode);
    state.editTargetNodeId = state.editor.selectedNodeId;
    state.transformGesture = null;
    state.editor.cancelTransformDrag();
    setStatus(`${state.editor.selectedNode().displayName}・${state.editorMode === EDITOR_MODES.TOPOLOGY ? "Topology Edit" : "Deform"} Mode`);
  } else {
    state.editorMode = EDITOR_MODES.OBJECT;
    state.editTargetNodeId = null;
    state.drag = null;
    state.selected.clear();
    setStatus("Object Mode・scene selectionとTransformを有効化しました");
  }
  updateEditorModeUi();
  renderEditorUi();
  render();
  return true;
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

function render() {
  viewportRenderer.render();
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
  state.editorMode = EDITOR_MODES.DEFORM;
  state.editTargetNodeId = null;
  state.psdParts = [];
  state.autosaveScheduler?.stop();
  state.autosaveScheduler = null;
  state.documentController = null;
  state.renderAssetHistory = null;
  state.recoveryRestored = false;
  state.editor = null;
  desktopApi?.clearAssociation();
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

function renderEditorUi() {
  sceneEditorView.render();
  transitionAuthoringView.render();
  transitionPreviewView.render();
  transitionDiagnosticsView.render();
}

function handleEditorChange(reason) {
  if (reason === "endpoint-exit") {
    syncSelectedPsdPart();
    renderEditorUi();
    render();
    return;
  }
  if (["transition-selection", "semantic-slot-selection"].includes(reason)) {
    state.editor?.endpointMesh.exitEditing();
    return;
  }
  if (reason.startsWith("endpoint-") ||
    (reason === "project" && state.editor?.endpointMesh.getState().editingEnabled)) {
    syncEndpointMeshViewport();
    return;
  }
  if (
    isMeshAuthoringMode(state.editorMode) &&
    state.editTargetNodeId &&
    !state.editor?.session.project.scene.nodes[state.editTargetNodeId]
  ) {
    state.editorMode = EDITOR_MODES.OBJECT;
    state.editTargetNodeId = null;
    setStatus("active mesh-edit targetが存在しないためObject Modeへ戻りました");
  }
  if (
    reason === "selection" &&
    isMeshAuthoringMode(state.editorMode) &&
    state.editTargetNodeId &&
    state.editor.selectedNodeId !== state.editTargetNodeId
  ) {
    state.editor.selectedNodeId = state.editTargetNodeId;
    setStatus("Edit Mode中はactive mesh-edit targetを変更できません");
    renderEditorUi();
    render();
    return;
  }
  if (reason === "selection") syncSelectedPsdPart();
  renderEditorUi();
  render();
}

function attachProject(project, {
  fileName = null,
  filePath = null,
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
  recoveryStore = createRecoveryStore(appStorage, {
    maxVersions: preferences.recoveryVersions,
  });
  state.documentController = new ProjectDocumentController(session, {
    writer: projectWriter,
    currentFileName: fileName,
    currentFilePath: filePath,
    metadata,
    recovery: recoveryStore,
    incrementalWidth: preferences.incrementalSaveWidth,
    getRenderAssets: () => serializePsdRenderAssets(state.psdParts),
  });
  state.autosaveScheduler = createAutosaveScheduler({
    session,
    recovery: recoveryStore,
    preferences,
  });
  state.editor = editor;
  state.editorMode = EDITOR_MODES.OBJECT;
  state.editTargetNodeId = null;
  if (desktopApi && !filePath) desktopApi.clearAssociation();
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
  const choice = desktopApi
    ? await desktopApi.confirmUnsaved({
      fileName: state.documentController?.currentFileName,
    })
    : await new Promise((resolve) => {
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

async function loadFile(file, { skipConfirmation = false } = {}) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith(".psd")) {
      if (!skipConfirmation && !await confirmProjectReplacement()) return;
      await loadPsd(file);
      return;
    }
    if (lower.endsWith(".png") || file.type === "image/png") {
      if (!skipConfirmation && !await confirmProjectReplacement()) return;
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

function requestedFileName(suggestedName) {
  const value = window.prompt(".fl2d filename", suggestedName);
  return value?.trim() || null;
}

async function performSave(action) {
  if (!state.documentController) return false;
  try {
    let result;
    if (action === "save") {
      if (!state.documentController.currentFileName &&
          !state.documentController.currentFilePath) {
        return performSave("save-as");
      }
      result = await state.documentController.save();
    } else if (action === "save-as") {
      const suggestedName = state.documentController.currentFileName ||
        `${state.editor.session.project.displayName}.fl2d`;
      const name = desktopApi ? suggestedName : requestedFileName(suggestedName);
      if (!name) return false;
      result = await state.documentController.saveAs(name);
    } else if (action === "save-incremental") {
      result = await state.documentController.saveIncremental(
        await projectWriter.knownFileNames(),
      );
    } else if (action === "save-copy") {
      const suggestedName = `${state.editor.session.project.displayName}_copy.fl2d`;
      const name = desktopApi ? suggestedName : requestedFileName(suggestedName);
      if (!name) return false;
      result = await state.documentController.saveCopy(name);
    }
    if (!result) return false;
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

async function loadPersistedRenderImage(source) {
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("保存済みPSD renderを読み込めませんでした"));
    image.src = source;
  });
  return image;
}

async function openProjectFile(file, {
  skipConfirmation = false,
  filePath = null,
} = {}) {
  if (!file || (!skipConfirmation && !await confirmProjectReplacement())) return;
  try {
    const parsed = parseProjectDocument(await file.text());
    const hydration = await hydratePsdRenderAssets(
      parsed.renderAssets,
      parsed.project,
      { loadImage: loadPersistedRenderImage },
    );
    const parts = hydration.parts;
    if (desktopApi && filePath) await desktopApi.acceptOpenedProject(filePath);
    attachProject(parsed.project, {
      fileName: file.name,
      filePath,
      metadata: parsed.metadata,
      parts,
      mode: parts.length ? "psd" : "project",
      saved: true,
    });
    if (hydration.failedCount) {
      setStatus(
        `${file.name} を開き、PSD render ${parts.length}/${hydration.totalCount}件を復元。` +
        `${hydration.failedCount}件は読み込めないため、Re-importで復元できます`,
      );
    } else {
      setStatus(parts.length
        ? `${file.name} を開き、PSD render ${parts.length}件を復元しました`
        : `${file.name} を開きました。PSD renderはRe-import時に再選択できます`);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
}

async function chooseProjectFile() {
  if (desktopApi) {
    if (!await confirmProjectReplacement()) return;
    try {
      const payload = await desktopApi.openFile({ purpose: "open" });
      const file = desktopFileFromPayload(payload);
      if (!file) return;
      if (file.name.toLocaleLowerCase().endsWith(".fl2d")) {
        await openProjectFile(file, {
          skipConfirmation: true,
          filePath: file.filePath,
        });
      } else {
        await loadFile(file, { skipConfirmation: true });
      }
    } catch (error) {
      setStatus(error.message || String(error));
    }
    return;
  }
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
    recoveryStore = createRecoveryStore(appStorage, {
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
    reimportReviewView.render();
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
  if (result) {
    renderEditorUi();
    render();
  }
  return result;
}

function redoProject() {
  const result = state.renderAssetHistory?.redo() || state.editor?.redo();
  if (result && state.editor?.selectedNodeId) syncSelectedPsdPart();
  if (result) {
    renderEditorUi();
    render();
  }
  return result;
}

async function choosePsdFile(action) {
  if (!desktopApi) {
    if (action === "import-psd") elements.fileInput.click();
    else elements.reimportPsdInput.click();
    return;
  }
  if (action === "import-psd" && !await confirmProjectReplacement()) return;
  try {
    const payload = await desktopApi.openFile({ purpose: action });
    const file = desktopFileFromPayload(payload);
    if (!file) return;
    if (action === "import-psd") await loadPsd(file);
    else await analyzePsdReimport(file);
  } catch (error) {
    setStatus(error.message || String(error));
  }
}

async function openDesktopProjectFrom(source, filePath) {
  if (!desktopApi || !await confirmProjectReplacement()) return;
  try {
    const payload = source === "recent"
      ? await desktopApi.openRecent(filePath)
      : await desktopApi.openExternalProject(filePath);
    const file = desktopFileFromPayload(payload);
    if (!file) return;
    await openProjectFile(file, {
      skipConfirmation: true,
      filePath: file.filePath,
    });
  } catch (error) {
    setStatus(error.message || String(error));
  }
}

async function handleFileAction(action) {
  if (action === "new") await createNewProject();
  else if (action === "open") await chooseProjectFile();
  else if (action === "save" || action === "save-as" ||
    action === "save-incremental" || action === "save-copy") {
    await performSave(action);
  } else if (action === "import-psd" || action === "reimport-psd") {
    await choosePsdFile(action);
  } else if (action === "preferences") openPreferences();
  else if (action === "undo") undoProject();
  else if (action === "redo") redoProject();
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
    await handleFileAction(action);
  });
});
desktopApi?.onMenuAction(async (action) => {
  if (action?.type === "open-recent") {
    await openDesktopProjectFrom("recent", action.filePath);
  } else if (action?.type === "open-external") {
    await openDesktopProjectFrom("external", action.filePath);
  } else {
    await handleFileAction(action);
  }
});
desktopApi?.onRequest(async (action) => {
  if (action === "save") return Boolean(await performSave("save"));
  if (action === "get-document-state") {
    return {
      dirty: Boolean(state.editor?.session.isDirty),
      recovered: state.recoveryRestored,
    };
  }
  return false;
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
    sceneEditorView.renderInspector();
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
meshEditingController.bind();

elements.fitAllButton.addEventListener("click", fitDocumentView);
elements.fitPartButton.addEventListener("click", fitSelectedPartView);
elements.editorModeSelect.addEventListener("change", () => {
  setEditorMode(elements.editorModeSelect.value);
});

bindViewportInteractions({
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
  endpointMesh: () => state.editor?.endpointMesh || null,
  loadFile,
});

new ResizeObserver(resizeCanvases).observe(elements.viewportWrap);
if (!desktopApi) {
  window.addEventListener("beforeunload", (event) => {
    if (!state.editor?.session.isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
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
