import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { evaluateLinearBlendSkinning } from "../src/core/linear-blend-skinning-evaluator.js";
import { skinBindingForTarget } from "../src/model/skin-binding-validation.js";
import { createSkinBinding } from "../src/model/skin-binding.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { boneSceneTransform, createBone, createBonePoseKeyform } from "../src/model/bone.js";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

const topology = {
  id: "topology",
  vertexIds: ["vertex"],
  indices: [],
  vertexMetadata: {},
  nextVertexSequence: 1,
};

function pose(boneId, x = 0, y = 0) {
  return { boneId, skinMatrix: [1, 0, 0, 1, x, y] };
}

function binding(influences, enabled = true) {
  return createSkinBinding({
    id: "skin",
    targetNodeId: "part",
    topologyId: topology.id,
    enabled,
    vertexWeights: [{ vertexId: "vertex", influences }],
  });
}

function evaluate(influences, bonePoses, position = [2, 3]) {
  return evaluateLinearBlendSkinning({
    mesh: { positions: position, uvs: [0, 0] },
    topology,
    binding: binding(influences),
    bonePoses,
  });
}

test("LBS evaluates one Bone influence numerically", () => {
  const result = evaluate([{ boneId: "bone_a", weight: 1 }], [pose("bone_a", 10, -2)]);
  assert.deepEqual(result.mesh.positions, [12, 1]);
  assert.deepEqual(result.diagnostics, []);
});

test("LBS evaluates two Bone influences numerically", () => {
  const result = evaluate([
    { boneId: "bone_a", weight: 0.25 },
    { boneId: "bone_b", weight: 0.75 },
  ], [pose("bone_a", 10, 0), pose("bone_b", 0, 20)]);
  assert.deepEqual(result.mesh.positions, [4.5, 18]);
});

test("LBS evaluates three and four Bone influences numerically", () => {
  const three = evaluate([
    { boneId: "bone_a", weight: 0.2 },
    { boneId: "bone_b", weight: 0.3 },
    { boneId: "bone_c", weight: 0.5 },
  ], [pose("bone_a", 10), pose("bone_b", 20), pose("bone_c", 30)]);
  assert.deepEqual(three.mesh.positions, [25, 3]);

  const four = evaluate([
    { boneId: "bone_a", weight: 0.1 },
    { boneId: "bone_b", weight: 0.2 },
    { boneId: "bone_c", weight: 0.3 },
    { boneId: "bone_d", weight: 0.4 },
  ], [pose("bone_a", 10), pose("bone_b", 20), pose("bone_c", 30), pose("bone_d", 40)]);
  assert.ok(Math.abs(four.mesh.positions[0] - 32) < 1e-12);
  assert.equal(four.mesh.positions[1], 3);
});

test("LBS is independent of influence and evaluated-pose insertion order", () => {
  const influences = [
    { boneId: "bone_a", weight: 0.25 },
    { boneId: "bone_b", weight: 0.75 },
  ];
  const forward = evaluate(influences, [pose("bone_a", 10), pose("bone_b", 20)]);
  const reverse = evaluate([...influences].reverse(), [pose("bone_b", 20), pose("bone_a", 10)]);
  assert.deepEqual(reverse, forward);
});

test("enabled binding selection is independent of binding insertion order", () => {
  const enabled = binding([{ boneId: "bone_a", weight: 1 }]);
  const disabled = { ...binding([{ boneId: "bone_b", weight: 1 }], false), id: "draft" };
  const left = { rig: { skinBindings: [disabled, enabled] } };
  const right = { rig: { skinBindings: [enabled, disabled] } };
  assert.deepEqual(skinBindingForTarget(left, "part"), enabled);
  assert.deepEqual(skinBindingForTarget(right, "part"), enabled);
});

test("identity FK skin matrix leaves geometry unchanged", () => {
  const mesh = { positions: [2, 3], uvs: [0, 0] };
  const result = evaluateLinearBlendSkinning({
    mesh,
    topology,
    binding: binding([{ boneId: "bone_a", weight: 1 }]),
    bonePoses: [pose("bone_a")],
  });
  assert.deepEqual(result.mesh, mesh);
  assert.notEqual(result.mesh.positions, mesh.positions);
});

test("disabled SkinBinding returns unchanged geometry without requiring weights or poses", () => {
  const mesh = { positions: [2, 3] };
  const result = evaluateLinearBlendSkinning({
    mesh,
    topology,
    binding: { ...binding([{ boneId: "bone_a", weight: 1 }], false), vertexWeights: [] },
    bonePoses: [],
  });
  assert.deepEqual(result, { mesh, diagnostics: [] });
  assert.notEqual(result.mesh.positions, mesh.positions);
});

