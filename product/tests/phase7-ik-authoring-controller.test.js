import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession } from "../src/commands/editor.js";
import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createTwoBoneIkConstraint } from "../src/model/two-bone-ik-constraint.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { TwoBoneIkAuthoringController } from "../src/ui/two-bone-ik-authoring-controller.js";

function addBone(project, id, parentNodeId, x, length) {
  project.scene.nodes[id] = createSceneNode({ id, kind: "bone", displayName: id,
    parentId: parentNodeId, transform: boneSceneTransform({ x, y: 0, rotation: 0 }) });
  project.scene.nodes[parentNodeId].children.push(id);
  project.rig.bones.push(createBone({ id, parentNodeId,
    restLocalTransform: { x, y: 0, rotation: 0 }, length }));
}

function fixture() {
  const project = createProject({ name: "IK authoring", width: 100, height: 100,
    idFactory: createIdFactory("ik_author") });
  const rootId = project.scene.rootId;
  addBone(project, "root", rootId, 0, 10);
  addBone(project, "mid", "root", 10, 10);
  addBone(project, "end", "mid", 10, 2);
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: rootId,
    sourceAssetId: null, members: [], metadata: {} });
  project.rig.twoBoneIkConstraints.push(createTwoBoneIkConstraint({ id: "ik",
    rootBoneId: "root", midBoneId: "mid", endBoneId: "end" }));
  return project;
}

function authoring() {
  const session = new EditorSession(fixture());
  const controller = new TwoBoneIkAuthoringController(session);
  controller.setContext({ constraintId: "ik", keyArtId: "key" });
  return { session, controller };
}

test("one IK target drag atomically bakes two pose keyforms into one history unit", () => {
  const { session, controller } = authoring();
  controller.beginTargetDrag();
  controller.previewTarget({ x: 10, y: 10 });
  assert.equal(session.undoStack.length, 0);
  assert.equal(session.isDirty, false);
  assert.equal(session.project.rig.bonePoseKeyforms.length, 0);
  controller.commitTargetDrag();
  assert.equal(session.undoStack.length, 1);
  assert.equal(session.undoStack[0].commands.length, 2);
  assert.deepEqual(session.project.rig.bonePoseKeyforms.map((entry) => entry.boneId).sort(),
    ["mid", "root"]);
});

test("IK drag Undo and Redo restore the exact authored pose state", () => {
  const { session, controller } = authoring();
  const before = structuredClone(session.project.rig.bonePoseKeyforms);
  controller.beginTargetDrag();
  controller.previewTarget({ x: 7, y: 12 });
  controller.commitTargetDrag();
  const after = structuredClone(session.project.rig.bonePoseKeyforms);
  session.undo();
  assert.deepEqual(session.project.rig.bonePoseKeyforms, before);
  session.redo();
  assert.deepEqual(session.project.rig.bonePoseKeyforms, after);
});

test("IK target and drag preview stay transient and do not serialize", () => {
  const { session, controller } = authoring();
  controller.beginTargetDrag();
  controller.previewTarget({ x: 6, y: 13 });
  const serialized = JSON.stringify(session.project);
  assert.doesNotMatch(serialized, /"target"/);
  assert.doesNotMatch(serialized, /6[^0-9]*13/);
  assert.equal(session.isDirty, false);
  controller.cancelTargetDrag();
  assert.equal(controller.getState().dragging, false);
});

test("bend toggle and enabled state use ordinary Commands", () => {
  const { session, controller } = authoring();
  controller.setBendDirection("clockwise");
  assert.equal(controller.activeConstraint().bendDirection, "clockwise");
  controller.setEnabled(false);
  assert.equal(controller.activeConstraint().enabled, false);
  assert.equal(session.undoStack.length, 2);
  session.undo();
  assert.equal(controller.activeConstraint().enabled, true);
});

test("IK constraint creation uses explicit chain IDs and no name inference", () => {
  const session = new EditorSession(fixture());
  session.project.rig.twoBoneIkConstraints = [];
  const controller = new TwoBoneIkAuthoringController(session, {
    idFactory: () => "new_ik",
  });
  controller.createConstraint({ rootBoneId: "root", midBoneId: "mid", endBoneId: "end" });
  assert.deepEqual(controller.activeConstraint(), {
    id: "new_ik", rootBoneId: "root", midBoneId: "mid", endBoneId: "end",
    enabled: true, bendDirection: "counterclockwise",
  });
});
