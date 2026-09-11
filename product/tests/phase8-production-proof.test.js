import assert from "node:assert/strict";
import test from "node:test";

import { projectClipInstanceTick } from "../src/core/clip-time.js";
import { serializeProject } from "../src/io/project-json.js";
import { validateProject } from "../src/model/validation.js";
import {
  PROOF_TICKS,
  buildPhase8ProductionProof,
} from "./helpers/phase8-production-proof.js";

test("production proof authors an exact A to B to C Sequence through timeline Commands", () => {
  const { project, session } = buildPhase8ProductionProof();
  assert.deepEqual(validateProject(project), []);
  const sequence = session.query("sequence.get", { sequenceId: "sequence_proof" });
  assert.deepEqual(sequence.viewLaneItems.map((item) => [
    item.kind,
    item.keyArtId || item.transitionId,
    item.startTicks,
    item.endTicks,
  ]), [
    ["KeyArtHold", "key_a", 0, 100],
    ["TransitionInstance", "transition_ab", 100, 200],
    ["KeyArtHold", "key_b", 200, 300],
    ["TransitionInstance", "transition_bc", 300, 400],
    ["KeyArtHold", "key_c", 400, 600],
  ]);
  for (const [tick, expectedKind, expectedId] of [
    [99, "KeyArtHold", "hold_a"],
    [100, "TransitionInstance", "view_transition_ab"],
    [200, "KeyArtHold", null],
    [300, "TransitionInstance", "view_transition_bc"],
    [400, "KeyArtHold", null],
    [600, "KeyArtHold", null],
  ]) {
    const item = session.query("sequence.evaluate", { sequenceId: "sequence_proof", timeTicks: tick })
      .activeViewLaneItem;
    assert.equal(item.kind, expectedKind);
    if (expectedId) assert.equal(item.id, expectedId);
  }
});

test("Blink, Breath, and HairSway are ordinary reusable typed AnimationClips", () => {
  const { project } = buildPhase8ProductionProof();
  const clips = new Map(project.animation.clips.map((clip) => [clip.id, clip]));
  assert.deepEqual([...clips.keys()].sort(), [
    "clip_blink", "clip_breath", "clip_hair_sway", "clip_node_motion",
  ]);
  const program = (clipId) => project.temporalPrograms.find((entry) =>
    entry.id === clips.get(clipId).temporalProgramId);
  assert.deepEqual(program("clip_blink").tracks.map((track) => track.kind), ["TransformTrack"]);
  assert.deepEqual(program("clip_blink").tracks[0].target,
    { semanticSlotId: "slot_eye", coordinateSpace: "node-local" });
  assert.deepEqual(program("clip_breath").tracks.map((track) => track.kind),
    ["TransformTrack", "BoneTrack", "MeshDeformationTrack"]);
  assert.deepEqual(program("clip_hair_sway").tracks.map((track) => track.kind),
    ["DeformerTrack", "DeformerTrack"]);
  assert.deepEqual(program("clip_node_motion").tracks[0].target,
    { nodeId: "background", coordinateSpace: "node-local" });
  const blinkInstances = project.sequences[0].clipInstances.filter((entry) =>
    entry.clipId === "clip_blink");
  assert.equal(blinkInstances.length, 2);
  assert.equal(new Set(blinkInstances.map((entry) => entry.clipId)).size, 1);
  assert.doesNotMatch(serializeProject(project),
    /BlinkTrack|BreathTrack|HairSwayTrack|blinkRenderer|proceduralBreath|proceduralHair/u);
});

test("looping clips wrap exact periods and stay inactive at the terminal Sequence tick", () => {
  const { project, session } = buildPhase8ProductionProof();
  const breath = project.sequences[0].clipInstances.find(({ id }) => id === "breath_loop");
  const breathClip = project.animation.clips.find(({ id }) => id === breath.clipId);
  const breathProgram = project.temporalPrograms.find(({ id }) => id === breathClip.temporalProgramId);
  assert.deepEqual(projectClipInstanceTick(breath, 120, breathProgram.durationTicks), {
    active: true,
    clipInstanceId: "breath_loop",
    clipId: "clip_breath",
    loopMode: "loop",
    rawLocalTick: 120,
    localTick: 0,
  });
  const exactPeriod = session.query("sequence.evaluate",
    { sequenceId: "sequence_proof", timeTicks: 120 });
  assert.equal(exactPeriod.activeClipInstances.find(({ clipInstanceId }) =>
    clipInstanceId === "breath_loop").localTick, 0);
  const terminal = session.query("sequence.evaluate",
    { sequenceId: "sequence_proof", timeTicks: PROOF_TICKS.terminal });
  assert.equal(terminal.activeViewLaneItem.keyArtId, "key_c");
  assert.equal(terminal.activeClipInstances.length, 0);
  assert.ok(!terminal.diagnostics.some(({ code }) => code === "ANIMATION_LOOP_ENDPOINT_MISMATCH"));
});

test("SemanticSlot Blink crosses Hold to Transition to Hold without target remapping", () => {
  const { session } = buildPhase8ProductionProof();
  for (const tick of [90, PROOF_TICKS.transitionAB, 210]) {
    const evaluation = session.query("sequence.evaluate", { sequenceId: "sequence_proof", timeTicks: tick });
    const blink = evaluation.activeClipInstances.find(({ clipInstanceId }) =>
      clipInstanceId === "blink_cross_boundary");
    assert.equal(blink.clipId, "clip_blink");
    assert.ok(evaluation.evaluatedParts.find(({ semanticSlotId }) => semanticSlotId === "slot_eye"));
    assert.ok(!evaluation.diagnostics.some(({ code }) =>
      code === "ANIMATION_CLIP_TARGET_INCOMPATIBLE"));
  }
});

test("ClipInstance insertion order cannot change the production shot output", () => {
  const { project, session } = buildPhase8ProductionProof();
  const before = session.query("sequence.evaluate",
    { sequenceId: "sequence_proof", timeTicks: PROOF_TICKS.transitionBC });
  project.sequences[0].clipInstances.reverse();
  project.animation.clips.reverse();
  project.temporalPrograms.reverse();
  const after = session.query("sequence.evaluate",
    { sequenceId: "sequence_proof", timeTicks: PROOF_TICKS.transitionBC });
  assert.deepEqual(after, before);
});
