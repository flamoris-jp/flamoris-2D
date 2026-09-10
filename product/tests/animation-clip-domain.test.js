import assert from "node:assert/strict";
import test from "node:test";

import { createAnimationClip } from "../src/model/animation-clip.js";
import { createIdFactory, createProject, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { temporalProgramOwners } from "../src/model/temporal-program-ownership.js";
import { migrateProjectSchema } from "../src/io/project-json.js";

function projectFixture() {
  return createProject({ name: "Clip Domain", width: 64, height: 64,
    idFactory: createIdFactory("clip_domain") });
}

function program(id, durationTicks = 100) {
  return { id, durationTicks, tracks: [], events: [], regions: [] };
}

test("AnimationClip preserves stable identity and derives duration from its owned program", () => {
  const project = projectFixture();
  const clip = createAnimationClip({
    id: "clip_idle",
    displayName: "Idle",
    temporalProgramId: "program_idle",
    defaultLoopMode: "loop",
  });
  project.temporalPrograms.push(program("program_idle"));
  project.animation.clips.push(clip);

  assert.equal(clip.id, "clip_idle");
  assert.equal(Object.hasOwn(clip, "durationTicks"), false);
  assert.deepEqual(clip.metadata, {});
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(
    temporalProgramOwners(project).get("program_idle").map(({ kind, id }) => [kind, id]),
    [["AnimationClip", "clip_idle"]],
  );
});

test("TemporalProgram ownership conflicts span Transition, Sequence, and AnimationClip", () => {
  const project = projectFixture();
  project.temporalPrograms.push(program("program_shared"));
  project.animation.clips.push(createAnimationClip({ id: "clip_a", displayName: "A",
    temporalProgramId: "program_shared" }));
  project.transitions.push({ id: "transition_a", displayName: "Transition",
    fromKeyArtId: "missing_a", toKeyArtId: "missing_b", temporalProgramId: "program_shared",
    partTransitions: [], diagnosticOverrides: [], metadata: {} });
  project.sequences.push({ id: "sequence_a", displayName: "Sequence",
    temporalProgramId: "program_shared", viewLaneItems: [], clipInstances: [], metadata: {} });

  const conflicts = validateProject(project)
    .filter((issue) => issue.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT");
  assert.deepEqual(conflicts.map((issue) => issue.entityId), [
    "clip_a", "sequence_a", "transition_a",
  ]);
});

test("TemporalProgram ownership rejects every Clip cross-owner pairing", () => {
  const ownerCases = [
    ["Transition", (project) => project.transitions.push({
      id: "transition_a", displayName: "Transition", fromKeyArtId: "missing_a",
      toKeyArtId: "missing_b", temporalProgramId: "program_shared", partTransitions: [],
      diagnosticOverrides: [], metadata: {},
    })],
    ["Sequence", (project) => project.sequences.push({
      id: "sequence_a", displayName: "Sequence", temporalProgramId: "program_shared",
      viewLaneItems: [], clipInstances: [], metadata: {},
    })],
    ["AnimationClip", (project) => project.animation.clips.push(createAnimationClip({
      id: "clip_b", displayName: "B", temporalProgramId: "program_shared",
    }))],
  ];
  for (const [kind, addOwner] of ownerCases) {
    const project = projectFixture();
    project.temporalPrograms.push(program("program_shared"));
    project.animation.clips.push(createAnimationClip({ id: "clip_a", displayName: "A",
      temporalProgramId: "program_shared" }));
    addOwner(project);
    const owners = temporalProgramOwners(project).get("program_shared");
    assert.equal(owners.length, 2, kind);
    assert.equal(validateProject(project).filter((issue) =>
      issue.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT").length, 2, kind);
  }
});

test("schema 13 migration starts typed clip state empty without promoting placeholders", () => {
  const legacy = projectFixture();
  legacy.schemaVersion = 13;
  legacy.animation.clips = [{ id: "legacy_clip", arbitrary: true }];
  legacy.animation.deformationSamples = [{ id: "legacy_sample" }];
  legacy.sequences = [{ id: "legacy_sequence", clipInstances: [{ id: "legacy_instance" }] }];
  legacy.temporalPrograms.push(program("unowned_program"));

  const migrated = migrateProjectSchema(legacy);
  assert.equal(PROJECT_SCHEMA_VERSION, 14);
  assert.equal(migrated.schemaVersion, 14);
  assert.deepEqual(migrated.animation, { clips: [], deformationSamples: [] });
  assert.deepEqual(migrated.sequences[0].clipInstances, []);
  assert.equal(migrated.temporalPrograms[0].id, "unowned_program");
});

test("schema 13 migration discards a non-array Sequence placeholder", () => {
  const legacy = projectFixture();
  legacy.schemaVersion = 13;
  legacy.sequences = { unsupported: true };
  assert.deepEqual(migrateProjectSchema(legacy).sequences, []);
});

test("AnimationClip rejects unknown fields and missing owned programs", () => {
  const project = projectFixture();
  project.animation.clips.push({
    ...createAnimationClip({ id: "clip_bad", displayName: "Bad",
      temporalProgramId: "missing_program" }),
    durationTicks: 20,
  });
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.code === "ANIMATION_CLIP_INVALID"));
  assert.ok(issues.some((issue) => issue.code === "ANIMATION_CLIP_PROGRAM_REFERENCE_INVALID"));
});

function scalarTrack(trackId, values) {
  return {
    trackId,
    version: 1,
    kind: "OpacityTrack",
    target: { nodeId: "node_clip_domain_0002" },
    channels: { opacity: { keyframes: values.map((value, index) => ({
      id: trackId + "_key_" + index,
      timeTicks: index * 100,
      value,
      interpolationToNext: { kind: "linear" },
    })) } },
  };
}

test("loop endpoint mismatch is a warning and uses the documented numeric tolerance", () => {
  const project = projectFixture();
  const clip = createAnimationClip({ id: "clip_loop", displayName: "Loop",
    temporalProgramId: "program_loop", defaultLoopMode: "loop" });
  project.animation.clips.push(clip);
  project.temporalPrograms.push({ ...program("program_loop"),
    tracks: [scalarTrack("track_opacity", [0.5, 0.75])],
    events: [{ id: "event_terminal", type: "marker", timeTicks: 100,
      participants: [], payload: {} }],
  });
  const issues = validateProject(project);
  const mismatch = issues.find((issue) => issue.code === "ANIMATION_LOOP_ENDPOINT_MISMATCH");
  assert.equal(mismatch.severity, "warning");
  assert.equal(mismatch.details.tolerance, 1e-9);
  assert.equal(issues.some((issue) => issue.severity === "error"), false);

  project.temporalPrograms[0].tracks = [scalarTrack("track_opacity", [0.5, 0.5000000005])];
  assert.equal(validateProject(project).some((issue) =>
    issue.code === "ANIMATION_LOOP_ENDPOINT_MISMATCH"), false);
});

test("AnimationClip ownership preserves existing owner-aware target validation", () => {
  const project = projectFixture();
  project.animation.clips.push(createAnimationClip({ id: "clip_camera", displayName: "Camera",
    temporalProgramId: "program_camera" }));
  project.temporalPrograms.push({ ...program("program_camera"), tracks: [{
    trackId: "track_camera", version: 1, kind: "CameraTrack", target: { cameraId: "main" },
    channels: { positionX: { keyframes: [] } },
  }] });
  assert.ok(validateProject(project).some((issue) =>
    issue.code === "ANIMATION_TRACK_OWNER_INVALID" && issue.entityId === "track_camera"));
});

test("AnimationClip ownership cannot smuggle Transition-only track families", () => {
  const project = projectFixture();
  project.semanticSlots.push({ id: "slot_face", displayName: "Face", mappings: [], metadata: {} });
  project.animation.clips.push(createAnimationClip({ id: "clip_transition_track",
    displayName: "Invalid", temporalProgramId: "program_transition_track" }));
  project.temporalPrograms.push({ ...program("program_transition_track"), tracks: [{
    trackId: "track_geometry", version: 1, kind: "GeometryBlendTrack",
    target: { semanticSlotId: "slot_face" },
    channels: { geometryWeight: { keyframes: [] } },
  }] });
  assert.ok(validateProject(project).some((issue) =>
    issue.code === "ANIMATION_TRACK_OWNER_INVALID" && issue.entityId === "track_geometry"));
});
