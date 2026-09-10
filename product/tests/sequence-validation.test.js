import assert from "node:assert/strict";
import test from "node:test";

import { migrateProjectSchema } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { VIEW_LANE_ITEM_KINDS } from "../src/model/sequence.js";
import { validateProject } from "../src/model/validation.js";

function member(nodeId, appearanceId) {
  return { nodeId, appearanceId, opacity: 1, presence: "present", drawOrder: 0,
    clipping: { sourceNodeId: null } };
}

function fixture() {
  const project = createProject({ name: "Sequence", width: 100, height: 100,
    idFactory: createIdFactory("sequence") });
  for (const [id, name] of [["node_a", "A"], ["node_b", "B"]]) {
    project.scene.nodes[id] = createSceneNode({ id, displayName: name,
      parentId: project.scene.rootId, bounds: { left: 0, top: 0, right: 10, bottom: 10 } });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
      members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId,
      members: [member("node_b", "appearance_b")], metadata: {} },
  );
  project.semanticSlots.push({ id: "slot_subject", displayName: "Subject", role: "subject",
    mappings: [{ keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" }], metadata: {} });
  project.temporalPrograms.push(
    { id: "program_transition", durationTicks: 100, tracks: [], events: [], regions: [] },
    { id: "program_sequence", durationTicks: 300, tracks: [], events: [], regions: [] },
  );
  project.transitions.push({ id: "transition_ab", displayName: "A to B",
    fromKeyArtId: "keyart_a", toKeyArtId: "keyart_b", temporalProgramId: "program_transition",
    partTransitions: [{ id: "part_ab", semanticSlotId: "slot_subject", mode: "replace",
      topologyId: null, fromKeyformId: null, toKeyformId: null,
      configuration: { compositeGroupId: "group_subject" } }], diagnosticOverrides: [] });
  project.sequences.push({ id: "sequence_shot", displayName: "Shot",
    temporalProgramId: "program_sequence", viewLaneItems: [
      { id: "hold_b", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
        keyArtId: "keyart_b", startTicks: 200, endTicks: 300 },
      { id: "transition_instance", kind: VIEW_LANE_ITEM_KINDS.TRANSITION_INSTANCE,
        transitionId: "transition_ab", startTicks: 100, endTicks: 200 },
      { id: "hold_a", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
        keyArtId: "keyart_a", startTicks: 0, endTicks: 100 },
    ], clipInstances: [], metadata: {} });
  return project;
}

function scalarTrack(trackId, kind, target, channel, value = 1) {
  return {
    trackId,
    version: 1,
    kind,
    target,
    channels: {
      [channel]: { keyframes: [{ id: "key_" + trackId, timeTicks: 0, value,
        interpolationToNext: { kind: "step" } }] },
    },
  };
}

test("Sequence duration comes only from its owned TemporalProgram", () => {
  const project = fixture();
  assert.deepEqual(validateProject(project), []);
  assert.equal(Object.hasOwn(project.sequences[0], "durationTicks"), false);
  assert.equal(project.temporalPrograms.find((entry) => entry.id === "program_sequence").durationTicks, 300);
});

test("ViewLane requires full coverage without gaps or overlaps", () => {
  const gap = fixture();
  gap.sequences[0].viewLaneItems.find((item) => item.id === "hold_b").startTicks = 201;
  assert.ok(validateProject(gap).some((entry) => entry.code === "SEQUENCE_VIEW_GAP"));

  const overlap = fixture();
  overlap.sequences[0].viewLaneItems.find((item) => item.id === "hold_b").startTicks = 199;
  assert.ok(validateProject(overlap).some((entry) => entry.code === "SEQUENCE_VIEW_OVERLAP"));
});

test("ViewLane continuity is resolved canonically instead of by insertion order", () => {
  const project = fixture();
  project.sequences[0].viewLaneItems.reverse();
  assert.equal(validateProject(project).some((entry) => entry.code.startsWith("SEQUENCE_")), false);
  project.sequences[0].viewLaneItems.find((item) => item.id === "hold_b").keyArtId = "keyart_a";
  assert.ok(validateProject(project).some((entry) => entry.code === "SEQUENCE_TRANSITION_ENDPOINT_MISMATCH"));
});

test("TemporalProgram ownership rejects a Sequence and Transition sharing one program", () => {
  const project = fixture();
  project.sequences[0].temporalProgramId = "program_transition";
  const issues = validateProject(project)
    .filter((entry) => entry.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT");
  assert.deepEqual(issues.map((entry) => entry.entityId), ["sequence_shot", "transition_ab"]);
});

test("owner-aware validation rejects reusable motion in a Sequence program", () => {
  const project = fixture();
  project.temporalPrograms.find((entry) => entry.id === "program_sequence").tracks.push(
    scalarTrack("track_sequence_opacity", "OpacityTrack",
      { semanticSlotId: "slot_subject" }, "opacity"),
  );
  assert.ok(validateProject(project).some((entry) =>
    entry.code === "ANIMATION_TRACK_OWNER_INVALID" &&
    entry.entityId === "track_sequence_opacity"));
});

test("CameraTrack is Sequence-owned and unique within its program", () => {
  const wrongOwner = fixture();
  wrongOwner.temporalPrograms.find((entry) => entry.id === "program_transition").tracks.push(
    scalarTrack("track_transition_camera", "CameraTrack", { cameraId: "main" }, "positionX", 0),
  );
  assert.ok(validateProject(wrongOwner).some((entry) =>
    entry.code === "ANIMATION_TRACK_OWNER_INVALID" &&
    entry.entityId === "track_transition_camera"));

  const duplicate = fixture();
  duplicate.temporalPrograms.find((entry) => entry.id === "program_sequence").tracks.push(
    scalarTrack("track_camera_x", "CameraTrack", { cameraId: "main" }, "positionX", 0),
    scalarTrack("track_camera_y", "CameraTrack", { cameraId: "main" }, "positionY", 0),
  );
  const cameraIssues = validateProject(duplicate)
    .filter((entry) => entry.code === "SEQUENCE_CAMERA_TRACK_MULTIPLE");
  assert.deepEqual(cameraIssues.map((entry) => entry.details.trackIds),
    [["track_camera_x", "track_camera_y"]]);
});

test("schema 12 placeholders and second duration authority are removed without changing programs", () => {
  const project = fixture();
  project.schemaVersion = 12;
  project.animation = { clips: [{ legacy: true }], tracks: [{ legacy: true }],
    keyframes: [{ legacy: true }] };
  project.sequence = [{ legacy: true }];
  delete project.sequences;
  project.renderSettings.durationTicks = 999999;
  const beforePrograms = structuredClone(project.temporalPrograms);

  const migrated = migrateProjectSchema(project);
  assert.equal(migrated.schemaVersion, 13);
  assert.deepEqual(migrated.temporalPrograms, beforePrograms);
  assert.deepEqual(migrated.animation, { clips: [], deformationSamples: [] });
  assert.deepEqual(migrated.sequences, []);
  assert.equal(Object.hasOwn(migrated, "sequence"), false);
  assert.equal(Object.hasOwn(migrated.renderSettings, "durationTicks"), false);
});

test("schema 13 rejects non-empty or extended Phase 8 placeholders", () => {
  const clip = fixture();
  clip.animation.clips.push({ id: "clip_future", temporalProgramId: "program_sequence" });
  assert.ok(validateProject(clip).some((entry) => entry.code === "ANIMATION_CLIP_UNSUPPORTED"));

  const deformation = fixture();
  deformation.animation.deformationSamples.push({ id: "sample_future" });
  assert.ok(validateProject(deformation).some((entry) =>
    entry.code === "ANIMATION_DEFORMATION_SAMPLE_UNSUPPORTED"));

  const legacyShape = fixture();
  legacyShape.animation.tracks = [];
  assert.ok(validateProject(legacyShape).some((entry) => entry.code === "ANIMATION_SCHEMA_INVALID"));
});
