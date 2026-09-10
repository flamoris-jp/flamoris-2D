import assert from "node:assert/strict";
import test from "node:test";

import { CommandError, EditorSession, TransactionError } from "../src/commands/editor.js";
import { serializeProject, deserializeProject } from "../src/io/project-json.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { createIdFactory, createProject } from "../src/model/project.js";
import { VIEW_LANE_ITEM_KINDS } from "../src/model/sequence.js";

function baseProject() {
  const project = createProject({ name: "Clip Commands", width: 64, height: 64,
    idFactory: createIdFactory("clip_commands") });
  project.keyArts.push({ id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
    members: [], metadata: {} });
  return project;
}

function clip(programId = "program_clip") {
  return { id: "clip_idle", displayName: "Idle", temporalProgramId: programId,
    defaultLoopMode: "once", metadata: {} };
}

function instance(overrides = {}) {
  return { id: "instance_idle", clipId: "clip_idle", startTicks: 0, endTicks: 10,
    sourceOffsetTicks: 0, playbackRate: { numerator: 1, denominator: 1 },
    loopMode: "once", weight: 1, layer: 0, enabled: true, ...overrides };
}

function createClipCommands() {
  return [
    { type: "animation.temporal.create_program",
      payload: { programId: "program_clip", durationTicks: 20 } },
    { type: "animation.clip.create", payload: { clip: clip() } },
  ];
}

function createSequenceCommands() {
  return [
    { type: "animation.temporal.create_program",
      payload: { programId: "program_sequence", durationTicks: 10 } },
    { type: "sequence.create", payload: { sequence: {
      id: "sequence_shot", displayName: "Shot", temporalProgramId: "program_sequence",
      viewLaneItems: [{ id: "hold_a", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
        keyArtId: "keyart_a", startTicks: 0, endTicks: 10 }],
      clipInstances: [], metadata: {},
    } } },
  ];
}

test("AnimationClip and owned TemporalProgram are atomic Undo/Redo lifecycle units", () => {
  const session = new EditorSession(baseProject());
  session.executeTransaction(createClipCommands(), { label: "Create Clip" });
  assert.equal(session.project.animation.clips[0].id, "clip_idle");
  assert.equal(session.project.temporalPrograms[0].id, "program_clip");
  assert.equal(session.undoStack.length, 1);
  session.undo();
  assert.deepEqual(session.project.animation.clips, []);
  assert.deepEqual(session.project.temporalPrograms, []);
  session.redo();
  assert.equal(session.project.animation.clips[0].temporalProgramId, "program_clip");

  assert.throws(() => session.execute({ type: "animation.clip.remove",
    payload: { clipId: "clip_idle" } }), (error) => error instanceof TransactionError &&
    error.issues.some((issue) => issue.code === "ANIMATION_CLIP_PROGRAM_REMOVAL_NOT_ATOMIC"));

  session.executeTransaction([
    { type: "animation.clip.remove", payload: { clipId: "clip_idle" } },
    { type: "animation.temporal.remove_program", payload: { programId: "program_clip" } },
  ], { label: "Remove Clip" });
  assert.deepEqual(session.project.animation.clips, []);
  session.undo();
  assert.equal(session.project.animation.clips[0].id, "clip_idle");
  assert.equal(session.project.temporalPrograms[0].id, "program_clip");
});

test("AnimationClip cannot attach to an existing program or rebind through update/recreate", () => {
  const session = new EditorSession(baseProject());
  session.execute({ type: "animation.temporal.create_program",
    payload: { programId: "program_existing", durationTicks: 20 } });
  assert.throws(() => session.execute({ type: "animation.clip.create",
    payload: { clip: clip("program_existing") } }), (error) => error instanceof TransactionError &&
    error.issues.some((issue) => issue.code === "ANIMATION_CLIP_PROGRAM_CREATION_NOT_ATOMIC"));

  session.executeTransaction(createClipCommands());
  assert.throws(() => session.execute({ type: "animation.clip.update", payload: {
    clipId: "clip_idle", clip: clip("program_existing"),
  } }), (error) => error instanceof CommandError &&
    error.code === "animation.clip_temporal_program_immutable");

  assert.throws(() => session.executeTransaction([
    { type: "animation.clip.remove", payload: { clipId: "clip_idle" } },
    { type: "animation.clip.create", payload: { clip: clip("program_existing") } },
  ]), (error) => error instanceof TransactionError && error.issues.some((issue) =>
    issue.code === "ANIMATION_CLIP_PROGRAM_OWNERSHIP_REASSIGNED"));
});

