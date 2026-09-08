import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject } from "../src/model/project.js";
import { BoneAuthoringController } from "../src/ui/bone-authoring-controller.js";

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
  const session = new EditorSession(project);
  let sequence = 0;
  const controller = new BoneAuthoringController(session, {
    idFactory: (kind) => `${kind}_${++sequence}`,
  });
  controller.createChild({ displayName: "Root Bone", length: 10 });
  session.markSaved();
  return { session, controller, boneId: controller.selectedBoneId };
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
