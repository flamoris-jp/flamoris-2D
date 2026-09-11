import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSequence } from "../src/core/sequence-evaluator.js";
import {
  PROOF_TICKS,
  buildPhase8ProductionProof,
  proofTicks,
} from "./helpers/phase8-production-proof.js";

function partMesh(evaluation, semanticSlotId) {
  return evaluation.evaluatedParts.find((part) => part.semanticSlotId === semanticSlotId)
    .renderInstances[0].mesh.positions;
}

function withoutTrack(project, programId, trackId) {
  const copy = structuredClone(project);
  const program = copy.temporalPrograms.find(({ id }) => id === programId);
  program.tracks = program.tracks.filter((track) => track.trackId !== trackId);
  return copy;
}

test("BoneTrack mixes over the KeyArt pose and one rotation constraint runs before FK/rigid binding", () => {
  const { project } = buildPhase8ProductionProof();
  const constrained = evaluateSequence(project, "sequence_proof", proofTicks(60));
  const unconstrainedProject = structuredClone(project);
  unconstrainedProject.rig.boneRotationConstraints = [];
  const unconstrained = evaluateSequence(
    unconstrainedProject, "sequence_proof", proofTicks(60));
  assert.notDeepEqual(partMesh(constrained, "slot_body"), partMesh(unconstrained, "slot_body"));

  const exactClampedProject = structuredClone(unconstrainedProject);
  exactClampedProject.temporalPrograms.find(({ id }) => id === "program_breath")
    .tracks.find(({ trackId }) => trackId === "breath_bone")
    .channels.rotation.keyframes.find(({ id }) => id === "breath_bone_peak").value = 0.28;
  const exactClamped = evaluateSequence(
    exactClampedProject, "sequence_proof", proofTicks(60));
  assert.deepEqual(partMesh(constrained, "slot_body"), partMesh(exactClamped, "slot_body"));
  assert.ok(project.rig.rigidBoneBindings.some(({ targetNodeId }) => targetNodeId === "slot_body_a"));
});

test("DeformerTrack overlays nested Warp parent-first and one cage drives mesh and Bone projection", () => {
  const { project } = buildPhase8ProductionProof();
  const animated = evaluateSequence(project, "sequence_proof", proofTicks(50));
  const noHairProject = structuredClone(project);
  noHairProject.sequences[0].clipInstances = noHairProject.sequences[0].clipInstances
    .filter(({ clipId }) => clipId !== "clip_hair_sway");
  const noHair = evaluateSequence(noHairProject, "sequence_proof", proofTicks(50));
  assert.notDeepEqual(partMesh(animated, "slot_hair"), partMesh(noHair, "slot_hair"));
  assert.notDeepEqual(partMesh(animated, "slot_body"), partMesh(noHair, "slot_body"));

  const reversed = structuredClone(project);
  reversed.rig.deformers.reverse();
  reversed.rig.warpControlPoints.reverse();
  reversed.rig.warpDeformerKeyforms.reverse();
  assert.deepEqual(evaluateSequence(reversed, "sequence_proof", proofTicks(50)), animated);
});

test("MeshFormCorrection remains before ordinary MeshDeformationTrack contribution", () => {
  const { project } = buildPhase8ProductionProof();
  const noDetail = withoutTrack(project, "program_breath", "breath_form_detail");
  const noForm = structuredClone(project);
  noForm.meshFormCorrectionKeyforms = [];
  const neither = withoutTrack(noForm, "program_breath", "breath_form_detail");
  const fullPosition = partMesh(
    evaluateSequence(project, "sequence_proof", proofTicks(60)), "slot_body");
  const noDetailPosition = partMesh(
    evaluateSequence(noDetail, "sequence_proof", proofTicks(60)), "slot_body");
  const noFormPosition = partMesh(
    evaluateSequence(noForm, "sequence_proof", proofTicks(60)), "slot_body");
  const neitherPosition = partMesh(
    evaluateSequence(neither, "sequence_proof", proofTicks(60)), "slot_body");
  assert.deepEqual(fullPosition.slice(0, 2).map((value, index) => value - noDetailPosition[index]),
    [1.5, -0.5]);
  assert.deepEqual(noFormPosition.slice(0, 2).map((value, index) => value - neitherPosition[index]),
    [1.5, -0.5]);
  assert.deepEqual(fullPosition.slice(0, 2).map((value, index) => value - noFormPosition[index]),
    [0, 0.5]);
});

test("clipping resolves the final deformed mask instance while Blink and Warp are active", () => {
  const { session } = buildPhase8ProductionProof();
  const frame = session.query("sequence.evaluate",
    { sequenceId: "sequence_proof", timeTicks: PROOF_TICKS.transitionAB });
  const eye = frame.evaluatedParts.find(({ semanticSlotId }) => semanticSlotId === "slot_eye")
    .renderInstances[0];
  const mask = frame.evaluatedParts.find(({ semanticSlotId }) => semanticSlotId === "slot_mask")
    .renderInstances[0];
  assert.equal(eye.clipping.sourceRenderInstanceId, mask.renderInstanceId);
  assert.ok(Math.hypot(eye.transform[2], eye.transform[3]) < 1,
    "Blink scale must be present before final clipping resolution");
  assert.ok(frame.activeClipInstances.some(({ clipId }) => clipId === "clip_hair_sway"));
  assert.equal(frame.authoritative, true);
});

test("production evaluation never mutates KeyArt, Bone, Warp, or Form keyforms", () => {
  const { project, session } = buildPhase8ProductionProof();
  const authored = structuredClone({
    keyArts: project.keyArts,
    meshKeyforms: project.meshKeyforms,
    bonePoseKeyforms: project.rig.bonePoseKeyforms,
    warpDeformerKeyforms: project.rig.warpDeformerKeyforms,
    meshFormCorrectionKeyforms: project.meshFormCorrectionKeyforms,
  });
  for (const timeTicks of [
    PROOF_TICKS.start,
    PROOF_TICKS.holdA,
    proofTicks(100),
    PROOF_TICKS.transitionAB,
    proofTicks(200),
    PROOF_TICKS.holdB,
    proofTicks(300),
    PROOF_TICKS.transitionBC,
    proofTicks(400),
    PROOF_TICKS.blinkC,
    PROOF_TICKS.terminal,
  ]) {
    session.query("sequence.evaluate", { sequenceId: "sequence_proof", timeTicks });
  }
  assert.deepEqual({
    keyArts: session.project.keyArts,
    meshKeyforms: session.project.meshKeyforms,
    bonePoseKeyforms: session.project.rig.bonePoseKeyforms,
    warpDeformerKeyforms: session.project.rig.warpDeformerKeyforms,
    meshFormCorrectionKeyforms: session.project.meshFormCorrectionKeyforms,
  }, authored);
});
