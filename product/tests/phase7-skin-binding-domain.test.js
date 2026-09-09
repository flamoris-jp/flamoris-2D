import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeSkinInfluences,
  createSkinBinding,
  SKIN_WEIGHT_SUM_TOLERANCE,
} from "../src/model/skin-binding.js";
import {
  skinBindingValidationResult,
  validateSkinBindings,
} from "../src/model/skin-binding-validation.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createRigidBoneBinding } from "../src/model/rigid-bone-binding.js";
import { validateProject } from "../src/model/validation.js";
import {
  deserializeProject,
  migrateProjectSchema,
  serializeProject,
} from "../src/io/project-json.js";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function fixture() {
  const project = createProject({
    name: "Skin binding",
    width: 100,
    height: 100,
    idFactory: createIdFactory("skin_binding"),
  });
  const rootId = project.scene.rootId;
  project.scene.nodes.part = createSceneNode({
    id: "part", displayName: "Part", parentId: rootId,
  });
  project.scene.nodes[rootId].children.push("part");
  for (const [index, boneId] of ["bone_a", "bone_b", "bone_c", "bone_d"].entries()) {
    project.scene.nodes[boneId] = createSceneNode({
      id: boneId,
      kind: "bone",
      displayName: boneId,
      parentId: rootId,
      transform: boneSceneTransform({ x: index * 10, y: 0, rotation: 0 }),
    });
    project.scene.nodes[rootId].children.push(boneId);
    project.rig.bones.push(createBone({
      id: boneId,
      parentNodeId: rootId,
      restLocalTransform: { x: index * 10, y: 0, rotation: 0 },
      length: 10,
    }));
  }
  project.keyArts.push({
    id: "key_a",
    displayName: "A",
    rootNodeId: rootId,
    members: [{
      nodeId: "part",
      appearanceId: "appearance",
      opacity: 1,
      presence: "present",
      drawOrder: 0,
      clipping: { sourceNodeId: null },
    }],
    metadata: {},
  });
  project.semanticSlots.push({
    id: "slot",
    displayName: "Slot",
    mappings: [{ keyArtId: "key_a", nodeId: "part" }],
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology",
    vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2],
    vertexMetadata: {},
    nextVertexSequence: 1,
  });
  project.meshKeyforms.push({
    id: "mesh",
    topologyId: "topology",
    keyArtId: "key_a",
    semanticSlotId: "slot",
    positions: [0, 0, 10, 0, 0, 10],
    uvs: [0, 0, 1, 0, 0, 1],
  });
  const binding = createSkinBinding({
    id: "skin",
    targetNodeId: "part",
    topologyId: "topology",
    vertexWeights: ["v1", "v2", "v3"].map((vertexId) => ({
      vertexId,
      influences: [{ boneId: "bone_a", weight: 1 }],
    })),
  });
  project.rig.skinBindings.push(binding);
  return { project, binding };
}

test("SkinBinding canonicalizes stable vertex and Bone influence order", () => {
  const binding = createSkinBinding({
    id: "skin",
    targetNodeId: "part",
    topologyId: "topology",
    enabled: false,
    vertexWeights: [
      {
        vertexId: "v2",
        influences: [
          { boneId: "bone_b", weight: 0.25 },
          { boneId: "bone_a", weight: 0.75 },
        ],
      },
      { vertexId: "v1", influences: [{ boneId: "bone_a", weight: 1 }] },
    ],
  });
  assert.deepEqual(binding.vertexWeights.map((entry) => entry.vertexId), ["v1", "v2"]);
  assert.deepEqual(binding.vertexWeights[1].influences, [
    { boneId: "bone_a", weight: 0.75 },
    { boneId: "bone_b", weight: 0.25 },
  ]);
});

test("SkinBinding canonicalization rejects duplicate stable identities", () => {
  assert.throws(() => createSkinBinding({
    id: "skin",
    targetNodeId: "part",
    topologyId: "topology",
    vertexWeights: [
      { vertexId: "v1", influences: [{ boneId: "bone", weight: 1 }] },
      { vertexId: "v1", influences: [{ boneId: "bone", weight: 1 }] },
    ],
  }), { code: "SKIN_BINDING_VERTEX_DUPLICATE" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: 0.5 },
    { boneId: "bone", weight: 0.5 },
  ]), { code: "SKIN_BINDING_INFLUENCE_DUPLICATE" });
});

