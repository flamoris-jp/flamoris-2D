import test from "node:test";
import assert from "node:assert/strict";
import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../src/model/project.js";
import { EditorSession } from "../src/commands/editor.js";
import {
  bindPsdPartsToProject,
  EditorUiAdapter,
} from "../src/ui/editor-adapter.js";
import {
  createTransformGesture,
  pickNodeAtDocumentPoint,
  screenToMeshLocal,
} from "../src/ui/canvas-interaction.js";
import {
  changePivotPreservingLocalMatrix,
  invertAffine,
  localTransformMatrix,
  transformPoint,
} from "../src/core/transforms.js";
import { createProjectFromPsd } from "../src/io/psd-project.js";
import { collectPsdParts } from "../src/psd.js";

function fixture() {
  const ids = createIdFactory("ui");
  const project = createProject({
    name: "愛乃",
    width: 100,
    height: 100,
    idFactory: ids,
  });
  const groupId = ids("node");
  const partId = ids("node");
  project.scene.nodes[groupId] = createSceneNode({
    id: groupId,
    kind: "group",
    displayName: "顔",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[partId] = createSceneNode({
    id: partId,
    displayName: "左目・非表示",
    parentId: groupId,
    visible: false,
    bounds: { left: 10, top: 20, right: 30, bottom: 40 },
    sourceRef: { sourceKey: "layer:11" },
  });
  project.scene.nodes[project.scene.rootId].children.push(groupId);
  project.scene.nodes[groupId].children.push(partId);
  const session = new EditorSession(project);
  const adapter = new EditorUiAdapter(session);
  return { project, session, adapter, groupId, partId };
}

test("tree projection includes hidden Unicode nodes and filters with ancestors", () => {
  const { adapter, groupId, partId } = fixture();
  assert.equal(adapter.getTree().children[0].children[0].id, partId);
  adapter.setFilter("左目");
  const filtered = adapter.getTree();
  assert.equal(filtered.children[0].id, groupId);
  assert.equal(filtered.children[0].children[0].displayName, "左目・非表示");
});

test("selection is transient and persistent UI edits use Core history", () => {
  const { adapter, session, partId } = fixture();
  const before = JSON.stringify(session.project);
  adapter.selectNode(partId);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, 0);

  adapter.renameSelected("左目・虹彩");
  adapter.setVisibility(partId, true);
  assert.equal(session.query("scene.get_node", { nodeId: partId }).displayName, "左目・虹彩");
  assert.equal(session.history.length, 2);
  adapter.undo();
  assert.equal(session.query("scene.get_node", { nodeId: partId }).visible, false);
  adapter.redo();
  assert.equal(session.query("scene.get_node", { nodeId: partId }).visible, true);
});

test("Undo and Redo expose the next history label to the UI", () => {
  const { adapter, partId } = fixture();
  assert.equal(adapter.undoLabel, null);
  assert.equal(adapter.redoLabel, null);

  adapter.selectNode(partId);
  adapter.renameSelected("左目・履歴表示");
  assert.equal(adapter.undoLabel, "Rename node");
  assert.equal(adapter.redoLabel, null);

  adapter.undo();
  assert.equal(adapter.undoLabel, null);
  assert.equal(adapter.redoLabel, "Rename node");
});

test("gizmo preview commits many pointer updates as one undo entry", () => {
  const { adapter, session, groupId, partId } = fixture();
  adapter.selectNode(groupId);
  const drag = adapter.beginTransformDrag("Move group");
  for (let x = 1; x <= 20; x += 1) {
    adapter.previewTransform({
      ...drag.initialTransform,
      position: { x, y: x * 2 },
    });
  }
  assert.equal(session.history.length, 0);
  assert.deepEqual(
    transformPoint(adapter.worldTransform(partId), { x: 0, y: 0 }),
    { x: 20, y: 40 },
  );
  adapter.commitTransformDrag();
  assert.equal(session.history.length, 1);
  assert.deepEqual(
    session.query("scene.get_node", { nodeId: groupId }).transform.position,
    { x: 20, y: 40 },
  );
  adapter.undo();
  assert.deepEqual(
    session.query("scene.get_node", { nodeId: groupId }).transform.position,
    { x: 0, y: 0 },
  );
});

test("PSD render assets bind to stable Product node IDs", () => {
  const psd = {
    width: 100,
    height: 100,
    children: [{
      name: "顔",
      children: [{
        id: 11,
        name: "左目",
        left: 10,
        top: 20,
        right: 30,
        bottom: 40,
        canvas: { width: 20, height: 20 },
      }],
    }],
  };
  const project = createProjectFromPsd(psd);
  const bound = bindPsdPartsToProject(
    collectPsdParts(psd.children),
    project,
  );
  const partId = Object.values(project.scene.nodes)
    .find((node) => node.displayName === "左目").id;
  assert.equal(bound[0].sourceKey, "layer:11");
  assert.equal(bound[0].nodeId, partId);
  assert.notEqual(bound[0].nodeId, bound[0].name);
});

test("canvas picking uses effective visibility and inherited transforms", () => {
  const { adapter, session, groupId, partId } = fixture();
  adapter.setVisibility(partId, true);
  adapter.selectNode(groupId);
  adapter.setSelectedTransform({
    position: { x: 40, y: 5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
  });
  const parts = [{
    nodeId: partId,
    left: 10,
    top: 20,
    right: 30,
    bottom: 40,
  }];
  assert.equal(
    pickNodeAtDocumentPoint(parts, adapter, { x: 55, y: 30 }),
    partId,
  );
  session.execute({
    type: "scene.set_visibility",
    payload: { nodeId: groupId, visible: false },
  });
  assert.equal(
    pickNodeAtDocumentPoint(parts, adapter, { x: 55, y: 30 }),
    null,
  );
});

test("transform gestures edit node-local translate, rotate, scale, and pivot", () => {
  const { session, partId } = fixture();
  const node = session.query("scene.get_node", { nodeId: partId });
  const translate = createTransformGesture(
    session.project,
    node,
    "translate",
    { x: 0, y: 0 },
  ).update({ x: 7, y: 9 });
  assert.deepEqual(translate.position, { x: 7, y: 9 });

  const rotate = createTransformGesture(
    session.project,
    node,
    "rotate",
    { x: 10, y: 0 },
  ).update({ x: 0, y: 10 });
  assert.ok(Math.abs(rotate.rotation - Math.PI / 2) < 1e-9);

  const scale = createTransformGesture(
    session.project,
    node,
    "scale",
    { x: 10, y: 0 },
  ).update({ x: 20, y: 0 });
  assert.deepEqual(scale.scale, { x: 2, y: 2 });

  const pivot = createTransformGesture(
    session.project,
    node,
    "pivot",
    { x: 0, y: 0 },
  ).update({ x: 5, y: 6 });
  assert.deepEqual(pivot.pivot, { x: 5, y: 6 });
  assert.deepEqual(pivot.position, { x: 0, y: 0 });
});

test("affine inversion and pivot editing preserve rendered geometry", () => {
  const initial = {
    position: { x: 12, y: -4 },
    rotation: Math.PI / 3,
    scale: { x: 2, y: 0.75 },
    pivot: { x: 3, y: 5 },
  };
  const before = localTransformMatrix(initial);
  const after = localTransformMatrix(
    changePivotPreservingLocalMatrix(initial, { x: 20, y: -8 }),
  );
  before.forEach((value, index) => {
    assert.ok(Math.abs(value - after[index]) < 1e-9);
  });
  const point = { x: 4, y: 9 };
  const roundTrip = transformPoint(
    invertAffine(before),
    transformPoint(before, point),
  );
  assert.ok(Math.abs(roundTrip.x - point.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - point.y) < 1e-9);
});

function assertPointClose(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${actual.y} != ${expected.y}`);
}

function screenPointForMeshLocal(meshLocal, view, partOffset, worldTransform) {
  const partPoint = {
    x: meshLocal.x + partOffset.x,
    y: meshLocal.y + partOffset.y,
  };
  const documentPoint = transformPoint(worldTransform, partPoint);
  return {
    x: view.originX + documentPoint.x * view.scale,
    y: view.originY + documentPoint.y * view.scale,
  };
}

test("mesh-local pointer conversion preserves identity transform coordinates", () => {
  const view = { originX: 30, originY: -12, scale: 2 };
  const partOffset = { x: 10, y: 20 };
  const expected = { x: 4, y: 7 };
  const identity = [1, 0, 0, 1, 0, 0];
  assertPointClose(screenToMeshLocal(
    screenPointForMeshLocal(expected, view, partOffset, identity),
    view,
    { worldTransform: identity, partOffset },
  ), expected);
});

test("mesh-local pointer conversion inverts translated parts", () => {
  const view = { originX: 5, originY: 8, scale: 1.5 };
  const partOffset = { x: 12, y: 6 };
  const expected = { x: 9, y: -3 };
  const translated = localTransformMatrix({
    position: { x: 40, y: -15 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
  });
  assertPointClose(screenToMeshLocal(
    screenPointForMeshLocal(expected, view, partOffset, translated),
    view,
    { worldTransform: translated, partOffset },
  ), expected);
});

test("mesh-local pointer conversion inversely rotates drag direction", () => {
  const view = { originX: 0, originY: 0, scale: 1 };
  const rotation = localTransformMatrix({
    position: { x: 0, y: 0 },
    rotation: Math.PI / 2,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
  });
  const start = screenToMeshLocal({ x: 0, y: 0 }, view, {
    worldTransform: rotation,
  });
  const end = screenToMeshLocal({ x: 0, y: 10 }, view, {
    worldTransform: rotation,
  });
  assertPointClose({ x: end.x - start.x, y: end.y - start.y }, { x: 10, y: 0 });
});

test("mesh-local pointer conversion inversely scales drag amount", () => {
  const view = { originX: 0, originY: 0, scale: 1 };
  const scaled = localTransformMatrix({
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 2, y: 0.5 },
    pivot: { x: 0, y: 0 },
  });
  const start = screenToMeshLocal({ x: 0, y: 0 }, view, {
    worldTransform: scaled,
  });
  const end = screenToMeshLocal({ x: 10, y: 10 }, view, {
    worldTransform: scaled,
  });
  assertPointClose({ x: end.x - start.x, y: end.y - start.y }, { x: 5, y: 20 });
});

test("mesh-local pointer conversion handles combined rotation and scale", () => {
  const view = { originX: 17, originY: 23, scale: 2.5 };
  const partOffset = { x: 14, y: -5 };
  const expected = { x: -8, y: 11 };
  const combined = localTransformMatrix({
    position: { x: 31, y: -19 },
    rotation: Math.PI / 3,
    scale: { x: 2.25, y: 0.6 },
    pivot: { x: 4, y: 7 },
  });
  assertPointClose(screenToMeshLocal(
    screenPointForMeshLocal(expected, view, partOffset, combined),
    view,
    { worldTransform: combined, partOffset },
  ), expected);
});
