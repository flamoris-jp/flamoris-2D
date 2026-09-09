import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession } from "../src/commands/editor.js";
import { deserializeProject, migrateProjectSchema, serializeProject } from "../src/io/project-json.js";
import {
  canonicalizeMeshFormVertexOffsets,
  createMeshFormCorrectionKeyform,
} from "../src/model/mesh-form-correction.js";
import { validateMeshFormCorrections } from "../src/model/mesh-form-correction-validation.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function fixture() {
  const project = createProject({
    name: "Form correction", width: 100, height: 100,
    idFactory: createIdFactory("form_correction"),
  });
  const rootId = project.scene.rootId;
  project.scene.nodes.part = createSceneNode({
    id: "part", displayName: "Part", parentId: rootId,
  });
  project.scene.nodes[rootId].children.push("part");
  project.keyArts.push({
    id: "key_a", displayName: "A", rootNodeId: rootId,
    members: [{ nodeId: "part", appearanceId: "appearance", opacity: 1,
      presence: "present", drawOrder: 0, clipping: { sourceNodeId: null } }],
    metadata: {},
  });
  project.semanticSlots.push({
    id: "slot", displayName: "Slot",
    mappings: [{ keyArtId: "key_a", nodeId: "part" }], metadata: {},
  });
  project.meshTopologies.push({
    id: "topology", vertexIds: ["v1", "v2", "v3"], indices: [0, 1, 2],
    vertexMetadata: {}, nextVertexSequence: 1,
  });
  project.meshKeyforms.push({
    id: "mesh", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1],
  });
  return project;
}

test("MeshFormCorrectionKeyform is sparse and canonical by stable vertex ID", () => {
  const value = createMeshFormCorrectionKeyform({
    id: "correction", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [
      { vertexId: "v3", x: 0, y: 0 },
      { vertexId: "v2", x: 2, y: -1 },
      { vertexId: "v1", x: 1, y: 3 },
    ],
  });
  assert.deepEqual(value.vertexOffsets, [
    { vertexId: "v1", x: 1, y: 3 },
    { vertexId: "v2", x: 2, y: -1 },
  ]);
});

test("MeshFormCorrectionKeyform rejects duplicate and non-finite offsets", () => {
  assert.throws(() => canonicalizeMeshFormVertexOffsets([
    { vertexId: "v1", x: 1, y: 0 }, { vertexId: "v1", x: 2, y: 0 },
  ]), { code: "MESH_FORM_CORRECTION_VERTEX_DUPLICATE" });
  assert.throws(() => canonicalizeMeshFormVertexOffsets([
    { vertexId: "v1", x: Number.NaN, y: 0 },
  ]), { code: "MESH_FORM_CORRECTION_OFFSET_INVALID" });
});

test("MeshFormCorrectionKeyform validates topology Key Art slot and stable vertices", () => {
  const project = fixture();
  project.meshFormCorrectionKeyforms.push(createMeshFormCorrectionKeyform({
    id: "correction", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [{ vertexId: "v2", x: 1, y: 2 }],
  }));
  assert.deepEqual(validateMeshFormCorrections(project), []);
  project.meshFormCorrectionKeyforms[0].vertexOffsets[0].vertexId = "missing";
  assert.ok(validateMeshFormCorrections(project).some((entry) =>
    entry.code === "MESH_FORM_CORRECTION_VERTEX_MISSING"));
});

test("MeshFormCorrectionKeyform Save Open preserves canonical sparse state", () => {
  const project = fixture();
  project.meshFormCorrectionKeyforms.push(createMeshFormCorrectionKeyform({
    id: "z", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [{ vertexId: "v2", x: 2, y: 3 }],
  }), createMeshFormCorrectionKeyform({
    id: "a", topologyId: "topology", keyArtId: "key_b", semanticSlotId: "slot",
    vertexOffsets: [],
  }));
  project.keyArts.push({ ...project.keyArts[0], id: "key_b", displayName: "B" });
  project.semanticSlots[0].mappings.push({ keyArtId: "key_b", nodeId: "part" });
  project.meshKeyforms.push({ ...project.meshKeyforms[0], id: "mesh_2", keyArtId: "key_b" });
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened.meshFormCorrectionKeyforms.map((entry) => entry.id), ["a", "z"]);
  assert.deepEqual(reopened.meshFormCorrectionKeyforms[1].vertexOffsets,
    [{ vertexId: "v2", x: 2, y: 3 }]);
  assert.doesNotThrow(() => new EditorSession(reopened));
});

