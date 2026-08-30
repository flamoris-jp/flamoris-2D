import test from "node:test";
import assert from "node:assert/strict";
import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../src/model/project.js";
import {
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
      transform: { scale: { x: 0, y: 1 } },
    },
  }), TransactionError);
  assert.equal(
    session.project.scene.nodes[partId].transform.scale.x,
    1,
  );
  assert.equal(session.history.length, 0);
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
