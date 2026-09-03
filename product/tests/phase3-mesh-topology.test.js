import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import {
  deserializeProject,
  migrateProjectSchema,
  serializeProject,
} from "../src/io/project-json.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { TransitionAuthoringController } from "../src/ui/transition-authoring-controller.js";
import { EndpointMeshController } from "../src/ui/endpoint-mesh-controller.js";
import {
  MeshToolController,
  MeshToolRegistry,
  MESH_AUTHORING_MODES,
} from "../src/ui/mesh-tool-controller.js";

function member(nodeId, appearanceId, drawOrder) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder,
    clipping: { sourceNodeId: null },
  };
}

function setup() {
  const project = createProject({
    name: "Phase 3 topology",
    width: 100,
    height: 100,
    idFactory: createIdFactory("phase3"),
  });
  const nodeA = createSceneNode({ id: "node_a", displayName: "A", parentId: project.scene.rootId });
  const nodeB = createSceneNode({ id: "node_b", displayName: "B", parentId: project.scene.rootId });
  project.scene.nodes[nodeA.id] = nodeA;
  project.scene.nodes[nodeB.id] = nodeB;
  project.scene.nodes[project.scene.rootId].children.push(nodeA.id, nodeB.id);
  project.keyArts.push(
    {
      id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
      members: [member(nodeA.id, "appearance_a", 0)], metadata: {},
    },
    {
      id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId,
      members: [member(nodeB.id, "appearance_b", 0)], metadata: {},
    },
  );
  project.semanticSlots.push({
    id: "slot",
    displayName: "Face",
    mappings: [
      { keyArtId: "keyart_a", nodeId: nodeA.id },
      { keyArtId: "keyart_b", nodeId: nodeB.id },
    ],
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology",
    vertexIds: ["vtx_0001", "vtx_0002", "vtx_0003", "vtx_0004"],
    indices: [0, 1, 2, 0, 2, 3],
    vertexMetadata: {},
  });
  project.meshKeyforms.push(
    {
      id: "keyform_a", topologyId: "topology", keyArtId: "keyart_a",
      semanticSlotId: "slot",
      positions: [0, 0, 10, 0, 10, 10, 0, 10],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    },
    {
      id: "keyform_b", topologyId: "topology", keyArtId: "keyart_b",
      semanticSlotId: "slot",
      positions: [2, 4, 22, 4, 22, 24, 2, 24],
      uvs: [0.1, 0.2, 0.9, 0.2, 0.9, 0.8, 0.1, 0.8],
    },
  );
  project.temporalPrograms.push({
    id: "program", durationTicks: 120000, tracks: [], events: [], regions: [],
  });
  project.transitions.push({
    id: "transition",
    displayName: "A to B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program",
    partTransitions: [{
      id: "part", semanticSlotId: "slot", mode: "morph",
      topologyId: "topology", fromKeyformId: "keyform_a", toKeyformId: "keyform_b",
      configuration: {},
    }],
    diagnosticOverrides: [],
  });

  const session = new EditorSession(project);
  const authoring = new TransitionAuthoringController(session);
  authoring.selectTransition("transition");
  authoring.selectSemanticSlot("slot");
  const endpoint = new EndpointMeshController(session, authoring);
  endpoint.selectTopology("topology");
  endpoint.selectEndpoint("from");
  const meshTools = new MeshToolController(session, endpoint);
  return { project, session, endpoint, meshTools };
}

test("Deform Mode cannot dispatch topology mutation and commits one keyform command", () => {
  const { session, meshTools } = setup();
  assert.equal(meshTools.mode, MESH_AUTHORING_MODES.DEFORM);
  assert.throws(
    () => meshTools.execute("topology.add", {
      position: { x: 5, y: 5 }, uv: { x: 0.5, y: 0.5 },
    }),
    /unavailable in deform mode/,
  );
  meshTools.execute("deform.move", {
    positions: [1, 1, 10, 0, 10, 10, 0, 10],
  });
  assert.equal(session.history.at(-1).commandTypes[0], "mesh_keyform.move_vertices");
  assert.deepEqual(
    session.query("mesh.get_topology", { topologyId: "topology" }).vertexIds,
    ["vtx_0001", "vtx_0002", "vtx_0003", "vtx_0004"],
  );
});