test("SkinBinding accepts only positive normalized one-to-four influence weights", () => {
  assert.equal(canonicalizeSkinInfluences([
    { boneId: "bone_a", weight: 0.5 + SKIN_WEIGHT_SUM_TOLERANCE / 4 },
    { boneId: "bone_b", weight: 0.5 },
  ]).reduce((sum, entry) => sum + entry.weight, 0), 1);
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: 0 },
  ]), { code: "SKIN_BINDING_WEIGHT_INVALID" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: Number.NaN },
  ]), { code: "SKIN_BINDING_WEIGHT_INVALID" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: 1 + SKIN_WEIGHT_SUM_TOLERANCE / 2 },
  ]), { code: "SKIN_BINDING_WEIGHT_INVALID" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone_a", weight: 0.4 },
    { boneId: "bone_b", weight: 0.4 },
  ]), { code: "SKIN_BINDING_WEIGHT_NOT_NORMALIZED" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "a", weight: 0.2 },
    { boneId: "b", weight: 0.2 },
    { boneId: "c", weight: 0.2 },
    { boneId: "d", weight: 0.2 },
    { boneId: "e", weight: 0.2 },
  ]), { code: "SKIN_BINDING_INFLUENCE_COUNT_INVALID" });
});

test("SkinBinding validation accepts a complete stable topology contract", () => {
  const { project } = fixture();
  assert.deepEqual(validateSkinBindings(project), []);
  assert.equal(validateProject(project).some((entry) => entry.severity === "error"), false);
});

test("persistent weights must already use the normalized canonical representation", () => {
  const { project, binding } = fixture();
  binding.vertexWeights[0].influences = [
    { boneId: "bone_a", weight: 0.5000001 },
    { boneId: "bone_b", weight: 0.5 },
  ];
  assert.ok(validateSkinBindings(project).some((entry) =>
    entry.code === "SKIN_BINDING_WEIGHT_NOT_CANONICAL"));
});

