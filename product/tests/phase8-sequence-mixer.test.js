import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSequence } from "../src/core/sequence-evaluator.js";
import { evaluateExportFrame, planSequenceExportFrames } from "../src/core/export-frame-evaluator.js";
import { ExportFrameRenderer } from "../src/core/export-frame-renderer.js";
import { createEvaluatedRenderPlan } from "../src/core/evaluated-render.js";
import {
  collectClipContributions,
  resolveActiveClipSamples,
} from "../src/core/sequence-mixer.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { createMeshFormCorrectionKeyform } from "../src/model/mesh-form-correction.js";
import { renderEvaluatedViewport } from "../src/ui/viewport-renderer.js";

const step = Object.freeze({ kind: "step" });

function channel(id, value, timeTicks = 0) {
  return { keyframes: [{ id, timeTicks, value, interpolationToNext: step }] };
}

function track(trackId, kind, target, channels) {
  return { trackId, version: 1, kind, target, channels };
}

function member(nodeId, appearanceId, drawOrder = 0) {
  return { nodeId, appearanceId, opacity: 1, presence: "present", drawOrder,
    clipping: { sourceNodeId: null } };
}

function clipInstance(id, clipId, overrides = {}) {
  return { id, clipId, startTicks: 0, endTicks: 100, sourceOffsetTicks: 0,
    playbackRate: { numerator: 1, denominator: 1 }, loopMode: "once", weight: 1,
    layer: 0, enabled: true, ...overrides };
}

function addClip(project, id, tracks, instanceOverrides = {}) {
  const programId = "program_" + id;
  project.temporalPrograms.push({ id: programId, durationTicks: 100,
    tracks, events: [], regions: [] });
  project.animation.clips.push({ id, displayName: id, temporalProgramId: programId,
    defaultLoopMode: "once", metadata: {} });
  const instance = clipInstance("instance_" + id, id, instanceOverrides);
  project.sequences[0].clipInstances.push(instance);
  return instance;
}

function fixture({ transitionMode = null } = {}) {
  const project = createProject({ name: "Mixer", width: 100, height: 100,
    idFactory: createIdFactory("mixer") });
  const rootId = project.scene.rootId;
  project.scene.nodes.parent = createSceneNode({ id: "parent", kind: "group",
    displayName: "Parent", parentId: rootId });
  project.scene.nodes.node_a = createSceneNode({ id: "node_a", displayName: "A",
    sourceRef: "mesh_subject", parentId: "parent",
    bounds: { left: 0, top: 0, right: 10, bottom: 10 } });
  project.scene.nodes.node_b = createSceneNode({ id: "node_b", displayName: "B",
    sourceRef: "mesh_subject", parentId: "parent",
    bounds: { left: 0, top: 0, right: 10, bottom: 10 } });
  project.scene.nodes[rootId].children.push("parent");
  project.scene.nodes.parent.children.push("node_a", "node_b");
  project.meshes.push({ id: "mesh_subject" });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  project.keyArts.push(
    { id: "key_a", displayName: "A", rootNodeId: rootId,
      members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "key_b", displayName: "B", rootNodeId: rootId,
      members: [member("node_b", "appearance_b")], metadata: {} },
  );
  project.semanticSlots.push({ id: "slot", displayName: "Subject", role: null,
    mappings: [{ keyArtId: "key_a", nodeId: "node_a" },
      { keyArtId: "key_b", nodeId: "node_b" }], metadata: {} });
  project.meshKeyforms.push(
    { id: "mesh_a", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
      positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "mesh_b", topologyId: "topology", keyArtId: "key_b", semanticSlotId: "slot",
      positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
  );
  project.temporalPrograms.push({ id: "program_sequence", durationTicks: 100,
    tracks: [], events: [], regions: [] });
  let viewLaneItems;
  if (transitionMode) {
    project.temporalPrograms.push({ id: "program_transition", durationTicks: 100,
      tracks: [], events: [], regions: [] });
    project.transitions.push({ id: "transition", displayName: "A/B",
      fromKeyArtId: "key_a", toKeyArtId: "key_b", temporalProgramId: "program_transition",
      partTransitions: [{ id: "part", semanticSlotId: "slot", mode: transitionMode,
        topologyId: transitionMode === "morph" ? "topology" : null,
        fromKeyformId: "mesh_a", toKeyformId: "mesh_b",
        configuration: transitionMode === "replace" ? { compositeGroupId: "group" } : {} }],
      diagnosticOverrides: [] });
    viewLaneItems = [{ id: "transition_instance", kind: "TransitionInstance",
      transitionId: "transition", startTicks: 0, endTicks: 100 }];
  } else {
    viewLaneItems = [{ id: "hold", kind: "KeyArtHold", keyArtId: "key_a",
      startTicks: 0, endTicks: 100 }];
  }
  project.sequences.push({ id: "sequence", displayName: "Shot",
    temporalProgramId: "program_sequence", viewLaneItems, clipInstances: [], metadata: {} });
  return project;
}

function firstInstance(project, tick = 50) {
  return evaluateSequence(project, "sequence", tick)
    .evaluatedParts[0].renderInstances[0];
}

test("continuous mixer is insertion-order independent and uses canonical contribution order", () => {
  const project = fixture();
  addClip(project, "z", [track("track_z", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("z_x", -1e16),
    })], { layer: -1 });
  addClip(project, "a", [track("track_a", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("a_x", 1e16),
    })], { layer: 0 });
  addClip(project, "b", [track("track_b", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("b_x", 1),
    })], { layer: 1 });
  const active = resolveActiveClipSamples(project, project.sequences[0], 50);
  assert.deepEqual(collectClipContributions(active).map((entry) => [
    entry.layer, entry.clipInstanceId, entry.trackId, entry.channel, entry.targetStableId,
  ]), [
    [-1, "instance_z", "track_z", "positionX", "slot"],
    [0, "instance_a", "track_a", "positionX", "slot"],
    [1, "instance_b", "track_b", "positionX", "slot"],
  ]);
  const before = evaluateSequence(project, "sequence", 50);
  project.sequences[0].clipInstances.reverse();
  project.animation.clips.reverse();
  project.temporalPrograms.reverse();
  assert.deepEqual(evaluateSequence(project, "sequence", 50), before);
  assert.equal(before.evaluatedParts[0].renderInstances[0].transform[4], 1);
});

