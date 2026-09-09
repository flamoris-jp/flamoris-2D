import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { BoneMirrorAuthoringController } from "../src/ui/bone-mirror-authoring-controller.js";

function fixture() {
  const project = createProject({ name: "Mirror", width: 100, height: 100,
    idFactory: createIdFactory("mirror") });
  const parent = project.scene.rootId;
  for (const [id, transform, length] of [
    ["source_without_left_name", { x: -4, y: 3, rotation: 0.25 }, 12],
    ["target_without_right_name", { x: 2, y: 8, rotation: -1 }, 5],
  ]) {
    project.scene.nodes[id] = createSceneNode({ id, kind: "bone", displayName: id,
      parentId: parent, transform: boneSceneTransform(transform) });
    project.scene.nodes[parent].children.push(id);
    project.rig.bones.push(createBone({ id, parentNodeId: parent,
      restLocalTransform: transform, length }));
  }
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: parent,
    sourceAssetId: null, members: [], metadata: {} });
  project.rig.bonePoseKeyforms.push({ boneId: "source_without_left_name", keyArtId: "key",
    localDelta: { x: 2, y: 3, rotation: 0.4 } });
  return new EditorSession(project);
}

function controllerFor(session) {
  const controller = new BoneMirrorAuthoringController(session);
  controller.setPair({ sourceBoneId: "source_without_left_name",
    targetBoneId: "target_without_right_name", activeKeyArtId: "key", axisX: 1 });
  return controller;
}

test("explicit pair rest mirror is numeric, one history unit, and preserves hierarchy/IDs", () => {
  const session = fixture();
  const beforeChildren = [...session.project.scene.nodes[session.project.scene.rootId].children];
  const beforeIds = session.project.rig.bones.map((entry) => entry.id);
  controllerFor(session).mirrorRest();
  const target = session.query("bone.get", { boneId: "target_without_right_name" });
  assert.deepEqual(target.restLocalTransform, {
    x: 6, y: 3, rotation: Math.PI - 0.25,
  });
  assert.equal(target.length, 12);
  assert.equal(session.undoStack.length, 1);
  assert.deepEqual(session.project.scene.nodes[session.project.scene.rootId].children, beforeChildren);
  assert.deepEqual(session.project.rig.bones.map((entry) => entry.id), beforeIds);
  session.undo();
  assert.deepEqual(session.query("bone.get", { boneId: target.id }).restLocalTransform,
    { x: 2, y: 8, rotation: -1 });
});

test("explicit pair pose mirror writes ordinary Key-Art pose and supports exact Undo/Redo", () => {
  const session = fixture();
  controllerFor(session).mirrorPose();
  const expected = { x: -2, y: 3, rotation: -0.4 };
  assert.deepEqual(session.query("bone.get_keyform", {
    boneId: "target_without_right_name", keyArtId: "key",
  }).localDelta, expected);
  assert.equal(session.undoStack.length, 1);
  session.undo();
  assert.equal(session.query("bone.get_keyform", {
    boneId: "target_without_right_name", keyArtId: "key",
  }), null);
  session.redo();
  assert.deepEqual(session.query("bone.get_keyform", {
    boneId: "target_without_right_name", keyArtId: "key",
  }).localDelta, expected);
});

test("mirror authoring never guesses a pair from Bone names", () => {
  const session = fixture();
  const controller = new BoneMirrorAuthoringController(session);
  assert.throws(() => controller.mirrorRest(), /explicit source\/target/);
});

test("mirror helper/controller are DOM-independent and production packaged", async () => {
  const [helper, controller, manifest] = await Promise.all([
    readFile(new URL("../src/core/bone-mirror-helper.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/bone-mirror-authoring-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../production-files.txt", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(helper + controller, /\bdocument\b|\bwindow\b|HTMLElement/);
  assert.doesNotMatch(helper + controller, /left|right/i);
  assert.match(manifest, /^src\/core\/bone-mirror-helper\.js$/m);
  assert.match(manifest, /^src\/ui\/bone-mirror-authoring-controller\.js$/m);
});
