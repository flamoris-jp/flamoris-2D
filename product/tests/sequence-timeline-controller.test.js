import assert from "node:assert/strict";
import test from "node:test";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { createWarpDeformer } from "../src/model/warp-deformer.js";
import { SequenceTimelineController } from "../src/ui/sequence-timeline-controller.js";

function fixture({ withSequence = true } = {}) {
  const project = createProject({ name: "Timeline", width: 100, height: 100,
    idFactory: createIdFactory("timeline") });
  project.keyArts.push(
    { id: "key_a", displayName: "A", rootNodeId: project.scene.rootId, members: [], metadata: {} },
    { id: "key_b", displayName: "B", rootNodeId: project.scene.rootId, members: [], metadata: {} },
    { id: "key_c", displayName: "C", rootNodeId: project.scene.rootId, members: [], metadata: {} },
  );
  project.semanticSlots.push({ id: "slot", displayName: "Subject", role: "subject",
    mappings: [], metadata: {} });
  project.scene.nodes.part = createSceneNode({ id: "part", displayName: "Part",
    parentId: project.scene.rootId });
  project.scene.nodes.bone = createSceneNode({ id: "bone", kind: "bone", displayName: "Arm",
    parentId: project.scene.rootId, transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }) });
  project.scene.nodes[project.scene.rootId].children.push("part", "bone");
  project.rig.bones.push(createBone({ id: "bone", parentNodeId: project.scene.rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 }, length: 10 }));
  const warp = createWarpDeformer({ id: "warp", displayName: "Warp",
    parentNodeId: project.scene.rootId, columns: 2, rows: 2,
    bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    controlPointIds: ["cp1", "cp2", "cp3", "cp4"] });
  project.rig.deformers.push(warp.deformer);
  project.rig.warpControlPoints.push(...warp.controlPoints);
  project.scene.nodes.warp = createSceneNode({ id: "warp", kind: "deformer",
    displayName: "Warp", parentId: project.scene.rootId });
  project.scene.nodes[project.scene.rootId].children.push("warp");
  project.meshes.push({ id: "mesh" });
  project.temporalPrograms.push(
    { id: "program_ab", durationTicks: 100, tracks: [], events: [], regions: [] },
    { id: "program_bc", durationTicks: 100, tracks: [], events: [], regions: [] },
  );
  project.transitions.push(
    { id: "transition_ab", displayName: "A/B", fromKeyArtId: "key_a", toKeyArtId: "key_b",
      temporalProgramId: "program_ab", partTransitions: [], diagnosticOverrides: [] },
    { id: "transition_bc", displayName: "B/C", fromKeyArtId: "key_b", toKeyArtId: "key_c",
      temporalProgramId: "program_bc", partTransitions: [], diagnosticOverrides: [] },
  );
  if (withSequence) {
    project.temporalPrograms.push(
      { id: "program_sequence", durationTicks: 300, tracks: [], events: [], regions: [] });
    project.sequences.push({
      id: "sequence", displayName: "Shot", temporalProgramId: "program_sequence",
      viewLaneItems: [{ id: "hold_a", kind: "KeyArtHold", keyArtId: "key_a",
        startTicks: 0, endTicks: 300 }],
      clipInstances: [], metadata: {},
    });
  }
  return project;
}

function controller(options = {}) {
  const session = new EditorSession(fixture(options));
  let id = 0;
  const scheduled = [];
  const timeline = new SequenceTimelineController(session, {
    idFactory: (kind) => `${kind}_${++id}`,
    scheduleFrame(callback) { scheduled.push(callback); return scheduled.length; },
    cancelFrame() {},
  });
  if (options.withSequence !== false) timeline.selectSequence("sequence");
  return { session, timeline, scheduled };
}

test("Sequence selector projection is deterministic and selection is transient", () => {
  const { session, timeline } = controller();
  const before = structuredClone(session.project);
  const history = session.history.length;
  assert.deepEqual(timeline.getState().sequences.map(({ id, selected }) => ({ id, selected })),
    [{ id: "sequence", selected: true }]);
  timeline.selectSequence(null);
  timeline.selectSequence("sequence");
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
});

