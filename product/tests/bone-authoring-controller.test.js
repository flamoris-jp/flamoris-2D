import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";
import { BoneAuthoringController } from "../src/ui/bone-authoring-controller.js";
import {
  nearestBoneHandle,
  projectBoneOverlay,
} from "../src/ui/bone-viewport-overlay.js";
import { bindViewportInteractions } from "../src/ui/viewport-input-controller.js";

function fixture() {
  const project = createProject({
    name: "Bone authoring",
    width: 100,
    height: 100,
    idFactory: createIdFactory("bone_authoring"),
  });
  project.keyArts.push(
    { id: "key_a", displayName: "A", rootNodeId: project.scene.rootId, members: [], metadata: {} },
    { id: "key_b", displayName: "B", rootNodeId: project.scene.rootId, members: [], metadata: {} },
  );
  project.scene.nodes.part = createSceneNode({
    id: "part", displayName: "Part", parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push("part");
  const session = new EditorSession(project);
  let sequence = 0;
  const controller = new BoneAuthoringController(session, {
    idFactory: (kind) => `${kind}_${++sequence}`,
  });
  controller.createChild({ displayName: "Root Bone", length: 10 });
  session.markSaved();
  return { session, controller, boneId: controller.selectedBoneId };
}

function viewportHarness(session, controller) {
  const listeners = new Map();
  const eventTarget = (extra = {}) => ({
    ...extra,
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
  });
  const elements = {
    overlayCanvas: eventTarget({
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture() {},
    }),
    viewportWrap: eventTarget({ classList: { add() {}, remove() {} } }),
  };
  const state = {
    mode: "psd",
    editorMode: "object",
    editor: {
      session,
      selectedNodeId: controller.selectedBoneId,
      selectNode(boneId) {
        this.selectedNodeId = boneId;
        controller.selectBone(boneId);
      },
      transitionPreview: { getState: () => ({ viewMode: "endpoint-a" }) },
    },
    previewMode: false,
    spacePressed: false,
    view: { scale: 1, originX: 0, originY: 0 },
    psdParts: [],
  };
  const viewportRenderer = {
    projectedBoneOverlay: () => projectBoneOverlay({
      project: session.project,
      authoring: controller.getState(),
      view: state.view,
    }),
    projectedDeformerLattice: () => ({ points: [], segments: [], diagnostics: [] }),
  };
  bindViewportInteractions({
    state,
    elements,
    viewportRenderer,
    returnToEdit() {}, zoomAtScreenPoint() {}, panViewBy() {}, setEditorMode() {},
    undoProject() {}, redoProject() {}, render() {}, setStatus() {},
    selectedPart: () => null,
    boneAuthoring: () => controller,
    loadFile() {},
    windowTarget: eventTarget(),
  });
  return {
    overlay: () => viewportRenderer.projectedBoneOverlay(),
    dispatch(type, point, pointerId = 1) {
      for (const listener of listeners.get(type) || []) listener({
        type,
        button: 0,
        pointerId,
        clientX: point.x,
        clientY: point.y,
        shiftKey: false,
        preventDefault() {},
      });
    },
  };
}

function addNonlinearWarpAncestor(project, boneId) {
  const rootId = project.scene.rootId;
  const created = createWarpDeformer({
    id: "warp",
    displayName: "Warp",
    parentNodeId: rootId,
    columns: 2,
    rows: 2,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    controlPointIds: ["warp_tl", "warp_tr", "warp_bl", "warp_br"],
  });
  project.scene.nodes.warp = createSceneNode({
    id: "warp", kind: "deformer", displayName: "Warp", parentId: rootId,
  });
  project.scene.nodes.warp.children.push(boneId);
  project.scene.nodes[rootId].children = project.scene.nodes[rootId].children
    .map((id) => id === boneId ? "warp" : id);
  project.scene.nodes[boneId].parentId = "warp";
  project.rig.bones.find((bone) => bone.id === boneId).parentNodeId = "warp";
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  const regular = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints);
  const nonlinear = regular.map((point) => point.controlPointId.endsWith("tr")
    ? { ...point, x: 200 }
    : point);
  project.rig.warpDeformerKeyforms.push(
    { deformerId: "warp", keyArtId: "key_a", controlPoints: structuredClone(nonlinear) },
    { deformerId: "warp", keyArtId: "key_b", controlPoints: structuredClone(nonlinear) },
  );
}

test("Bone Edit and Pose mutate separate persistent domains", () => {
  const { session, controller, boneId } = fixture();
  controller.setRest({ x: 2, y: 3, rotation: 0.2, length: 12 });
  assert.deepEqual(session.query("bone.get", { boneId }).restLocalTransform,
    { x: 2, y: 3, rotation: 0.2 });
  assert.equal(session.query("bone.get_keyform", { boneId, keyArtId: "key_a" }), null);

  controller.setMode("pose");
  controller.setActiveKeyArt("key_a");
  controller.setPose({ x: 1, y: -1, rotation: 0.5 });
  assert.deepEqual(session.query("bone.get_keyform", {
    boneId, keyArtId: "key_a",
  }).localDelta, { x: 1, y: -1, rotation: 0.5 });
  assert.deepEqual(session.query("bone.get", { boneId }).restLocalTransform,
    { x: 2, y: 3, rotation: 0.2 });
});

test("first pose gesture creates the active Key-Art keyform in one history unit", () => {
  const { session, controller, boneId } = fixture();
  controller.setMode("pose");
  controller.setActiveKeyArt("key_a");
  const historyBefore = session.undoStack.length;
  controller.beginGesture();
  controller.previewGesture({ rotation: 0.2 });
  controller.previewGesture({ rotation: 0.4 });
  controller.previewGesture({ rotation: 0.75 });
  controller.commitGesture();

  assert.equal(session.undoStack.length, historyBefore + 1);
  assert.equal(session.undoStack.at(-1).label, "Create and edit Bone pose");
  assert.equal(session.query("bone.get_keyform", {
    boneId, keyArtId: "key_a",
  }).localDelta.rotation, 0.75);
  session.undo();
  assert.equal(session.query("bone.get_keyform", { boneId, keyArtId: "key_a" }), null);
  session.redo();
  assert.equal(session.query("bone.get_keyform", {
    boneId, keyArtId: "key_a",
  }).localDelta.rotation, 0.75);
});

test("explicit active Key Arts A and B keep independent Bone poses", () => {
  const { session, controller, boneId } = fixture();
  controller.setMode("pose");
  controller.setActiveKeyArt("key_a");
  controller.setPose({ x: 0, y: 0, rotation: 0.25 });
  controller.setActiveKeyArt("key_b");
  assert.deepEqual(controller.getState().editableValue, { x: 0, y: 0, rotation: 0 });
  controller.setPose({ x: 3, y: 4, rotation: -0.5 });
  assert.equal(session.query("bone.get_keyform", {
    boneId, keyArtId: "key_a",
  }).localDelta.rotation, 0.25);
  assert.deepEqual(session.query("bone.get_keyform", {
    boneId, keyArtId: "key_b",
  }).localDelta, { x: 3, y: 4, rotation: -0.5 });
});

test("transient Bone mode selection hover ghost and drag do not serialize or dirty Project", () => {
  const { session, controller } = fixture();
  const now = () => new Date("2026-09-08T00:00:00.000Z");
  const before = serializeProject(session.project, 2, { now });
  controller.setMode("pose");
  controller.setActiveKeyArt("key_a");
  controller.setGhostKeyArt("key_b");
  controller.setHover(controller.selectedBoneId);
  controller.beginGesture();
  controller.previewGesture({ x: 8, y: 9, rotation: 1.2 });
  assert.equal(session.isDirty, false);
  assert.equal(serializeProject(session.project, 2, { now }), before);
  controller.cancelGesture();
  assert.equal(session.isDirty, false);
});

test("child creation rename and validated reparent use normal Commands", () => {
  const { session, controller, boneId: parentId } = fixture();
  controller.createChild({ displayName: "Child", length: 6 });
  const childId = controller.selectedBoneId;
  assert.equal(session.query("bone.get", { boneId: childId }).parentNodeId, parentId);
  controller.rename("Hand");
  assert.equal(session.query("bone.get", { boneId: childId }).displayName, "Hand");
  assert.throws(() => controller.reparent(childId), (error) =>
    error.issues?.some((entry) => entry.code === "BONE_HIERARCHY_CYCLE") ||
    error.code === "BONE_HIERARCHY_CYCLE");
});

test("Bone authoring controller is DOM-independent and production packaged", async () => {
  const [source, manifest] = await Promise.all([
    readFile(new URL("../src/ui/bone-authoring-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../production-files.txt", import.meta.url), "utf8"),
  ]);
  assert.equal(source.includes("document."), false);
  assert.equal(source.includes("window."), false);
  assert.equal(source.includes("session.project"), false);
  assert.match(manifest, /src\/ui\/bone-authoring-controller\.js/);
});

test("viewport Bone projection exposes joints body parent link selected state and rotation handle", () => {
  const { session, controller, boneId: parentId } = fixture();
  controller.createChild({ displayName: "Child", length: 6 });
  const childId = controller.selectedBoneId;
  controller.setActiveKeyArt("key_a");
  const overlay = projectBoneOverlay({
    project: session.project,
    authoring: controller.getState(),
    view: { originX: 0, originY: 0, scale: 1 },
  });
  assert.deepEqual(overlay.diagnostics, []);
  assert.equal(overlay.bones.length, 2);
  const parent = overlay.bones.find((entry) => entry.boneId === parentId);
  const child = overlay.bones.find((entry) => entry.boneId === childId);
  assert.deepEqual(parent.head, { x: 0, y: 0 });
  assert.deepEqual(parent.tip, { x: 10, y: 0 });
  assert.equal(child.body.length, 4);
  assert.equal(child.selected, true);
  assert.deepEqual(child.parentLink, { from: parent.tip, to: child.head });
  assert.equal(nearestBoneHandle(overlay, child.rotationHandle).kind, "rotation");
  assert.equal(nearestBoneHandle(overlay, child.head).boneId, parentId);
});

test("viewport Edit drag converts document input through a rotated parent Bone", () => {
  const { session, controller, boneId: parentId } = fixture();
  controller.setRest({ x: 0, y: 0, rotation: Math.PI / 2, length: 10 });
  controller.createChild({ displayName: "Child", length: 6 });
  const childId = controller.selectedBoneId;
  controller.setRest({ x: 20, y: 0, rotation: 0, length: 6 });
  const viewport = viewportHarness(session, controller);
  const historyBefore = session.undoStack.length;
  const head = viewport.overlay().bones.find((entry) => entry.boneId === childId).head;
  viewport.dispatch("pointerdown", head, 11);
  viewport.dispatch("pointermove", { x: head.x + 5, y: head.y }, 11);
  viewport.dispatch("pointerup", { x: head.x + 5, y: head.y }, 11);

  assert.deepEqual(session.query("bone.get", { boneId: childId }).restLocalTransform, {
    x: 20,
    y: -5,
    rotation: 0,
  });
  assert.equal(session.undoStack.length, historyBefore + 1);
  const moved = viewport.overlay().bones.find((entry) => entry.boneId === childId);
  assert.ok(Math.abs(moved.head.x - head.x - 5) < 1e-9);
  assert.ok(Math.abs(moved.head.y - head.y) < 1e-9);

  const rotationHandle = moved.rotationHandle;
  viewport.dispatch("pointerdown", rotationHandle, 12);
  viewport.dispatch("pointermove", { x: moved.head.x, y: moved.head.y - 28 }, 12);
  viewport.dispatch("pointerup", { x: moved.head.x, y: moved.head.y - 28 }, 12);
  assert.ok(Math.abs(
    session.query("bone.get", { boneId: childId }).restLocalTransform.rotation - Math.PI / 2,
  ) < 1e-9);
  assert.equal(session.undoStack.length, historyBefore + 2);
});

test("viewport Pose drag writes the rotated-parent movement as Bone-local delta", () => {
  const { session, controller } = fixture();
  controller.setRest({ x: 0, y: 0, rotation: Math.PI / 2, length: 10 });
  controller.createChild({ displayName: "Child", length: 6 });
  const childId = controller.selectedBoneId;
  controller.setRest({ x: 20, y: 0, rotation: 0, length: 6 });
  controller.setMode("pose");
  controller.setActiveKeyArt("key_a");
  const viewport = viewportHarness(session, controller);
  const historyBefore = session.undoStack.length;
  const head = viewport.overlay().bones.find((entry) => entry.boneId === childId).head;
  viewport.dispatch("pointerdown", head, 21);
  viewport.dispatch("pointermove", { x: head.x + 5, y: head.y }, 21);
  viewport.dispatch("pointerup", { x: head.x + 5, y: head.y }, 21);

  assert.deepEqual(session.query("bone.get_keyform", {
    boneId: childId,
    keyArtId: "key_a",
  }).localDelta, { x: 0, y: -5, rotation: 0 });
  assert.equal(session.undoStack.length, historyBefore + 1);
  const moved = viewport.overlay().bones.find((entry) => entry.boneId === childId);
  assert.ok(Math.abs(moved.head.x - head.x - 5) < 1e-9);
  assert.ok(Math.abs(moved.head.y - head.y) < 1e-9);
});

test("viewport length drag inverts a non-affine Warp before storing local length", () => {
  const { session, controller, boneId } = fixture();
  controller.setRest({ x: 10, y: 0, rotation: 0, length: 10 });
  addNonlinearWarpAncestor(session.project, boneId);
  controller.setActiveKeyArt("key_a");
  const viewport = viewportHarness(session, controller);
  const historyBefore = session.undoStack.length;
  const projected = viewport.overlay().bones.find((entry) => entry.boneId === boneId);
  assert.ok(Math.abs(projected.head.x - 20) < 1e-9);
  assert.ok(Math.abs(projected.tip.x - 40) < 1e-9);
  viewport.dispatch("pointerdown", projected.tip, 31);
  viewport.dispatch("pointermove", { x: projected.tip.x + 20, y: projected.tip.y }, 31);
  viewport.dispatch("pointerup", { x: projected.tip.x + 20, y: projected.tip.y }, 31);

  assert.ok(Math.abs(session.query("bone.get", { boneId }).length - 20) < 1e-9);
  assert.equal(session.undoStack.length, historyBefore + 1);
  const moved = viewport.overlay().bones.find((entry) => entry.boneId === boneId);
  assert.ok(Math.abs(moved.tip.x - projected.tip.x - 20) < 1e-9);
});

test("authoring creates a rigid influence without Scene reparent or draw-order mutation", () => {
  const { session, controller, boneId } = fixture();
  const rootId = session.project.scene.rootId;
  const order = [...session.project.scene.nodes[rootId].children];
  controller.bindTarget("part", boneId);
  assert.deepEqual(session.project.scene.nodes[rootId].children, order);
  assert.equal(session.project.scene.nodes.part.parentId, rootId);
  assert.deepEqual(session.query("bone.get_rigid_binding_for_target", {
    targetNodeId: "part",
  }), {
    id: "rigid_binding_2",
    targetNodeId: "part",
    boneId,
    enabled: true,
  });
});