test("TransformTrack mixes additive position/rotation and weighted multiplicative scale", () => {
  const project = fixture();
  addClip(project, "motion", [track("transform", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("position", 8),
      rotation: channel("rotation", 2),
      scaleX: channel("scale_x", 4),
      scaleY: channel("scale_y", 9),
    })], { weight: 0.5 });
  const instance = firstInstance(project);
  assert.ok(Math.abs(instance.transform[4] - 4) < 1e-12);
  assert.ok(Math.abs(Math.hypot(instance.transform[0], instance.transform[1]) - 2) < 1e-12);
  assert.ok(Math.abs(Math.hypot(instance.transform[2], instance.transform[3]) - 3) < 1e-12);
  assert.ok(Math.abs(Math.atan2(instance.transform[1], instance.transform[0]) - 1) < 1e-12);
});

test("parent TransformTrack uses ordinary ancestry before the render instance is emitted", () => {
  const project = fixture();
  addClip(project, "parent_motion", [track("parent_transform", "TransformTrack",
    { nodeId: "parent", coordinateSpace: "node-local" }, {
      positionY: channel("parent_y", 12),
    })]);
  assert.equal(firstInstance(project).transform[5], 12);
});

test("SemanticSlot Transform applies to both Morph endpoints and Replace instances", () => {
  for (const transitionMode of ["morph", "replace"]) {
    const project = fixture({ transitionMode });
    addClip(project, "semantic", [track("semantic_transform", "TransformTrack",
      { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
        positionX: channel("semantic_x", 7),
      })]);
    const result = evaluateSequence(project, "sequence", 50);
    assert.ok(result.evaluatedParts[0].renderInstances.length >= 1);
    assert.ok(result.evaluatedParts[0].renderInstances.every((entry) =>
      Math.abs(entry.transform[4] - 7) < 1e-12));
  }
});

test("node Transform spanning incompatible mapped Key Arts diagnoses instead of guessing", () => {
  const project = fixture({ transitionMode: "morph" });
  addClip(project, "node", [track("node_transform", "TransformTrack",
    { nodeId: "node_a", coordinateSpace: "node-local" }, {
      positionX: channel("node_x", 10),
    })]);
  const result = evaluateSequence(project, "sequence", 50);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "ANIMATION_CLIP_TARGET_INCOMPATIBLE"));
  assert.equal(result.authoritative, false);
});

test("node Transform remains compatible when Transition Hold keeps that mapped source", () => {
  const project = fixture({ transitionMode: "hold" });
  addClip(project, "node", [track("node_transform", "TransformTrack",
    { nodeId: "node_a", coordinateSpace: "node-local" }, {
      positionX: channel("node_x", 10),
    })]);
  const result = evaluateSequence(project, "sequence", 50);
  assert.equal(result.evaluatedParts[0].renderInstances[0].transform[4], 10);
  assert.ok(!result.diagnostics.some((entry) =>
    entry.code === "ANIMATION_CLIP_TARGET_INCOMPATIBLE"));
});

