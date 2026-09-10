import assert from "node:assert/strict";
import test from "node:test";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { createIdFactory, createProject } from "../src/model/project.js";
import { VIEW_LANE_ITEM_KINDS } from "../src/model/sequence.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function baseProject() {
  const project = createProject({ name: "Sequence Commands", width: 64, height: 64,
    idFactory: createIdFactory("sequence_commands") });
  project.keyArts.push({ id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
    members: [], metadata: {} });
  return project;
}

function sequence(viewLaneItems = [
  { id: "hold_a", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
    keyArtId: "keyart_a", startTicks: 0, endTicks: 100 },
]) {
  return { id: "sequence_shot", displayName: "Shot", temporalProgramId: "program_shot",
    viewLaneItems, clipInstances: [], metadata: {} };
}

function createCommands() {
  return [
    { type: "animation.temporal.create_program",
      payload: { programId: "program_shot", durationTicks: 100 } },
    { type: "sequence.create", payload: { sequence: sequence() } },
  ];
}

test("Sequence and owned TemporalProgram create and remove as atomic Undo/Redo units", () => {
  const session = new EditorSession(baseProject());
  session.executeTransaction(createCommands(), { label: "Create Sequence" });
  assert.equal(session.project.sequences.length, 1);
  assert.equal(session.project.temporalPrograms.length, 1);
  assert.equal(session.undoStack.length, 1);

  session.undo();
  assert.deepEqual(session.project.sequences, []);
  assert.deepEqual(session.project.temporalPrograms, []);
  session.redo();
  assert.equal(session.project.sequences[0].id, "sequence_shot");
  assert.equal(session.project.temporalPrograms[0].id, "program_shot");

  assert.throws(
    () => session.execute({ type: "sequence.remove", payload: { sequenceId: "sequence_shot" } }),
    (error) => error instanceof TransactionError &&
      error.issues.some((entry) => entry.code === "SEQUENCE_PROGRAM_REMOVAL_NOT_ATOMIC"),
  );
  assert.equal(session.project.sequences[0].id, "sequence_shot");
  assert.equal(session.project.temporalPrograms[0].id, "program_shot");

  session.executeTransaction([
    { type: "sequence.remove", payload: { sequenceId: "sequence_shot" } },
    { type: "animation.temporal.remove_program", payload: { programId: "program_shot" } },
  ], { label: "Remove Sequence" });
  assert.deepEqual(session.project.sequences, []);
  assert.deepEqual(session.project.temporalPrograms, []);
  session.undo();
  assert.equal(session.project.sequences[0].temporalProgramId, "program_shot");
});

test("ViewLane add update remove commands canonicalize and share transaction history", () => {
  const session = new EditorSession(baseProject());
  session.executeTransaction(createCommands());
  const first = { ...session.project.sequences[0].viewLaneItems[0], endTicks: 50 };
  const second = { id: "hold_b", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
    keyArtId: "keyart_a", startTicks: 50, endTicks: 100 };
  session.executeTransaction([
    { type: "sequence.add_view_item", payload: { sequenceId: "sequence_shot", viewItem: second } },
    { type: "sequence.update_view_item", payload: { sequenceId: "sequence_shot",
      viewItemId: "hold_a", viewItem: first } },
  ], { label: "Split Hold" });
  assert.deepEqual(session.query("sequence.get", { sequenceId: "sequence_shot" })
    .viewLaneItems.map((item) => item.id), ["hold_a", "hold_b"]);
  assert.equal(session.undoStack.length, 2);
  session.undo();
  assert.deepEqual(session.project.sequences[0].viewLaneItems.map((item) => item.id), ["hold_a"]);
  session.redo();

  session.executeTransaction([
    { type: "sequence.remove_view_item", payload: {
      sequenceId: "sequence_shot", viewItemId: "hold_b" } },
    { type: "sequence.update_view_item", payload: { sequenceId: "sequence_shot",
      viewItemId: "hold_a", viewItem: { ...first, endTicks: 100 } } },
  ], { label: "Join Hold" });
  assert.deepEqual(session.project.sequences[0].viewLaneItems.map((item) => item.id), ["hold_a"]);
});

test("invalid non-atomic owner/program mutations roll back", () => {
  const session = new EditorSession(baseProject());
  assert.throws(() => session.execute({ type: "sequence.create",
    payload: { sequence: sequence() } }), TransactionError);
  assert.deepEqual(session.project.sequences, []);
});

test("Sequence queries are MCP-ready, derived from program duration, and DOM-independent", () => {
  const session = new EditorSession(baseProject());
  session.executeTransaction(createCommands());
  const adapter = new HeadlessProductAdapter(session);
  assert.equal(adapter.query("sequence.get", { sequenceId: "sequence_shot" }).durationTicks, 100);
  assert.deepEqual(adapter.query("sequence.list", {}).map((entry) => entry.id), ["sequence_shot"]);
  assert.deepEqual(adapter.query("sequence.get_diagnostics", { sequenceId: "sequence_shot" }),
    { valid: true, issues: [] });
  assert.equal(adapter.query("sequence.evaluate", {
    sequenceId: "sequence_shot", timeTicks: 100,
  }).activeViewLaneItem.id, "hold_a");
  assert.equal(adapter.query("project.get_summary", {}).counts.sequences, 1);
  assert.equal(Object.hasOwn(globalThis, "document"), false);
});
