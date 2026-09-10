import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSequence } from "../src/core/sequence-evaluator.js";
import { createBoneRotationConstraint } from "../src/model/bone-rotation-constraint.js";
import { boneSceneTransform, createBone, createBonePoseKeyform } from "../src/model/bone.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { createRigidBoneBinding } from "../src/model/rigid-bone-binding.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";

const step = Object.freeze({ kind: "step" });

function scalar(trackId, kind, target, channelName, value) {
  return { trackId, version: 1, kind, target, channels: {
    [channelName]: { keyframes: [{ id: "key_" + trackId, timeTicks: 0, value,
      interpolationToNext: step }] },
  } };
}

function attachClip(project, id, tracks, { weight = 1, layer = 0 } = {}) {
  project.temporalPrograms.push({ id: "program_" + id, durationTicks: 100,
    tracks, events: [], regions: [] });
  project.animation.clips.push({ id, displayName: id, temporalProgramId: "program_" + id,
    defaultLoopMode: "once", metadata: {} });
  project.sequences[0].clipInstances.push({ id: "instance_" + id, clipId: id,
    startTicks: 0, endTicks: 100, sourceOffsetTicks: 0,
    playbackRate: { numerator: 1, denominator: 1 }, loopMode: "once", weight, layer,
    enabled: true });
}

function fixture() {
  const project = createProject({ name: "Rig mixer", width: 100, height: 100,
    idFactory: createIdFactory("rig_mixer") });
  const rootId = project.scene.rootId;
  project.scene.nodes.bone = createSceneNode({ id: "bone", kind: "bone",
    displayName: "Bone", parentId: rootId,
    transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }) });
  project.scene.nodes.part = createSceneNode({ id: "part", displayName: "Part",
    parentId: rootId, bounds: { left: 0, top: 0, right: 2, bottom: 2 } });
  project.scene.nodes[rootId].children.push("bone", "part");
  project.rig.bones.push(createBone({ id: "bone", parentNodeId: rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 }, length: 10 }));
  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({ boneId: "bone",
    keyArtId: "key", localDelta: { x: 0, y: 0, rotation: 0 } }));
  project.rig.rigidBoneBindings.push(createRigidBoneBinding({ id: "binding",
    targetNodeId: "part", boneId: "bone" }));
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: rootId,
    members: [{ nodeId: "part", appearanceId: "appearance", opacity: 1,
      presence: "present", drawOrder: 0, clipping: { sourceNodeId: null } }], metadata: {} });
  project.semanticSlots.push({ id: "slot", displayName: "Part", role: null,
    mappings: [{ keyArtId: "key", nodeId: "part" }], metadata: {} });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  project.meshKeyforms.push({ id: "mesh", topologyId: "topology", keyArtId: "key",
    semanticSlotId: "slot", positions: [1, 0, 2, 0, 1, 1],
    uvs: [0, 0, 1, 0, 0, 1] });
  project.temporalPrograms.push({ id: "program_sequence", durationTicks: 100,
    tracks: [], events: [], regions: [] });
  project.sequences.push({ id: "sequence", displayName: "Shot",
    temporalProgramId: "program_sequence", viewLaneItems: [{ id: "hold", kind: "KeyArtHold",
      keyArtId: "key", startTicks: 0, endTicks: 100 }], clipInstances: [], metadata: {} });
  return project;
}

function firstPositions(project) {
  return evaluateSequence(project, "sequence", 50)
    .evaluatedParts[0].renderInstances[0].mesh.positions;
}

function closeArray(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon,
    `${value} != ${expected[index]} at ${index}`));
}

function wrapWithWarp(project, id, parentNodeId, children) {
  const controlPointIds = ["tl", "tr", "bl", "br"].map((suffix) => id + "_" + suffix);
  const created = createWarpDeformer({ id, displayName: id, parentNodeId,
    columns: 2, rows: 2, bounds: { left: -20, top: -20, right: 20, bottom: 20 },
    controlPointIds });
  project.scene.nodes[id] = createSceneNode({ id, kind: "deformer", displayName: id,
    parentId: parentNodeId });
  project.scene.nodes[id].children = [...children];
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  project.rig.warpDeformerKeyforms.push({ deformerId: id, keyArtId: "key",
    controlPoints: defaultWarpKeyformControlPoints(created.deformer, created.controlPoints) });
  return controlPointIds;
}