test("missing Bone pose produces a deterministic diagnostic and no partial deformation", () => {
  const input = { positions: [2, 3] };
  const result = evaluateLinearBlendSkinning({
    mesh: input,
    topology,
    binding: binding([{ boneId: "bone_a", weight: 1 }]),
    bonePoses: [],
  });
  assert.deepEqual(result.mesh.positions, input.positions);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code), ["SKIN_BONE_POSE_MISSING"]);
  assert.equal(result.diagnostics[0].boneId, "bone_a");
  assert.equal(result.diagnostics[0].vertexId, "vertex");
});

test("missing stable vertex produces a diagnostic instead of index reassignment", () => {
  const twoVertices = { ...topology, vertexIds: ["vertex", "other"] };
  const result = evaluateLinearBlendSkinning({
    mesh: { positions: [2, 3, 9, 8] },
    topology: twoVertices,
    binding: binding([{ boneId: "bone_a", weight: 1 }]),
    bonePoses: [pose("bone_a", 10)],
  });
  assert.deepEqual(result.mesh.positions, [2, 3, 9, 8]);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "SKIN_BINDING_VERTEX_MISSING" && entry.vertexId === "other"));
});

test("invalid non-normalized raw weight state is diagnosed without guessing", () => {
  const invalid = binding([{ boneId: "bone_a", weight: 1 }]);
  invalid.vertexWeights[0].influences = [
    { boneId: "bone_a", weight: 0.4 },
    { boneId: "bone_b", weight: 0.4 },
  ];
  const result = evaluateLinearBlendSkinning({
    mesh: { positions: [2, 3] }, topology, binding: invalid,
    bonePoses: [pose("bone_a", 10), pose("bone_b", 20)],
  });
  assert.deepEqual(result.mesh.positions, [2, 3]);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "SKIN_BINDING_WEIGHT_NOT_NORMALIZED"));
});

function headlessFixture() {
  const project = createProject({
    name: "Headless skin evaluation",
    width: 100,
    height: 100,
    idFactory: createIdFactory("skin_eval"),
  });
  const rootId = project.scene.rootId;
  project.scene.nodes.part = createSceneNode({
    id: "part", displayName: "Part", parentId: rootId,
  });
  project.scene.nodes.bone = createSceneNode({
    id: "bone",
    kind: "bone",
    displayName: "Bone",
    parentId: rootId,
    transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }),
  });
  project.scene.nodes[rootId].children.push("part", "bone");
  project.rig.bones.push(createBone({
    id: "bone",
    parentNodeId: rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 },
    length: 10,
  }));
  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({
    boneId: "bone",
    keyArtId: "key",
    localDelta: { x: 10, y: 0, rotation: 0 },
  }));
  project.keyArts.push({
    id: "key",
    displayName: "Key",
    rootNodeId: rootId,
    members: [{
      nodeId: "part", appearanceId: "appearance", opacity: 1,
      presence: "present", drawOrder: 0, clipping: { sourceNodeId: null },
    }],
    metadata: {},
  });
  project.semanticSlots.push({
    id: "slot", displayName: "Slot",
    mappings: [{ keyArtId: "key", nodeId: "part" }], metadata: {},
  });
  project.meshTopologies.push({
    id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1,
  });
  project.meshKeyforms.push({
    id: "mesh", topologyId: "topology", keyArtId: "key", semanticSlotId: "slot",
    positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1],
  });
  project.rig.skinBindings.push(createSkinBinding({
    id: "skin", targetNodeId: "part", topologyId: "topology",
    vertexWeights: ["v1", "v2", "v3"].map((vertexId) => ({
      vertexId, influences: [{ boneId: "bone", weight: 1 }],
    })),
  }));
  return project;
}

test("headless skin.evaluate query reuses projected FK skin matrices", () => {
  const adapter = new HeadlessProductAdapter(new EditorSession(headlessFixture()));
  const result = adapter.query("skin.evaluate", {
    bindingId: "skin",
    keyArtId: "key",
    positions: [0, 0, 1, 0, 0, 1],
  });
  assert.deepEqual(result.mesh.positions, [10, 0, 11, 0, 10, 1]);
  assert.deepEqual(result.diagnostics, []);
});

test("LBS evaluator remains DOM-independent and uses no parallel Bone evaluator", () => {
  const source = fs.readFileSync(
    new URL("../src/core/linear-blend-skinning-evaluator.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|evaluateBoneFk/);
  assert.match(source, /pose\.skinMatrix/);
});