test("Topology Edit mutation uses Command Transaction and reports all affected keyforms", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  const before = session.history.length;
  meshTools.execute("topology.add", {
    position: { x: 5, y: 5 }, uv: { x: 0.5, y: 0.5 },
  });
  assert.equal(session.history.length, before + 1);
  assert.equal(session.history.at(-1).commandTypes[0], "mesh_topology.add_vertex");
  assert.deepEqual(meshTools.getState().affectedKeyformIds, ["keyform_a", "keyform_b"]);
});

test("selected stable vertex ID and label are controller and Query projections only", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  meshTools.selectVertexByIndex(2);
  meshTools.execute("topology.set-label", { semanticLabel: "chin_tip" });
  const selected = meshTools.getState().selectedVertex;
  assert.deepEqual(selected, { id: "vtx_0003", index: 2, semanticLabel: "chin_tip" });
  assert.deepEqual(session.query("mesh.get_vertex", {
    topologyId: "topology", vertexId: "vtx_0003",
  }), selected);
  meshTools.setVertexIdOverlayVisible(true);
  const serialized = serializeProject(session.project);
  assert.match(serialized, /chin_tip/);
  assert.doesNotMatch(serialized, /selectedVertex|activeTool|vertexIdOverlayVisible/);
});

test("semanticLabel add update remove, Undo Redo, and duplicate rejection", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  meshTools.selectVertexByIndex(0);
  meshTools.execute("topology.set-label", { semanticLabel: "jaw_left_01" });
  meshTools.execute("topology.set-label", { semanticLabel: "jaw_left_corner" });
  session.undo();
  assert.equal(meshTools.getState().selectedVertex.semanticLabel, "jaw_left_01");
  session.redo();
  assert.equal(meshTools.getState().selectedVertex.semanticLabel, "jaw_left_corner");
  meshTools.execute("topology.clear-label");
  assert.equal(meshTools.getState().selectedVertex.semanticLabel, null);
  session.undo();
  assert.equal(meshTools.getState().selectedVertex.semanticLabel, "jaw_left_corner");
  meshTools.selectVertexByIndex(1);
  assert.throws(
    () => meshTools.execute("topology.set-label", { semanticLabel: "jaw_left_corner" }),
    (error) => error.code === "MESH_TOPOLOGY_DUPLICATE_SEMANTIC_LABEL",
  );
});

test("Add Vertex allocates a fresh stable ID and deterministically initializes every keyform", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  const survivors = [...session.query("mesh.get_topology", { topologyId: "topology" }).vertexIds];
  meshTools.execute("topology.add", {
    position: { x: 7, y: 8 }, uv: { x: 0.7, y: 0.8 },
  });
  const topology = session.query("mesh.get_topology", { topologyId: "topology" });
  assert.deepEqual(topology.vertexIds.slice(0, -1), survivors);
  assert.equal(topology.vertexIds.at(-1), "vtx_0005");
  for (const keyform of session.query("mesh.list_keyforms", { topologyId: "topology" })) {
    assert.deepEqual(keyform.positions.slice(-2), [7, 8]);
    assert.deepEqual(keyform.uvs.slice(-2), [0.7, 0.8]);
    assert.equal(keyform.positions.length, topology.vertexIds.length * 2);
    assert.equal(keyform.uvs.length, topology.vertexIds.length * 2);
  }
});

test("Remove Vertex does not renumber survivors or reuse an issued ID", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  meshTools.execute("topology.add", {
    position: { x: 7, y: 8 }, uv: { x: 0.7, y: 0.8 },
  });
  meshTools.execute("topology.remove", { vertexId: "vtx_0005" });
  assert.deepEqual(
    session.query("mesh.get_topology", { topologyId: "topology" }).vertexIds,
    ["vtx_0001", "vtx_0002", "vtx_0003", "vtx_0004"],
  );
  assert.equal(
    session.query("mesh.get_topology", { topologyId: "topology" }).nextVertexId,
    "vtx_0006",
  );
  meshTools.execute("topology.remove", { vertexId: "vtx_0002" });
  const topology = session.query("mesh.get_topology", { topologyId: "topology" });
  assert.deepEqual(topology.vertexIds, ["vtx_0001", "vtx_0003", "vtx_0004"]);
  assert.deepEqual(topology.indices, [0, 1, 2]);
  assert.throws(
    () => meshTools.execute("topology.remove", { vertexId: "vtx_0001" }),
    (error) => error.code === "MESH_TOPOLOGY_REMOVE_UNSAFE",
  );
});