test("Sequence create/remove owns its program and valid initial ViewLane atomically", () => {
  const { session, timeline } = controller({ withSequence: false });
  timeline.createSequence({ displayName: "New shot", durationTicks: 240,
    keyArtId: "key_a", sequenceId: "new_sequence", programId: "new_program",
    viewItemId: "new_hold" });
  assert.deepEqual(session.history.at(-1).commandTypes,
    ["animation.temporal.create_program", "sequence.create"]);
  assert.equal(session.project.sequences[0].viewLaneItems[0].endTicks, 240);
  assert.deepEqual(validateProject(session.project), []);
  session.undo();
  assert.deepEqual(session.project.sequences, []);
  assert.equal(session.project.temporalPrograms.some((entry) => entry.id === "new_program"), false);
  session.redo();
  timeline.projectChanged();
  timeline.selectSequence("new_sequence");
  timeline.removeSequence();
  assert.deepEqual(session.history.at(-1).commandTypes,
    ["sequence.remove", "animation.temporal.remove_program"]);
  assert.equal(session.project.temporalPrograms.some((entry) => entry.id === "new_program"), false);
});

test("ViewLane projection uses canonical placement order and stable references", () => {
  const { session, timeline } = controller();
  timeline.insertTransition({ transitionId: "transition_ab", startTicks: 100, endTicks: 200,
    itemId: "instance_ab" });
  session.project.sequences[0].viewLaneItems.reverse();
  const state = timeline.getState();
  assert.deepEqual(state.viewItems.map((entry) => entry.id), ["hold_a", "instance_ab", "view_1"]);
  assert.deepEqual(state.viewItems.map((entry) => entry.referenceId),
    ["key_a", "transition_ab", "key_b"]);
});

test("coordinated ViewLane boundary drag previews transiently and commits once", () => {
  const { session, timeline } = controller();
  timeline.insertTransition({ transitionId: "transition_ab", startTicks: 100, endTicks: 200,
    itemId: "instance_ab" });
  const history = session.history.length;
  const before = structuredClone(session.project);
  timeline.previewViewBoundary("hold_a", "instance_ab", 120);
  assert.equal(timeline.getState().viewItems[0].endTicks, 120);
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
  assert.throws(() => timeline.previewViewBoundary("hold_a", "instance_ab", 0),
    /positive neighboring durations/);
  assert.equal(timeline.commitViewBoundary(), null);
  assert.equal(session.history.length, history);
  timeline.previewViewBoundary("hold_a", "instance_ab", 120);
  timeline.commitViewBoundary();
  assert.equal(session.history.length, history + 1);
  assert.deepEqual(session.history.at(-1).commandTypes,
    ["sequence.update_view_item", "sequence.update_view_item"]);
  assert.equal(session.query("sequence.get", { sequenceId: "sequence" }).viewLaneItems[1].startTicks, 120);
});

test("invalid ViewLane gap/overlap or endpoint edit commits nothing and exposes a reason", () => {
  const { session, timeline } = controller();
  const history = session.history.length;
  assert.throws(() => timeline.commitViewItems([
    { id: "left", kind: "KeyArtHold", keyArtId: "key_a", startTicks: 0, endTicks: 100 },
    { id: "right", kind: "KeyArtHold", keyArtId: "key_a", startTicks: 101, endTicks: 300 },
  ], "Invalid gap"), /contiguous/);
  assert.equal(session.history.length, history);
  assert.match(timeline.getState().operationError.message, /contiguous/);
  timeline.insertTransition({ transitionId: "transition_ab", startTicks: 100, endTicks: 200,
    itemId: "instance_ab" });
  const afterInsert = session.history.length;
  assert.throws(() => timeline.changeViewReference("hold_a", "key_b"), TransactionError);
  assert.equal(session.history.length, afterInsert);
});

