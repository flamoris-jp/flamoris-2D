import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { createWarpDeformer } from "../src/model/warp-deformer.js";
import { DeformerAuthoringController } from "../src/ui/deformer-authoring-controller.js";
import {
  nearestDeformerControlPoint,
  projectDeformerLattice,
} from "../src/ui/deformer-viewport-overlay.js";
import { bindViewportInteractions } from "../src/ui/viewport-input-controller.js";

function fixture() {
  const project = createProject({
    name: "Deformer Authoring",
    width: 100,
    height: 100,
    idFactory: createIdFactory("deformer_ui"),
  });
  const created = createWarpDeformer({
    id: "warp",
    displayName: "Warp",
    parentNodeId: project.scene.rootId,
    columns: 2,
    rows: 2,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    controlPointIds: ["cp_tl", "cp_tr", "cp_bl", "cp_br"],
  });
  project.scene.nodes.warp = createSceneNode({
    id: "warp", kind: "deformer", displayName: "Warp", parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push("warp");
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [], metadata: {} },
  );
  const session = new EditorSession(project);
  let endpoint = "from";
  const endpointMesh = {
    getState: () => ({
      editingEnabled: true,
      activeEndpoint: endpoint,
      activeTransition: { id: "transition", fromKeyArtId: "keyart_a", toKeyArtId: "keyart_b" },
      endpoints: {
        from: { keyArt: { id: "keyart_a", displayName: "A" } },
        to: { keyArt: { id: "keyart_b", displayName: "B" } },
      },
    }),
  };
  const controller = new DeformerAuthoringController(session, endpointMesh, {
    idFactory: (() => {
      let sequence = 0;
      return () => `new_cp_${++sequence}`;
    })(),
  });
  controller.selectDeformer("warp");
  return { session, controller, setEndpoint: (value) => { endpoint = value; } };
}

test("first Warp drag creates one Key Art keyform and one undo unit", () => {
  const { session, controller } = fixture();
  controller.selectControlPoint("cp_tl");
  controller.beginDrag();
  controller.previewDrag({ x: 12, y: 7 });
  controller.commitDrag();

  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints[0], { controlPointId: "cp_tl", x: 12, y: 7 });
  assert.equal(session.undoStack.length, 1);
  assert.equal(session.undoStack[0].label, "Create and edit Warp keyform");
  session.undo();
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }), null);
  session.redo();
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints[0].x, 12);
});

test("Warp A and B authoring states are independent", () => {
  const { session, controller, setEndpoint } = fixture();
  controller.selectControlPoint("cp_tl");
  controller.beginDrag();
  controller.previewDrag({ x: 10, y: 0 });
  controller.commitDrag();
  setEndpoint("to");
  controller.beginDrag();
  controller.previewDrag({ x: 0, y: 20 });
  controller.commitDrag();

  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints[0], { controlPointId: "cp_tl", x: 10, y: 0 });
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_b",
  }).controlPoints[0], { controlPointId: "cp_tl", x: 0, y: 20 });
  const reopened = deserializeProject(serializeProject(session.project));
  assert.deepEqual(
    reopened.rig.warpDeformerKeyforms,
    session.project.rig.warpDeformerKeyforms,
  );
  assert.deepEqual(reopened.rig.deformers[0].controlPointIds, ["cp_tl", "cp_tr", "cp_bl", "cp_br"]);
});

test("Warp multi-select, box select, drag preview and reset remain command based", () => {
  const { session, controller } = fixture();
  controller.selectControlPoint("cp_tl");
  controller.selectControlPoint("cp_tr", { additive: true });
  assert.deepEqual(controller.getState().selectedControlPointIds, ["cp_tl", "cp_tr"]);
  controller.beginDrag();
  controller.previewDrag({ x: 5, y: 6 });
  assert.deepEqual(controller.getState().controlPoints.slice(0, 2), [
    { controlPointId: "cp_tl", x: 5, y: 6 },
    { controlPointId: "cp_tr", x: 105, y: 6 },
  ]);
  controller.commitDrag();
  controller.clearSelection();
  controller.beginBoxSelection({ x: -1, y: -1 });
  controller.previewBoxSelection({ x: 110, y: 10 });
  assert.deepEqual(controller.commitBoxSelection(), ["cp_tl", "cp_tr"]);
  controller.resetSelected();
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints.slice(0, 2), [
    { controlPointId: "cp_tl", x: 0, y: 0 },
    { controlPointId: "cp_tr", x: 100, y: 0 },
  ]);
  session.undo();
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints[0].x, 5);
  controller.resetAll();
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints[0].x, 0);
});

