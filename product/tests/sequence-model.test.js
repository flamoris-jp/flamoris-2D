import assert from "node:assert/strict";
import test from "node:test";

import {
  VIEW_LANE_ITEM_KINDS,
  createSequence,
} from "../src/model/sequence.js";
import {
  temporalProgramOwners,
  validateTemporalProgramOwnership,
} from "../src/model/temporal-program-ownership.js";

test("Sequence construction canonicalizes ViewLane items without changing stable identity", () => {
  const sequence = createSequence({
    id: "sequence_shot",
    displayName: "Shot",
    temporalProgramId: "program_shot",
    viewLaneItems: [
      { id: "hold_b", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD, keyArtId: "key_b", startTicks: 10, endTicks: 20 },
      { id: "hold_a", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD, keyArtId: "key_a", startTicks: 0, endTicks: 10 },
    ],
  });

  assert.equal(sequence.id, "sequence_shot");
  assert.equal(sequence.temporalProgramId, "program_shot");
  assert.deepEqual(sequence.viewLaneItems.map((item) => item.id), ["hold_a", "hold_b"]);
  assert.deepEqual(sequence.clipInstances, []);
  assert.deepEqual(sequence.metadata, {});
});

test("TemporalProgram ownership is exclusive across Transition, AnimationClip, and Sequence", () => {
  const project = {
    transitions: [{ id: "transition_a", temporalProgramId: "program_shared" }],
    animation: { clips: [{ id: "clip_a", temporalProgramId: "program_shared" }] },
    sequences: [{ id: "sequence_a", temporalProgramId: "program_shared" }],
  };

  assert.deepEqual(
    temporalProgramOwners(project).get("program_shared").map(({ kind, id }) => [kind, id]),
    [
      ["AnimationClip", "clip_a"],
      ["Sequence", "sequence_a"],
      ["Transition", "transition_a"],
    ],
  );
  const issues = validateTemporalProgramOwnership(project);
  assert.equal(issues.length, 3);
  assert.ok(issues.every((entry) => entry.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT"));
  assert.deepEqual(issues.map((entry) => entry.entityId), ["clip_a", "sequence_a", "transition_a"]);
});
