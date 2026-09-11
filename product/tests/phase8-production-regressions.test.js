import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSequence } from "../src/core/sequence-evaluator.js";
import { buildPhase8ProductionProof } from "./helpers/phase8-production-proof.js";

test("MeshDeformationTrack retains the active topology across a Morph transition", () => {
  const { project } = buildPhase8ProductionProof();
  const withoutDetail = structuredClone(project);
  const breathProgram = withoutDetail.temporalPrograms.find(({ id }) => id === "program_breath");
  breathProgram.tracks = breathProgram.tracks.filter(({ trackId }) =>
    trackId !== "breath_form_detail");

  const withDetailFrame = evaluateSequence(project, "sequence_proof", 150);
  const withoutDetailFrame = evaluateSequence(withoutDetail, "sequence_proof", 150);
  assert.ok(!withDetailFrame.diagnostics.some(({ code }) =>
    code === "ANIMATION_TOPOLOGY_INCOMPATIBLE"));
  assert.notDeepEqual(
    withDetailFrame.evaluatedParts.find(({ semanticSlotId }) => semanticSlotId === "slot_body")
      .renderInstances[0].mesh.positions,
    withoutDetailFrame.evaluatedParts.find(({ semanticSlotId }) => semanticSlotId === "slot_body")
      .renderInstances[0].mesh.positions,
  );
});
