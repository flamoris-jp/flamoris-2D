import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { createIdFactory, createProject, createSceneNode, identityTransform } from "../src/model/project.js";
import { serializeProject } from "../src/io/project-json.js";
import { transformPoint, worldTransformMatrix } from "../src/core/transforms.js";
import { TransitionAuthoringController } from "../src/ui/transition-authoring-controller.js";
import { EndpointMeshController } from "../src/ui/endpoint-mesh-controller.js";
import { readFile } from "node:fs/promises";

function member(nodeId, appearanceId) {
  return { nodeId, appearanceId, opacity: 1, presence: "present", drawOrder: 0, clipping: { sourceNodeId: null } };
}

function setup({ alternateTopology = false } = {}) {
  const project = createProject({ name: "Endpoint mesh", width: 500, height: 400, idFactory: createIdFactory("endpoint") });
  const group = createSceneNode({ id: "group", kind: "group", displayName: "Group", parentId: project.scene.rootId,
    transform: { ...identityTransform(), position: { x: 30, y: 40 }, rotation: Math.PI / 7, scale: { x: 1.2, y: 0.8 } } });
  const from = createSceneNode({ id: "node_a", displayName: "A part", parentId: "group",
    transform: { ...identityTransform(), position: { x: 15, y: 12 }, rotation: Math.PI / 4, scale: { x: 1.5, y: 0.75 } } });
  const to = createSceneNode({ id: "node_b", displayName: "B part", parentId: "group",
    transform: { ...identityTransform(), position: { x: 180, y: 45 }, rotation: -Math.PI / 6, scale: { x: 0.6, y: 1.7 } } });
  for (const node of [group, from, to]) project.scene.nodes[node.id] = node;
  project.scene.nodes[project.scene.rootId].children.push("group");
  group.children.push("node_a", "node_b");
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "art_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "art_b")], metadata: {} },
  );
  project.semanticSlots.push({ id: "slot", displayName: "Slot", mappings: [{ keyArtId: "keyart_a", nodeId: "node_a" }, { keyArtId: "keyart_b", nodeId: "node_b" }], metadata: {} });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"], indices: [0, 1, 2] });
  if (alternateTopology) project.meshTopologies.push({ id: "topology_other", vertexIds: ["o1", "o2", "o3"], indices: [0, 1, 2] });
  project.temporalPrograms.push({ id: "program", durationTicks: 120000, tracks: [], events: [], regions: [] });
  project.transitions.push({ id: "transition", displayName: "A to B", fromKeyArtId: "keyart_a", toKeyArtId: "keyart_b", temporalProgramId: "program", partTransitions: [{ id: "part", semanticSlotId: "slot", mode: "replace", topologyId: null, fromKeyformId: null, toKeyformId: null, configuration: {} }], diagnosticOverrides: [] });
  const session = new EditorSession(project);
  const authoring = new TransitionAuthoringController(session, { idFactory: (kind) => `${kind}_id` });
  authoring.selectTransition("transition");
  authoring.selectSemanticSlot("slot");
  const mesh = new EndpointMeshController(session, authoring, { idFactory: (kind) => `${kind}_id` });
  return { session, authoring, mesh };
}

function createBoth(mesh) {
  mesh.selectTopology("topology");
  mesh.createKeyform("from", { keyformId: "keyform_a", positions: [1, 2, 3, 4, 5, 6], uvs: [0, 0, 1, 0, 0, 1] });
  mesh.createKeyform("to", { keyformId: "keyform_b", positions: [11, 12, 13, 14, 15, 16], uvs: [0, 0, 1, 0, 0, 1] });
}

test("endpoint selection, topology selection, and vertex selection are transient and never serialize", () => {
  const { session, mesh } = setup({ alternateTopology: true });
  const before = JSON.stringify(session.project);
  mesh.selectEndpoint("to");
  mesh.selectTopology("topology_other");
  mesh.selectVertex(0);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, 0);
  assert.doesNotMatch(serializeProject(session.project), /activeEndpoint|selectedTopology|selectedVertex/);
});

