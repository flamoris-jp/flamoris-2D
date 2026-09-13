import test from "node:test";
import assert from "node:assert/strict";

import { generateGridMesh, imageToScreen } from "../src/mesh.js";
import { multiplyAffine, transformPoint } from "../src/core/transforms.js";
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

test("endpoint vertex drag previews transiently and commits one keyform position update", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    10,
    10,
    1,
    1,
  );
  const committed = [];
  const endpoint = {
    getState: () => ({ editingEnabled: true }),
    activeKeyform: () => ({ id: "keyform_a" }),
    commitActiveMeshPositions: (positions) => committed.push(positions),
  };
  const state = {
    mode: "psd", editorMode: "edit", editor: null, previewMode: false,
    spacePressed: false, view: { scale: 1, originX: 0, originY: 0 },
    mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
  };
  const elements = viewportElements();
  bindViewport(state, elements, { endpointMesh: () => endpoint });
  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0, pointerId: 9, clientX: 0, clientY: 0, shiftKey: false,
  });
  elements.overlayCanvas.dispatch("pointermove", {
    pointerId: 9, clientX: 7, clientY: 4,
  });
  assert.equal(committed.length, 0);
  elements.overlayCanvas.dispatch("pointerup", { pointerId: 9 });
  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0].slice(0, 2), [7, 4]);
});

test("Topology Edit selects through the stable-ID controller and Add never starts a deform drag", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 100, 100, 1, 1,
  );
  const calls = [];
  const tools = {
    activeToolId: "topology.add",
    selectVertexByIndex: (index, additive) => calls.push(["select", index, additive]),
    execute: (toolId, payload) => calls.push([toolId, payload]),
  };
  const state = {
    mode: "psd", editorMode: "topology", editor: null, previewMode: false,
    spacePressed: false, view: { scale: 1, originX: 0, originY: 0 },
    mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
  };
  const elements = viewportElements();
  bindViewport(state, elements, {
    endpointMesh: () => ({ getState: () => ({ editingEnabled: true }) }),
    meshTools: () => tools,
    selectedPart: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0, pointerId: 11, clientX: 50, clientY: 50, shiftKey: false,
  });
  assert.equal(state.drag, null);
  assert.deepEqual(calls[0], ["select", -1, false]);
  assert.deepEqual(calls[1], ["topology.add", {
    position: { x: 50, y: 50 },
    uv: { x: 0.5, y: 0.5 },
  }]);
});

test("Weight viewport stroke previews moves and commits once on pointer-up", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10, 10, 1, 1,
  );
  const calls = [];
  const authoring = {
    setSelectedVertex: (id) => calls.push(["select", id]),
    beginStroke: () => calls.push(["begin"]),
    previewStroke: (ids) => calls.push(["preview", ids]),
    commitStroke: () => calls.push(["commit"]),
    cancelStroke: () => calls.push(["cancel"]),
  };
  const tools = {
    selectVertexByIndex() {},
    activeTopology: () => ({ vertexIds: ["v1", "v2", "v3", "v4"] }),
  };
  const state = {
    mode: "psd", editorMode: "weight", editor: null, previewMode: false,
    spacePressed: false, view: { scale: 1, originX: 0, originY: 0 },
    mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
  };
  const elements = viewportElements();
  bindViewport(state, elements, {
    endpointMesh: () => ({ getState: () => ({ editingEnabled: true }) }),
    meshTools: () => tools,
    weightAuthoring: () => authoring,
  });
  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0, pointerId: 41, clientX: 0, clientY: 0, shiftKey: false,
  });
  elements.overlayCanvas.dispatch("pointermove", {
    pointerId: 41, clientX: 10, clientY: 0,
  });
  assert.equal(calls.some(([name]) => name === "commit"), false);
  elements.overlayCanvas.dispatch("pointerup", { pointerId: 41 });
  assert.deepEqual(calls, [
    ["select", "v1"], ["begin"], ["preview", ["v1"]],
    ["preview", ["v2"]], ["commit"],
  ]);
});

