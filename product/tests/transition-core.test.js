import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdFactory,
  createProject,
  createSceneNode,
  PROJECT_SCHEMA_VERSION,
} from "../src/model/project.js";
import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { evaluateTransition, getTransitionDiagnostics } from "../src/core/transition-evaluator.js";
import {
  mixWeightedPremultiplied,
  prepareEvaluatedTransition,
} from "../src/renderer.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { validateProject } from "../src/model/validation.js";

const step = { kind: "step" };
const linear = { kind: "linear" };

function keyframe(id, timeTicks, value, interpolationToNext = linear) {
  return { id, timeTicks, value, interpolationToNext };
}

function member(nodeId, appearanceId, drawOrder = 0, overrides = {}) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder,
    clipping: { sourceNodeId: null },
    ...overrides,
  };
}

function transitionFixture({ mode = "morph", mapping = "both", inverted = false } = {}) {
  const project = createProject({
    name: "Transition",
    width: 100,
    height: 100,
    idFactory: createIdFactory("phase2b"),
  });
  const fromNodeId = "node_eye_from";
  const toNodeId = "node_eye_to";
  project.scene.nodes[fromNodeId] = createSceneNode({
    id: fromNodeId,
    displayName: "eye_left",
    parentId: project.scene.rootId,
    bounds: { left: 0, top: 0, right: 10, bottom: 10 },
  });
  project.scene.nodes[toNodeId] = createSceneNode({
    id: toNodeId,
    displayName: "左目・虹彩",
    parentId: project.scene.rootId,
    bounds: { left: 10, top: 10, right: 30, bottom: 30 },
  });
  project.scene.nodes[project.scene.rootId].children.push(fromNodeId, toNodeId);
  const fromMembers = mapping === "to" ? [] : [member(fromNodeId, "appearance_eye_a", 2, { opacity: 0.8 })];
  const toMembers = mapping === "from" ? [] : [member(toNodeId, "appearance_eye_b", 7, { opacity: 0.6 })];
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: fromMembers, metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: toMembers, metadata: {} },
  );
  const mappings = [];
  if (mapping !== "to") mappings.push({ keyArtId: "keyart_a", nodeId: fromNodeId });
  if (mapping !== "from") mappings.push({ keyArtId: "keyart_b", nodeId: toNodeId });
  project.semanticSlots.push({
    id: "semantic.eye.left",
    displayName: "Left eye",
    role: "eye",
    mappings,
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology_eye",
    vertexIds: ["vertex_1", "vertex_2", "vertex_3"],
    indices: [0, 1, 2],
  });
  if (mapping !== "to") {
    project.meshKeyforms.push({
      id: "keyform_eye_a",
      topologyId: "topology_eye",
      keyArtId: "keyart_a",
      semanticSlotId: "semantic.eye.left",
      positions: [0, 0, 10, 0, 0, 10],
      uvs: [0, 0, 1, 0, 0, 1],
    });
  }
  if (mapping !== "from") {
    project.meshKeyforms.push({
      id: "keyform_eye_b",
      topologyId: "topology_eye",
      keyArtId: "keyart_b",
      semanticSlotId: "semantic.eye.left",
      positions: inverted ? [5, 5, 5, 25, 25, 5] : [5, 5, 25, 5, 5, 25],
      uvs: [0.1, 0.2, 0.9, 0.2, 0.1, 0.8],
    });
  }
  project.temporalPrograms.push({
    id: "program_eye",
    durationTicks: 100,
    tracks: [],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition_eye",
    displayName: "A to B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program_eye",
    partTransitions: [{
      id: "part_transition_eye",
      semanticSlotId: "semantic.eye.left",
      mode,
      topologyId: mode === "morph" ? "topology_eye" : null,
      fromKeyformId: mapping === "to" ? null : "keyform_eye_a",
      toKeyformId: mapping === "from" ? null : "keyform_eye_b",
      configuration: {},
    }],
    diagnosticOverrides: [],
  });
  return { project, fromNodeId, toNodeId };
}

