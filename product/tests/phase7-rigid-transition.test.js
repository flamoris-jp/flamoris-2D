import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../src/model/project.js";
import {
  boneSceneTransform,
  createBone,
  createBonePoseKeyform,
} from "../src/model/bone.js";
import { createRigidBoneBinding } from "../src/model/rigid-bone-binding.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";

function member(nodeId, appearanceId) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder: 0,
    clipping: { sourceNodeId: null },
  };
}

function fixture({ mode = "morph", positions = [10, 0, 11, 0, 10, 1] } = {}) {
  const project = createProject({
    name: "Rigid transition",
    width: 100,
    height: 100,
    idFactory: createIdFactory("rigid_transition"),
  });
  const rootId = project.scene.rootId;
  project.scene.nodes.bone = createSceneNode({
    id: "bone",
    kind: "bone",
    displayName: "Bone",
    parentId: rootId,
    transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }),
  });
  project.rig.bones.push(createBone({
    id: "bone",
    parentNodeId: rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 },
    length: 10,
  }));
  for (const endpoint of ["a", "b"]) {
    const nodeId = `part_${endpoint}`;
    project.scene.nodes[nodeId] = createSceneNode({
      id: nodeId,
      displayName: nodeId,
      parentId: rootId,
      bounds: { left: 0, top: 0, right: 12, bottom: 2 },
    });
    project.rig.rigidBoneBindings.push(createRigidBoneBinding({
      id: `binding_${endpoint}`,
      targetNodeId: nodeId,
      boneId: "bone",
    }));
  }
  project.scene.nodes[rootId].children.push("bone", "part_a", "part_b");
  project.keyArts.push(
    {
      id: "key_a",
      displayName: "A",
      rootNodeId: rootId,
      members: [member("part_a", "appearance_a")],
      metadata: {},
    },
    {
      id: "key_b",
      displayName: "B",
      rootNodeId: rootId,
      members: [member("part_b", "appearance_b")],
      metadata: {},
    },
  );
  project.rig.bonePoseKeyforms.push(
    createBonePoseKeyform({
      boneId: "bone",
      keyArtId: "key_a",
      localDelta: { x: 0, y: 0, rotation: 0 },
    }),
    createBonePoseKeyform({
      boneId: "bone",
      keyArtId: "key_b",
      localDelta: { x: 0, y: 0, rotation: Math.PI / 2 },
    }),
  );
  project.semanticSlots.push({
    id: "slot",
    displayName: "Part",
    mappings: [
      { keyArtId: "key_a", nodeId: "part_a" },
      { keyArtId: "key_b", nodeId: "part_b" },
    ],
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology",
    vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2],
  });
  project.meshKeyforms.push(
    {
      id: "mesh_a",
      topologyId: "topology",
      keyArtId: "key_a",
      semanticSlotId: "slot",
      positions: [...positions],
      uvs: [0, 0, 1, 0, 0, 1],
    },
    {
      id: "mesh_b",
      topologyId: "topology",
      keyArtId: "key_b",
      semanticSlotId: "slot",
      positions: [...positions],
      uvs: [0, 0, 1, 0, 0, 1],
    },
  );
  project.temporalPrograms.push({
    id: "program",
    durationTicks: 100,
    tracks: [],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition",
    displayName: "A to B",
    fromKeyArtId: "key_a",
    toKeyArtId: "key_b",
    temporalProgramId: "program",
    partTransitions: [{
      id: "part_transition",
      semanticSlotId: "slot",
      mode,
      topologyId: mode === "morph" ? "topology" : null,
      fromKeyformId: "mesh_a",
      toKeyformId: "mesh_b",
      configuration: mode === "hold" ? { holdEndpoint: "from" } : {},
    }],
    diagnosticOverrides: [],
  });
  return project;
}

function instances(project, ticks) {
  return evaluateTransition(project, "transition", ticks)
    .evaluatedParts[0].renderInstances;
}

function addWarp(project, {
  id,
  parentNodeId,
  children,
  bounds = { left: 0, top: 0, right: 20, bottom: 20 },
  changeB = (points) => points,
}) {
  const controlPointIds = ["tl", "tr", "bl", "br"].map((suffix) => `${id}_${suffix}`);
  const created = createWarpDeformer({
    id,
    displayName: id,
    parentNodeId,
    columns: 2,
    rows: 2,
    bounds,
    controlPointIds,
  });
  project.scene.nodes[id] = createSceneNode({
    id,
    kind: "deformer",
    displayName: id,
    parentId: parentNodeId,
  });
  project.scene.nodes[id].children = [...children];
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  const regular = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints);
  project.rig.warpDeformerKeyforms.push(
    { deformerId: id, keyArtId: "key_a", controlPoints: structuredClone(regular) },
    { deformerId: id, keyArtId: "key_b", controlPoints: changeB(structuredClone(regular)) },
  );
}

function wrapSkeletonAndParts(project, { nested = false, collapse = false } = {}) {
  const rootId = project.scene.rootId;
  const rigChildren = ["bone", "part_a", "part_b"];
  const shear = (points) => points.map((point) => point.controlPointId.endsWith("tr")
    ? { ...point, y: point.y + 10 }
    : point);
  const collapsed = (points) => points.map((point) => ({ ...point, y: 0 }));
  if (nested) {
    addWarp(project, {
      id: "outer_warp",
      parentNodeId: rootId,
      children: ["inner_warp"],
      changeB: (points) => points.map((point) => ({ ...point, x: point.x + 2 })),
    });
    addWarp(project, {
      id: "inner_warp",
      parentNodeId: "outer_warp",
      children: rigChildren,
      bounds: { left: 0, top: 0, right: 15, bottom: 15 },
      changeB: shear,
    });
    project.scene.nodes[rootId].children = ["outer_warp"];
    project.scene.nodes.inner_warp.parentId = "outer_warp";
  } else {
    addWarp(project, {
      id: "warp",
      parentNodeId: rootId,
      children: rigChildren,
      changeB: collapse ? collapsed : shear,
    });
    project.scene.nodes[rootId].children = ["warp"];
  }
  const parentId = nested ? "inner_warp" : "warp";
  for (const id of rigChildren) project.scene.nodes[id].parentId = parentId;
  project.rig.bones[0].parentNodeId = parentId;
}

