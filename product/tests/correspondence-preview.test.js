import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { serializeProject } from "../src/io/project-json.js";
import { TransitionAuthoringController } from "../src/ui/transition-authoring-controller.js";
import { EndpointMeshController } from "../src/ui/endpoint-mesh-controller.js";
import { MeshToolController } from "../src/ui/mesh-tool-controller.js";
import { CorrespondencePreviewController } from "../src/ui/correspondence-preview-controller.js";
import { transformPoint } from "../src/core/transforms.js";

function member(nodeId, appearanceId) {
  return { nodeId, appearanceId, opacity: 1, presence: "present", drawOrder: 0,
    clipping: { sourceNodeId: null } };
}

function fixture() {
  const project = createProject({
    name: "Correspondence", width: 200, height: 200,
    idFactory: createIdFactory("correspondence"),
  });
  for (const [id, x] of [["node_a", 10], ["node_b", 80]]) {
    project.scene.nodes[id] = createSceneNode({
      id, displayName: id, parentId: project.scene.rootId,
      transform: { position: { x, y: 20 }, rotation: x / 200,
        scale: { x: 1 + x / 100, y: 0.8 }, pivot: { x: 0, y: 0 } },
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
      members: [member("node_a", "art_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId,
      members: [member("node_b", "art_b")], metadata: {} },
  );
  project.semanticSlots.push({
    id: "slot", displayName: "Face", metadata: {},
    mappings: [
      { keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" },
    ],
  });
  project.meshTopologies.push({
    id: "topology", vertexIds: ["vtx_0001", "vtx_0002", "vtx_0003"],
    indices: [0, 1, 2], vertexMetadata: {
      vtx_0001: { semanticLabel: "chin_tip" },
    }, nextVertexSequence: 4,
  });
  project.meshKeyforms.push(
    { id: "keyform_a", topologyId: "topology", keyArtId: "keyart_a",
      semanticSlotId: "slot", positions: [0, 0, 10, 0, 0, 10],
      uvs: [0, 0, 1, 0, 0, 1] },
    { id: "keyform_b", topologyId: "topology", keyArtId: "keyart_b",
      semanticSlotId: "slot", positions: [20, 20, 30, 20, 20, 30],
      uvs: [0, 0, 1, 0, 0, 1] },
  );
  project.temporalPrograms.push({ id: "program", durationTicks: 120000,
    tracks: [], events: [], regions: [] });
  project.transitions.push({
    id: "transition", displayName: "A to B", fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b", temporalProgramId: "program", diagnosticOverrides: [],
    partTransitions: [{ id: "part", semanticSlotId: "slot", mode: "morph",
      topologyId: "topology", fromKeyformId: "keyform_a", toKeyformId: "keyform_b",
      configuration: {} }],
  });
  const session = new EditorSession(project);
  const authoring = new TransitionAuthoringController(session);
  authoring.selectTransition("transition");
  authoring.selectSemanticSlot("slot");
  const endpoint = new EndpointMeshController(session, authoring);
  endpoint.selectTopology("topology");
  endpoint.selectKeyform("from", "keyform_a");
  endpoint.selectKeyform("to", "keyform_b");
  endpoint.selectEndpoint("from");
  let correspondence;
  const meshTools = new MeshToolController(session, endpoint, {
    isPreviewReadOnly: () => Boolean(correspondence?.getState().previewActive),
  });
  correspondence = new CorrespondencePreviewController(session, endpoint);
  return { session, endpoint, meshTools, correspondence };
}

test("pin workspace supports add, move, delete, clear and rejects duplicate Stable IDs", () => {
  const { session, correspondence } = fixture();
  const before = JSON.stringify(session.project);
  const historyLength = session.history.length;
  correspondence.addPin("vtx_0001", { x: 4, y: 5 });
  assert.equal(correspondence.getState().pins[0].semanticLabel, "chin_tip");
  assert.throws(() => correspondence.addPin("vtx_0001", { x: 1, y: 1 }),
    (error) => error.code === "CORRESPONDENCE_DUPLICATE_PIN");
  correspondence.movePin("vtx_0001", { x: 7, y: 8 });
  assert.deepEqual(correspondence.getState().pins[0].target, { x: 7, y: 8 });
  correspondence.removePin();
  correspondence.addPin("vtx_0002", { x: 12, y: 3 });
  correspondence.clearWorkspace();
  assert.equal(correspondence.getState().pinCount, 0);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, historyLength);
});

test("Solve preview is transient, history-free, read-only, and serializes no workspace state", () => {
  const { session, endpoint, meshTools, correspondence } = fixture();
  const before = JSON.stringify(session.project);
  const historyLength = session.history.length;
  correspondence.addPin("vtx_0001", { x: 5, y: 7 });
  correspondence.solve();
  assert.equal(correspondence.getState().previewActive, true);
  assert.equal(endpoint.getState().activeEndpoint, "to");
  assert.equal(endpoint.getState().editingEnabled, false);
  assert.throws(() => meshTools.execute("deform.move", {
    positions: [1, 1, 11, 1, 1, 11],
  }), /Preview is read-only/);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, historyLength);
  assert.doesNotMatch(serializeProject(session.project),
    /selectedPin|pendingVertex|candidatePositions|falloffPower|previewActive|pinCount/);
});

test("Apply is one ordinary command; Undo and Redo restore exact positions without solver rerun", () => {
  const { session, endpoint, meshTools } = fixture();
  let solveCount = 0;
  const correspondence = new CorrespondencePreviewController(session, endpoint, {
    solver(input) {
      solveCount += 1;
      return {
        candidatePositions: [3, 4, 13, 4, 3, 14], diagnostics: [], settings: input.settings,
      };
    },
  });
  const original = [...session.query("mesh.get_keyform", { keyformId: "keyform_b" }).positions];
  correspondence.addPin("vtx_0001", { x: 3, y: 4 });
  correspondence.solve();
  correspondence.apply(meshTools);
  const solved = session.query("mesh.get_keyform", { keyformId: "keyform_b" }).positions;
  assert.deepEqual(solved, [3, 4, 13, 4, 3, 14]);
  assert.deepEqual(session.history.at(-1).commandTypes, ["mesh_keyform.move_vertices"]);
  assert.equal(endpoint.getState().editingEnabled, true);
  assert.equal(endpoint.getState().activeEndpoint, "to");
  assert.equal(meshTools.getState().mode, "deform");
  session.undo();
  assert.deepEqual(session.query("mesh.get_keyform", { keyformId: "keyform_b" }).positions, original);
  session.redo();
  assert.deepEqual(session.query("mesh.get_keyform", { keyformId: "keyform_b" }).positions, solved);
  assert.equal(solveCount, 1);
});

test("B to A direction uses the same controller/core boundary", () => {
  const { session, correspondence } = fixture();
  correspondence.setDirection("to", "from");
  correspondence.addPin("vtx_0002", { x: 8, y: -1 });
  const preview = correspondence.solve();
  assert.equal(preview.sourceKeyformId, "keyform_b");
  assert.equal(preview.targetKeyformId, "keyform_a");
  assert.deepEqual(preview.candidatePositions, [-2, -1, 8, -1, -2, 9]);
  assert.equal(session.history.length, 2);
});

test("target anchor screen conversion is endpoint-local and independent of zoom/pan", () => {
  const { endpoint } = fixture();
  const local = { x: 9, y: 14 };
  const documentPoint = transformPoint(endpoint.endpointWorldTransform("to"), local);
  for (const view of [
    { scale: 0.5, originX: -30, originY: 75 },
    { scale: 4, originX: 310, originY: -140 },
  ]) {
    const screen = {
      x: documentPoint.x * view.scale + view.originX,
      y: documentPoint.y * view.scale + view.originY,
    };
    const result = endpoint.screenToEndpointKeyformLocal("to", screen, view);
    assert.ok(Math.abs(result.x - local.x) < 1e-9);
    assert.ok(Math.abs(result.y - local.y) < 1e-9);
  }
});

test("correspondence controller is DOM-independent and production allowlisted", async () => {
  const [source, rendererSource, allowlist] = await Promise.all([
    readFile(new URL("../src/ui/correspondence-preview-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/viewport-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../production-files.txt", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|session\.project/);
  assert.match(source, /mesh_keyform\.move_vertices/);
  assert.match(rendererSource, /new Float32Array\(correspondence\.candidatePositions\)/);
  assert.match(rendererSource, /CORRESPONDENCE PREVIEW/);
  assert.match(allowlist, /^src\/ui\/correspondence-preview-controller\.js$/m);
});