test("ClipInstance commands are one-history-unit edits with Undo/Redo", () => {
  const session = new EditorSession(baseProject());
  session.executeTransaction(createClipCommands());
  session.executeTransaction(createSequenceCommands());
  session.execute({ type: "sequence.add_clip_instance", payload: {
    sequenceId: "sequence_shot", clipInstance: instance(),
  } });
  assert.equal(session.project.sequences[0].clipInstances[0].enabled, true);
  session.execute({ type: "sequence.update_clip_instance", payload: {
    sequenceId: "sequence_shot", clipInstanceId: "instance_idle",
    clipInstance: instance({ enabled: false, weight: 0.5, layer: 2 }),
  } });
  assert.equal(session.project.sequences[0].clipInstances[0].enabled, false);
  session.undo();
  assert.equal(session.project.sequences[0].clipInstances[0].enabled, true);
  session.redo();
  assert.equal(session.project.sequences[0].clipInstances[0].weight, 0.5);
  session.execute({ type: "sequence.remove_clip_instance", payload: {
    sequenceId: "sequence_shot", clipInstanceId: "instance_idle",
  } });
  assert.deepEqual(session.project.sequences[0].clipInstances, []);
  session.undo();
  assert.equal(session.project.sequences[0].clipInstances[0].layer, 2);
});

test("Clip and ClipInstance Save/Open and queries are deterministic and DOM-independent", () => {
  const session = new EditorSession(baseProject());
  session.executeTransaction(createClipCommands());
  session.executeTransaction(createSequenceCommands());
  session.executeTransaction([
    { type: "sequence.add_clip_instance", payload: {
      sequenceId: "sequence_shot", clipInstance: instance({ id: "instance_b",
        startTicks: 5, endTicks: 10, sourceOffsetTicks: 5 }),
    } },
    { type: "sequence.add_clip_instance", payload: {
      sequenceId: "sequence_shot", clipInstance: instance({ id: "instance_a",
        startTicks: 0, endTicks: 5 }),
    } },
  ]);
  const reopened = deserializeProject(serializeProject(session.project));
  assert.deepEqual(reopened.animation.clips, session.project.animation.clips);
  assert.deepEqual(reopened.sequences[0].clipInstances.map((entry) => entry.id),
    ["instance_a", "instance_b"]);

  const adapter = new HeadlessProductAdapter(new EditorSession(reopened));
  assert.equal(adapter.query("animation.clip.get", { clipId: "clip_idle" }).durationTicks, 20);
  assert.deepEqual(adapter.query("animation.clip.list", {}).map((entry) => entry.id), ["clip_idle"]);
  const atBoundary = adapter.query("sequence.project_clip_instances", {
    sequenceId: "sequence_shot", timeTicks: 5,
  });
  assert.deepEqual(atBoundary.map(({ clipInstanceId, active }) => ({ clipInstanceId, active })), [
    { clipInstanceId: "instance_a", active: false },
    { clipInstanceId: "instance_b", active: true },
  ]);
  assert.ok(atBoundary.every((entry) => !Object.hasOwn(entry, "geometry")));
  assert.ok(adapter.query("sequence.project_clip_instances", {
    sequenceId: "sequence_shot", timeTicks: 10,
  }).every((entry) => entry.active === false));
  assert.equal(Object.hasOwn(globalThis, "document"), false);
});