function closeArray(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(
    Math.abs(value - expected[index]) <= epsilon,
    `${value} != ${expected[index]} at ${index}`,
  ));
}

test("rigid FK uses exact A, exact B, and deterministic interpolated endpoint poses", () => {
  const project = fixture();
  closeArray(instances(project, 0)[0].mesh.positions, [10, 0, 11, 0, 10, 1]);
  closeArray(instances(project, 100)[0].mesh.positions, [0, 10, 0, 11, -1, 10]);
  const expected = Math.SQRT1_2;
  closeArray(instances(project, 50)[0].mesh.positions, [
    10 * expected, 10 * expected,
    11 * expected, 11 * expected,
    9 * expected, 11 * expected,
  ]);
  assert.deepEqual(instances(project, 50)[0].mesh.positions, instances(project, 50)[0].mesh.positions);
});

test("Morph Bone rotation uses shortest-arc interpolation", () => {
  const project = fixture({ positions: [1, 0, 2, 0, 1, 1] });
  project.rig.bonePoseKeyforms[0].localDelta.rotation = 170 * Math.PI / 180;
  project.rig.bonePoseKeyforms[1].localDelta.rotation = -170 * Math.PI / 180;
  closeArray(instances(project, 50)[0].mesh.positions.slice(0, 2), [-1, 0]);
});

test("absent BonePoseKeyform is identity and does not mutate Project", () => {
  const project = fixture();
  project.rig.bonePoseKeyforms = [];
  const before = structuredClone(project);
  closeArray(instances(project, 50)[0].mesh.positions, [10, 0, 11, 0, 10, 1]);
  assert.deepEqual(project, before);
});

test("Hold uses its selected endpoint Bone pose", () => {
  const project = fixture({ mode: "hold" });
  closeArray(instances(project, 50)[0].mesh.positions, [10, 0, 11, 0, 10, 1]);
  project.transitions[0].partTransitions[0].configuration.holdEndpoint = "to";
  closeArray(instances(project, 50)[0].mesh.positions, [0, 10, 0, 11, -1, 10]);
});

test("Replace keeps dual instances and evaluates each endpoint Bone pose", () => {
  const project = fixture({ mode: "replace" });
  const result = instances(project, 50);
  assert.equal(result.length, 2);
  closeArray(result.find((entry) => entry.sourceNodeId === "part_a").mesh.positions,
    [10, 0, 11, 0, 10, 1]);
  closeArray(result.find((entry) => entry.sourceNodeId === "part_b").mesh.positions,
    [0, 10, 0, 11, -1, 10]);
});

test("incompatible Morph rigid state is diagnosed without an inferred pose", () => {
  const project = fixture();
  project.rig.rigidBoneBindings.find((entry) => entry.targetNodeId === "part_b").enabled = false;
  const evaluation = evaluateTransition(project, "transition", 50);
  assert.ok(evaluation.diagnostics.some((entry) =>
    entry.code === "BONE_TRANSITION_INCOMPATIBLE" && entry.severity === "error"));
  closeArray(evaluation.evaluatedParts[0].renderInstances[0].mesh.positions,
    [10, 0, 11, 0, 10, 1]);
});

test("ancestor Warp is evaluated before projected FK and rigid deformation", () => {
  const project = fixture({ positions: [10, 1, 11, 1, 10, 2] });
  wrapSkeletonAndParts(project);
  const evaluation = evaluateTransition(project, "transition", 100);
  assert.equal(evaluation.diagnostics.some((entry) => entry.severity === "error"), false);
  closeArray(evaluation.evaluatedParts[0].renderInstances[0].mesh.positions, [
    -0.75, 9.625,
    -0.725, 10.6375,
    -1.5, 9.25,
  ]);
});

test("nested ancestor Warps are projected through the existing Warp evaluator before FK", () => {
  const project = fixture({ positions: [10, 1, 11, 1, 10, 2] });
  wrapSkeletonAndParts(project, { nested: true });
  const first = evaluateTransition(project, "transition", 100);
  const second = evaluateTransition(project, "transition", 100);
  assert.equal(first.diagnostics.some((entry) => entry.severity === "error"), false);
  assert.deepEqual(first, second);
  closeArray(first.evaluatedParts[0].renderInstances[0].mesh.positions, [
    1.444444444444445, 9.62962962962963,
    1.488888888888889, 10.65925925925926,
    0.8888888888888893, 9.25925925925926,
  ]);
});

test("degenerate post-Warp bind frame emits a deterministic Bone diagnostic", () => {
  const project = fixture();
  wrapSkeletonAndParts(project, { collapse: true });
  const first = evaluateTransition(project, "transition", 100);
  const second = evaluateTransition(project, "transition", 100);
  assert.ok(first.diagnostics.some((entry) =>
    entry.code === "BONE_PROJECTED_FRAME_DEGENERATE" && entry.severity === "error"));
  assert.deepEqual(first, second);
});