test("clip opacity is a weighted multiplier around identity", () => {
  const project = fixture();
  addClip(project, "opacity", [track("opacity", "OpacityTrack",
    { semanticSlotId: "slot" }, { opacity: channel("opacity_key", 0.2) })],
  { weight: 0.5 });
  assert.equal(firstInstance(project).opacity, 0.6);
});

test("discrete highest layer wins, identical ties agree, and incompatible ties diagnose", () => {
  const project = fixture();
  addClip(project, "low", [track("low_draw", "DrawOrderTrack",
    { semanticSlotId: "slot" }, { drawOrder: channel("low_key", 2) })], { layer: 0 });
  addClip(project, "high_a", [track("high_a_draw", "DrawOrderTrack",
    { semanticSlotId: "slot" }, { drawOrder: channel("high_a_key", 9) })], { layer: 5 });
  addClip(project, "high_b", [track("high_b_draw", "DrawOrderTrack",
    { semanticSlotId: "slot" }, { drawOrder: channel("high_b_key", 9) })], { layer: 5 });
  assert.equal(firstInstance(project).drawOrder, 9);
  addClip(project, "high_c", [track("high_c_draw", "DrawOrderTrack",
    { semanticSlotId: "slot" }, { drawOrder: channel("high_c_key", 10) })], { layer: 5 });
  const conflict = evaluateSequence(project, "sequence", 50);
  assert.ok(conflict.diagnostics.some((entry) => entry.code === "ANIMATION_TRACK_CONFLICT"));
  assert.equal(conflict.authoritative, false);
  project.sequences[0].clipInstances.reverse();
  assert.deepEqual(evaluateSequence(project, "sequence", 50).diagnostics, conflict.diagnostics);
});

test("Presence and Clipping overrides resolve before the existing final clipping pass", () => {
  const project = fixture();
  const rootId = project.scene.rootId;
  project.scene.nodes.mask = createSceneNode({ id: "mask", displayName: "Mask",
    parentId: rootId, bounds: { left: -5, top: -5, right: 5, bottom: 5 } });
  project.scene.nodes[rootId].children.push("mask");
  project.keyArts[0].members.push(member("mask", "appearance_mask", 1));
  project.semanticSlots.push({ id: "mask_slot", displayName: "Mask", role: null,
    mappings: [{ keyArtId: "key_a", nodeId: "mask" }], metadata: {} });
  addClip(project, "clipping", [
    track("clip_override", "ClippingTrack", { semanticSlotId: "slot" }, {
      clipping: channel("clip_key", { sourceNodeId: "mask" }),
    }),
  ], { layer: 4 });
  const clipped = evaluateSequence(project, "sequence", 50);
  const subject = clipped.evaluatedParts.find((part) => part.semanticSlotId === "slot")
    .renderInstances[0];
  const mask = clipped.evaluatedParts.find((part) => part.semanticSlotId === "mask_slot")
    .renderInstances[0];
  assert.equal(subject.clipping.sourceRenderInstanceId, mask.renderInstanceId);

  addClip(project, "presence", [track("presence_override", "PresenceTrack",
    { semanticSlotId: "slot" }, { presence: channel("presence_key", "absent") })],
  { layer: 5 });
  const hidden = evaluateSequence(project, "sequence", 50);
  assert.equal(hidden.evaluatedParts.find((part) => part.semanticSlotId === "slot").presence,
    "absent");
});

test("disabled, zero-weight, and terminal-ending ClipInstances contribute no visual motion", () => {
  const project = fixture();
  addClip(project, "disabled", [track("disabled", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("disabled_x", 50),
    })], { enabled: false });
  addClip(project, "zero", [track("zero", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("zero_x", 50),
    })], { weight: 0 });
  addClip(project, "ending", [track("ending", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("ending_x", 50),
    })], { startTicks: 99, endTicks: 100 });
  const terminal = evaluateSequence(project, "sequence", 100);
  assert.equal(terminal.activeClipInstances.length, 0);
  assert.equal(terminal.evaluatedParts[0].renderInstances[0].transform[4], 0);
});

