import assert from "node:assert/strict";
import test from "node:test";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { sampleBezier } from "../src/core/temporal.js";
import { createWarpDeformer } from "../src/model/warp-deformer.js";
import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createAnimationClip } from "../src/model/animation-clip.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";

const step = { kind: "step" };
const linear = { kind: "linear" };

function key(id, timeTicks, value, interpolationToNext = linear) {
  return { id, timeTicks, value, interpolationToNext };
}

function track(trackId, kind, target, channels) {
  return { trackId, version: 1, kind, target, channels };
}

function channel(...keyframes) {
  return { keyframes };
}

function fixture() {
  const project = createProject({ name: "Phase 8-3", width: 100, height: 100,
    idFactory: createIdFactory("phase8_tracks") });
  const rootId = project.scene.rootId;
  project.scene.nodes.part = createSceneNode({ id: "part", displayName: "Part", parentId: rootId });
  project.scene.nodes[rootId].children.push("part");
  project.semanticSlots.push({ id: "slot", displayName: "Slot",
    mappings: [], metadata: {} });
  project.scene.nodes.bone = createSceneNode({ id: "bone", kind: "bone", displayName: "Bone",
    parentId: rootId, transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }) });
  project.scene.nodes[rootId].children.push("bone");
  project.rig.bones.push(createBone({ id: "bone", parentNodeId: rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 }, length: 10 }));
  const warp = createWarpDeformer({ id: "warp", displayName: "Warp", parentNodeId: rootId,
    columns: 2, rows: 2, bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    controlPointIds: ["cp1", "cp2", "cp3", "cp4"] });
  project.rig.deformers.push(warp.deformer);
  project.rig.warpControlPoints.push(...warp.controlPoints);
  project.scene.nodes.warp = createSceneNode({ id: "warp", kind: "deformer",
    displayName: "Warp", parentId: rootId });
  project.scene.nodes[rootId].children.push("warp");
  project.meshes.push({ id: "mesh" }, { id: "mesh_other" });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  project.animation.deformationSamples.push({ id: "sample", meshId: "mesh",
    topologyId: "topology", offsets: [{ vertexId: "v1", dx: 2, dy: -1 }] });
  return project;
}

function ownClipProgram(project, tracks, durationTicks = 100) {
  project.temporalPrograms.push({ id: "program", durationTicks, tracks, events: [], regions: [] });
  project.animation.clips.push(createAnimationClip({ id: "clip", displayName: "Clip",
    temporalProgramId: "program" }));
}

test("Phase 8-3 typed tracks validate in an AnimationClip and sample through the shared query", () => {
  const project = fixture();
  ownClipProgram(project, [
    track("transform", "TransformTrack", { nodeId: "part", coordinateSpace: "node-local" }, {
      positionX: channel(key("tx0", 0, 0), key("tx1", 100, 10, step)),
      rotation: channel(key("tr0", 0, 3 * Math.PI / 4), key("tr1", 100, -3 * Math.PI / 4, step)),
      scaleX: channel(key("tsx0", 0, 1), key("tsx1", 100, 2, step)),
    }),
    track("bone_track", "BoneTrack", { boneId: "bone" }, {
      x: channel(key("bx0", 0, 0), key("bx1", 100, 4, step)),
      rotation: channel(key("br0", 0, 0), key("br1", 100, Math.PI, step)),
    }),
    track("deformer_track", "DeformerTrack", { deformerId: "warp", controlPointId: "cp1" }, {
      deltaX: channel(key("dx0", 0, 0), key("dx1", 100, 8, step)),
      deltaY: channel(key("dy0", 0, 0), key("dy1", 100, -2, step)),
    }),
    track("mesh_track", "MeshDeformationTrack", { meshId: "mesh" }, {
      deformation: channel(
        key("md0", 0, { deformationSampleId: "sample", weight: 0 }),
        key("md1", 100, { deformationSampleId: "sample", weight: 1 }, step),
      ),
    }),
  ]);
  assert.equal(validateProject(project).some((issue) => issue.severity === "error"), false);
  const before = structuredClone(project);
  const session = new EditorSession(project);
  const sampled = session.query("animation.sample_program",
    { programId: "program", timeTicks: 50 });
  const values = Object.fromEntries(sampled.tracks.map((entry) => [entry.trackId, entry.values]));
  assert.equal(values.transform.positionX, 5);
  assert.ok(Math.abs(values.transform.rotation - Math.PI) < 1e-12);
  assert.equal(values.transform.scaleX, 1.5);
  assert.equal(values.bone_track.x, 2);
  assert.equal(values.bone_track.rotation, Math.PI / 2);
  assert.deepEqual(values.deformer_track, { deltaX: 4, deltaY: -1 });
  assert.deepEqual(values.mesh_track.deformation,
    { deformationSampleId: "sample", weight: 0.5 });
  assert.deepEqual(project, before);
  assert.equal(session.history.length, 0);
  const reversed = structuredClone(project);
  reversed.temporalPrograms[0].tracks.reverse();
  assert.deepEqual(new EditorSession(reversed).query("animation.sample_program",
    { programId: "program", timeTicks: 50 }), sampled);
});

