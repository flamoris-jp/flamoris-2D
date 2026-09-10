import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { serializeProject } from "../src/io/project-json.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import {
  PART_TRANSITION_MODES,
  TransitionAuthoringController,
} from "../src/ui/transition-authoring-controller.js";
import { createTransitionAuthoringView } from "../src/ui/transition-authoring-view.js";

function member(nodeId, appearanceId) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder: 0,
    clipping: { sourceNodeId: null },
  };
}

function fixture({ mapping = "both", withPart = false } = {}) {
  const project = createProject({
    name: "Authoring",
    width: 100,
    height: 100,
    idFactory: createIdFactory("authoring"),
  });
  for (const [id, name] of [["node_a", "Eye A"], ["node_b", "Eye B"]]) {
    project.scene.nodes[id] = createSceneNode({
      id,
      displayName: name,
      parentId: project.scene.rootId,
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "appearance_b")], metadata: {} },
  );
  const mappings = [];
  if (mapping !== "b") mappings.push({ keyArtId: "keyart_a", nodeId: "node_a" });
  if (mapping !== "a") mappings.push({ keyArtId: "keyart_b", nodeId: "node_b" });
  project.semanticSlots.push({
    id: "semantic_eye",
    displayName: "Eye",
    role: "eye",
    mappings,
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology_eye",
    vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2],
  });
  if (mapping !== "b") project.meshKeyforms.push({
    id: "keyform_a",
    topologyId: "topology_eye",
    keyArtId: "keyart_a",
    semanticSlotId: "semantic_eye",
    positions: [0, 0, 10, 0, 0, 10],
    uvs: [0, 0, 1, 0, 0, 1],
  });
  if (mapping !== "a") project.meshKeyforms.push({
    id: "keyform_b",
    topologyId: "topology_eye",
    keyArtId: "keyart_b",
    semanticSlotId: "semantic_eye",
    positions: [1, 1, 11, 1, 1, 11],
    uvs: [0, 0, 1, 0, 0, 1],
  });
  project.temporalPrograms.push({
    id: "program_ab",
    durationTicks: 120000,
    tracks: [],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition_ab",
    displayName: "A → B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program_ab",
    partTransitions: withPart ? [{
      id: "part_eye",
      semanticSlotId: "semantic_eye",
      mode: "morph",
      topologyId: "topology_eye",
      fromKeyformId: "keyform_a",
      toKeyformId: "keyform_b",
      configuration: {},
    }] : [],
    diagnosticOverrides: [],
  });
  const session = new EditorSession(project);
  let id = 0;
  const controller = new TransitionAuthoringController(session, {
    idFactory: (kind) => `${kind}_test_${++id}`,
  });
  return { project, session, controller };
}

test("Transition selection and Key Art selection are transient", () => {
  const { session, controller } = fixture();
  const before = JSON.stringify(session.project);
  controller.selectTransition("transition_ab");
  controller.selectKeyArt("keyart_a");
  controller.selectSemanticSlot("semantic_eye");
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.currentRevision, 0);
  assert.equal(session.history.length, 0);
  assert.doesNotMatch(serializeProject(session.project), /activeTransition|selectedSemantic/);
});

test("removed active Transition is safe and Redo/Undo restoration reuses its selection", () => {
  const { session, controller } = fixture();
  controller.selectTransition("transition_ab");
  session.execute({
    type: "transition.remove",
    payload: { transitionId: "transition_ab" },
  });
  assert.equal(controller.getState().activeTransition, null);
  assert.equal(controller.getState().activeTransitionMissing, true);
  session.undo();
  assert.equal(controller.getState().activeTransition.id, "transition_ab");
  session.redo();
  assert.equal(controller.getState().activeTransitionMissing, true);
  session.undo();
  assert.equal(controller.getState().activeTransition.id, "transition_ab");
});

test("A/B Key Art references and missing references are projected explicitly", () => {
  const { session, controller } = fixture();
  controller.selectTransition("transition_ab");
  let endpoints = controller.getState().endpoints;
  assert.equal(endpoints.from.keyArt.displayName, "A");
  assert.equal(endpoints.to.keyArt.displayName, "B");
  session.project.transitions[0].fromKeyArtId = "keyart_missing";
  endpoints = controller.getState().endpoints;
  assert.equal(endpoints.from.id, "keyart_missing");
  assert.equal(endpoints.from.keyArt, null);
  assert.equal(endpoints.from.missing, true);
  assert.equal(endpoints.to.missing, false);
});