test("SkinBinding validation diagnoses target and topology contracts deterministically", () => {
  const missingTarget = fixture().project;
  missingTarget.rig.skinBindings[0].targetNodeId = "missing";
  assert.ok(validateSkinBindings(missingTarget).some((entry) =>
    entry.code === "SKIN_BINDING_TARGET_MISSING"));

  const invalidTarget = fixture().project;
  invalidTarget.rig.skinBindings[0].targetNodeId = invalidTarget.scene.rootId;
  assert.ok(validateSkinBindings(invalidTarget).some((entry) =>
    entry.code === "SKIN_BINDING_TARGET_INVALID"));

  const missingTopology = fixture().project;
  missingTopology.rig.skinBindings[0].topologyId = "missing";
  assert.ok(validateSkinBindings(missingTopology).some((entry) =>
    entry.code === "SKIN_BINDING_TOPOLOGY_MISSING"));

  const mismatch = fixture().project;
  mismatch.meshTopologies.push({
    id: "other", vertexIds: ["other_a", "other_b", "other_c"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1,
  });
  mismatch.rig.skinBindings[0].topologyId = "other";
  mismatch.rig.skinBindings[0].vertexWeights = [];
  const mismatchCodes = validateSkinBindings(mismatch).map((entry) => entry.code);
  assert.ok(mismatchCodes.includes("SKIN_BINDING_TOPOLOGY_TARGET_MISMATCH"));
  assert.ok(mismatchCodes.includes("SKIN_BINDING_VERTEX_MISSING"));
});

test("SkinBinding rejects mixed Key-Art topology contracts for one target", () => {
  const { project } = fixture();
  project.keyArts.push({
    id: "key_b",
    displayName: "B",
    rootNodeId: project.scene.rootId,
    members: [{
      nodeId: "part",
      appearanceId: "appearance_b",
      opacity: 1,
      presence: "present",
      drawOrder: 0,
      clipping: { sourceNodeId: null },
    }],
    metadata: {},
  });
  project.semanticSlots[0].mappings.push({ keyArtId: "key_b", nodeId: "part" });
  project.meshTopologies.push({
    id: "other_topology",
    vertexIds: ["other_1", "other_2", "other_3"],
    indices: [0, 1, 2],
    vertexMetadata: {},
    nextVertexSequence: 1,
  });
  project.meshKeyforms.push({
    id: "mesh_b",
    topologyId: "other_topology",
    keyArtId: "key_b",
    semanticSlotId: "slot",
    positions: [0, 0, 10, 0, 0, 10],
    uvs: [0, 0, 1, 0, 0, 1],
  });
  const mismatch = validateSkinBindings(project).find((entry) =>
    entry.code === "SKIN_BINDING_TOPOLOGY_TARGET_MISMATCH");
  assert.deepEqual(mismatch?.details, {
    targetNodeId: "part",
    topologyId: "topology",
    evaluatedTopologyIds: ["other_topology", "topology"],
  });
});

test("SkinBinding validation diagnoses raw duplicate and dangling stable IDs", () => {
  const { project, binding } = fixture();
  binding.vertexWeights.push(structuredClone(binding.vertexWeights[0]));
  binding.vertexWeights[0].influences.push({ boneId: "bone_a", weight: 0.5 });
  binding.vertexWeights[0].influences[0].weight = 0.5;
  binding.vertexWeights[1].vertexId = "missing_vertex";
  binding.vertexWeights[2].influences[0].boneId = "missing_bone";
  const issues = validateSkinBindings(project);
  assert.ok(issues.some((entry) => entry.code === "SKIN_BINDING_VERTEX_DUPLICATE"));
  assert.ok(issues.some((entry) => entry.code === "SKIN_BINDING_INFLUENCE_DUPLICATE"));
  assert.ok(issues.some((entry) => entry.code === "SKIN_BINDING_VERTEX_MISSING"));
  assert.ok(issues.some((entry) => entry.code === "BONE_NODE_MISSING"));
  assert.deepEqual(issues, validateSkinBindings(project));
});

test("SkinBinding validation rejects invalid count weights ordering and normalization", () => {
  const { project, binding } = fixture();
  binding.vertexWeights[0].influences = [
    { boneId: "bone_d", weight: 0.2 },
    { boneId: "bone_c", weight: 0.2 },
    { boneId: "bone_b", weight: 0.2 },
    { boneId: "bone_a", weight: 0.2 },
    { boneId: "missing", weight: 0.2 },
  ];
  binding.vertexWeights[1].influences = [
    { boneId: "bone_b", weight: 0.6 },
    { boneId: "bone_a", weight: 0.3 },
  ];
  binding.vertexWeights[2].influences[0].weight = -1;
  binding.vertexWeights.reverse();
  const codes = validateSkinBindings(project).map((entry) => entry.code);
  assert.ok(codes.includes("SKIN_BINDING_INFLUENCE_COUNT_INVALID"));
  assert.ok(codes.includes("SKIN_BINDING_INFLUENCE_ORDER_INVALID"));
  assert.ok(codes.includes("SKIN_BINDING_VERTEX_ORDER_INVALID"));
  assert.ok(codes.includes("SKIN_BINDING_WEIGHT_NOT_NORMALIZED"));
  assert.ok(codes.includes("SKIN_BINDING_WEIGHT_INVALID"));
});

test("disabled SkinBinding may be partial but retains structural validation", () => {
  const { project, binding } = fixture();
  binding.enabled = false;
  binding.vertexWeights = [];
  assert.deepEqual(validateSkinBindings(project), []);
  binding.topologyId = "missing";
  assert.ok(validateSkinBindings(project).some((entry) =>
    entry.code === "SKIN_BINDING_TOPOLOGY_MISSING"));
});

test("enabled RigidBoneBinding conflicts with enabled SkinBinding only", () => {
  const { project, binding } = fixture();
  project.rig.rigidBoneBindings.push(createRigidBoneBinding({
    id: "rigid",
    targetNodeId: "part",
    boneId: "bone_a",
  }));
  assert.ok(skinBindingValidationResult(project).issues.some((entry) =>
    entry.code === "RIGID_BINDING_CONFLICT"));
  assert.ok(validateProject(project).some((entry) =>
    entry.code === "RIGID_BINDING_CONFLICT"));
  binding.enabled = false;
  assert.equal(skinBindingValidationResult(project).valid, true);
});

test("SkinBinding Save Open preserves stable IDs and canonical ordering", () => {
  const { project, binding } = fixture();
  binding.enabled = false;
  project.rig.skinBindings.push(createSkinBinding({
    id: "a_skin",
    targetNodeId: "part",
    topologyId: "topology",
    enabled: false,
    vertexWeights: [{
      vertexId: "v2",
      influences: [
        { boneId: "bone_b", weight: 0.25 },
        { boneId: "bone_a", weight: 0.75 },
      ],
    }],
  }));
  const now = () => new Date("2026-09-09T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(opened.rig.skinBindings.map((entry) => entry.id), ["a_skin", "skin"]);
  assert.deepEqual(opened.rig.skinBindings[0].vertexWeights, [{
    vertexId: "v2",
    influences: [
      { boneId: "bone_a", weight: 0.75 },
      { boneId: "bone_b", weight: 0.25 },
    ],
  }]);
  assert.deepEqual(opened.meshTopologies[0].vertexIds, ["v1", "v2", "v3"]);
  assert.equal(serializeProject(opened, 2, { now }), serialized);
});

test("schema 8 migration preserves Phase 7-2 rig state and adds empty skin bindings", () => {
  const { project } = fixture();
  project.rig.skinBindings = [];
  project.rig.rigidBoneBindings.push(createRigidBoneBinding({
    id: "rigid",
    targetNodeId: "part",
    boneId: "bone_a",
  }));
  const schema8 = structuredClone(project);
  schema8.schemaVersion = 8;
  delete schema8.rig.skinBindings;
  const previousRig = structuredClone(schema8.rig);
  const migrated = migrateProjectSchema(schema8);
  assert.equal(migrated.schemaVersion, 9);
  assert.deepEqual(migrated.rig.skinBindings, []);
  for (const key of Object.keys(previousRig)) {
    assert.deepEqual(migrated.rig[key], previousRig[key]);
  }
});

test("SkinBinding Commands Queries MCP and Undo Redo share one stable-ID boundary", () => {
  const project = fixture().project;
  project.rig.skinBindings = [];
  const session = new EditorSession(project);
  const adapter = new HeadlessProductAdapter(session);
  const weights = ["v3", "v1", "v2"].map((vertexId) => ({
    vertexId,
    influences: [{ boneId: "bone_a", weight: 1 }],
  }));
  adapter.execute({
    type: "skin.create_binding",
    payload: { binding: {
      id: "skin",
      targetNodeId: "part",
      topologyId: "topology",
      enabled: true,
      vertexWeights: weights,
    } },
  });
  assert.deepEqual(adapter.query("skin.list_bindings", {}).map((entry) => entry.id), ["skin"]);
  assert.equal(adapter.query("skin.get_binding", { bindingId: "skin" }).targetNodeId, "part");
  assert.equal(adapter.query("skin.get_binding_for_target", { targetNodeId: "part" }).id,
    "skin");
  assert.equal(adapter.query("skin.validate", {}).valid, true);
  assert.deepEqual(adapter.query("skin.get_vertex_weights", {
    bindingId: "skin", vertexId: "v1",
  }), {
    vertexId: "v1",
    influences: [{ boneId: "bone_a", weight: 1 }],
  });

  const beforeEdit = structuredClone(session.project.rig.skinBindings);
  adapter.execute({
    type: "skin.set_vertex_weights",
    payload: {
      bindingId: "skin",
      vertexId: "v1",
      influences: [
        { boneId: "bone_b", weight: 0.25 },
        { boneId: "bone_a", weight: 0.75 },
      ],
    },
  });
  assert.deepEqual(adapter.query("skin.get_vertex_weights", {
    bindingId: "skin", vertexId: "v1",
  }).influences.map((entry) => entry.boneId), ["bone_a", "bone_b"]);
  const afterEdit = structuredClone(session.project.rig.skinBindings);
  session.undo();
  assert.deepEqual(session.project.rig.skinBindings, beforeEdit);
  session.redo();
  assert.deepEqual(session.project.rig.skinBindings, afterEdit);

  adapter.execute({
    type: "skin.set_enabled",
    payload: { bindingId: "skin", enabled: false },
  });
  adapter.execute({
    type: "skin.clear_vertex_weights",
    payload: { bindingId: "skin", vertexId: "v1" },
  });
  assert.equal(adapter.query("skin.get_vertex_weights", {
    bindingId: "skin", vertexId: "v1",
  }), null);
  session.undo();
  assert.deepEqual(adapter.query("skin.get_vertex_weights", {
    bindingId: "skin", vertexId: "v1",
  }).influences, afterEdit[0].vertexWeights[0].influences);

  const exact = structuredClone(session.project.rig.skinBindings);
  adapter.execute({ type: "skin.remove_binding", payload: { bindingId: "skin" } });
  assert.deepEqual(adapter.query("skin.list_bindings", {}), []);
  session.undo();
  assert.deepEqual(session.project.rig.skinBindings, exact);
});

test("enabling an incomplete SkinBinding is rejected without persistent mutation", () => {
  const project = fixture().project;
  project.rig.skinBindings[0].enabled = false;
  project.rig.skinBindings[0].vertexWeights = project.rig.skinBindings[0].vertexWeights.slice(0, 1);
  const session = new EditorSession(project);
  const before = structuredClone(session.project);
  assert.throws(() => session.execute({
    type: "skin.set_enabled",
    payload: { bindingId: "skin", enabled: true },
  }), (error) => error.issues?.some((entry) =>
    entry.code === "SKIN_BINDING_VERTEX_MISSING"));
  assert.deepEqual(session.project, before);
  assert.equal(session.undoStack.length, 0);
});

test("stable vertex deletion and replacement are locked while SkinBinding exists", () => {
  const session = new EditorSession(fixture().project);
  const before = structuredClone(session.project);
  assert.throws(() => session.execute({
    type: "mesh_topology.remove_vertex",
    payload: { topologyId: "topology", vertexId: "v1" },
  }), { code: "MESH_TOPOLOGY_LOCKED_BY_SKIN_BINDING" });

  const replacement = structuredClone(session.project.meshTopologies[0]);
  replacement.vertexIds = ["v1", "v2", "replacement"];
  assert.throws(() => session.execute({
    type: "mesh_topology.update",
    payload: { topologyId: "topology", topology: replacement },
  }), { code: "MESH_TOPOLOGY_LOCKED_BY_SKIN_BINDING" });
  assert.deepEqual(session.project, before);
  assert.equal(session.undoStack.length, 0);
});

test("disabled SkinBinding still protects stable topology identity", () => {
  const project = fixture().project;
  project.rig.skinBindings[0].enabled = false;
  const session = new EditorSession(project);
  assert.throws(() => session.execute({
    type: "mesh_topology.add_vertex",
    payload: {
      topologyId: "topology",
      vertexId: "v4",
      position: { x: 10, y: 10 },
      uv: { x: 1, y: 1 },
    },
  }), { code: "MESH_TOPOLOGY_LOCKED_BY_SKIN_BINDING" });
});

test("topology removal is rejected while persistent skin weights reference it", () => {
  const session = new EditorSession(fixture().project);
  const before = structuredClone(session.project);
  assert.throws(() => session.execute({
    type: "mesh_topology.remove",
    payload: { topologyId: "topology" },
  }), { code: "MESH_TOPOLOGY_LOCKED_BY_SKIN_BINDING" });
  assert.deepEqual(session.project, before);
});

test("Bone removal is rejected while a SkinBinding influence references it", () => {
  const session = new EditorSession(fixture().project);
  const before = structuredClone(session.project);
  assert.throws(() => session.execute({
    type: "bone.remove",
    payload: { boneId: "bone_a" },
  }), { code: "bone.rest_locked_by_skin_bindings" });
  assert.deepEqual(session.project, before);
});

test("target removal cannot commit a dangling SkinBinding", () => {
  const session = new EditorSession(fixture().project);
  const before = structuredClone(session.project);
  const reimported = structuredClone(session.project);
  delete reimported.scene.nodes.part;
  reimported.scene.nodes[reimported.scene.rootId].children =
    reimported.scene.nodes[reimported.scene.rootId].children.filter((id) => id !== "part");
  assert.throws(() => session.execute({
    type: "source.apply_psd_reimport",
    payload: { project: reimported },
  }), (error) => error.code === "command.payload_invalid" &&
    error.details?.issues?.some((entry) =>
      entry.path.includes("rig.skinBindings.0.targetNodeId")));
  assert.deepEqual(session.project, before);
});