test("Warp selection, hover, box and drag previews never enter Project serialization", () => {
  const { session, controller } = fixture();
  const before = structuredClone(session.project);
  controller.selectControlPoint("cp_tl");
  controller.setHover("cp_br");
  controller.beginBoxSelection({ x: 0, y: 0 });
  controller.previewBoxSelection({ x: 50, y: 50 });
  controller.beginDrag();
  controller.previewDrag({ x: 3, y: 4 });
  assert.deepEqual(session.project, before);
  assert.equal(session.isDirty, false);
  assert.equal(session.undoStack.length, 0);
});

test("authored Warp keyforms lock grid changes with an explicit reason", () => {
  const { controller } = fixture();
  controller.selectControlPoint("cp_tl");
  controller.beginDrag();
  controller.previewDrag({ x: 1, y: 0 });
  controller.commitDrag();
  assert.equal(controller.getState().gridLocked, true);
  assert.match(controller.getState().gridLockReason, /Authored Warp keyforms/);
  assert.throws(() => controller.setGrid(3), /must be removed/);
});

test("viewport projection exposes the regular lattice with stable control-point identity", () => {
  const { session, controller } = fixture();
  const state = controller.getState();
  const projected = projectDeformerLattice({
    project: session.project,
    deformer: state.deformer,
    keyArtId: state.activeKeyArt.id,
    controlPoints: state.controlPoints,
    view: { scale: 2, originX: 10, originY: 20 },
  });
  assert.equal(projected.points.length, 4);
  assert.equal(projected.segments.length, 4);
  assert.deepEqual(projected.points[0], {
    controlPointId: "cp_tl",
    document: { x: 0, y: 0 },
    screen: { x: 10, y: 20 },
  });
  assert.equal(nearestDeformerControlPoint(projected, { x: 12, y: 21 }), "cp_tl");
});

test("viewport pointer drag selects and commits one Warp authoring gesture", () => {
  const { session, controller } = fixture();
  const listeners = new Map();
  const target = (extra = {}) => ({
    ...extra,
    addEventListener(type, listener) {
      const atType = listeners.get(type) || [];
      atType.push(listener);
      listeners.set(type, atType);
    },
  });
  const classes = { add() {}, remove() {} };
  const elements = {
    overlayCanvas: target({
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture() {},
    }),
    viewportWrap: target({ classList: classes }),
  };
  const state = {
    mode: "psd",
    editorMode: "object",
    editor: {
      session,
      selectedNodeId: "warp",
      worldTransform: () => [1, 0, 0, 1, 0, 0],
      transitionPreview: { getState: () => ({ viewMode: "endpoint-a" }) },
    },
    previewMode: false,
    spacePressed: false,
    view: { scale: 1, originX: 0, originY: 0 },
    psdParts: [],
  };
  const viewportRenderer = {
    projectedDeformerLattice: () => projectDeformerLattice({
      project: session.project,
      deformer: controller.getState().deformer,
      keyArtId: "keyart_a",
      controlPoints: controller.getState().controlPoints,
      view: state.view,
    }),
  };
  bindViewportInteractions({
    state,
    elements,
    viewportRenderer,
    returnToEdit() {}, zoomAtScreenPoint() {}, panViewBy() {}, setEditorMode() {},
    undoProject() {}, redoProject() {}, render() {}, setStatus() {},
    selectedPart: () => null,
    deformerAuthoring: () => controller,
    loadFile() {},
    windowTarget: target(),
  });
  const dispatch = (type, event) => (listeners.get(type) || []).forEach((listener) => listener(event));
  dispatch("pointerdown", {
    button: 0, pointerId: 7, clientX: 0, clientY: 0, shiftKey: false, preventDefault() {},
  });
  dispatch("pointermove", { pointerId: 7, clientX: 8, clientY: 4 });
  assert.equal(session.undoStack.length, 0);
  dispatch("pointerup", { type: "pointerup", pointerId: 7 });
  assert.equal(session.undoStack.length, 1);
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "keyart_a",
  }).controlPoints[0], { controlPointId: "cp_tl", x: 8, y: 4 });
});

test("Warp authoring stays DOM-independent, command-based, and production packaged", async () => {
  const [controller, overlay, manifest] = await Promise.all([
    readFile(new URL("../src/ui/deformer-authoring-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/deformer-viewport-overlay.js", import.meta.url), "utf8"),
    readFile(new URL("../production-files.txt", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(controller, /\bdocument\b|\bwindow\b|HTMLElement|session\.project/);
  assert.match(controller, /deformer\.move_control_points/);
  assert.match(controller, /deformer\.set_keyform/);
  assert.match(controller, /deformer\.reset_control_points/);
  assert.doesNotMatch(overlay, /SharedCompositionRenderer|renderEvaluated|clippingBinding/);
  assert.match(manifest, /^src\/ui\/deformer-authoring-controller\.js$/m);
  assert.match(manifest, /^src\/ui\/deformer-viewport-overlay\.js$/m);
});