test("multiple topology candidates require explicit selection and do not mutate PartTransition", () => {
  const { session, mesh } = setup({ alternateTopology: true });
  assert.equal(mesh.getState().selectedTopologyId, null);
  assert.equal(session.project.transitions[0].partTransitions[0].topologyId, null);
  mesh.selectTopology("topology_other");
  assert.equal(session.project.transitions[0].partTransitions[0].topologyId, null);
  assert.equal(session.history.length, 0);
});

test("MeshTopology create/update/remove and list query use normal Undo/Redo", () => {
  const { session, mesh } = setup();
  mesh.createTopology({ topologyId: "created", vertexIds: ["c1", "c2", "c3"], indices: [0, 1, 2] });
  mesh.updateTopology("created", { vertexIds: ["c1", "c2", "c3", "c4"], indices: [0, 1, 2, 1, 3, 2] });
  assert.equal(session.query("mesh.list_topologies").find((entry) => entry.id === "created").vertexIds.length, 4);
  session.undo();
  assert.equal(session.query("mesh.get_topology", { topologyId: "created" }).vertexIds.length, 3);
  session.redo();
  mesh.removeTopology("created");
  session.undo();
  assert.equal(session.query("mesh.get_topology", { topologyId: "created" }).vertexIds.length, 4);
});

test("shared topology creates A/B keyforms and transition reference update is Undo/Redo safe", () => {
  const { session, mesh } = setup();
  createBoth(mesh);
  const part = session.project.transitions[0].partTransitions[0];
  assert.deepEqual([part.topologyId, part.fromKeyformId, part.toKeyformId], ["topology", "keyform_a", "keyform_b"]);
  session.undo();
  assert.equal(session.project.transitions[0].partTransitions[0].topologyId, null);
  session.redo();
  assert.equal(session.project.transitions[0].partTransitions[0].topologyId, "topology");
});

test("headless workflow creates topology, A/B keyforms, and Morph references in one Undo step", () => {
  const { session, mesh } = setup();
  mesh.createSharedTopologyAndKeyforms({
    topologyId: "fresh_topology", fromKeyformId: "fresh_a", toKeyformId: "fresh_b",
    vertexIds: ["a", "b", "c"], indices: [0, 1, 2],
    fromPositions: [0, 0, 4, 0, 0, 4], fromUvs: [0, 0, 1, 0, 0, 1],
    toPositions: [1, 1, 5, 1, 1, 5], toUvs: [0, 0, 1, 0, 0, 1],
  });
  assert.equal(session.history.at(-1).commandTypes.length, 5);
  assert.equal(session.project.transitions[0].partTransitions[0].mode, "morph");
  session.undo();
  assert.equal(session.project.meshTopologies.some((entry) => entry.id === "fresh_topology"), false);
  session.redo();
  assert.equal(session.project.transitions[0].partTransitions[0].toKeyformId, "fresh_b");
});

test("keyform creation, update, and removal use normal history", () => {
  const { session, mesh } = setup();
  mesh.selectTopology("topology");
  mesh.createKeyform("from", { keyformId: "keyform_a", positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] });
  mesh.moveVertex("keyform_a", 1, { x: 22, y: 33 });
  assert.deepEqual(session.project.meshKeyforms[0].positions.slice(2, 4), [22, 33]);
  session.undo();
  assert.deepEqual(session.project.meshKeyforms[0].positions.slice(2, 4), [10, 0]);
  session.redo();
  session.execute({ type: "mesh_keyform.remove", payload: { keyformId: "keyform_a" } });
  session.undo();
  assert.equal(session.project.meshKeyforms[0].id, "keyform_a");
});