test("Form Correction viewport drag stays transient until one pointer-up commit", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10, 10, 1, 1,
  );
  const calls = [];
  const authoring = {
    selectVertex: (id, additive) => calls.push(["select", id, additive]),
    beginGesture: () => calls.push(["begin"]),
    previewGesture: (delta) => calls.push(["preview", delta]),
    commitGesture: () => calls.push(["commit"]),
    cancelGesture: () => calls.push(["cancel"]),
  };
  const tools = {
    selectVertexByIndex() {},
    activeTopology: () => ({ vertexIds: ["v1", "v2", "v3", "v4"] }),
  };
  const state = {
    mode: "psd", editorMode: "form-correction", editor: null, previewMode: false,
    spacePressed: false, view: { scale: 1, originX: 0, originY: 0 },
    mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
  };
  const elements = viewportElements();
  bindViewport(state, elements, {
    endpointMesh: () => ({ getState: () => ({ editingEnabled: true }) }),
    meshTools: () => tools,
    formCorrectionAuthoring: () => authoring,
  });
  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0, pointerId: 42, clientX: 0, clientY: 0, shiftKey: false,
  });
  elements.overlayCanvas.dispatch("pointermove", {
    pointerId: 42, clientX: 4, clientY: 6,
  });
  assert.equal(calls.some(([name]) => name === "commit"), false);
  elements.overlayCanvas.dispatch("pointerup", { pointerId: 42 });
  assert.deepEqual(calls, [
    ["select", "v1", false], ["begin"], ["preview", { x: 4, y: 6 }], ["commit"],
  ]);
});

test("Weight and Form Correction pick the displayed evaluated vertex by stable ID", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10, 10, 1, 1,
  );
  // v1 is rendered far from its rest/deformed mesh coordinate. A pointer at
  // this point must not fall back to base vertex positions or persist it.
  const evaluatedPositions = new Float32Array([100, 50, 110, 50, 100, 60, 110, 60]);
  const tools = {
    selectVertexByIndex() {},
    activeTopology: () => ({ vertexIds: ["v1", "v2", "v3", "v4"] }),
  };
  for (const mode of ["weight", "form-correction"]) {
    const calls = [];
    const authoring = mode === "weight"
      ? {
        setSelectedVertex: (id) => calls.push(["select", id]),
        beginStroke: () => calls.push(["begin"]),
        previewStroke: (ids) => calls.push(["preview", ids]),
        commitStroke: () => calls.push(["commit"]),
        cancelStroke() {},
      }
      : {
        selectVertex: (id) => calls.push(["select", id]),
        beginGesture: () => calls.push(["begin"]),
        previewGesture: () => calls.push(["preview"]),
        commitGesture: () => calls.push(["commit"]),
        cancelGesture() {},
      };
    const state = {
      mode: "psd", editorMode: mode, editor: null, previewMode: false,
      spacePressed: false, view: { scale: 1, originX: 0, originY: 0 },
      mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
    };
    const elements = viewportElements();
    bindViewport(state, elements, {
      endpointMesh: () => ({ getState: () => ({ editingEnabled: true }) }),
      meshTools: () => tools,
      viewportRenderer: {
        screenPointForPart: (x, y) => ({ x, y }),
        evaluatedMeshPositions: () => evaluatedPositions,
      },
      ...(mode === "weight"
        ? { weightAuthoring: () => authoring }
        : { formCorrectionAuthoring: () => authoring }),
    });
    elements.overlayCanvas.dispatch("pointerdown", {
      button: 0, pointerId: 70, clientX: 100, clientY: 50, shiftKey: false,
    });
    elements.overlayCanvas.dispatch("pointerup", { pointerId: 70 });
    assert.deepEqual(calls.filter(([name]) => name === "select"), [["select", "v1"]]);
    assert.equal(calls.filter(([name]) => name === "commit").length, 1);
    assert.deepEqual([...mesh.baseVertices], [0, 0, 10, 0, 0, 10, 10, 10]);
  }
});

test("pending correspondence pin consumes one viewport click in target mesh-local coordinates", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10, 10, 1, 1,
  );
  const placed = [];
  const correspondence = {
    getState: () => ({ pendingVertexId: "vtx_0002", targetEndpoint: "to", previewActive: false }),
    placePendingPin: (point) => placed.push(point),
  };
  const endpoint = {
    screenToEndpointKeyformLocal(endpointName, screenPoint, view) {
      assert.equal(endpointName, "to");
      assert.deepEqual(view, { scale: 3, originX: 40, originY: -20 });
      return { x: (screenPoint.x - 40) / 3, y: (screenPoint.y + 20) / 3 };
    },
  };
  const state = {
    mode: "psd", editorMode: "edit", editor: null, previewMode: false,
    spacePressed: false, view: { scale: 3, originX: 40, originY: -20 },
    mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
  };
  const elements = viewportElements();
  bindViewport(state, elements, {
    endpointMesh: () => endpoint,
    correspondencePreview: () => correspondence,
  });
  elements.overlayCanvas.dispatch("pointerdown", {
    button: 0, pointerId: 17, clientX: 61, clientY: 13, shiftKey: false,
  });
  assert.deepEqual(placed, [{ x: 7, y: 11 }]);
  assert.equal(state.drag, null);
  assert.equal(state.selected.size, 0);
});