test("A/B Key Art controls update the persistent Transition through transition.update", () => {
  const { session, controller } = fixture();
  session.execute({
    type: "keyart.create",
    payload: { keyArt: {
      id: "keyart_c",
      displayName: "C",
      rootNodeId: session.project.scene.rootId,
      members: [],
      metadata: {},
    } },
  });
  controller.selectTransition("transition_ab");
  controller.setEndpoint("to", "keyart_c");
  assert.equal(session.project.transitions[0].toKeyArtId, "keyart_c");
  assert.equal(Object.hasOwn(session.project.transitions[0], "durationTicks"), false);
  assert.deepEqual(session.history.at(-1).commandTypes, ["transition.update"]);
  session.undo();
  assert.equal(session.project.transitions[0].toKeyArtId, "keyart_b");
});

test("SemanticSlot mapping uses existing map/unmap commands and reports A/B state", () => {
  const { session, controller } = fixture({ mapping: "a" });
  controller.selectTransition("transition_ab");
  controller.selectSemanticSlot("semantic_eye");
  assert.equal(controller.getState().selectedSemanticSlot.status, "a-only");
  controller.mapNode("keyart_b", "node_b");
  assert.deepEqual(session.history.at(-1).commandTypes, ["semantic_slot.map_node"]);
  assert.equal(controller.getState().selectedSemanticSlot.status, "mapped");
  controller.unmapNode("keyart_a");
  assert.deepEqual(session.history.at(-1).commandTypes, ["semantic_slot.unmap_node"]);
  assert.equal(controller.getState().selectedSemanticSlot.status, "b-only");
});

test("duplicate and ambiguous SemanticSlot mappings remain rejected", () => {
  const { session, controller } = fixture();
  session.execute({
    type: "semantic_slot.create",
    payload: { semanticSlot: { id: "semantic_other", displayName: "Other", mappings: [], metadata: {} } },
  });
  controller.selectTransition("transition_ab");
  controller.selectSemanticSlot("semantic_other");
  assert.throws(
    () => controller.mapNode("keyart_a", "node_a"),
    (error) => error.code === "SEMANTIC_MAPPING_DUPLICATE",
  );

  const invalid = structuredClone(session.project);
  invalid.semanticSlots[1].mappings.push(
    { keyArtId: "keyart_b", nodeId: "node_b" },
    { keyArtId: "keyart_b", nodeId: "node_b" },
  );
  assert.ok(validateProject(invalid).some((issue) =>
    issue.code === "SEMANTIC_MAPPING_DUPLICATE"));
});

test("PartTransition mode changes use normal history and Undo/Redo", () => {
  const { session, controller } = fixture({ withPart: true });
  controller.selectTransition("transition_ab");
  controller.selectSemanticSlot("semantic_eye");
  controller.setPartMode("replace", { compositeGroupId: "eye_crossfade" });
  assert.equal(session.project.transitions[0].partTransitions[0].mode, "replace");
  assert.deepEqual(session.history.at(-1).commandTypes, ["transition.set_part_mode"]);
  session.undo();
  assert.equal(session.project.transitions[0].partTransitions[0].mode, "morph");
  session.redo();
  assert.equal(session.project.transitions[0].partTransitions[0].mode, "replace");
});

test("all six persistent modes can be authored without convenience modes", () => {
  for (const mode of PART_TRANSITION_MODES) {
    const mapping = mode === "appear" ? "b" : mode === "disappear" ? "a" : "both";
    const { session, controller } = fixture({ mapping, withPart: mode === "morph" });
    controller.selectTransition("transition_ab");
    controller.selectSemanticSlot("semantic_eye");
    controller.setPartMode(mode);
    const part = session.project.transitions[0].partTransitions[0];
    assert.equal(part.mode, mode);
    assert.ok(PART_TRANSITION_MODES.includes(part.mode));
  }
});