test("remove and semantic reorder gestures retain strict coverage as one unit when valid", () => {
  const { session, timeline } = controller();
  timeline.insertHold({ keyArtId: "key_a", startTicks: 100, endTicks: 200, itemId: "middle" });
  const afterInsert = session.history.length;
  timeline.moveViewItem("middle", "earlier");
  assert.equal(session.history.length, afterInsert + 1);
  assert.deepEqual(validateProject(session.project), []);
  timeline.removeViewItem("middle", { absorb: "previous" });
  assert.deepEqual(validateProject(session.project), []);
  assert.equal(session.project.sequences[0].viewLaneItems[0].startTicks, 0);
});

test("Sequence scrub delegates to sequence.evaluate without persistence and inspects boundaries", () => {
  const { session, timeline } = controller();
  timeline.insertTransition({ transitionId: "transition_ab", startTicks: 100, endTicks: 200,
    itemId: "instance_ab" });
  const originalQuery = session.query.bind(session);
  const ticks = [];
  session.query = (name, input) => {
    if (name === "sequence.evaluate") ticks.push(input.timeTicks);
    return originalQuery(name, input);
  };
  const before = structuredClone(session.project);
  const history = session.history.length;
  timeline.scrubToTick(100);
  assert.equal(timeline.getState().evaluation.activeViewLaneItem.id, "instance_ab");
  timeline.scrubToTick(200);
  assert.equal(timeline.getState().evaluation.activeViewLaneItem.keyArtId, "key_b");
  timeline.scrubToTick(300);
  assert.equal(timeline.getState().evaluation.activeViewLaneItem.id, "view_1");
  assert.deepEqual(timeline.getState().evaluation,
    originalQuery("sequence.evaluate", { sequenceId: "sequence", timeTicks: 300 }));
  assert.deepEqual(ticks, [100, 200, 300]);
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
});

test("Sequence Once and Loop playback use deterministic transient integer ticks", () => {
  const { session, timeline, scheduled } = controller();
  const before = structuredClone(session.project);
  const history = session.history.length;
  timeline.setPlaybackMode("once");
  timeline.play(0);
  scheduled.shift()(2.5);
  assert.equal(timeline.getState().currentTick, 300);
  assert.equal(timeline.getState().playing, false);
  timeline.jumpToStart();
  timeline.setPlaybackMode("loop");
  timeline.play(0);
  scheduled.shift()(2.5);
  assert.equal(timeline.getState().currentTick, 0);
  assert.equal(timeline.getState().playing, true);
  timeline.pause();
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
});

test("time display uses project rational FPS without persistent display preference", () => {
  const { session, timeline } = controller();
  session.project.renderSettings.frameRate = { numerator: 30000, denominator: 1001 };
  timeline.scrubToTick(300);
  timeline.setDisplayUnit("frames");
  const first = timeline.getState().timeDisplay;
  const second = timeline.getState().timeDisplay;
  assert.deepEqual(first, second);
  assert.equal(first.frameRate.numerator, 30000);
  assert.equal(first.label.includes("300 ticks"), true);
  assert.doesNotMatch(serializeProject(session.project), /displayUnit|currentTick/);
});