function warpTrackSet(deformerId, controlPointIds, amount) {
  return controlPointIds.map((controlPointId) => scalar(
    "deform_" + controlPointId,
    "DeformerTrack",
    { deformerId, controlPointId },
    "deltaX",
    amount,
  ));
}

test("BoneTrack sums over the KeyArt pose then one rotation constraint runs before FK", () => {
  const project = fixture();
  project.rig.bonePoseKeyforms[0].localDelta.rotation = 0.1;
  project.rig.boneRotationConstraints.push(createBoneRotationConstraint({ id: "limit",
    boneId: "bone", minRotation: -0.5, maxRotation: 0.5 }));
  attachClip(project, "bone_a", [scalar("bone_a_rotation", "BoneTrack", { boneId: "bone" },
    "rotation", 0.3)], { layer: 2 });
  attachClip(project, "bone_b", [scalar("bone_b_rotation", "BoneTrack", { boneId: "bone" },
    "rotation", 0.4)], { layer: -1 });
  const before = structuredClone(project.rig.bonePoseKeyforms);
  const positions = firstPositions(project);
  closeArray(positions.slice(0, 2), [Math.cos(0.5), Math.sin(0.5)]);
  assert.deepEqual(project.rig.bonePoseKeyforms, before);
});

test("BoneTrack translation is additive and ClipInstance-weighted", () => {
  const project = fixture();
  project.rig.bonePoseKeyforms[0].localDelta.x = 2;
  attachClip(project, "bone", [scalar("bone_x", "BoneTrack", { boneId: "bone" },
    "x", 6)], { weight: 0.5 });
  closeArray(firstPositions(project).slice(0, 2), [6, 0]);
});

test("DeformerTrack overlays the cage before Warp without mutating keyforms", () => {
  const project = fixture();
  const rootId = project.scene.rootId;
  const points = wrapWithWarp(project, "warp", rootId, ["bone", "part"]);
  project.scene.nodes[rootId].children = ["warp"];
  project.scene.nodes.bone.parentId = "warp";
  project.scene.nodes.part.parentId = "warp";
  project.rig.bones[0].parentNodeId = "warp";
  attachClip(project, "warp_motion", warpTrackSet("warp", points, 2));
  const before = structuredClone(project.rig.warpDeformerKeyforms);
  closeArray(firstPositions(project).slice(0, 2), [3, 0]);
  assert.deepEqual(project.rig.warpDeformerKeyforms, before);
});

test("the same overlaid Warp cage drives visible mesh and post-Warp Bone projection", () => {
  const animated = fixture();
  animated.rig.bonePoseKeyforms[0].localDelta.rotation = Math.PI / 2;
  const rootId = animated.scene.rootId;
  const points = wrapWithWarp(animated, "warp", rootId, ["bone", "part"]);
  animated.scene.nodes[rootId].children = ["warp"];
  animated.scene.nodes.bone.parentId = "warp";
  animated.scene.nodes.part.parentId = "warp";
  animated.rig.bones[0].parentNodeId = "warp";
  attachClip(animated, "warp_motion", warpTrackSet("warp", points, 2));

  const authored = structuredClone(animated);
  authored.sequences[0].clipInstances = [];
  authored.animation.clips = [];
  authored.temporalPrograms = authored.temporalPrograms.filter((program) =>
    program.id !== "program_warp_motion");
  for (const point of authored.rig.warpDeformerKeyforms[0].controlPoints) point.x += 2;
  closeArray(firstPositions(animated), firstPositions(authored));
});

test("nested Warp overlays remain parent-first and deterministic", () => {
  const project = fixture();
  const rootId = project.scene.rootId;
  const outer = wrapWithWarp(project, "outer", rootId, ["inner"]);
  const inner = wrapWithWarp(project, "inner", "outer", ["bone", "part"]);
  project.scene.nodes[rootId].children = ["outer"];
  project.scene.nodes.bone.parentId = "inner";
  project.scene.nodes.part.parentId = "inner";
  project.rig.bones[0].parentNodeId = "inner";
  attachClip(project, "outer_motion", warpTrackSet("outer", outer, 1), { layer: 3 });
  attachClip(project, "inner_motion", warpTrackSet("inner", inner, 2), { layer: -2 });
  const first = evaluateSequence(project, "sequence", 50);
  const second = evaluateSequence(project, "sequence", 50);
  assert.deepEqual(second, first);
  closeArray(first.evaluatedParts[0].renderInstances[0].mesh.positions.slice(0, 2), [4, 0]);
});
