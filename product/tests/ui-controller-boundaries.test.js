import test from "node:test";
import assert from "node:assert/strict";

import { generateGridMesh } from "../src/mesh.js";
import { createMeshEditingController } from "../src/ui/mesh-editing-controller.js";
import { applyReimportRowAction } from "../src/ui/reimport-review-view.js";
import { createSceneEditorView } from "../src/ui/scene-editor-view.js";
import { bindViewportInteractions } from "../src/ui/viewport-input-controller.js";

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
}

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
    contains: (name) => values.has(name),
  };
}

function control(value = "") {
  return eventTarget({
    value,
    disabled: false,
    textContent: "",
    classList: classList(),
  });
}

function viewportElements() {
  return {
    overlayCanvas: eventTarget({
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture() {},
    }),
    viewportWrap: eventTarget({ classList: classList() }),
  };
}

function bindViewport(state, elements, overrides = {}) {
  return bindViewportInteractions({
    state,
    elements,
    viewportRenderer: {
      screenPointForPart: (x, y) => ({ x, y }),
    },
    returnToEdit() {},
    zoomAtScreenPoint() {},
    panViewBy() {},
    setEditorMode() {},
    undoProject() {},
    redoProject() {},
    render() {},
    setStatus() {},
    selectedPart: () => null,
    loadFile() {},
    windowTarget: eventTarget(),
    ...overrides,
  });
}

test("viewport controller binds Object Mode pointer input to scene selection", () => {
  let selectedNodeId = null;
  const editor = {
    selectedNodeId: null,
    getNode: () => ({ effectiveVisible: true, locked: false }),
    worldTransform: () => [1, 0, 0, 1, 0, 0],
    selectNode: (nodeId) => { selectedNodeId = nodeId; },
  };
  const state = {
    mode: "psd",
    editorMode: "object",
    editor,
    previewMode: false,
    spacePressed: false,
    view: { scale: 1, originX: 0, originY: 0 },
    psdParts: [{
      nodeId: "part_a",
      left: 0,
      top: 0,
      right: 20,
      bottom: 20,
    }],
  };
  const elements = viewportElements();
  bindViewport(state, elements);

  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });

  assert.equal(selectedNodeId, "part_a");
});

test("viewport controller binds Edit Mode pointer input to vertex selection", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    10,
    10,
    1,
    1,
  );
  const state = {
    mode: "psd",
    editorMode: "edit",
    editor: null,
    previewMode: false,
    spacePressed: false,
    view: { scale: 1, originX: 0, originY: 0 },
    mesh,
    selected: new Set(),
    partOffset: { x: 0, y: 0 },
    drag: null,
  };
  const elements = viewportElements();
  bindViewport(state, elements);

  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0,
    pointerId: 2,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
  });

  assert.deepEqual([...state.selected], [0]);
  assert.deepEqual(state.drag.last, { x: 0, y: 0 });
});

test("scene view keeps the active selection locked in Edit Mode", () => {
  const selections = [];
  const statuses = [];
  const state = {
    editorMode: "edit",
    editor: {
      selectedNodeId: "part_a",
      selectNode: (nodeId) => selections.push(nodeId),
    },
  };
  const view = createSceneEditorView({
    state,
    elements: {},
    desktopApi: null,
    setStatus: (message) => statuses.push(message),
    updateEditorModeUi() {},
    updateZoomOutput() {},
  });

  view.selectSceneNode("part_b");
  assert.deepEqual(selections, []);
  assert.match(statuses[0], /active mesh-edit target/);

  state.editorMode = "object";
  view.selectSceneNode("part_b");
  assert.deepEqual(selections, ["part_b"]);
});

test("re-import view actions call only the existing review API", () => {
  const calls = [];
  const review = {
    markAsNew: (id) => calls.push(["add", id]),
    keepExisting: (id) => calls.push(["keep", id]),
    removeExisting: (id) => calls.push(["remove", id]),
    ignore: (id) => calls.push(["ignore", id]),
    resetToAuto: (id) => calls.push(["reset", id]),
    setMatch: (id, importedNodeId) => calls.push(["update", id, importedNodeId]),
  };
  const row = { id: "row_a", importedNodeId: "part_new" };

  for (const action of ["add", "keep", "remove", "ignore", "reset", "update"]) {
    applyReimportRowAction(review, row, action);
  }

  assert.deepEqual(calls, [
    ["add", "row_a"],
    ["keep", "row_a"],
    ["remove", "row_a"],
    ["ignore", "row_a"],
    ["reset", "row_a"],
    ["update", "row_a", "part_new"],
  ]);
});

test("mesh controller preserves generation, A/B capture, and deformation reset", () => {
  const elements = {
    generateButton: control(),
    resetButton: control(),
    captureAButton: control(),
    captureBButton: control(),
    playButton: control(),
    editButton: control(),
    timeSlider: control("0"),
    timeOutput: control(),
    durationInput: control("1"),
    columnsInput: control("1"),
    rowsInput: control("1"),
    keyframeStatus: control(),
    viewportWrap: { clientWidth: 100, clientHeight: 100 },
  };
  const state = {
    mode: "png",
    image: { width: 2, height: 2 },
    imageData: {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 255, 0, 0, 0, 255,
        0, 0, 0, 255, 0, 0, 0, 255,
      ]),
    },
    mesh: null,
    selected: new Set(),
    keyframes: { a: null, b: null },
    currentTime: 0,
    previewMode: false,
    playing: false,
    animationFrame: null,
  };
  let rendererMesh = null;
  const controller = createMeshEditingController({
    state,
    elements,
    renderer: {
      setMesh: (mesh) => { rendererMesh = mesh; },
      clearMesh() {},
      setTexture() {},
    },
    selectedPart: () => null,
    setStatus() {},
    render() {},
    documentRoot: {},
    requestFrame: () => 1,
    cancelFrame() {},
    now: () => 0,
  });
  controller.bind();

  elements.generateButton.dispatch("click");
  assert.equal(state.mesh, rendererMesh);
  state.mesh.vertexOffsets[0] = 3;
  elements.captureAButton.dispatch("click");
  state.mesh.vertexOffsets[0] = 7;
  elements.captureBButton.dispatch("click");
  assert.equal(state.keyframes.a[0], 3);
  assert.equal(state.keyframes.b[0], 7);

  state.selected.add(0);
  elements.resetButton.dispatch("click");
  assert.equal(state.mesh.vertexOffsets[0], 0);
  assert.equal(state.selected.size, 0);
});
