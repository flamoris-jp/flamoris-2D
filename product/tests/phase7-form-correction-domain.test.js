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
  assert.equal(migrated.schemaVersion, 10);
  assert.deepEqual(migrated.meshFormCorrectionKeyforms, []);
  assert.equal(migrated.rig.skinBindings[0].id, "disabled");
});