test("Edge Subdivide updates all keyforms by midpoint and Undo Redo restores exact identity", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  const before = {
    topology: session.query("mesh.get_topology", { topologyId: "topology" }),
    keyforms: session.query("mesh.list_keyforms", { topologyId: "topology" }),
  };
  meshTools.execute("topology.subdivide", { vertexIds: ["vtx_0001", "vtx_0003"] });
  const after = {
    topology: session.query("mesh.get_topology", { topologyId: "topology" }),
    keyforms: session.query("mesh.list_keyforms", { topologyId: "topology" }),
  };
  assert.equal(after.topology.vertexIds.at(-1), "vtx_0005");
  assert.equal(after.topology.indices.length, 12);
  assert.deepEqual(after.keyforms[0].positions.slice(-2), [5, 5]);
  assert.deepEqual(after.keyforms[0].uvs.slice(-2), [0.5, 0.5]);
  assert.deepEqual(after.keyforms[1].positions.slice(-2), [12, 14]);
  assert.deepEqual(after.keyforms[1].uvs.slice(-2), [0.5, 0.5]);
  session.undo();
  assert.deepEqual(session.query("mesh.get_topology", { topologyId: "topology" }), before.topology);
  assert.deepEqual(session.query("mesh.list_keyforms", { topologyId: "topology" }), before.keyforms);
  session.redo();
  assert.deepEqual(session.query("mesh.get_topology", { topologyId: "topology" }), after.topology);
  assert.deepEqual(session.query("mesh.list_keyforms", { topologyId: "topology" }), after.keyforms);
});

test("triangle creation resolves stable IDs and rejects duplicate repeated and degenerate faces", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  meshTools.execute("topology.add", {
    position: { x: 4, y: 6 }, uv: { x: 0.4, y: 0.6 },
  });
  meshTools.execute("topology.connect", {
    vertexIds: ["vtx_0001", "vtx_0002", "vtx_0005"],
  });
  assert.deepEqual(
    session.query("mesh.get_topology", { topologyId: "topology" }).indices.slice(-3),
    [0, 1, 4],
  );
  assert.throws(
    () => meshTools.execute("topology.connect", {
      vertexIds: ["vtx_0001", "vtx_0002", "vtx_0005"],
    }),
    (error) => error.code === "MESH_TOPOLOGY_TRIANGLE_DUPLICATE",
  );
  assert.throws(
    () => meshTools.execute("topology.connect", {
      vertexIds: ["vtx_0001", "vtx_0001", "vtx_0005"],
    }),
    (error) => error.code === "MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX",
  );
  meshTools.execute("topology.add", {
    position: { x: 5, y: 0.000001 }, uv: { x: 0.5, y: 0 },
  });
  assert.throws(
    () => meshTools.execute("topology.connect", {
      vertexIds: ["vtx_0001", "vtx_0002", "vtx_0006"],
    }),
    (error) => error.code === "MESH_TOPOLOGY_TRIANGLE_DEGENERATE",
  );
});

test("reason-specific topology/keyform diagnostics do not silently repair identity", () => {
  const { project } = setup();
  const invalid = structuredClone(project);
  invalid.meshTopologies[0].vertexIds[1] = "vtx_0001";
  invalid.meshTopologies[0].vertexMetadata = {
    vtx_0001: { semanticLabel: "same" },
    vtx_0003: { semanticLabel: "same" },
    removed_vertex: { semanticLabel: "ghost" },
  };
  invalid.meshTopologies[0].indices = [0, 0, 2, 0, 1, 99];
  invalid.meshKeyforms[0].positions.pop();
  invalid.meshKeyforms[1].uvs.pop();
  const codes = new Set(validateProject(invalid).map((issue) => issue.code));
  for (const code of [
    "MESH_TOPOLOGY_DUPLICATE_VERTEX",
    "MESH_TOPOLOGY_DUPLICATE_SEMANTIC_LABEL",
    "MESH_TOPOLOGY_MISSING_VERTEX_REFERENCE",
    "MESH_TOPOLOGY_INVALID_VERTEX_REFERENCE",
    "MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX",
    "MESH_KEYFORM_POSITION_COUNT_MISMATCH",
    "MESH_KEYFORM_UV_COUNT_MISMATCH",
  ]) assert.ok(codes.has(code), code);
  assert.deepEqual(invalid.meshTopologies[0].vertexIds, [
    "vtx_0001", "vtx_0001", "vtx_0003", "vtx_0004",
  ]);

  const near = structuredClone(project);
  near.meshKeyforms[0].positions = [0, 0, 10, 0, 10, 0.00001, 0, 10];
  assert.ok(validateProject(near).some((issue) =>
    issue.code === "MESH_TOPOLOGY_TRIANGLE_NEAR_DEGENERATE"));
});

