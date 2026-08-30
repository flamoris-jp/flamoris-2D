import test from "node:test";
import assert from "node:assert/strict";
import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../src/model/project.js";
import {
  CommandError,
  EditorSession,
  TransactionError,
} from "../src/commands/editor.js";
import {
  createRecoveryStore,
  createAutosavingSession,
  deserializeProject,
  serializeProject,
} from "../src/io/project-json.js";
import { transformPoint } from "../src/core/transforms.js";

function fixture() {
  const ids = createIdFactory("test");
  const project = createProject({
    name: "愛乃",
    width: 1920,
    height: 1080,
    idFactory: ids,
  });
  const partId = ids("node");
  project.scene.nodes[partId] = createSceneNode({
    id: partId,
    displayName: "左目",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push(partId);
  return { project, ids, partId };
}

test("headless commands rename/group/transform and undo/redo deterministically", () => {
  const { project, ids, partId } = fixture();
  const session = new EditorSession(project);
  const groupId = ids("node");
  session.executeTransaction([
    {
      type: "scene.create_group",
      payload: {
        id: groupId,
        parentId: project.scene.rootId,
        displayName: "目グループ",
      },
    },
    {
      type: "scene.reparent_node",
      payload: { nodeId: partId, parentId: groupId },
    },
    {
      type: "scene.rename_node",
      payload: { nodeId: partId, displayName: "左目・虹彩" },
    },
    {
      type: "scene.set_transform",
      payload: {
        nodeId: groupId,
        coordinateSpace: "node-local",
        transform: {
          position: { x: 10, y: 20 },
          rotation: 0,
          scale: { x: 2, y: 2 },
          pivot: { x: 0, y: 0 },
        },
      },
    },
  ], { label: "目をグループ化" });

  assert.equal(
    session.query("scene.get_node", { nodeId: partId }).displayName,
    "左目・虹彩",
  );
  const world = session.query(
    "scene.get_node",
    { nodeId: partId },
  ).worldTransform;
  assert.deepEqual(
    transformPoint(world, { x: 1, y: 1 }),
    { x: 12, y: 22 },
  );
  assert.equal(session.history.length, 1);
  session.undo();
  assert.equal(
    session.query("scene.get_node", { nodeId: partId }).displayName,
    "左目",
  );
  assert.equal(session.project.scene.nodes[groupId], undefined);
  session.redo();
  assert.equal(
    session.query("scene.get_node", { nodeId: partId }).parentId,
    groupId,
  );
});

test("transactions roll back when validation fails", () => {
  const { project, partId } = fixture();
  const session = new EditorSession(project);
  assert.throws(() => session.execute({
    type: "scene.set_transform",
    payload: {
      nodeId: partId,
      coordinateSpace: "node-local",
      transform: {
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 0, y: 1 },
        pivot: { x: 0, y: 0 },
      },
    },
  }), TransactionError);
  assert.equal(
    session.project.scene.nodes[partId].transform.scale.x,
    1,
  );
  assert.equal(session.history.length, 0);
});

test("deserialize rejects roots with a parent or a non-group kind", () => {
  const { project, partId } = fixture();
  const parentedRoot = structuredClone(project);
  parentedRoot.scene.nodes[parentedRoot.scene.rootId].parentId = partId;
  assert.throws(
    () => deserializeProject(JSON.stringify(parentedRoot)),
    (error) =>
      error instanceof TransactionError &&
      error.issues.some(
        (entry) => entry.code === "scene.root_parent_not_null",
      ),
  );

  const partRoot = structuredClone(project);
  partRoot.scene.nodes[partRoot.scene.rootId].kind = "part";
  assert.throws(
    () => deserializeProject(JSON.stringify(partRoot)),
    (error) =>
      error instanceof TransactionError &&
      error.issues.some(
        (entry) => entry.code === "scene.root_not_group",
      ),
  );
});

test("malformed command payloads are rejected before transaction mutation", () => {
  const { project, partId } = fixture();
  const session = new EditorSession(project);

  assert.throws(() => session.execute({
    type: "scene.set_visibility",
    payload: { nodeId: partId, visible: "false" },
  }), CommandError);
  assert.equal(session.project.scene.nodes[partId].visible, true);

  assert.throws(() => session.executeTransaction([
    {
      type: "scene.rename_node",
      payload: { nodeId: partId, displayName: "変更されない名前" },
    },
    {
      type: "scene.set_locked",
      payload: { nodeId: partId, locked: "false" },
    },
  ]), CommandError);
  assert.equal(
    session.project.scene.nodes[partId].displayName,
    "左目",
  );
  assert.equal(session.history.length, 0);
});

test("set_transform is a complete node-local replacement", () => {
  const { project, partId } = fixture();
  project.scene.nodes[partId].transform.rotation = 0.75;
  project.scene.nodes[partId].transform.scale = { x: 2, y: 3 };
  const session = new EditorSession(project);

  assert.throws(() => session.execute({
    type: "scene.set_transform",
    payload: {
      nodeId: partId,
      coordinateSpace: "node-local",
      transform: { position: { x: 10, y: 20 } },
    },
  }), CommandError);
  assert.equal(
    session.project.scene.nodes[partId].transform.rotation,
    0.75,
  );
  assert.deepEqual(
    session.project.scene.nodes[partId].transform.scale,
    { x: 2, y: 3 },
  );

  assert.throws(() => session.execute({
    type: "scene.set_transform",
    payload: {
      nodeId: partId,
      coordinateSpace: "document",
      transform: structuredClone(
        session.project.scene.nodes[partId].transform,
      ),
    },
  }), CommandError);
  assert.equal(session.history.length, 0);
});

test("tree and search share effective visibility semantics", () => {
  const { project, ids, partId } = fixture();
  const hiddenGroupId = ids("node");
  project.scene.nodes[hiddenGroupId] = createSceneNode({
    id: hiddenGroupId,
    kind: "group",
    displayName: "非表示グループ",
    parentId: project.scene.rootId,
    visible: false,
  });
  project.scene.nodes[project.scene.rootId].children = [hiddenGroupId];
  project.scene.nodes[hiddenGroupId].children.push(partId);
  project.scene.nodes[partId].parentId = hiddenGroupId;
  const session = new EditorSession(project);

  assert.deepEqual(
    session.query("scene.get_tree", { includeHidden: false }).children,
    [],
  );
  assert.deepEqual(
    session.query("scene.search", {
      text: "左目",
      includeHidden: false,
    }),
    [],
  );
  const hiddenResult = session.query("scene.search", {
    text: "左目",
    includeHidden: true,
  });
  assert.equal(hiddenResult[0].visible, true);
  assert.equal(hiddenResult[0].effectiveVisible, false);
  assert.equal(
    session.query("scene.get_node", { nodeId: partId })
      .effectiveVisible,
    false,
  );
});

test("project JSON and recovery store round-trip persistent state", () => {
  const { project } = fixture();
  assert.deepEqual(
    deserializeProject(serializeProject(project)),
    project,
  );
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const recovery = createRecoveryStore(storage);
  recovery.save(project);
  assert.deepEqual(recovery.load(), project);
  recovery.clear();
  assert.equal(recovery.load(), null);

  const autosave = createAutosavingSession(project, storage);
  autosave.session.execute({
    type: "scene.rename_node",
    payload: {
      nodeId: project.scene.rootId,
      displayName: "自動保存済み",
    },
  });
  assert.equal(
    autosave.recovery.load().scene.nodes[project.scene.rootId].displayName,
    "自動保存済み",
  );
});