function addSecondSlot(project, { fromOrder = 11, toOrder = 13 } = {}) {
  const fromNodeId = "node_hair_from";
  const toNodeId = "node_hair_to";
  project.scene.nodes[fromNodeId] = createSceneNode({
    id: fromNodeId,
    displayName: "hair-front",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[toNodeId] = createSceneNode({
    id: toNodeId,
    displayName: "前髪",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push(fromNodeId, toNodeId);
  project.keyArts.find((entry) => entry.id === "keyart_a").members.push(member(fromNodeId, "appearance_hair_a", fromOrder));
  project.keyArts.find((entry) => entry.id === "keyart_b").members.push(member(toNodeId, "appearance_hair_b", toOrder));
  project.semanticSlots.push({
    id: "semantic.hair.front",
    displayName: "Front hair",
    mappings: [
      { keyArtId: "keyart_a", nodeId: fromNodeId },
      { keyArtId: "keyart_b", nodeId: toNodeId },
    ],
    metadata: {},
  });
  project.transitions[0].partTransitions.push({
    id: "part_transition_hair",
    semanticSlotId: "semantic.hair.front",
    mode: "replace",
    topologyId: null,
    fromKeyformId: null,
    toKeyformId: null,
    configuration: { compositeGroupId: "composite_hair" },
  });
}

test("Key Arts save and load with stable endpoint members", () => {
  const { project } = transitionFixture();
  const reloaded = deserializeProject(serializeProject(project));
  assert.deepEqual(reloaded.keyArts, project.keyArts);
});

test("differently named nodes correspond only through SemanticSlot", () => {
  const { project, fromNodeId, toNodeId } = transitionFixture();
  const slot = project.semanticSlots[0];
  assert.notEqual(project.scene.nodes[fromNodeId].displayName, project.scene.nodes[toNodeId].displayName);
  assert.deepEqual(slot.mappings.map((entry) => entry.nodeId).sort(), [fromNodeId, toNodeId].sort());
  assert.equal(evaluateTransition(project, "transition_eye", 50).evaluatedParts[0].semanticSlotId, slot.id);
});

test("duplicate semantic mapping is rejected", () => {
  const { project, fromNodeId } = transitionFixture();
  project.semanticSlots.push({
    id: "semantic.duplicate",
    displayName: "Duplicate",
    mappings: [{ keyArtId: "keyart_a", nodeId: fromNodeId }],
    metadata: {},
  });
  assert.ok(validateProject(project).some((entry) => entry.code === "SEMANTIC_MAPPING_DUPLICATE"));
});

test("Transition owns one TemporalProgram and derives duration from it", () => {
  const { project } = transitionFixture();
  const session = new EditorSession(project);
  assert.equal(session.query("transition.get", { transitionId: "transition_eye" }).durationTicks, 100);
  assert.equal(Object.hasOwn(session.project.transitions[0], "durationTicks"), false);
});

test("shared TemporalProgram ownership is rejected", () => {
  const { project } = transitionFixture();
  project.transitions.push({
    ...structuredClone(project.transitions[0]),
    id: "transition_shared",
    displayName: "Shared",
    partTransitions: [],
  });
  assert.throws(() => new EditorSession(project), (error) =>
    error instanceof TransactionError && error.issues.some((entry) => entry.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT"));
});

test("Morph interpolates shared topology and differing positions", () => {
  const { project } = transitionFixture();
  const part = evaluateTransition(project, "transition_eye", 50).evaluatedParts[0];
  assert.deepEqual(part.renderInstances[0].mesh.indices, [0, 1, 2]);
  assert.deepEqual(part.renderInstances[0].mesh.positions, [2.5, 2.5, 17.5, 2.5, 2.5, 17.5]);
});

test("Morph keeps differing endpoint UVs in weighted appearance samples", () => {
  const { project } = transitionFixture();
  const samples = evaluateTransition(project, "transition_eye", 50)
    .evaluatedParts[0].renderInstances[0].appearanceSamples;
  assert.deepEqual(samples.map((entry) => entry.uvs), [
    [0, 0, 1, 0, 0, 1],
    [0.1, 0.2, 0.9, 0.2, 0.1, 0.8],
  ]);
});

test("geometry and appearance timing evaluate independently", () => {
  const { project } = transitionFixture();
  project.temporalPrograms[0].tracks.push(
    {
      trackId: "track_geometry",
      version: 1,
      kind: "GeometryBlendTrack",
      target: { transitionDefault: true },
      channels: { geometryWeight: { keyframes: [
        keyframe("geometry_a", 0, 0),
        keyframe("geometry_b", 100, 0.5, step),
      ] } },
    },
    {
      trackId: "track_appearance",
      version: 1,
      kind: "AppearanceTrack",
      target: { semanticSlotId: "semantic.eye.left" },
      channels: { appearance: { keyframes: [
        keyframe("appearance_a", 0, { appearance_eye_a: 1, appearance_eye_b: 0 }),
        keyframe("appearance_mid", 50, { appearance_eye_a: 0.25, appearance_eye_b: 0.75 }, step),
      ] } },
    },
  );
  const render = evaluateTransition(project, "transition_eye", 50).evaluatedParts[0].renderInstances[0];
  assert.deepEqual(render.mesh.positions, [1.25, 1.25, 13.75, 1.25, 1.25, 13.75]);
  assert.deepEqual(render.appearanceSamples.map((entry) => entry.weight), [0.25, 0.75]);
});

test("dual appearance evaluation is normalized and weighted-premultiplied", () => {
  const mixed = mixWeightedPremultiplied([
    { color: [1, 0, 0], alpha: 1, weight: 1 },
    { color: [0, 0, 1], alpha: 0.5, weight: 1 },
  ]);
  assert.deepEqual(mixed, { premultipliedColor: [0.5, 0, 0.25], alpha: 0.75 });
});

test("Hold preserves the source state before the target endpoint", () => {
  const { project, fromNodeId } = transitionFixture({ mode: "hold" });
  const held = evaluateTransition(project, "transition_eye", 99).evaluatedParts[0];
  assert.equal(held.renderInstances[0].sourceNodeId, fromNodeId);
  assert.equal(held.renderInstances[0].opacity, 0.8);
});

test("Replace emits simultaneous independent render instances", () => {
  const { project } = transitionFixture({ mode: "replace" });
  project.transitions[0].partTransitions[0].configuration = { compositeGroupId: "composite_eye" };
  const result = evaluateTransition(project, "transition_eye", 50);
  assert.equal(result.evaluatedParts[0].renderInstances.length, 2);
  assert.equal(result.compositeGroups[0].members.length, 2);
  assert.equal(prepareEvaluatedTransition(result).length, 2);
});

test("Replace applies weighted-premultiplied composite weights exactly once", () => {
  const { project } = transitionFixture({ mode: "replace" });
  project.transitions[0].partTransitions[0].configuration = { compositeGroupId: "composite_eye" };
  const result = evaluateTransition(project, "transition_eye", 50);
  const instances = result.evaluatedParts[0].renderInstances;
  const weights = new Map(result.compositeGroups[0].members.map((entry) => [entry.renderInstanceId, entry.weight]));
  assert.deepEqual(instances.map((entry) => entry.opacity), [0.8, 0.6]);
  assert.deepEqual(mixWeightedPremultiplied(instances.map((entry, index) => ({
    color: index === 0 ? [1, 0, 0] : [0, 0, 1],
    alpha: entry.opacity,
    weight: weights.get(entry.renderInstanceId),
  }))), {
    premultipliedColor: [0.4, 0, 0.3],
    alpha: 0.7,
  });
});

test("Morph interpolates rotation semantically without a singular midpoint", () => {
  const { project, toNodeId } = transitionFixture();
  project.meshKeyforms[1].positions = [...project.meshKeyforms[0].positions];
  project.scene.nodes[toNodeId].transform.rotation = Math.PI;
  const transform = evaluateTransition(project, "transition_eye", 50)
    .evaluatedParts[0].renderInstances[0].transform;
  const determinant = transform[0] * transform[3] - transform[1] * transform[2];
  assert.ok(Math.abs(determinant - 1) < 1e-12);
  assert.ok(Math.abs(transform[0]) < 1e-12);
  assert.ok(Math.abs(transform[1] + 1) < 1e-12,
    "Transition endpoint interpolation keeps its existing +PI -> -PI tie direction");
});

test("Appear changes absent to present with rising opacity", () => {
  const { project } = transitionFixture({ mode: "appear", mapping: "to" });
  assert.equal(evaluateTransition(project, "transition_eye", 0).evaluatedParts[0].presence, "absent");
  const middle = evaluateTransition(project, "transition_eye", 50).evaluatedParts[0];
  assert.equal(middle.presence, "present");
  assert.equal(middle.renderInstances[0].opacity, 0.3);
});

test("Disappear changes present to absent after fading", () => {
  const { project } = transitionFixture({ mode: "disappear", mapping: "from" });
  assert.equal(evaluateTransition(project, "transition_eye", 50).evaluatedParts[0].renderInstances[0].opacity, 0.4);
  assert.equal(evaluateTransition(project, "transition_eye", 100).evaluatedParts[0].presence, "absent");
});

test("Occlusion remains semantically distinct from absent", () => {
  const { project } = transitionFixture({ mode: "occlusion" });
  const state = evaluateTransition(project, "transition_eye", 75).evaluatedParts[0];
  assert.equal(state.presence, "occluded");
  assert.deepEqual(state.renderInstances, []);
});

test("draw order is explicit and deterministic", () => {
  const { project } = transitionFixture();
  addSecondSlot(project);
  const result = evaluateTransition(project, "transition_eye", 50);
  const orders = result.evaluatedParts.flatMap((part) => part.renderInstances.map((entry) => entry.drawOrder));
  assert.deepEqual(orders, [7, 11, 13]);
});

test("draw-order conflicts fail validation", () => {
  const { project } = transitionFixture();
  addSecondSlot(project, { fromOrder: 2, toOrder: 7 });
  assert.ok(validateProject(project).some((entry) => entry.code === "TRANSITION_DRAW_ORDER_CONFLICT"));
});

test("missing PartTransition produces correspondence diagnostics", () => {
  const { project } = transitionFixture();
  project.transitions[0].partTransitions = [];
  const diagnostics = getTransitionDiagnostics(project, "transition_eye");
  assert.ok(diagnostics.some((entry) => entry.code === "TRANSITION_MISSING_CORRESPONDENCE"));
});

test("incompatible topology invalidates Morph", () => {
  const { project } = transitionFixture();
  project.meshTopologies.push({ id: "topology_other", vertexIds: ["a", "b", "c"], indices: [0, 1, 2] });
  project.meshKeyforms[1].topologyId = "topology_other";
  assert.ok(validateProject(project).some((entry) => entry.code === "TRANSITION_TOPOLOGY_INCOMPATIBLE"));
});

test("triangle inversion is a reason-specific derived diagnostic", () => {
  const { project } = transitionFixture({ inverted: true });
  assert.ok(getTransitionDiagnostics(project, "transition_eye").some((entry) => entry.code === "TRANSITION_TRIANGLE_INVERSION"));
});

test("endpoint A reproduces geometry appearance UV opacity presence and draw order", () => {
  const { project, fromNodeId } = transitionFixture();
  const state = evaluateTransition(project, "transition_eye", 0).evaluatedParts[0];
  assert.equal(state.presence, "present");
  assert.equal(state.renderInstances[0].sourceNodeId, fromNodeId);
  assert.equal(state.renderInstances[0].opacity, 0.8);
  assert.equal(state.renderInstances[0].drawOrder, 2);
  assert.deepEqual(state.renderInstances[0].mesh.positions, [0, 0, 10, 0, 0, 10]);
  assert.deepEqual(state.renderInstances[0].appearanceSamples[0], {
    appearanceId: "appearance_eye_a",
    sourceNodeId: fromNodeId,
    uvs: [0, 0, 1, 0, 0, 1],
    weight: 1,
  });
});

test("endpoint B reproduces geometry appearance UV opacity presence and draw order", () => {
  const { project, toNodeId } = transitionFixture();
  const state = evaluateTransition(project, "transition_eye", 100).evaluatedParts[0];
  assert.equal(state.presence, "present");
  assert.equal(state.renderInstances[0].sourceNodeId, toNodeId);
  assert.equal(state.renderInstances[0].opacity, 0.6);
  assert.equal(state.renderInstances[0].drawOrder, 7);
  assert.deepEqual(state.renderInstances[0].mesh.positions, [5, 5, 25, 5, 5, 25]);
  assert.deepEqual(state.renderInstances[0].appearanceSamples[0].uvs, [0.1, 0.2, 0.9, 0.2, 0.1, 0.8]);
});

test("arbitrary tick evaluation is repeatably deterministic", () => {
  const { project } = transitionFixture();
  assert.deepEqual(
    evaluateTransition(project, "transition_eye", 37),
    evaluateTransition(project, "transition_eye", 37),
  );
});

test("evaluation is independent from collection insertion order", () => {
  const { project } = transitionFixture();
  addSecondSlot(project);
  const reversed = structuredClone(project);
  for (const name of ["keyArts", "semanticSlots", "meshTopologies", "meshKeyforms", "transitions", "temporalPrograms"]) {
    reversed[name].reverse();
  }
  reversed.keyArts.forEach((keyArt) => keyArt.members.reverse());
  reversed.semanticSlots.forEach((slot) => slot.mappings.reverse());
  reversed.transitions.forEach((transition) => transition.partTransitions.reverse());
  assert.deepEqual(
    evaluateTransition(project, "transition_eye", 61),
    evaluateTransition(reversed, "transition_eye", 61),
  );
});

test("Transition updates are Undoable and Redoable", () => {
  const { project } = transitionFixture();
  const session = new EditorSession(project);
  session.execute({
    type: "transition.update",
    payload: {
      transitionId: "transition_eye",
      transition: { ...structuredClone(project.transitions[0]), displayName: "Updated" },
    },
  });
  assert.equal(session.project.transitions[0].displayName, "Updated");
  session.undo();
  assert.equal(session.project.transitions[0].displayName, "A to B");
  session.redo();
  assert.equal(session.project.transitions[0].displayName, "Updated");
});

test("Transition create and remove share normal Undo/Redo history", () => {
  const { project } = transitionFixture();
  const transition = structuredClone(project.transitions[0]);
  project.transitions = [];
  const session = new EditorSession(project);
  session.execute({ type: "transition.create", payload: { transition } });
  assert.equal(session.project.transitions.length, 1);
  session.undo();
  assert.equal(session.project.transitions.length, 0);
  session.redo();
  assert.equal(session.project.transitions.length, 1);
  session.execute({ type: "transition.remove", payload: { transitionId: transition.id } });
  assert.equal(session.project.transitions.length, 0);
  session.undo();
  assert.equal(session.project.transitions[0].id, transition.id);
});

test("persistent Transition schema rejects duplicate duration and convenience modes", () => {
  const { project } = transitionFixture();
  project.transitions[0].durationTicks = 100;
  project.transitions[0].partTransitions[0].mode = "swap";
  const codes = validateProject(project).map((entry) => entry.code);
  assert.ok(codes.includes("TRANSITION_INVALID"));
  assert.ok(codes.includes("TRANSITION_INVALID_MODE"));
});

test("semantic mapping transaction rolls back on duplicate mapping", () => {
  const { project, fromNodeId } = transitionFixture();
  const session = new EditorSession(project);
  assert.throws(() => session.executeTransaction([
    {
      type: "semantic_slot.create",
      payload: { semanticSlot: { id: "semantic.new", displayName: "New", mappings: [], metadata: {} } },
    },
    {
      type: "semantic_slot.map_node",
      payload: { semanticSlotId: "semantic.new", keyArtId: "keyart_a", nodeId: fromNodeId },
    },
  ]));
  assert.equal(session.project.semanticSlots.some((entry) => entry.id === "semantic.new"), false);
});

test("Transition plus TemporalProgram creation rolls back atomically", () => {
  const { project } = transitionFixture();
  project.transitions = [];
  project.temporalPrograms = [];
  const session = new EditorSession(project);
  assert.throws(() => session.executeTransaction([
    {
      type: "animation.temporal.create_program",
      payload: { programId: "program_invalid", durationTicks: 100 },
    },
    {
      type: "transition.create",
      payload: { transition: {
        id: "transition_invalid",
        displayName: "Invalid",
        fromKeyArtId: "keyart_a",
        toKeyArtId: "keyart_a",
        temporalProgramId: "program_invalid",
        partTransitions: [],
        diagnosticOverrides: [],
      } },
    },
  ]), TransactionError);
  assert.deepEqual(session.project.temporalPrograms, []);
  assert.deepEqual(session.project.transitions, []);
});

test("save and load preserve equivalent Transition evaluation", () => {
  const { project } = transitionFixture();
  const before = evaluateTransition(project, "transition_eye", 43);
  const after = evaluateTransition(deserializeProject(serializeProject(project)), "transition_eye", 43);
  assert.deepEqual(after, before);
});

test("Phase 2A schema migrates with unchanged TemporalPrograms and empty Phase 2B mesh domains", () => {
  const project = createProject({ name: "2A", width: 10, height: 10, idFactory: createIdFactory("migration2a") });
  project.temporalPrograms.push({ id: "program_orphan", durationTicks: 12, tracks: [], events: [], regions: [] });
  project.schemaVersion = 2;
  delete project.meshTopologies;
  delete project.meshKeyforms;
  const migrated = deserializeProject(JSON.stringify(project));
  assert.equal(migrated.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.deepEqual(migrated.temporalPrograms, project.temporalPrograms);
  assert.deepEqual(migrated.meshTopologies, []);
  assert.deepEqual(migrated.meshKeyforms, []);
});

test("headless transition.evaluate uses the same DOM-free evaluator", () => {
  const { project } = transitionFixture();
  const adapter = new HeadlessProductAdapter(new EditorSession(project));
  const result = adapter.query("transition.evaluate", { transitionId: "transition_eye", timeTicks: 50 });
  assert.deepEqual(result, evaluateTransition(project, "transition_eye", 50));
  assert.ok(adapter.capabilities().queries["transition.evaluate"]);
  assert.ok(adapter.capabilities().commands["transition.set_part_mode"]);
});

test("specific SemanticSlot tracks override transition-default tracks", () => {
  const { project } = transitionFixture();
  project.temporalPrograms[0].tracks.push(
    {
      trackId: "opacity_default",
      version: 1,
      kind: "OpacityTrack",
      target: { transitionDefault: true },
      channels: { opacity: { keyframes: [keyframe("opacity_default_key", 0, 0.1, step)] } },
    },
    {
      trackId: "opacity_specific",
      version: 1,
      kind: "OpacityTrack",
      target: { semanticSlotId: "semantic.eye.left" },
      channels: { opacity: { keyframes: [keyframe("opacity_specific_key", 0, 0.7, step)] } },
    },
  );
  assert.equal(evaluateTransition(project, "transition_eye", 50).evaluatedParts[0].renderInstances[0].opacity, 0.7);
});

test("diagnostic overrides acknowledge only matching derived evidence", () => {
  const { project } = transitionFixture({ inverted: true });
  const inversion = getTransitionDiagnostics(project, "transition_eye")
    .find((entry) => entry.code === "TRANSITION_TRIANGLE_INVERSION");
  project.transitions[0].diagnosticOverrides.push({
    key: inversion.key,
    code: inversion.code,
    semanticSlotId: inversion.semanticSlotId,
    evidenceFingerprint: inversion.evidenceFingerprint,
  });
  assert.equal(getTransitionDiagnostics(project, "transition_eye")
    .find((entry) => entry.code === "TRANSITION_TRIANGLE_INVERSION").acknowledged, true);
});