test("stable IDs label connectivity and allocation cursor survive Save Open", () => {
  const { session, meshTools } = setup();
  meshTools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  meshTools.selectVertexByIndex(3);
  meshTools.execute("topology.set-label", { semanticLabel: "hair_tip_center" });
  meshTools.execute("topology.subdivide", { vertexIds: ["vtx_0001", "vtx_0003"] });
  meshTools.execute("topology.add", {
    position: { x: 8, y: 8 }, uv: { x: 0.8, y: 0.8 },
  });
  meshTools.execute("topology.remove", { vertexId: "vtx_0006" });
  const before = session.query("mesh.get_topology", { topologyId: "topology" });
  const opened = deserializeProject(serializeProject(session.project));
  const after = new EditorSession(opened).query("mesh.get_topology", { topologyId: "topology" });
  assert.deepEqual(after, before);
  assert.equal(after.nextVertexId, "vtx_0007");
});

test("schema 3 migration adds identity metadata and a monotonic cursor without rewriting IDs", () => {
  const { project } = setup();
  const legacy = structuredClone(project);
  legacy.schemaVersion = 3;
  delete legacy.meshTopologies[0].vertexMetadata;
  delete legacy.meshTopologies[0].nextVertexSequence;
  const migrated = migrateProjectSchema(legacy);
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.meshTopologies[0].vertexIds, [
    "vtx_0001", "vtx_0002", "vtx_0003", "vtx_0004",
  ]);
  assert.deepEqual(migrated.meshTopologies[0].vertexMetadata, {});
  assert.equal(migrated.meshTopologies[0].nextVertexSequence, 5);
  assert.deepEqual(validateProject(migrated), []);
});

test("headless command/query path is DOM independent and registry is extensible", async () => {
  const { session, endpoint } = setup();
  const adapter = new HeadlessProductAdapter(session);
  adapter.execute({
    type: "mesh_topology.set_vertex_label",
    payload: {
      topologyId: "topology", vertexId: "vtx_0001", semanticLabel: "chin_tip",
    },
  });
  assert.equal(adapter.query("mesh.get_vertex", {
    topologyId: "topology", vertexId: "vtx_0001",
  }).semanticLabel, "chin_tip");

  const registry = new MeshToolRegistry().register({
    id: "deform.future-relax",
    mode: MESH_AUTHORING_MODES.DEFORM,
    label: "Future Relax",
    execute: (_controller, input) => ({ strength: input.strength }),
  });
  const controller = new MeshToolController(session, endpoint, { registry });
  controller.setActiveTool("deform.future-relax");
  assert.deepEqual(controller.execute(undefined, { strength: 0.25 }), { strength: 0.25 });

  const source = await readFile(
    new URL("../src/ui/mesh-tool-controller.js", import.meta.url), "utf8",
  );
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|session\.project/);
});

test("generic topology replacement and incompatible keyform count are rejected", () => {
  const { session } = setup();
  const topology = session.query("mesh.get_topology", { topologyId: "topology" });
  assert.throws(
    () => session.execute({
      type: "mesh_topology.update",
      payload: {
        topologyId: topology.id,
        topology: {
          id: topology.id,
          vertexIds: [...topology.vertexIds].reverse(),
          indices: [...topology.indices],
          vertexMetadata: {},
        },
      },
    }),
    (error) => error.code === "MESH_TOPOLOGY_MUTATION_REQUIRES_CONTRACT",
  );
  assert.throws(
    () => session.execute({
      type: "mesh_keyform.move_vertices",
      payload: { keyformId: "keyform_a", positions: [0, 0] },
    }),
    TransactionError,
  );
});