test("mixer reuses Once endpoint and Loop exact-period local ticks without a terminal sample", () => {
  const once = fixture();
  const onceInstance = addClip(once, "once", [track("once_transform", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: { keyframes: [
        { id: "once_start", timeTicks: 0, value: 1, interpolationToNext: step },
        { id: "once_end", timeTicks: 100, value: 9, interpolationToNext: step },
      ] },
    })], { endTicks: 1, sourceOffsetTicks: 100 });
  assert.equal(evaluateSequence(once, "sequence", 0)
    .evaluatedParts[0].renderInstances[0].transform[4], 9);
  assert.equal(onceInstance.loopMode, "once");

  const loop = fixture();
  const loopInstance = addClip(loop, "loop", [track("loop_transform", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: { keyframes: [
        { id: "loop_start", timeTicks: 0, value: 2, interpolationToNext: step },
        { id: "loop_end", timeTicks: 100, value: 99, interpolationToNext: step },
      ] },
    })], { loopMode: "loop" });
  const wrapped = evaluateSequence(loop, "sequence", 100);
  assert.equal(wrapped.activeClipInstances.length, 0);
  loopInstance.endTicks = 100;
  const atPeriod = evaluateSequence(loop, "sequence", 50);
  assert.equal(atPeriod.activeClipInstances[0].localTick, 50);
  loopInstance.playbackRate = { numerator: 2, denominator: 1 };
  const exactWrap = evaluateSequence(loop, "sequence", 50);
  assert.equal(exactWrap.activeClipInstances[0].rawLocalTick, 100);
  assert.equal(exactWrap.activeClipInstances[0].localTick, 0);
  assert.equal(exactWrap.evaluatedParts[0].renderInstances[0].transform[4], 2);
});

test("MeshDeformationTrack applies after existing MeshFormCorrection by stable vertex ID", () => {
  const project = fixture();
  project.meshFormCorrectionKeyforms.push(createMeshFormCorrectionKeyform({
    id: "form", topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot",
    vertexOffsets: [{ vertexId: "v1", x: 2, y: 3 }],
  }));
  project.animation.deformationSamples.push({ id: "sample", meshId: "mesh_subject",
    topologyId: "topology", offsets: [{ vertexId: "v1", dx: 5, dy: 7 }] });
  addClip(project, "mesh", [track("mesh_track", "MeshDeformationTrack",
    { meshId: "mesh_subject" }, { deformation: channel("mesh_key", {
      deformationSampleId: "sample", weight: 0.5,
    }) })], { weight: 0.4 });
  assert.deepEqual(firstInstance(project).mesh.positions.slice(0, 2), [3, 4.4]);
});

test("topology mismatch is structural and does not silently remap offsets", () => {
  const project = fixture();
  project.meshTopologies.push({ id: "other", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  project.animation.deformationSamples.push({ id: "sample", meshId: "mesh_subject",
    topologyId: "other", offsets: [{ vertexId: "v1", dx: 5, dy: 7 }] });
  addClip(project, "mesh", [track("mesh_track", "MeshDeformationTrack",
    { meshId: "mesh_subject" }, { deformation: channel("mesh_key", {
      deformationSampleId: "sample", weight: 1,
    }) })]);
  const result = evaluateSequence(project, "sequence", 50);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "ANIMATION_TOPOLOGY_INCOMPATIBLE"));
  assert.deepEqual(result.evaluatedParts[0].renderInstances[0].mesh.positions.slice(0, 2), [0, 0]);
});

test("invalid active targets and fractional discrete weights are non-authoritative diagnostics", () => {
  const project = fixture();
  addClip(project, "invalid_target", [track("missing_bone", "BoneTrack",
    { boneId: "missing" }, { rotation: channel("missing_bone_key", 1) })]);
  addClip(project, "invalid_weight", [track("presence", "PresenceTrack",
    { semanticSlotId: "slot" }, { presence: channel("presence_key", "absent") })],
  { weight: 0.5 });
  const result = evaluateSequence(project, "sequence", 50);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "ANIMATION_TRACK_TARGET_INVALID"));
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "ANIMATION_DISCRETE_WEIGHT_INVALID"));
  assert.equal(result.authoritative, false);
});

test("Sequence camera and exact-tick events are deterministic metadata", () => {
  const project = fixture();
  project.temporalPrograms[0].tracks.push(track("camera", "CameraTrack",
    { cameraId: "main" }, {
      positionX: channel("camera_x", 4, 50),
      scale: channel("camera_scale", 2, 50),
    }));
  project.temporalPrograms[0].events.push({ id: "sequence_event", timeTicks: 50,
    type: "marker", payload: {} });
  addClip(project, "events", [], {});
  project.temporalPrograms.find((entry) => entry.id === "program_events").events.push(
    { id: "clip_event", timeTicks: 50, type: "marker", payload: {} },
  );
  const result = evaluateSequence(project, "sequence", 50);
  assert.deepEqual(result.camera,
    { positionX: 4, positionY: 0, rotation: 0, scale: 2 });
  assert.deepEqual(result.events.map((entry) => [entry.sourceScope, entry.event.id]), [
    ["sequence", "sequence_event"],
    ["clip", "clip_event"],
  ]);
});