test("validation rejects mismatched A/B topology, endpoint KeyArt, and SemanticSlot", () => {
  const { session } = setup();
  const invalid = structuredClone(session.project);
  invalid.meshKeyforms.push(
    { id: "a", topologyId: "topology", keyArtId: "keyart_a", semanticSlotId: "slot", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "b", topologyId: "topology", keyArtId: "keyart_a", semanticSlotId: "slot", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
  );
  invalid.transitions[0].partTransitions[0] = { ...invalid.transitions[0].partTransitions[0], mode: "morph", topologyId: "topology", fromKeyformId: "a", toKeyformId: "b" };
  assert.throws(() => new EditorSession(invalid), TransactionError);

  const topologyMismatch = structuredClone(session.project);
  topologyMismatch.meshTopologies.push({ id: "other", vertexIds: ["x", "y", "z"], indices: [0, 1, 2] });
  topologyMismatch.meshKeyforms.push(
    { id: "ta", topologyId: "topology", keyArtId: "keyart_a", semanticSlotId: "slot", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "tb", topologyId: "other", keyArtId: "keyart_b", semanticSlotId: "slot", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
  );
  topologyMismatch.transitions[0].partTransitions[0] = { ...topologyMismatch.transitions[0].partTransitions[0], mode: "morph", topologyId: "topology", fromKeyformId: "ta", toKeyformId: "tb" };
  assert.throws(() => new EditorSession(topologyMismatch), TransactionError);

  const slotMismatch = structuredClone(session.project);
  slotMismatch.semanticSlots.push({ id: "other_slot", displayName: "Other", mappings: [], metadata: {} });
  slotMismatch.meshKeyforms.push(
    { id: "sa", topologyId: "topology", keyArtId: "keyart_a", semanticSlotId: "slot", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "sb", topologyId: "topology", keyArtId: "keyart_b", semanticSlotId: "other_slot", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
  );
  slotMismatch.transitions[0].partTransitions[0] = { ...slotMismatch.transitions[0].partTransitions[0], mode: "morph", topologyId: "topology", fromKeyformId: "sa", toKeyformId: "sb" };
  assert.throws(() => new EditorSession(slotMismatch), TransactionError);
});

test("endpoint coordinate conversion resolves independent A/B world transforms including parent rotation and scale", () => {
  const { mesh } = setup();
  const view = { scale: 2.25, originX: 19, originY: -11 };
  for (const endpoint of ["from", "to"]) {
    mesh.selectEndpoint(endpoint);
    const mapping = mesh.getState().selectedSemanticSlot[endpoint].mapping;
    const local = { x: 12.5, y: -8.25 };
    const world = worldTransformMatrix(mesh.session.project, mapping.nodeId);
    assert.deepEqual(mesh.activeEndpointWorldTransform(), world);
    const documentPoint = transformPoint(world, local);
    const screenPoint = { x: documentPoint.x * view.scale + view.originX, y: documentPoint.y * view.scale + view.originY };
    const result = mesh.screenToActiveKeyformLocal(screenPoint, view);
    assert.ok(Math.abs(result.x - local.x) < 1e-9);
    assert.ok(Math.abs(result.y - local.y) < 1e-9);
  }
});

test("viewport zoom and pan do not alter persisted endpoint-local coordinates", () => {
  const { mesh } = setup();
  mesh.selectEndpoint("from");
  const local = { x: 9, y: 17 };
  const world = mesh.activeEndpointWorldTransform();
  const documentPoint = transformPoint(world, local);
  for (const view of [
    { scale: 0.45, originX: -120, originY: 87 },
    { scale: 6.2, originX: 430, originY: -250 },
  ]) {
    const screenPoint = { x: documentPoint.x * view.scale + view.originX, y: documentPoint.y * view.scale + view.originY };
    const result = mesh.screenToActiveKeyformLocal(screenPoint, view);
    assert.ok(Math.abs(result.x - local.x) < 1e-9);
    assert.ok(Math.abs(result.y - local.y) < 1e-9);
  }
});

test("deleted keyform remains a safe transient selection and Undo restoration is safe", () => {
  const { session, mesh } = setup();
  mesh.selectTopology("topology");
  mesh.createKeyform("from", { keyformId: "keyform_a", positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] });
  mesh.selectKeyform("from", "keyform_a");
  session.execute({ type: "mesh_keyform.remove", payload: { keyformId: "keyform_a" } });
  assert.equal(mesh.getState().activeKeyform, null);
  session.undo();
  assert.equal(mesh.getState().activeKeyform.id, "keyform_a");
});

test("endpoint controller is DOM-free and never directly reads or writes session.project", async () => {
  const source = await readFile(new URL("../src/ui/endpoint-mesh-controller.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|session\.project/);
  assert.match(source, /session\.query\("mesh\.list_topologies"\)/);
  assert.match(source, /session\.executeTransaction/);
  const allowlist = await readFile(new URL("../production-files.txt", import.meta.url), "utf8");
  assert.match(allowlist, /^src\/ui\/endpoint-mesh-controller\.js$/m);
});
