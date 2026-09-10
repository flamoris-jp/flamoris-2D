import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSequence,
  projectTransitionInstanceTick,
  resolveSequenceViewItem,
} from "../src/core/sequence-evaluator.js";
import { evaluateKeyArtBaseState } from "../src/core/transition-evaluator.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { VIEW_LANE_ITEM_KINDS } from "../src/model/sequence.js";
import { validateProject } from "../src/model/validation.js";
import { createEvaluatedRenderPlan } from "../src/core/evaluated-render.js";

function fixture() {
  const project = createProject({ name: "Evaluation", width: 100, height: 100,
    idFactory: createIdFactory("sequence_evaluation") });
  for (const id of ["node_a", "node_b"]) {
    project.scene.nodes[id] = createSceneNode({ id, displayName: id,
      parentId: project.scene.rootId, bounds: { left: 0, top: 0, right: 10, bottom: 10 } });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  const member = (nodeId, appearanceId) => ({ nodeId, appearanceId, opacity: 1,
    presence: "present", drawOrder: 0, clipping: { sourceNodeId: null } });
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId,
      members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId,
      members: [member("node_b", "appearance_b")], metadata: {} },
  );
  project.semanticSlots.push({ id: "slot_subject", displayName: "Subject", role: null,
    mappings: [{ keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" }], metadata: {} });
  project.temporalPrograms.push(
    { id: "program_transition", durationTicks: 7, tracks: [], events: [], regions: [] },
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

test("TransitionInstance projection uses exact rational round-half-up without unsafe Number products", () => {
  const item = { startTicks: 0, endTicks: 3 };
  assert.equal(projectTransitionInstanceTick(0, item, 10), 0);
  assert.equal(projectTransitionInstanceTick(1, item, 10), 3);
  assert.equal(projectTransitionInstanceTick(2, item, 10), 7);
  assert.equal(projectTransitionInstanceTick(3, item, 10), 10);

  const maximum = Number.MAX_SAFE_INTEGER;
  assert.equal(projectTransitionInstanceTick(maximum - 1,
    { startTicks: 0, endTicks: maximum }, maximum), maximum - 1);
});

test("internal boundaries belong to the later item and terminal tick inspects the last endpoint", () => {
  const project = fixture();
  assert.equal(resolveSequenceViewItem(project, "sequence_shot", 100).id, "transition_instance");
  assert.equal(evaluateSequence(project, "sequence_shot", 100).activeViewLaneItem.localTimeTicks, 0);
  assert.equal(resolveSequenceViewItem(project, "sequence_shot", 200).id, "hold_b");
  assert.equal(evaluateSequence(project, "sequence_shot", 200).activeViewLaneItem.localTimeTicks, 0);
  assert.equal(resolveSequenceViewItem(project, "sequence_shot", 300).id, "hold_b");
  assert.equal(evaluateSequence(project, "sequence_shot", 300).activeViewLaneItem.localTimeTicks, 100);
  assert.equal(evaluateSequence(project, "sequence_shot", 150).activeViewLaneItem.localTimeTicks, 4);

  const terminalTransition = fixture();
  terminalTransition.temporalPrograms.find((entry) =>
    entry.id === "program_sequence").durationTicks = 200;
  terminalTransition.sequences[0].viewLaneItems = terminalTransition.sequences[0]
    .viewLaneItems.filter((item) => item.id !== "hold_b");
  const terminal = evaluateSequence(terminalTransition, "sequence_shot", 200);
  assert.equal(terminal.activeViewLaneItem.id, "transition_instance");
  assert.equal(terminal.activeViewLaneItem.localTimeTicks, 7);
  assert.equal(terminal.evaluatedParts[0].renderInstances[0].sourceNodeId, "node_b");
});

test("standalone KeyArtHold shares Warp Bone Form and clipping endpoint evaluation", () => {
  const project = fixture();
  const hold = evaluateSequence(project, "sequence_shot", 0);
  const base = evaluateKeyArtBaseState(project, "keyart_a", { evaluationId: "sequence_shot:hold_a" });
  assert.deepEqual(hold.evaluatedParts, base.evaluatedParts);
  assert.deepEqual(hold.compositeGroups, base.compositeGroups);
  assert.equal(hold.evaluatedParts[0].renderInstances[0].sourceNodeId, "node_a");
});

test("standalone KeyArtHold ambiguity is rejected without selecting array order", () => {
  const project = fixture();
  for (const suffix of ["one", "two"]) {
    project.meshTopologies.push({ id: "topology_" + suffix,
      vertexIds: ["vertex_" + suffix + "_1", "vertex_" + suffix + "_2", "vertex_" + suffix + "_3"],
      indices: [0, 1, 2] });
    project.meshKeyforms.push({ id: "keyform_" + suffix, topologyId: "topology_" + suffix,
      keyArtId: "keyart_a", semanticSlotId: "slot_subject",
      positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] });
  }
  assert.ok(validateProject(project).some((entry) => entry.code === "SEQUENCE_KEYART_BASE_AMBIGUOUS"));
  const first = evaluateKeyArtBaseState(project, "keyart_a");
  project.meshKeyforms.reverse();
  const second = evaluateKeyArtBaseState(project, "keyart_a");
  assert.equal(first.baseSelections[0].keyformId, null);
  assert.deepEqual(first, second);
  assert.ok(first.diagnostics.some((entry) => entry.code === "SEQUENCE_KEYART_BASE_AMBIGUOUS"));
});

test("same-KeyArt adjacent Transition endpoints reject incompatible MeshKeyform state", () => {
  const project = fixture();
  for (const suffix of ["one", "two"]) {
    project.meshTopologies.push({ id: "topology_" + suffix,
      vertexIds: ["vertex_" + suffix + "_1", "vertex_" + suffix + "_2", "vertex_" + suffix + "_3"],
      indices: [0, 1, 2] });
    project.meshKeyforms.push({ id: "keyform_b_" + suffix, topologyId: "topology_" + suffix,
      keyArtId: "keyart_b", semanticSlotId: "slot_subject",
      positions: suffix === "one" ? [0, 0, 10, 0, 0, 10] : [0, 0, 20, 0, 0, 20],
      uvs: [0, 0, 1, 0, 0, 1] });
  }
  project.transitions[0].partTransitions[0].toKeyformId = "keyform_b_one";
  project.temporalPrograms.push({ id: "program_transition_ba", durationTicks: 7,
    tracks: [], events: [], regions: [] });
  project.transitions.push({ id: "transition_ba", displayName: "B to A",
    fromKeyArtId: "keyart_b", toKeyArtId: "keyart_a",
    temporalProgramId: "program_transition_ba", partTransitions: [{ id: "part_ba",
      semanticSlotId: "slot_subject", mode: "replace", topologyId: null,
      fromKeyformId: "keyform_b_two", toKeyformId: null,
      configuration: { compositeGroupId: "group_subject_ba" } }], diagnosticOverrides: [] });
  project.temporalPrograms.find((entry) => entry.id === "program_sequence").durationTicks = 400;
  project.sequences[0].viewLaneItems = [
    { id: "hold_a", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
      keyArtId: "keyart_a", startTicks: 0, endTicks: 100 },
    { id: "transition_instance", kind: VIEW_LANE_ITEM_KINDS.TRANSITION_INSTANCE,
      transitionId: "transition_ab", startTicks: 100, endTicks: 200 },
    { id: "transition_instance_ba", kind: VIEW_LANE_ITEM_KINDS.TRANSITION_INSTANCE,
      transitionId: "transition_ba", startTicks: 200, endTicks: 300 },
    { id: "hold_a_end", kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
      keyArtId: "keyart_a", startTicks: 300, endTicks: 400 },
  ];
  const issue = validateProject(project)
    .find((entry) => entry.code === "SEQUENCE_VIEW_ENDPOINT_INCOMPATIBLE");
  assert.deepEqual(issue?.details, {
    previousItemId: "transition_instance",
    nextItemId: "transition_instance_ba",
    keyArtId: "keyart_b",
  });
});

test("Sequence evaluation is deterministic, DOM-independent, and Save/Open equivalent", () => {
  const project = fixture();
  assert.deepEqual(validateProject(project), []);
  const before = evaluateSequence(project, "sequence_shot", 150);
  const after = evaluateSequence(deserializeProject(serializeProject(project)), "sequence_shot", 150);
  assert.deepEqual(after, before);
  assert.deepEqual(evaluateSequence(project, "sequence_shot", 150), before);
  assert.equal(Object.hasOwn(globalThis, "document"), false);
});

test("shared renderer plan consumes Sequence EvaluatedFrame without Sequence semantics", () => {
  const frame = evaluateSequence(fixture(), "sequence_shot", 0);
  const plan = createEvaluatedRenderPlan(frame, { resolveArtwork: () => ({}) });
  assert.equal(plan.renderInstanceCount, 1);
  assert.deepEqual(plan.unsupportedReasons, []);
  assert.equal(plan.batches[0].renderInstances[0].sourceNodeId, "node_a");
});