test("Bone-compatible angular tie direction is shared without changing endpoint values", () => {
  const project = fixture();
  ownClipProgram(project, [
    track("positive", "TransformTrack", { semanticSlotId: "slot", coordinateSpace: "node-local" }, {
      rotation: channel(key("p0", 0, 0), key("p1", 100, Math.PI, step)),
    }),
    track("negative", "BoneTrack", { boneId: "bone" }, {
      rotation: channel(key("n0", 0, 0), key("n1", 100, -Math.PI, step)),
    }),
  ]);
  const session = new EditorSession(project);
  const middle = session.query("animation.sample_program", { programId: "program", timeTicks: 50 });
  assert.equal(middle.tracks.find((entry) => entry.trackId === "positive").values.rotation,
    Math.PI / 2);
  assert.equal(middle.tracks.find((entry) => entry.trackId === "negative").values.rotation,
    -Math.PI / 2);
  const end = session.query("animation.sample_program", { programId: "program", timeTicks: 100 });
  assert.equal(end.tracks.find((entry) => entry.trackId === "positive").values.rotation, Math.PI);
  assert.equal(end.tracks.find((entry) => entry.trackId === "negative").values.rotation, -Math.PI);
});

test("typed targets and positive scale channels reject malformed references deterministically", () => {
  const cases = [
    track("transform", "TransformTrack", { nodeId: "part", semanticSlotId: "slot",
      coordinateSpace: "node-local" }, { scaleX: channel(key("k1", 0, 0, step)) }),
    track("bone_track", "BoneTrack", { boneId: "missing" },
      { rotation: channel(key("k2", 0, Number.NaN, step)) }),
    track("deformer_track", "DeformerTrack", { deformerId: "missing", controlPointId: "cp1" },
      { deltaX: channel(key("k3", 0, 1, step)) }),
    track("coordinate", "TransformTrack", { nodeId: "part", coordinateSpace: "world" },
      { positionX: channel(key("k4", 0, 1, step)) }),
    track("point", "DeformerTrack", { deformerId: "warp", controlPointId: "missing" },
      { deltaY: channel(key("k5", 0, 1, step)) }),
  ];
  for (const value of cases) {
    const project = fixture();
    ownClipProgram(project, [value]);
    const issues = validateProject(project);
    assert.ok(issues.some((issue) => issue.code === "ANIMATION_TRACK_TARGET_INVALID"), value.trackId);
  }
  const project = fixture();
  ownClipProgram(project, [cases[0]]);
  assert.ok(validateProject(project).some((issue) => issue.code === "ANIMATION_INVALID_VALUE"));
});

test("CameraTrack is Sequence-owned and shares scalar Bezier and angular sampling", () => {
  const project = fixture();
  const ease = { kind: "bezier", x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: project.scene.rootId,
    members: [], metadata: {} });
  project.temporalPrograms.push({ id: "camera_program", durationTicks: 100, events: [], regions: [],
    tracks: [track("camera", "CameraTrack", { cameraId: "main" }, {
      positionX: channel(key("cx0", 0, 0, ease), key("cx1", 100, 10, step)),
      rotation: channel(key("cr0", 0, 0, ease), key("cr1", 100, Math.PI, step)),
      scale: channel(key("cs0", 0, 1), key("cs1", 100, 2, step)),
    })] });
  project.sequences.push({ id: "sequence", displayName: "Sequence",
    temporalProgramId: "camera_program", viewLaneItems: [{ id: "hold", kind: "KeyArtHold",
      keyArtId: "key", startTicks: 0, endTicks: 100 }], clipInstances: [], metadata: {} });
  const session = new EditorSession(project);
  const values = session.query("animation.sample_program",
    { programId: "camera_program", timeTicks: 50 }).tracks[0].values;
  const eased = sampleBezier(0.5, ease);
  assert.ok(Math.abs(values.positionX - 10 * eased) < 1e-12);
  assert.ok(Math.abs(values.rotation - Math.PI * eased) < 1e-12);
  assert.equal(values.scale, 1.5);

  project.temporalPrograms[0].tracks[0].channels.scale.keyframes[0].value = 0;
  assert.ok(validateProject(project).some((issue) => issue.code === "ANIMATION_INVALID_VALUE"));
});