test("AnimationClip library lifecycle is atomic and Command-backed", () => {
  const { session, timeline } = controller();
  timeline.createClip({ displayName: "Blink", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  assert.deepEqual(session.history.at(-1).commandTypes,
    ["animation.temporal.create_program", "animation.clip.create"]);
  timeline.updateClip({ displayName: "Blink edited", defaultLoopMode: "loop" });
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.clip.update"]);
  session.undo();
  session.redo();
  assert.equal(session.query("animation.clip.get", { clipId: "clip" }).displayName, "Blink edited");
  timeline.removeClip();
  assert.deepEqual(session.history.at(-1).commandTypes,
    ["animation.clip.remove", "animation.temporal.remove_program"]);
});

test("ClipInstance add, drag, resize, trim, retime, loop and flags commit one unit each", () => {
  const { session, timeline } = controller();
  timeline.createClip({ displayName: "Motion", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  timeline.addClipInstance({ clipId: "clip", startTicks: 0, endTicks: 100,
    clipInstanceId: "instance" });
  assert.deepEqual(session.history.at(-1).commandTypes, ["sequence.add_clip_instance"]);
  let history = session.history.length;
  const before = structuredClone(session.project);
  timeline.previewClipInstance("instance", { startTicks: 50, endTicks: 150 });
  assert.equal(timeline.getState().clipInstances[0].startTicks, 50);
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
  assert.throws(() => timeline.previewClipInstance("instance",
    { startTicks: 250, endTicks: 350 }), /inside the Sequence/);
  assert.deepEqual(session.project, before);
  timeline.previewClipInstance("instance", { startTicks: 50, endTicks: 150 });
  timeline.commitClipInstance("instance");
  assert.equal(session.history.length, ++history);
  timeline.commitClipInstance("instance", { endTicks: 140 }, "Resize ClipInstance");
  assert.equal(session.history.length, ++history);
  timeline.commitClipInstance("instance", { sourceOffsetTicks: 1, loopMode: "loop",
    playbackRate: { numerator: 2, denominator: 4 }, weight: 0.75, layer: 3,
    enabled: false }, "Edit ClipInstance");
  assert.equal(session.history.length, ++history);
  const instance = session.query("sequence.get", { sequenceId: "sequence" }).clipInstances[0];
  assert.deepEqual(instance.playbackRate, { numerator: 1, denominator: 2 });
  assert.deepEqual({ loopMode: instance.loopMode, weight: instance.weight,
    layer: instance.layer, enabled: instance.enabled },
  { loopMode: "loop", weight: 0.75, layer: 3, enabled: false });
});

test("Once overrun and Loop offset validation surface without clamping or history", () => {
  const { session, timeline } = controller();
  timeline.createClip({ displayName: "Motion", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  const history = session.history.length;
  assert.throws(() => timeline.addClipInstance({ clipId: "clip", startTicks: 0,
    endTicks: 200, sourceOffsetTicks: 50, loopMode: "once" }), TransactionError);
  assert.equal(session.history.length, history);
  assert.ok(timeline.getState().operationError.issues.some((entry) =>
    entry.code === "ANIMATION_CLIP_ONCE_OVERRUN"));
  assert.throws(() => timeline.addClipInstance({ clipId: "clip", startTicks: 0,
    endTicks: 100, sourceOffsetTicks: 100, loopMode: "loop" }), TransactionError);
  assert.equal(session.history.length, history);
});

test("typed owner filtering and stable target pickers mirror Core contracts", () => {
  const { session, timeline } = controller();
  assert.deepEqual(timeline.allowedTrackKinds(), ["CameraTrack"]);
  assert.deepEqual(timeline.targetOptions("CameraTrack"),
    [{ label: "Main camera", target: { cameraId: "main" } }]);
  assert.throws(() => timeline.addTrack("TransformTrack",
    { nodeId: "missing", coordinateSpace: "node-local" }), /not valid/);
  timeline.addTrack("CameraTrack", { cameraId: "main" }, { trackId: "camera" });
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.add_track"]);
  timeline.removeTrack("camera");
  timeline.createClip({ displayName: "Motion", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  assert.deepEqual(timeline.allowedTrackKinds(), [
    "TransformTrack", "BoneTrack", "DeformerTrack", "MeshDeformationTrack",
    "OpacityTrack", "PresenceTrack", "DrawOrderTrack", "ClippingTrack",
  ]);
  const root = timeline.targetOptions("TransformTrack")
    .find((entry) => entry.target.nodeId)?.target;
  assert.equal(root.coordinateSpace, "node-local");
  assert.equal(Object.hasOwn(root, "displayName"), false);
  assert.deepEqual(timeline.targetOptions("BoneTrack").map((entry) => entry.target),
    [{ boneId: "bone" }]);
  assert.ok(timeline.targetOptions("DeformerTrack").some((entry) =>
    entry.target.deformerId === "warp" && entry.target.controlPointId === "cp1"));
  assert.deepEqual(timeline.targetOptions("MeshDeformationTrack").map((entry) => entry.target),
    [{ meshId: "mesh" }]);
  assert.ok(timeline.targetOptions("OpacityTrack").some((entry) =>
    entry.target.semanticSlotId === "slot"));
});

test("typed track and keyframe editing uses animation.temporal only with transient drag", () => {
  const { session, timeline } = controller();
  timeline.createClip({ displayName: "Motion", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  const target = timeline.targetOptions("TransformTrack").find((entry) => entry.target.nodeId).target;
  timeline.addTrack("TransformTrack", target, { trackId: "track" });
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.add_track"]);
  timeline.addKeyframe("track", "positionX", { keyframeId: "key", value: 4 });
  assert.equal(timeline.getState().selectedKeyframeValue.timeTicks, 0);
  const history = session.history.length;
  const before = structuredClone(session.project);
  timeline.previewKeyframeTime("track", "positionX", "key", 75);
  assert.equal(timeline.getState().selectedKeyframeValue.timeTicks, 75);
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
  timeline.commitKeyframePreview();
  assert.equal(session.history.length, history + 1);
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.update_keyframe"]);
  timeline.setKeyframeInterpolation("track", "positionX", "key", "step");
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    { kind: "step" });
  timeline.setKeyframeInterpolation("track", "positionX", "key", "linear");
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    { kind: "linear" });
  timeline.setKeyframeInterpolation("track", "positionX", "key", "bezier",
    { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 });
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    { kind: "bezier", x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 });
  timeline.removeKeyframe("track", "positionX", "key");
  session.undo();
  timeline.projectChanged();
  assert.equal(timeline.activeProgram().tracks[0].channels.positionX.keyframes[0].id, "key");
  session.redo();
  timeline.projectChanged();
  assert.deepEqual(timeline.activeProgram().tracks[0].channels.positionX.keyframes, []);
});

test("selection identities survive refresh and clear safely after persistent removal", () => {
  const { session, timeline } = controller();
  timeline.createClip({ displayName: "Motion", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  const target = timeline.targetOptions("OpacityTrack").find((entry) => entry.target.nodeId).target;
  timeline.addTrack("OpacityTrack", target, { trackId: "track" });
  timeline.addKeyframe("track", "opacity", { keyframeId: "key", value: 1 });
  timeline.projectChanged();
  assert.deepEqual(timeline.getState().selectedKeyframe,
    { trackId: "track", channel: "opacity", keyframeId: "key" });
  timeline.removeKeyframe("track", "opacity", "key");
  timeline.projectChanged();
  assert.equal(timeline.getState().selectedKeyframe, null);
  assert.doesNotMatch(serializeProject(session.project),
    /selectedTrack|selectedKeyframe|selectedSequence|playbackMode|displayUnit/);
});

test("Save/Open preserves only identical persistent timeline state", () => {
  const { session, timeline } = controller();
  timeline.createClip({ displayName: "Motion", durationTicks: 100,
    clipId: "clip", programId: "program_clip" });
  timeline.addClipInstance({ clipId: "clip", startTicks: 10, endTicks: 110,
    clipInstanceId: "instance" });
  timeline.scrubToTick(80);
  timeline.setDisplayUnit("seconds");
  const reopened = deserializeProject(serializeProject(session.project));
  assert.deepEqual(reopened.sequences, session.project.sequences);
  assert.deepEqual(reopened.animation, session.project.animation);
  assert.deepEqual(new Map(reopened.temporalPrograms.map((entry) => [entry.id, entry])),
    new Map(session.project.temporalPrograms.map((entry) => [entry.id, entry])));
});