test("schema 9 migration adds correction state without changing Phase 7-3 rig state", () => {
  const project = fixture();
  project.schemaVersion = 9;
  delete project.meshFormCorrectionKeyforms;
  project.rig.skinBindings = [{ id: "disabled", targetNodeId: "part", topologyId: "topology",
    enabled: false, vertexWeights: [] }];
  const migrated = migrateProjectSchema(project);
  assert.equal(migrated.schemaVersion, 12);
  assert.deepEqual(migrated.meshFormCorrectionKeyforms, []);
  assert.equal(migrated.rig.skinBindings[0].id, "disabled");
  assert.deepEqual(migrated.rig.boneRotationConstraints, []);
  assert.deepEqual(migrated.rig.twoBoneIkConstraints, []);
});

test("form correction Commands Queries and Undo Redo preserve exact state", () => {
  const session = new EditorSession(fixture());
  const adapter = new HeadlessProductAdapter(session);
  adapter.execute({ type: "mesh_form.create_keyform", payload: { keyform: {
    id: "correction", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [{ vertexId: "v2", x: 1, y: 2 }],
  } } });
  adapter.execute({ type: "mesh_form.set_vertex_offsets", payload: {
    keyformId: "correction",
    vertexOffsets: [{ vertexId: "v3", x: -3, y: 4 }, { vertexId: "v1", x: 2, y: 1 }],
  } });
  const expected = adapter.query("mesh_form.get_keyform", { keyformId: "correction" });
  assert.deepEqual(expected.vertexOffsets.map((entry) => entry.vertexId), ["v1", "v3"]);
  assert.deepEqual(adapter.query("mesh_form.get_for_context", {
    topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
  }), expected);
  assert.deepEqual(adapter.query("mesh_form.evaluate", {
    topologyId: "topology", keyformId: "correction",
    positions: [0, 0, 10, 0, 0, 10],
  }).mesh.positions, [2, 1, 10, 0, -3, 14]);
  session.undo();
  assert.deepEqual(session.query("mesh_form.get_keyform", {
    keyformId: "correction",
  }).vertexOffsets, [{ vertexId: "v2", x: 1, y: 2 }]);
  session.redo();
  assert.deepEqual(session.query("mesh_form.get_keyform", { keyformId: "correction" }), expected);
  adapter.execute({ type: "mesh_form.reset_keyform", payload: { keyformId: "correction" } });
  assert.equal(adapter.query("mesh_form.get_for_context", {
    topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
  }), null);
  session.undo();
  assert.deepEqual(session.query("mesh_form.get_keyform", { keyformId: "correction" }), expected);
});

test("form correction locks stable vertex removal and topology replacement/removal", () => {
  const session = new EditorSession(fixture());
  session.execute({ type: "mesh_form.create_keyform", payload: { keyform: {
    id: "correction", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [{ vertexId: "v2", x: 1, y: 2 }],
  } } });
  assert.throws(() => session.execute({ type: "mesh_topology.remove_vertex", payload: {
    topologyId: "topology", vertexId: "v2",
  } }), { code: "MESH_TOPOLOGY_LOCKED_BY_FORM_CORRECTION" });
  assert.throws(() => session.execute({ type: "mesh_topology.update", payload: {
    topologyId: "topology", topology: {
      ...session.query("mesh.get_topology", { topologyId: "topology" }),
      vertexIds: ["v1", "v2", "other"],
    },
  } }), { code: "MESH_TOPOLOGY_LOCKED_BY_FORM_CORRECTION" });
  assert.throws(() => session.execute({ type: "mesh_topology.remove", payload: {
    topologyId: "topology",
  } }), { code: "MESH_TOPOLOGY_LOCKED_BY_FORM_CORRECTION" });
});

test("removing Key Art slot mapping or compatible MeshKeyform rejects dangling correction", () => {
  const session = new EditorSession(fixture());
  session.execute({ type: "mesh_form.create_keyform", payload: { keyform: {
    id: "correction", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [{ vertexId: "v2", x: 1, y: 2 }],
  } } });
  for (const command of [
    { type: "keyart.remove", payload: { keyArtId: "key_a" } },
    { type: "semantic_slot.unmap_node", payload: { semanticSlotId: "slot", keyArtId: "key_a" } },
    { type: "mesh_keyform.remove", payload: { keyformId: "mesh" } },
  ]) {
    assert.throws(() => session.execute(command), (error) =>
      error.issues?.some((entry) => entry.code.startsWith("MESH_FORM_CORRECTION_")));
  }
});