test("clip discrete and opacity tracks accept exact node and SemanticSlot targets", () => {
  const project = fixture();
  const targets = [{ nodeId: "part" }, { semanticSlotId: "slot" }];
  const families = [
    ["OpacityTrack", "opacity", 0.5, linear],
    ["PresenceTrack", "presence", "present", step],
    ["DrawOrderTrack", "drawOrder", 1, step],
    ["ClippingTrack", "clipping", { sourceNodeId: null }, step],
  ];
  ownClipProgram(project, families.flatMap(([kind, channelName, value, interpolation]) =>
    targets.map((targetValue, index) => track(kind + index, kind, targetValue, {
      [channelName]: channel(key(kind + index + "_key", 0,
        kind === "DrawOrderTrack" ? value + index : value, interpolation)),
    }))));
  assert.equal(validateProject(project).some((issue) => issue.severity === "error"), false);
});

test("MeshDeformationTrack validates sample identity mesh and continuous sample compatibility", () => {
  const project = fixture();
  project.animation.deformationSamples.push({ id: "sample_other", meshId: "mesh_other",
    topologyId: "topology", offsets: [] });
  ownClipProgram(project, [track("mesh_track", "MeshDeformationTrack", { meshId: "mesh" }, {
    deformation: channel(
      key("m0", 0, { deformationSampleId: "sample", weight: 0 }),
      key("m1", 100, { deformationSampleId: "sample_other", weight: 1 }, step),
    ),
  })]);
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.code === "ANIMATION_TOPOLOGY_INCOMPATIBLE"));
  assert.ok(issues.some((issue) => issue.code === "ANIMATION_MESH_SAMPLE_INCOMPATIBLE"));
});

test("owner matrix keeps Camera Sequence-only and reusable tracks Clip-only", () => {
  const transition = fixture();
  transition.temporalPrograms.push({ id: "transition_program", durationTicks: 100,
    tracks: [track("bone_track", "BoneTrack", { boneId: "bone" },
      { x: channel(key("b", 0, 0, step)) })], events: [], regions: [] });
  transition.transitions.push({ id: "transition", displayName: "Transition",
    fromKeyArtId: "missing_a", toKeyArtId: "missing_b", temporalProgramId: "transition_program",
    partTransitions: [], diagnosticOverrides: [], metadata: {} });
  assert.ok(validateProject(transition).some((issue) =>
    issue.code === "ANIMATION_TRACK_OWNER_INVALID" && issue.entityId === "bone_track"));

  const clip = fixture();
  ownClipProgram(clip, [track("camera", "CameraTrack", { cameraId: "main" },
    { scale: channel(key("c", 0, 1, step)) })]);
  assert.ok(validateProject(clip).some((issue) =>
    issue.code === "ANIMATION_TRACK_OWNER_INVALID" && issue.entityId === "camera"));
});

test("discrete Clip data statically requires full ClipInstance weight", () => {
  const project = fixture();
  ownClipProgram(project, [track("presence", "PresenceTrack", { nodeId: "part" }, {
    presence: channel(key("presence_key", 0, "present", step)),
  })]);
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: project.scene.rootId,
    members: [], metadata: {} });
  project.temporalPrograms.push({ id: "sequence_program", durationTicks: 100,
    tracks: [], events: [], regions: [] });
  project.sequences.push({ id: "sequence", displayName: "Sequence",
    temporalProgramId: "sequence_program", viewLaneItems: [{ id: "hold", kind: "KeyArtHold",
      keyArtId: "key", startTicks: 0, endTicks: 100 }], clipInstances: [{
      id: "instance", clipId: "clip", startTicks: 0, endTicks: 100, sourceOffsetTicks: 0,
      playbackRate: { numerator: 1, denominator: 1 }, loopMode: "once", weight: 0.5,
      layer: 0, enabled: true,
    }], metadata: {} });
  const issues = validateProject(project);
  assert.deepEqual(issues.filter((issue) => issue.code === "ANIMATION_DISCRETE_WEIGHT_INVALID")
    .map((issue) => issue.entityId), ["instance"]);
  project.sequences[0].clipInstances[0].weight = 1;
  assert.equal(validateProject(project).some((issue) =>
    issue.code === "ANIMATION_DISCRETE_WEIGHT_INVALID"), false);
});

test("existing temporal commands remain the only track CRUD and reject invalid typed edits atomically", () => {
  const project = fixture();
  ownClipProgram(project, []);
  const session = new EditorSession(project);
  assert.throws(() => session.execute({ type: "animation.temporal.add_track", payload: {
    programId: "program",
    track: track("bad_scale", "TransformTrack",
      { nodeId: "part", coordinateSpace: "node-local" },
      { scaleY: channel(key("scale", 0, -1, step)) }),
  } }), (error) => error instanceof TransactionError &&
    error.issues.some((issue) => issue.code === "ANIMATION_INVALID_VALUE"));
  assert.equal(session.query("animation.list_tracks", { programId: "program" }).length, 0);
  assert.equal(session.history.length, 0);
});
