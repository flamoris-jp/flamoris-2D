import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createProject, createIdFactory, createSceneNode } from "../src/model/project.js";
import { boneSceneTransform, createBone, createBonePoseKeyform } from "../src/model/bone.js";
import { createSkinBinding } from "../src/model/skin-binding.js";
import { createMeshFormCorrectionKeyform } from "../src/model/mesh-form-correction.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";
import { evaluateTransitionExportFrame } from "../src/core/export-frame-evaluator.js";
import { createEvaluatedRenderPlan } from "../src/core/evaluated-render.js";

function member(nodeId, appearanceId) {
  return { nodeId, appearanceId, opacity: 1, presence: "present", drawOrder: 0,
    clipping: { sourceNodeId: null } };
}

function fixture({ mode = "morph", correctionA = 1, correctionB = 3 } = {}) {
  const project = createProject({ name: "Weighted form", width: 100, height: 100,
    idFactory: createIdFactory("weighted_form") });
  const rootId = project.scene.rootId;
  project.scene.nodes.bone = createSceneNode({ id: "bone", kind: "bone",
    displayName: "Bone", parentId: rootId,
    transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }) });
  project.rig.bones.push(createBone({ id: "bone", parentNodeId: rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 }, length: 10 }));
  for (const endpoint of ["a", "b"]) {
    const nodeId = `part_${endpoint}`;
    project.scene.nodes[nodeId] = createSceneNode({ id: nodeId, displayName: nodeId,
      parentId: rootId, bounds: { left: 0, top: 0, right: 1, bottom: 1 } });
    project.rig.skinBindings.push(createSkinBinding({
      id: `skin_${endpoint}`, targetNodeId: nodeId, topologyId: "topology",
      vertexWeights: ["v1", "v2", "v3"].map((vertexId) => ({
        vertexId, influences: [{ boneId: "bone", weight: 1 }],
      })),
    }));
  }
  project.scene.nodes[rootId].children.push("bone", "part_a", "part_b");
  project.keyArts.push(
    { id: "key_a", displayName: "A", rootNodeId: rootId,
      members: [member("part_a", "appearance_a")], metadata: {} },
    { id: "key_b", displayName: "B", rootNodeId: rootId,
      members: [member("part_b", "appearance_b")], metadata: {} },
  );
  project.rig.bonePoseKeyforms.push(
    createBonePoseKeyform({ boneId: "bone", keyArtId: "key_a",
      localDelta: { x: 10, y: 0, rotation: 0 } }),
    createBonePoseKeyform({ boneId: "bone", keyArtId: "key_b",
      localDelta: { x: 20, y: 0, rotation: 0 } }),
  );
  project.semanticSlots.push({ id: "slot", displayName: "Part", mappings: [
    { keyArtId: "key_a", nodeId: "part_a" },
    { keyArtId: "key_b", nodeId: "part_b" },
  ], metadata: {} });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  project.meshKeyforms.push(
    { id: "mesh_a", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
      positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "mesh_b", topologyId: "topology", keyArtId: "key_b", semanticSlotId: "slot",
      positions: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] },
  );
  if (correctionA !== null) project.meshFormCorrectionKeyforms.push(
    createMeshFormCorrectionKeyform({ id: "correction_a", topologyId: "topology",
      keyArtId: "key_a", semanticSlotId: "slot",
      vertexOffsets: [{ vertexId: "v1", x: 0, y: correctionA }] }));
  if (correctionB !== null) project.meshFormCorrectionKeyforms.push(
    createMeshFormCorrectionKeyform({ id: "correction_b", topologyId: "topology",
      keyArtId: "key_b", semanticSlotId: "slot",
      vertexOffsets: [{ vertexId: "v1", x: 0, y: correctionB }] }));
  project.temporalPrograms.push({ id: "program", durationTicks: 100,
    tracks: [], events: [], regions: [] });
  project.transitions.push({ id: "transition", displayName: "A to B",
    fromKeyArtId: "key_a", toKeyArtId: "key_b", temporalProgramId: "program",
    partTransitions: [{ id: "part_transition", semanticSlotId: "slot", mode,
      topologyId: mode === "morph" ? "topology" : null,
      fromKeyformId: "mesh_a", toKeyformId: "mesh_b",
      configuration: mode === "hold" ? { holdEndpoint: "from" } : {} }],
    diagnosticOverrides: [] });
  return project;
}

function firstPosition(project, ticks) {
  return evaluateTransition(project, "transition", ticks)
    .evaluatedParts[0].renderInstances[0].mesh.positions.slice(0, 2);
}

test("Transition evaluates weighted skinning before form correction at exact endpoints and midpoint", () => {
  const project = fixture();
  assert.deepEqual(firstPosition(project, 0), [10, 1]);
  assert.deepEqual(firstPosition(project, 100), [20, 3]);
  assert.deepEqual(firstPosition(project, 50), [15, 2]);
});

test("absent endpoint form correction interpolates from zero", () => {
  const project = fixture({ correctionA: null, correctionB: 4 });
  assert.deepEqual(firstPosition(project, 0), [10, 0]);
  assert.deepEqual(firstPosition(project, 50), [15, 2]);
});

test("Hold and Replace use endpoint-specific weighted skin and correction state", () => {
  assert.deepEqual(firstPosition(fixture({ mode: "hold" }), 50), [10, 1]);
  const project = fixture({ mode: "replace" });
  const positions = evaluateTransition(project, "transition", 50).evaluatedParts[0]
    .renderInstances.map((entry) => entry.mesh.positions.slice(0, 2));
  assert.deepEqual(positions, [[10, 1], [20, 3]]);
});

test("preview export and shared render plan preserve weighted form geometry parity", () => {
  const project = fixture();
  const preview = evaluateTransition(project, "transition", 50);
  const exported = evaluateTransitionExportFrame(project, {
    transitionId: "transition", frameIndex: 1,
    frameRate: { numerator: 2400, denominator: 1 },
  });
  assert.deepEqual(exported.evaluatedTransition,
    evaluateTransition(project, "transition", exported.frame.timeTicks));
  const plan = createEvaluatedRenderPlan(preview, { resolveArtwork: () => ({}) });
  assert.deepEqual(plan.batches[0].renderInstances[0].mesh.positions,
    preview.evaluatedParts[0].renderInstances[0].mesh.positions);
});

test("shared renderer remains SkinBinding and form-correction unaware", async () => {
  const sources = await Promise.all([
    "../src/core/evaluated-render.js", "../src/core/shared-composition-renderer.js",
    "../src/core/export-frame-renderer.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /SkinBinding|MeshFormCorrection|skinning|form correction/i);
  }
});
