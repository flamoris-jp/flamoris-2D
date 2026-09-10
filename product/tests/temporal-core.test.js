import test from "node:test";
import assert from "node:assert/strict";
import { createIdFactory, createProject, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { EditorSession, TransactionError } from "../src/commands/editor.js";
import {
  TIMEBASE_TICKS_PER_SECOND,
  frameToTicks,
  normalizeFrameRate,
  sampleKeyframes,
  secondsToTicks,
  ticksToFrame,
  ticksToSeconds,
} from "../src/core/temporal.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { validateProject } from "../src/model/validation.js";

const step = { kind: "step" };
const linear = { kind: "linear" };
const ease = { kind: "bezier", x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };

function fixture() {
  const project = createProject({
    name: "Temporal",
    width: 1920,
    height: 1080,
    idFactory: createIdFactory("temporal"),
  });
  project.semanticSlots.push({ id: "semantic.eye.left" });
  return project;
}

function opacityTrack(keyframes = []) {
  return {
    trackId: "track_opacity",
    version: 1,
    kind: "OpacityTrack",
    target: { semanticSlotId: "semantic.eye.left" },
    channels: { opacity: { keyframes } },
  };
}

function keyframe(id, timeTicks, value, interpolationToNext = linear) {
  return { id, timeTicks, value, interpolationToNext };
}

test("120000 tick timebase converts common rational frame rates exactly", () => {
  assert.equal(TIMEBASE_TICKS_PER_SECOND, 120000);
  const cases = [
    [{ numerator: 24, denominator: 1 }, 5000],
    [{ numerator: 25, denominator: 1 }, 4800],
    [{ numerator: 30, denominator: 1 }, 4000],
    [{ numerator: 60, denominator: 1 }, 2000],
    [{ numerator: 24000, denominator: 1001 }, 5005],
    [{ numerator: 30000, denominator: 1001 }, 4004],
    [{ numerator: 60000, denominator: 1001 }, 2002],
  ];
  for (const [rate, expected] of cases) {
    assert.deepEqual(frameToTicks(1, rate), { ticks: expected, exact: true });
    assert.deepEqual(ticksToFrame(expected * 17, rate), { frameIndex: 17, exact: true });
  }
  assert.deepEqual(normalizeFrameRate({ numerator: 60000, denominator: 2002 }), {
    numerator: 30000,
    denominator: 1001,
  });
  assert.deepEqual(frameToTicks(1, { numerator: 7, denominator: 1 }), {
    ticks: 17143,
    exact: false,
  });
  assert.equal(secondsToTicks(1.5), 180000);
  assert.equal(ticksToSeconds(180000), 1.5);
});

test("step, linear, and bezier sampling preserve exact endpoints", () => {
  const endpoints = (interpolation) => [
    keyframe("key_a", 0, 0, interpolation),
    keyframe("key_b", 120000, 1, step),
  ];
  for (const interpolation of [step, linear, ease]) {
    assert.equal(sampleKeyframes(endpoints(interpolation), 0), 0);
    assert.equal(sampleKeyframes(endpoints(interpolation), 120000), 1);
  }
  assert.equal(sampleKeyframes(endpoints(step), 60000), 0);
  assert.equal(sampleKeyframes(endpoints(linear), 60000), 0.5);
  const curved = sampleKeyframes(endpoints(ease), 60000);
  assert.ok(curved > 0.5 && curved < 1);
  assert.deepEqual(sampleKeyframes([
    keyframe("sample_a", 0, { deformationSampleId: "sample", weight: 0 }, linear),
    keyframe("sample_b", 100, { deformationSampleId: "sample", weight: 1 }, step),
  ], 50), { deformationSampleId: "sample", weight: 0.5 });
});

test("temporal commands create, edit, remove, undo, and redo exact state", () => {
  const session = new EditorSession(fixture());
  session.execute({
    type: "animation.temporal.create_program",
    payload: { programId: "program_turn", durationTicks: 120000 },
  });
  session.execute({
    type: "animation.temporal.add_track",
    payload: { programId: "program_turn", track: opacityTrack() },
  });
  session.execute({
    type: "animation.temporal.add_keyframe",
    payload: {
      programId: "program_turn",
      trackId: "track_opacity",
      channel: "opacity",
      keyframe: keyframe("key_opacity", 0, 0),
    },
  });
  session.execute({
    type: "animation.temporal.update_keyframe",
    payload: {
      programId: "program_turn",
      trackId: "track_opacity",
      channel: "opacity",
      keyframeId: "key_opacity",
      keyframe: keyframe("key_opacity", 60000, 0.5),
    },
  });
  session.execute({
    type: "animation.temporal.remove_keyframe",
    payload: {
      programId: "program_turn",
      trackId: "track_opacity",
      channel: "opacity",
      keyframeId: "key_opacity",
    },
  });
  assert.equal(session.query("animation.list_tracks", { programId: "program_turn" })[0]
    .channels.opacity.keyframes.length, 0);
  session.undo();
  assert.equal(session.query("animation.sample_program", {
    programId: "program_turn",
    timeTicks: 60000,
  }).tracks[0].values.opacity, 0.5);
  session.undo();
  assert.equal(session.query("animation.get_program", { programId: "program_turn" })
    .tracks[0].channels.opacity.keyframes[0].timeTicks, 0);
  session.redo();
  assert.equal(session.query("animation.get_program", { programId: "program_turn" })
    .tracks[0].channels.opacity.keyframes[0].timeTicks, 60000);
});

test("invalid temporal transactions roll back without touching Project state", () => {
  const project = fixture();
  const session = new EditorSession(project);
  assert.throws(() => session.executeTransaction([
    {
      type: "animation.temporal.create_program",
      payload: { programId: "program_invalid", durationTicks: 100 },
    },
    {
      type: "animation.temporal.add_track",
      payload: { programId: "program_invalid", track: opacityTrack() },
    },
    {
      type: "animation.temporal.add_keyframe",
      payload: {
        programId: "program_invalid",
        trackId: "track_opacity",
        channel: "opacity",
        keyframe: keyframe("key_outside", 101, 0.5),
      },
    },
  ]), (error) => error instanceof TransactionError &&
    error.issues.some((entry) => entry.code === "ANIMATION_KEY_OUTSIDE_PROGRAM"));
  assert.deepEqual(session.project, project);
  assert.equal(session.history.length, 0);

  assert.throws(() => session.executeTransaction([
    {
      type: "animation.temporal.create_program",
      payload: { programId: "program_curve", durationTicks: 100 },
    },
    {
      type: "animation.temporal.add_track",
      payload: {
        programId: "program_curve",
        track: opacityTrack([keyframe("bad_curve", 0, 0.5, {
          kind: "bezier", x1: -1, y1: 0, x2: 1, y2: 1,
        })]),
      },
    },
  ]), (error) => error instanceof TransactionError &&
    error.issues.some((entry) => entry.code === "ANIMATION_INVALID_CURVE"));
  assert.deepEqual(session.project, project);
});

test("typed tracks reject unknown kinds, duplicate times, and non-step discrete keys", () => {
  const project = fixture();
  project.temporalPrograms.push({
    id: "program_validation",
    durationTicks: 100,
    events: [],
    regions: [],
    tracks: [{
      ...opacityTrack([
        keyframe("key_1", 0, 0),
        keyframe("key_2", 0, 1),
      ]),
      kind: "ArbitraryPropertyPathTrack",
    }],
  });
  assert.throws(() => new EditorSession(project), (error) =>
    error instanceof TransactionError &&
    error.issues.some((entry) => entry.code === "ANIMATION_UNKNOWN_TRACK_KIND"));

  project.temporalPrograms[0].tracks = [opacityTrack([
    keyframe("key_duplicate_a", 0, 0),
    keyframe("key_duplicate_b", 0, 1),
  ])];
  assert.throws(() => new EditorSession(project), (error) =>
    error instanceof TransactionError &&
    error.issues.some((entry) => entry.code === "ANIMATION_DUPLICATE_KEY_TIME"));

  project.temporalPrograms[0].tracks = [{
    trackId: "track_presence",
    version: 1,
    kind: "PresenceTrack",
    target: { semanticSlotId: "semantic.eye.left" },
    channels: {
      presence: { keyframes: [keyframe("key_presence", 0, "present", linear)] },
    },
  }];
  assert.throws(() => new EditorSession(project), (error) =>
    error instanceof TransactionError &&
    error.issues.some((entry) => entry.code === "ANIMATION_INVALID_CURVE"));
});

test("Phase 2A typed track families validate without arbitrary property paths", () => {
  const project = fixture();
  project.meshes.push({ id: "mesh_face" });
  project.meshTopologies.push({ id: "topology_face", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  project.animation.deformationSamples.push({ id: "sample_face", meshId: "mesh_face",
    topologyId: "topology_face", offsets: [] });
  const scalar = (trackId, kind, target, channel, value) => ({
    trackId,
    version: 1,
    kind,
    target,
    channels: { [channel]: { keyframes: [keyframe("key_" + trackId, 0, value, step)] } },
  });
  project.temporalPrograms.push({
    id: "program_families",
    durationTicks: 100,
    events: [],
    regions: [],
    tracks: [
      scalar("geometry", "GeometryBlendTrack", { semanticSlotId: "semantic.eye.left" }, "geometryWeight", 0.5),
      scalar("appearance", "AppearanceTrack", { semanticSlotId: "semantic.eye.left" }, "appearance", { art_a: 0.25, art_b: 0.75 }),
      scalar("opacity", "OpacityTrack", { semanticSlotId: "semantic.eye.left" }, "opacity", 1),
      scalar("presence", "PresenceTrack", { semanticSlotId: "semantic.eye.left" }, "presence", "present"),
      scalar("draw", "DrawOrderTrack", { nodeId: project.scene.rootId }, "drawOrder", 3),
      scalar("clip", "ClippingTrack", { nodeId: project.scene.rootId }, "clipping", { sourceNodeId: null }),
      scalar("transform", "TransformTrack", {
        nodeId: project.scene.rootId,
        coordinateSpace: "node-local",
      }, "positionX", 12),
      scalar("mesh", "MeshDeformationTrack", { meshId: "mesh_face" }, "deformation", {
        deformationSampleId: "sample_face",
        weight: 0.5,
      }),
    ],
  });
  project.keyArts.push({ id: "keyart_camera", displayName: "Camera Base",
    rootNodeId: project.scene.rootId, members: [], metadata: {} });
  project.temporalPrograms.push({
    id: "program_camera",
    durationTicks: 100,
    events: [],
    regions: [],
    tracks: [scalar("camera", "CameraTrack", { cameraId: "main" }, "scale", 1)],
  });
  project.sequences.push({ id: "sequence_camera", displayName: "Camera Shot",
    temporalProgramId: "program_camera", viewLaneItems: [{ id: "hold_camera",
      kind: "KeyArtHold", keyArtId: "keyart_camera", startTicks: 0, endTicks: 100 }],
    clipInstances: [], metadata: {} });
  assert.deepEqual(validateProject(project), []);
});

test("DrawOrder conflicts fail atomically within the Phase 2A program scope", () => {
  const project = fixture();
  project.semanticSlots.push({ id: "semantic.hair.front" });
  const session = new EditorSession(project);
  const drawTrack = (trackId, semanticSlotId, drawOrder) => ({
    trackId,
    version: 1,
    kind: "DrawOrderTrack",
    target: { semanticSlotId },
    channels: {
      drawOrder: {
        keyframes: [keyframe("key_" + trackId, 0, drawOrder, step)],
      },
    },
  });

  assert.throws(() => session.executeTransaction([
    {
      type: "animation.temporal.create_program",
      payload: { programId: "program_draw_order", durationTicks: 100 },
    },
    {
      type: "animation.temporal.add_track",
      payload: {
        programId: "program_draw_order",
        track: drawTrack("track_eye_order", "semantic.eye.left", 4),
      },
    },
    {
      type: "animation.temporal.add_track",
      payload: {
        programId: "program_draw_order",
        track: drawTrack("track_hair_order", "semantic.hair.front", 4),
      },
    },
  ]), (error) => error instanceof TransactionError &&
    error.issues.some((entry) =>
      entry.code === "ANIMATION_TRACK_CONFLICT" &&
      entry.details?.scope === "temporal-program" &&
      entry.details?.timeTicks === 0 &&
      entry.details?.drawOrder === 4 &&
      entry.details?.trackIds.join(",") ===
        "track_eye_order,track_hair_order"));
  assert.deepEqual(session.project, project);
  assert.equal(session.history.length, 0);
});

test("events and regions persist as semantic metadata without changing sampled tracks", () => {
  const session = new EditorSession(fixture());
  session.executeTransaction([
    {
      type: "animation.temporal.create_program",
      payload: { programId: "program_event", durationTicks: 120000 },
    },
    {
      type: "animation.temporal.add_event",
      payload: {
        programId: "program_event",
        event: {
          id: "event_contact",
          timeTicks: 60000,
          type: "contact",
          participants: ["semantic.eye.left"],
          payload: {},
        },
      },
    },
    {
      type: "animation.temporal.add_region",
      payload: {
        programId: "program_event",
        region: {
          id: "region_action",
          startTicks: 30000,
          endTicks: 90000,
          type: "action",
          metadata: { note: "contact pass" },
        },
      },
    },
  ]);
  const sample = session.query("animation.sample_program", {
    programId: "program_event",
    timeTicks: 60000,
  });
  assert.deepEqual(sample.tracks, []);
  assert.equal(sample.events[0].id, "event_contact");
  assert.equal(sample.regions[0].id, "region_action");
});

test("temporal serialization is deterministic and round-trips stable IDs", () => {
  const first = fixture();
  first.temporalPrograms.push({
    id: "program_b",
    durationTicks: 120000,
    tracks: [opacityTrack([
      keyframe("key_b", 120000, 1, step),
      keyframe("key_a", 0, 0, linear),
    ])],
    events: [],
    regions: [],
  });
  first.temporalPrograms.push({
    id: "program_a",
    durationTicks: 1,
    tracks: [],
    events: [],
    regions: [],
  });
  const second = structuredClone(first);
  second.temporalPrograms.reverse();
  second.temporalPrograms.find((entry) => entry.id === "program_b")
    .tracks[0].channels.opacity.keyframes.reverse();
  const metadata = { now: () => new Date("2026-09-02T00:00:00.000Z") };
  const serialized = serializeProject(first, 0, metadata);
  assert.equal(serialized, serializeProject(second, 0, metadata));
  const reloaded = deserializeProject(serialized);
  assert.equal(reloaded.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(reloaded.temporalPrograms[0].id, "program_a");
  assert.equal(reloaded.temporalPrograms[1].tracks[0].channels.opacity.keyframes[0].id, "key_a");
});

test("Phase 1 schema migrates to an empty Temporal Core", () => {
  const phase1 = fixture();
  phase1.schemaVersion = 1;
  delete phase1.timebaseTicksPerSecond;
  delete phase1.temporalPrograms;
  phase1.renderSettings = {
    fps: 23.976,
    duration: 2.5,
    alpha: false,
  };
  const migrated = deserializeProject(JSON.stringify(phase1));
  assert.equal(migrated.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(migrated.timebaseTicksPerSecond, TIMEBASE_TICKS_PER_SECOND);
  assert.deepEqual(migrated.renderSettings.frameRate, {
    numerator: 24000,
    denominator: 1001,
  });
  assert.equal(Object.hasOwn(migrated.renderSettings, "durationTicks"), false);
  assert.equal(migrated.renderSettings.alpha, false);
  assert.deepEqual(migrated.temporalPrograms, []);
});

test("headless MCP-ready adapter inspects and samples the same TemporalProgram", () => {
  const project = fixture();
  project.temporalPrograms.push({
    id: "program_headless",
    durationTicks: 100,
    tracks: [opacityTrack([
      keyframe("key_start", 0, 0, linear),
      keyframe("key_end", 100, 1, step),
    ])],
    events: [],
    regions: [],
  });
  const adapter = new HeadlessProductAdapter(new EditorSession(project));
  assert.ok(adapter.capabilities().queries["animation.sample_program"]);
  assert.ok(adapter.capabilities().commands["animation.temporal.add_keyframe"]);
  assert.equal(adapter.query("animation.sample_program", {
    programId: "program_headless",
    timeTicks: 50,
  }).tracks[0].values.opacity, 0.5);
});