test("endpoint viewport drag uses the rendered endpoint world transform at any zoom", () => {
  // The resolved matrix includes a parent/group transform and the endpoint's
  // own Translate + Rotate + Scale transform. This is the same matrix supplied
  // to both the overlay renderer and the pointer drag path.
  const parentWorld = [1.25, 0, 0, 0.75, 30, -12];
  const endpointLocal = [0, 2, -3, 0, 40, 25];
  const endpointWorld = multiplyAffine(parentWorld, endpointLocal);

  function dragAtView(view) {
    const mesh = generateGridMesh(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10, 10, 1, 1,
    );
    const committed = [];
    const endpoint = {
      getState: () => ({ editingEnabled: true }),
      activeKeyform: () => ({ id: "keyform_a" }),
      commitActiveMeshPositions: (positions) => committed.push(positions),
    };
    const state = {
      mode: "psd", editorMode: "edit",
      editor: { worldTransform: (nodeId) => {
        assert.equal(nodeId, "endpoint_a");
        return endpointWorld;
      } },
      previewMode: false, spacePressed: false, view,
      mesh, selected: new Set(), partOffset: { x: 0, y: 0 }, drag: null,
    };
    const elements = viewportElements();
    const screenPointForPart = (x, y) => {
      const documentPoint = transformPoint(endpointWorld, { x, y });
      return imageToScreen(documentPoint.x, documentPoint.y, view);
    };
    bindViewport(state, elements, {
      endpointMesh: () => endpoint,
      selectedPart: () => ({ nodeId: "endpoint_a" }),
      viewportRenderer: { screenPointForPart },
    });

    const start = screenPointForPart(0, 0);
    const target = screenPointForPart(3, 4);
    elements.overlayCanvas.dispatch("pointerdown", {
      button: 0, pointerId: 10, clientX: start.x, clientY: start.y, shiftKey: false,
    });
    elements.overlayCanvas.dispatch("pointermove", {
      pointerId: 10, clientX: target.x, clientY: target.y,
    });
    elements.overlayCanvas.dispatch("pointerup", { pointerId: 10 });
    assert.equal(committed.length, 1);
    return committed[0];
  }

  const baseline = dragAtView({ scale: 1, originX: 0, originY: 0 });
  const zoomedAndPanned = dragAtView({ scale: 2.25, originX: 180, originY: -95 });
  for (const positions of [baseline, zoomedAndPanned]) {
    assert.ok(Math.abs(positions[0] - 3) < 1e-6);
    assert.ok(Math.abs(positions[1] - 4) < 1e-6);
  }
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

test("Mesh preparation can switch the active render part in Edit Mode", () => {
  const selections = [];
  const state = {
    editorMode: "topology",
    editor: {
      selectedNodeId: "part_a",
      getNode: (nodeId) => ({ id: nodeId, kind: "part" }),
      selectNode: (nodeId) => selections.push(nodeId),
    },
  };
  const view = createSceneEditorView({
    state,
    elements: {},
    desktopApi: null,
    setStatus() {},
    updateEditorModeUi() {},
    updateZoomOutput() {},
    canSelectMeshPreparationPart: () => true,
  });

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

test("mesh grid generation uses the production topology command in Mesh preparation", () => {
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
    image: { width: 2, height: 2 },
    imageData: {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16).fill(255),
    },
    mesh: null,
    partOffset: { x: 10, y: 20 },
    selected: new Set(),
    keyframes: { a: null, b: null },
    currentTime: 0,
    previewMode: false,
    playing: false,
    animationFrame: null,
  };
  const calls = [];
  const tools = {
    activeTopology: () => null,
    execute: (...args) => calls.push(args),
  };
  const controller = createMeshEditingController({
    state,
    elements,
    renderer: { setMesh() {}, clearMesh() {}, setTexture() {} },
    selectedPart: () => ({ name: "Face" }),
    meshTools: () => tools,
    persistGridMesh: () => true,
    setStatus() {},
    render() {},
    documentRoot: {},
    requestFrame: () => 1,
    cancelFrame() {},
    now: () => 0,
  });
  controller.bind();

  elements.generateButton.dispatch("click");

  assert.equal(state.mesh, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "topology.automesh");
  assert.equal(calls[0][1].replaceExisting, false);
  assert.deepEqual(calls[0][1].candidate.positions.slice(0, 2), [10, 20]);
});
