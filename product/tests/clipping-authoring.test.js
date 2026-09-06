import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { ClippingAuthoringController } from "../src/ui/clipping-authoring-controller.js";
import { clippingMaskOverlayTriangles } from "../src/ui/viewport-renderer.js";

function fixture() {
  const project = createProject({
    name: "Clipping authoring",
    width: 100,
    height: 100,
    idFactory: createIdFactory("clipping_authoring"),
  });
  for (const id of ["source_a", "source_b", "target"]) {
    project.scene.nodes[id] = createSceneNode({
      id,
      displayName: id,
      parentId: project.scene.rootId,
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  const session = new EditorSession(project);
  const controller = new ClippingAuthoringController(session, {
    idFactory: () => "clip_target",
  });
  return { session, controller };
}

test("Inspector controller creates, changes, disables, removes, and Undo/Redo restores clipping", () => {
  const { session, controller } = fixture();
  controller.setSource("target", "source_a");
  assert.deepEqual(session.query("clipping.get_for_node", { nodeId: "target" }), {
    id: "clip_target",
    targetNodeId: "target",
    sourceNodeId: "source_a",
    mode: "inside",
    enabled: true,
  });
  controller.setSource("target", "source_b");
  controller.setEnabled("target", false);
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).enabled, false);
  session.undo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).enabled, true);
  session.undo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).sourceNodeId, "source_a");
  session.redo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).sourceNodeId, "source_b");
  controller.remove("target");
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }), null);
  session.undo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).id, "clip_target");
});

test("source candidates omit self but Command validation remains authoritative", () => {
  const { controller } = fixture();
  assert.deepEqual(controller.sourceCandidates("target").map((entry) => entry.id), [
    "source_a",
    "source_b",
  ]);
  assert.throws(() => controller.setSource("target", "target"), TransactionError);
});

test("Show Clipping Mask is transient and cannot affect Project, history, or dirty state", () => {
  const { session, controller } = fixture();
  const before = JSON.stringify(session.project);
  const history = session.history.length;
  const dirty = session.isDirty;
  controller.setShowMask(true);
  assert.equal(controller.getState("target").showMask, true);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, history);
  assert.equal(session.isDirty, dirty);
  assert.doesNotMatch(JSON.stringify(session.project), /showMask|Show Clipping Mask/);
});

test("Scene indicator and Inspector state are query projections with no persistent UI model", async () => {
  const { controller } = fixture();
  controller.setSource("target", "source_a");
  assert.deepEqual([...controller.bindingTargetIds()], ["target"]);
  const [controllerSource, viewSource] = await Promise.all([
    readFile(new URL("../src/ui/clipping-authoring-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/scene-editor-view.js", import.meta.url), "utf8"),
  ]);
  assert.match(controllerSource, /session\.query\("clipping\.list"/);
  assert.match(controllerSource, /session\.query\("clipping\.get_for_node"/);
  assert.match(controllerSource, /session\.execute/);
  assert.doesNotMatch(controllerSource, /session\.project|clippingBindings\s*=/);
  assert.match(viewSource, /bindingTargetIds\(\)/);
});

test("clipping visualization projects evaluated source geometry through its final transform", () => {
  const evaluation = {
    evaluatedParts: [{
      renderInstances: [{
        renderInstanceId: "target_instance",
        sourceNodeId: "target",
        clipping: { sourceRenderInstanceId: "source_instance", mode: "inside" },
        mesh: { positions: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] },
        transform: [1, 0, 0, 1, 0, 0],
      }, {
        renderInstanceId: "source_instance",
        sourceNodeId: "source_a",
        clipping: null,
        mesh: { positions: [0, 0, 10, 0, 0, 10], indices: [0, 1, 2] },
        transform: [2, 0, 0, 3, 5, 7],
      }],
    }],
  };
  assert.deepEqual(
    clippingMaskOverlayTriangles(evaluation, "target", {
      scale: 2,
      originX: 11,
      originY: 13,
    }),
    [[{ x: 21, y: 27 }, { x: 61, y: 27 }, { x: 21, y: 87 }]],
  );
  assert.deepEqual(clippingMaskOverlayTriangles(evaluation, "unbound", {
    scale: 2, originX: 11, originY: 13,
  }), []);
});

test("mask overlay is confined to viewport code and never enters export core", async () => {
  const [viewport, exportCore] = await Promise.all([
    readFile(new URL("../src/ui/viewport-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/export-frame-renderer.js", import.meta.url), "utf8"),
  ]);
  assert.match(viewport, /drawClippingMaskVisualization/);
  assert.doesNotMatch(exportCore, /showMask|clippingMaskOverlayTriangles|overlayCanvas/);
});
