import assert from "node:assert/strict";
import test from "node:test";

import { projectClipInstanceTick, rawClipLocalTick } from "../src/core/clip-time.js";
import { createAnimationClip } from "../src/model/animation-clip.js";
import { createIdFactory, createProject } from "../src/model/project.js";
import { VIEW_LANE_ITEM_KINDS } from "../src/model/sequence.js";
import { validateProject } from "../src/model/validation.js";

function temporalProgram(id, durationTicks) {
  return { id, durationTicks, tracks: [], events: [], regions: [] };
}

function clipInstance(overrides = {}) {
  return {
    id: "instance_idle",
    clipId: "clip_idle",
    startTicks: 0,
    endTicks: 10,
    sourceOffsetTicks: 0,
    playbackRate: { numerator: 1, denominator: 1 },
    loopMode: "once",
    weight: 1,
    layer: 0,
    enabled: true,
    ...overrides,
  };
}

function projectWithInstance(instance = clipInstance(), clipDurationTicks = 20,
  sequenceDurationTicks = 10) {
  const project = createProject({ name: "Clip Instance", width: 64, height: 64,
    idFactory: createIdFactory("clip_instance") });
  project.keyArts.push({ id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
    members: [], metadata: {} });
  project.temporalPrograms.push(
    temporalProgram("program_clip", clipDurationTicks),
    temporalProgram("program_sequence", sequenceDurationTicks),
  );
  project.animation.clips.push(createAnimationClip({ id: "clip_idle", displayName: "Idle",
    temporalProgramId: "program_clip" }));
  project.sequences.push({
    id: "sequence_shot",
    displayName: "Shot",
    temporalProgramId: "program_sequence",
    viewLaneItems: [{ id: "hold_a", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
      keyArtId: "keyart_a", startTicks: 0, endTicks: sequenceDurationTicks }],
    clipInstances: [instance],
    metadata: {},
  });
  return project;
}

test("ClipInstance exact projection uses BigInt before rational rounding", () => {
  const instance = clipInstance({
    startTicks: 0,
    endTicks: 4_000_000_001,
    playbackRate: { numerator: 4_000_000_000, denominator: 4_000_000_000 },
  });
  assert.equal(
    rawClipLocalTick(instance, 4_000_000_000),
    4_000_000_000,
  );
});

test("Once allows the inclusive source endpoint only when it is the last active sample", () => {
  const valid = projectWithInstance(clipInstance({ endTicks: 1, sourceOffsetTicks: 20 }), 20, 1);
  assert.deepEqual(validateProject(valid), []);
  assert.deepEqual(projectClipInstanceTick(valid.sequences[0].clipInstances[0], 0, 20), {
    active: true,
    clipInstanceId: "instance_idle",
    clipId: "clip_idle",
    loopMode: "once",
    rawLocalTick: 20,
    localTick: 20,
  });

  const overrun = projectWithInstance(clipInstance({ endTicks: 2, sourceOffsetTicks: 20 }), 20, 2);
  assert.ok(validateProject(overrun).some((issue) => issue.code === "ANIMATION_CLIP_ONCE_OVERRUN"));
  assert.throws(() => projectClipInstanceTick(overrun.sequences[0].clipInstances[0], 1, 20),
    /exceeds the AnimationClip duration/);
});

test("Loop phase is half-open and exact duration multiples resolve to zero", () => {
  const instance = clipInstance({ endTicks: 21, loopMode: "loop" });
  assert.equal(projectClipInstanceTick(instance, 20, 20).rawLocalTick, 20);
  assert.equal(projectClipInstanceTick(instance, 20, 20).localTick, 0);
  assert.notEqual(projectClipInstanceTick(instance, 19, 20).localTick, 20);

  const invalid = projectWithInstance(clipInstance({ loopMode: "loop", sourceOffsetTicks: 20 }), 20);
  assert.ok(validateProject(invalid).some((issue) => issue.code === "ANIMATION_CLIP_LOOP_OFFSET_INVALID"));
});

test("Clip placement is half-open even at terminal Sequence inspection", () => {
  const instance = clipInstance({ startTicks: 5, endTicks: 10 });
  assert.equal(projectClipInstanceTick(instance, 9, 20).active, true);
  assert.deepEqual(projectClipInstanceTick(instance, 10, 20), {
    active: false,
    clipInstanceId: "instance_idle",
    clipId: "clip_idle",
    loopMode: "once",
  });
});

test("disabled ClipInstances are inactive without changing their persisted placement", () => {
  const instance = clipInstance({ enabled: false });
  assert.equal(projectClipInstanceTick(instance, 0, 20).active, false);
  assert.equal(instance.startTicks, 0);
  assert.equal(instance.endTicks, 10);
});

test("ClipInstance validation rejects references, placement, rate, weight, and layer deterministically", () => {
  const project = projectWithInstance(clipInstance({
    clipId: "missing_clip",
    startTicks: 10,
    endTicks: 10,
    playbackRate: { numerator: 2, denominator: 4 },
    sourceOffsetTicks: -1,
    weight: 2,
    layer: 0.5,
    enabled: "yes",
  }));
  const codes = validateProject(project).map((issue) => issue.code);
  assert.ok(codes.includes("ANIMATION_CLIP_REFERENCE_INVALID"));
  assert.ok(codes.includes("ANIMATION_CLIP_INSTANCE_PLACEMENT_INVALID"));
  assert.ok(codes.includes("ANIMATION_CLIP_SOURCE_OFFSET_INVALID"));
  assert.ok(codes.includes("ANIMATION_CLIP_PLAYBACK_RATE_NONCANONICAL"));
  assert.ok(codes.includes("ANIMATION_CLIP_WEIGHT_INVALID"));
  assert.ok(codes.includes("ANIMATION_CLIP_LAYER_INVALID"));
  assert.ok(codes.includes("ANIMATION_CLIP_INSTANCE_INVALID"));
});

test("ClipInstance canonical validation is independent of array insertion order", () => {
  const first = clipInstance({ id: "instance_b", startTicks: 5, endTicks: 10,
    sourceOffsetTicks: 30 });
  const second = clipInstance({ id: "instance_a", clipId: "missing_clip",
    startTicks: 0, endTicks: 5 });
  const left = projectWithInstance(first);
  left.sequences[0].clipInstances.push(second);
  const right = structuredClone(left);
  right.sequences[0].clipInstances.reverse();
  const signature = (project) => validateProject(project)
    .filter((issue) => issue.code.startsWith("ANIMATION_CLIP"))
    .map(({ code, path, entityId, details }) => ({ code, path, entityId, details }));
  assert.deepEqual(signature(left), signature(right));
});

test("local-time overflow is rejected explicitly", () => {
  const project = projectWithInstance(clipInstance({
    endTicks: Number.MAX_SAFE_INTEGER,
    playbackRate: { numerator: Number.MAX_SAFE_INTEGER, denominator: 1 },
    loopMode: "loop",
  }), 20, Number.MAX_SAFE_INTEGER);
  assert.ok(validateProject(project).some((issue) =>
    issue.code === "ANIMATION_CLIP_LOCAL_TIME_OVERFLOW"));
  assert.throws(() => rawClipLocalTick(project.sequences[0].clipInstances[0],
    Number.MAX_SAFE_INTEGER - 1), /safe integer range/);
});