test("mode changes never infer Morph topology/keyform references", () => {
  const { session, controller } = fixture();
  session.project.meshTopologies.push({
    id: "topology_eye_alternate",
    vertexIds: ["v4", "v5", "v6"],
    indices: [0, 1, 2],
  });
  session.project.meshKeyforms.push(
    {
      ...structuredClone(session.project.meshKeyforms[0]),
      id: "keyform_a_alternate",
      topologyId: "topology_eye_alternate",
    },
    {
      ...structuredClone(session.project.meshKeyforms[1]),
      id: "keyform_b_alternate",
      topologyId: "topology_eye_alternate",
    },
  );
  controller.selectTransition("transition_ab");
  controller.selectSemanticSlot("semantic_eye");

  const slot = controller.getState().selectedSemanticSlot;
  assert.equal(slot.morphReferences, null);
  assert.equal(slot.availableModes.morph, false);
  assert.throws(() => controller.setPartMode("morph"), /not valid/);

  controller.setPartMode("replace");
  const part = session.project.transitions[0].partTransitions[0];
  assert.equal(part.topologyId, null);
  assert.equal(part.fromKeyformId, null);
  assert.equal(part.toKeyformId, null);
  assert.deepEqual(session.history.at(-1).commandTypes, ["transition.set_part_mode"]);
});

test("invalid mode/state is rejected instead of silently repaired", () => {
  const { session } = fixture();
  assert.throws(() => session.execute({
    type: "transition.set_part_mode",
    payload: {
      transitionId: "transition_ab",
      partTransitionId: "part_invalid",
      semanticSlotId: "semantic_eye",
      mode: "appear",
      configuration: {},
    },
  }), TransactionError);
  assert.deepEqual(session.project.transitions[0].partTransitions, []);
});

test("Transition and owned TemporalProgram creation is one atomic Undo/Redo operation", () => {
  const { session, controller } = fixture();
  session.project.transitions = [];
  session.project.temporalPrograms = [];
  const result = controller.createTransitionWithProgram({
    transitionId: "transition_new",
    programId: "program_new",
    displayName: "New A → B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    durationTicks: 240000,
  });
  assert.equal(result.transitionId, "transition_new");
  assert.equal(session.project.transitions[0].temporalProgramId, "program_new");
  assert.equal(session.project.temporalPrograms[0].id, "program_new");
  assert.deepEqual(session.history.at(-1).commandTypes, [
    "animation.temporal.create_program",
    "transition.create",
  ]);
  session.undo();
  assert.deepEqual(session.project.transitions, []);
  assert.deepEqual(session.project.temporalPrograms, []);
  session.redo();
  assert.equal(session.project.transitions[0].id, "transition_new");
  assert.equal(session.project.transitions[0].temporalProgramId, "program_new");
  assert.equal(session.project.temporalPrograms[0].id, "program_new");
});

test("failed atomic creation rolls back both objects and shared ownership remains rejected", () => {
  const { session, controller } = fixture();
  const before = JSON.stringify(session.project);
  assert.throws(() => controller.createTransitionWithProgram({
    transitionId: "transition_invalid",
    programId: "program_invalid",
    displayName: "Invalid",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_a",
    durationTicks: 100,
  }), TransactionError);
  assert.equal(JSON.stringify(session.project), before);

  const invalid = structuredClone(session.project);
  invalid.transitions.push({
    ...structuredClone(invalid.transitions[0]),
    id: "transition_shared",
    displayName: "Shared",
    partTransitions: [],
  });
  assert.ok(validateProject(invalid).some((issue) =>
    issue.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT"));
});

test("authoring controller stays DOM-free and routes through headless Session APIs", async () => {
  const source = await readFile(
    new URL("../src/ui/transition-authoring-controller.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b/);
  assert.doesNotMatch(source, /session\.project/);
  assert.match(source, /session\.query\("transition\.list"\)/);
  assert.match(source, /session\.query\("transition\.get_authoring"/);
  assert.match(source, /session\.executeTransaction\(commands/);
  assert.equal(typeof createTransitionAuthoringView, "function");
});

test("authoring view consumes query projections without reading Project directly", async () => {
  const source = await readFile(
    new URL("../src/ui/transition-authoring-view.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /session\.project/);
  const { session, controller } = fixture({ withPart: true });
  controller.selectTransition("transition_ab");
  const headless = new HeadlessProductAdapter(session);
  assert.ok(headless.capabilities().queries["transition.get_authoring"]);
  const authoring = headless.query("transition.get_authoring", {
    transitionId: "transition_ab",
  });
  assert.equal(authoring.endpoints.from.keyArt.members[0].node.displayName, "Eye A");
  assert.equal(authoring.semanticSlots[0].morphReferences.topologyId, "topology_eye");
});

test("Transition authoring runtime modules remain in the production allowlist", async () => {
  const allowlist = await readFile(
    new URL("../production-files.txt", import.meta.url),
    "utf8",
  );
  assert.match(allowlist, /^src\/ui\/transition-authoring-controller\.js$/m);
  assert.match(allowlist, /^src\/ui\/transition-authoring-view\.js$/m);
});