test("sequence evaluation is pure, repeatable, and Save/Open equivalent", () => {
  const project = fixture();
  addClip(project, "motion", [track("transform", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("position", 8),
    })]);
  const snapshot = structuredClone(project);
  const first = evaluateSequence(project, "sequence", 50);
  assert.deepEqual(evaluateSequence(project, "sequence", 50), first);
  assert.deepEqual(project, snapshot);
  assert.deepEqual(evaluateSequence(
    deserializeProject(serializeProject(project)), "sequence", 50,
  ), first);
  assert.equal(Object.hasOwn(globalThis, "document"), false);
});

test("Sequence export uses its owned duration and the exact headless source frame", () => {
  const project = fixture();
  addClip(project, "motion", [track("transform", "TransformTrack",
    { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      positionX: channel("position", 8),
    })]);
  const planner = planSequenceExportFrames(project, "sequence",
    { numerator: 2400, denominator: 1 });
  assert.equal(planner.durationTicks, 100);
  const exported = evaluateExportFrame(project, { sequenceId: "sequence",
    frameRate: planner.frameRate, frameIndex: 1 });
  assert.equal(exported.frame.timeTicks, 50);
  assert.deepEqual(exported.evaluation, evaluateSequence(project, "sequence", 50));
  assert.deepEqual(exported.evaluatedSequence, exported.evaluation);
});

test("preview, PNG source, and MP4 source share the ordinary Sequence frame and camera", () => {
  const project = fixture();
  project.temporalPrograms[0].tracks.push(track("camera", "CameraTrack",
    { cameraId: "main" }, {
      positionX: channel("camera_x", 4, 50),
      scale: channel("camera_scale", 2, 50),
    }));
  const headless = evaluateSequence(project, "sequence", 50);
  const expectedPlan = createEvaluatedRenderPlan(headless, { resolveArtwork: () => ({}) });
  assert.deepEqual(expectedPlan.camera, headless.camera);
  assert.deepEqual(expectedPlan.batches[0].renderInstances[0].transform,
    [2, 0, 0, 2, -8, 0]);

  let previewPlan = null;
  const preview = renderEvaluatedViewport({
    evaluation: headless,
    view: { originX: 0, originY: 0, scale: 1 },
    renderer: { renderEvaluated(plan) { previewPlan = plan; } },
    resolveArtwork: () => ({}),
  });
  assert.equal(preview.renderInstanceCount, 1);
  assert.deepEqual(previewPlan, expectedPlan);

  let sourcePlan = null;
  const renderer = new ExportFrameRenderer({
    createOffscreenRenderer: () => ({
      renderEvaluated(plan) {
        sourcePlan = plan;
        return { kind: "rgba8", width: 100, height: 100,
          rowOrder: "top-to-bottom", alphaMode: "premultiplied",
          data: new Uint8Array(100 * 100 * 4) };
      },
    }),
  });
  const source = renderer.render({ project, sequenceId: "sequence",
    frameRate: { numerator: 2400, denominator: 1 }, frameIndex: 1,
    outputWidth: 100, outputHeight: 100,
    renderAssets: [{ nodeId: "node_a", status: "ready", image: {} }] });
  assert.equal(source.ok, true);
  assert.deepEqual(source.evaluatedFrame, headless);
  assert.deepEqual(sourcePlan, expectedPlan);
});

test("Sequence export refuses a structurally non-authoritative mixer conflict", () => {
  const project = fixture();
  for (const [id, value] of [["a", 2], ["b", 3]]) {
    addClip(project, id, [track("draw_" + id, "DrawOrderTrack",
      { semanticSlotId: "slot" }, { drawOrder: channel("draw_key_" + id, value) })],
    { layer: 4 });
  }
  const renderer = new ExportFrameRenderer({
    createOffscreenRenderer: () => ({ renderEvaluated() { return null; } }),
  });
  const result = renderer.render({ project, sequenceId: "sequence",
    frameRate: { numerator: 2400, denominator: 1 }, frameIndex: 1,
    outputWidth: 100, outputHeight: 100,
    renderAssets: [{ nodeId: "node_a", status: "ready", image: {} }] });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "export.non_authoritative_evaluation" &&
    entry.codes.includes("ANIMATION_TRACK_CONFLICT")));
});
