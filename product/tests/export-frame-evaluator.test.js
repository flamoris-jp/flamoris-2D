import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession } from "../src/commands/editor.js";
import {
  evaluateTransitionExportFrame,
  planTransitionExportFrames,
} from "../src/core/export-frame-evaluator.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";
import { createIdFactory, createProject } from "../src/model/project.js";

function fixture() {
  const project = createProject({
    name: "Export bridge",
    width: 1920,
    height: 1080,
    idFactory: createIdFactory("export"),
  });
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [], metadata: {} },
  );
  project.temporalPrograms.push({
    id: "program_ab",
    durationTicks: 120000,
    tracks: [],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition_ab",
    displayName: "A to B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program_ab",
    partTransitions: [],
    diagnosticOverrides: [],
  });
  return project;
}

test("Transition-owned TemporalProgram is the sole export duration authority", () => {
  const planner = planTransitionExportFrames(
    fixture(),
    "transition_ab",
    { numerator: 30000, denominator: 1001 },
  );

  assert.equal(planner.durationTicks, 120000);
  assert.equal(planner.frameCount, 30);
  assert.throws(() => planTransitionExportFrames(
    { ...fixture(), temporalPrograms: [] },
    "transition_ab",
    { numerator: 24, denominator: 1 },
  ), /Unknown TemporalProgram program_ab/);
});

test("export frame bridge delegates the planned tick to the canonical evaluator", () => {
  const project = fixture();
  const request = {
    transitionId: "transition_ab",
    frameRate: { numerator: 24, denominator: 1 },
    frameIndex: 12,
  };
  const result = evaluateTransitionExportFrame(project, request);

  assert.deepEqual(result.frame, { frameIndex: 12, timeTicks: 60000, exact: true });
  assert.deepEqual(
    result.evaluatedTransition,
    evaluateTransition(project, "transition_ab", result.frame.timeTicks),
  );
});

test("export queries are DOM-independent and do not mutate Project or history", () => {
  const session = new EditorSession(fixture());
  const projectBefore = structuredClone(session.project);
  const historyBefore = {
    undo: session.undoStack.length,
    redo: session.redoStack.length,
    history: session.history.length,
    revision: session.currentRevision,
  };
  const input = {
    transitionId: "transition_ab",
    frameRate: { numerator: 30, denominator: 1 },
  };

  const plan = session.query("export.get_frame_plan", input);
  const result = session.query("export.evaluate_frame", { ...input, frameIndex: 15 });

  assert.equal(plan.frameCount, 30);
  assert.equal(result.frame.timeTicks, 60000);
  assert.deepEqual(session.project, projectBefore);
  assert.deepEqual({
    undo: session.undoStack.length,
    redo: session.redoStack.length,
    history: session.history.length,
    revision: session.currentRevision,
  }, historyBefore);
});
