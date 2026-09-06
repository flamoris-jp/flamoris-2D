import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";
import {
  deserializeProject,
  migrateProjectSchema,
  serializeProject,
} from "../src/io/project-json.js";
import {
  createIdFactory,
  createProject,
  createSceneNode,
  PROJECT_SCHEMA_VERSION,
} from "../src/model/project.js";
import {
  clippingValidationResult,
  validateClippingBindings,
} from "../src/model/clipping-validation.js";
import { validateProject } from "../src/model/validation.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function domainProject() {
  return createProject({
    name: "Clipping",
    width: 128,
    height: 128,
    idFactory: createIdFactory("clipping"),
  });
}

function addNode(project, id, kind = "part") {
  project.scene.nodes[id] = createSceneNode({
    id,
    kind,
    displayName: id,
    parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push(id);
}

function binding(id, targetNodeId, sourceNodeId, enabled = true) {
  return { id, targetNodeId, sourceNodeId, mode: "inside", enabled };
}

function clippingTrack(trackId, target, sourceNodeId) {
  return {
    trackId,
    version: 1,
    kind: "ClippingTrack",
    target,
    channels: {
      clipping: {
        keyframes: [{
          id: trackId + "_key",
          timeTicks: 0,
          value: { sourceNodeId },
          interpolationToNext: { kind: "step" },
        }],
      },
    },
  };
}

function issueCodes(project) {
  return validateClippingBindings(project).map((entry) => entry.code);
}

function member(nodeId, appearanceId, drawOrder) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder,
    clipping: { sourceNodeId: null },
  };
}

function evaluationProject() {
  const project = domainProject();
  for (const id of ["mask", "mask_alt", "target"]) addNode(project, id);
  const members = [
    member("mask", "appearance_mask", 0),
    member("mask_alt", "appearance_mask_alt", 1),
    member("target", "appearance_target", 2),
  ];
  project.keyArts.push(
    {
      id: "keyart_a",
      displayName: "A",
      rootNodeId: project.scene.rootId,
      sourceAssetId: null,
      members: structuredClone(members),
      metadata: {},
    },
    {
      id: "keyart_b",
      displayName: "B",
      rootNodeId: project.scene.rootId,
      sourceAssetId: null,
      members: structuredClone(members),
      metadata: {},
    },
  );
  const slots = [
    ["slot_mask", "mask"],
    ["slot_mask_alt", "mask_alt"],
    ["slot_target", "target"],
  ];
  for (const [slotId, nodeId] of slots) {
    project.semanticSlots.push({
      id: slotId,
      displayName: slotId,
      role: null,
      mappings: [
        { keyArtId: "keyart_a", nodeId },
        { keyArtId: "keyart_b", nodeId },
      ],
      metadata: {},
    });
  }
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
    partTransitions: slots.map(([slotId]) => ({
      id: "part_" + slotId,
      semanticSlotId: slotId,
      mode: "hold",
      topologyId: null,
      fromKeyformId: null,
      toKeyformId: null,
      configuration: {},
    })),
    diagnosticOverrides: [],
  });
  project.clippingBindings.push(binding("clip_target", "target", "mask"));
  assert.deepEqual(validateProject(project), []);
  return project;
}

test("valid clipping binding allows one source to clip multiple targets", () => {
  const project = domainProject();
  for (const id of ["source", "target_a", "target_b"]) addNode(project, id);
  project.clippingBindings.push(
    binding("clip_a", "target_a", "source"),
    binding("clip_b", "target_b", "source"),
  );
  assert.deepEqual(validateClippingBindings(project), []);
  assert.deepEqual(new EditorSession(project).query("clipping.list").map((entry) => entry.id), [
    "clip_a",
    "clip_b",
  ]);
});

test("missing source and missing target use reason-specific diagnostics", () => {
  const missingSource = domainProject();
  addNode(missingSource, "target");
  missingSource.clippingBindings.push(binding("clip", "target", "missing"));
  assert.deepEqual(issueCodes(missingSource), ["CLIPPING_SOURCE_MISSING"]);

  const missingTarget = domainProject();
  addNode(missingTarget, "source");
  missingTarget.clippingBindings.push(binding("clip", "missing", "source"));
  assert.deepEqual(issueCodes(missingTarget), ["CLIPPING_TARGET_MISSING"]);
});

test("clipping-specific validation reports duplicate stable binding IDs", () => {
  const project = domainProject();
  for (const id of ["source", "target_a", "target_b"]) addNode(project, id);
  project.clippingBindings.push(
    binding("duplicate", "target_a", "source"),
    binding("duplicate", "target_b", "source"),
  );
  assert.equal(clippingValidationResult(project).issues.some((entry) =>
    entry.code === "identity.duplicate" && entry.entityId === "duplicate"), true);
});

test("source and target must be distinct renderable part nodes", () => {
  const project = domainProject();
  addNode(project, "part");
  addNode(project, "group", "group");
  project.clippingBindings.push(
    binding("self", "part", "part"),
    binding("source_group", "part", "group"),
    binding("target_group", "group", "part"),
  );
  assert.deepEqual(new Set(issueCodes(project)), new Set([
    "CLIPPING_SELF_REFERENCE",
    "CLIPPING_SOURCE_NOT_RENDERABLE",
    "CLIPPING_TARGET_NOT_RENDERABLE",
    "CLIPPING_TARGET_ALREADY_BOUND",
  ]));
});

test("simple and multi-node clipping cycles are rejected", () => {
  const simple = domainProject();
  for (const id of ["a", "b"]) addNode(simple, id);
  simple.clippingBindings.push(binding("a_to_b", "a", "b"), binding("b_to_a", "b", "a"));
  assert.equal(issueCodes(simple).filter((code) => code === "CLIPPING_CYCLE").length, 1);

  const multi = domainProject();
  for (const id of ["a", "b", "c"]) addNode(multi, id);
  multi.clippingBindings.push(
    binding("a_to_b", "a", "b"),
    binding("b_to_c", "b", "c"),
    binding("c_to_a", "c", "a"),
  );
  const cycle = validateClippingBindings(multi).find((entry) => entry.code === "CLIPPING_CYCLE");
  assert.deepEqual(cycle.details.nodeIds, ["a", "b", "c"]);
});

test("commands replace one target source and preserve Undo Redo", () => {
  const project = domainProject();
  for (const id of ["source_a", "source_b", "target"]) addNode(project, id);
  const session = new EditorSession(project);
  session.execute({
    type: "clipping.create",
    payload: { binding: binding("clip", "target", "source_a") },
  });
  session.execute({
    type: "clipping.set_source",
    payload: { bindingId: "clip", sourceNodeId: "source_b" },
  });
  session.execute({
    type: "clipping.set_enabled",
    payload: { bindingId: "clip", enabled: false },
  });
  assert.deepEqual(session.query("clipping.get_for_node", { nodeId: "target" }),
    binding("clip", "target", "source_b", false));
  session.undo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).enabled, true);
  session.undo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }).sourceNodeId, "source_a");
  session.redo();
  session.redo();
  assert.deepEqual(session.query("clipping.get_for_node", { nodeId: "target" }),
    binding("clip", "target", "source_b", false));
  session.execute({ type: "clipping.remove", payload: { bindingId: "clip" } });
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }), null);
  session.undo();
  assert.deepEqual(session.query("clipping.get_for_node", { nodeId: "target" }),
    binding("clip", "target", "source_b", false));
  session.redo();
  assert.equal(session.query("clipping.get_for_node", { nodeId: "target" }), null);
});

test("transaction rollback leaves no partial clipping cycle", () => {
  const project = domainProject();
  for (const id of ["a", "b"]) addNode(project, id);
  const session = new EditorSession(project);
  const before = structuredClone(session.project);
  assert.throws(() => session.executeTransaction([
    { type: "clipping.create", payload: { binding: binding("a_to_b", "a", "b") } },
    { type: "clipping.create", payload: { binding: binding("b_to_a", "b", "a") } },
  ]), TransactionError);
  assert.deepEqual(session.project, before);
  assert.deepEqual(session.query("clipping.list"), []);
});

test("ClippingTrack cycle is rejected and rolls back its transaction", () => {
  const session = new EditorSession(evaluationProject());
  const before = structuredClone(session.project);
  const track = clippingTrack(
    "track_cycle",
    { semanticSlotId: "slot_mask" },
    "mask_alt",
  );
  track.channels.clipping.keyframes.push({
    id: "track_cycle_key_cycle",
    timeTicks: 60000,
    value: { sourceNodeId: "target" },
    interpolationToNext: { kind: "step" },
  });
  assert.throws(() => session.execute({
    type: "animation.temporal.add_track",
    payload: {
      programId: "program_ab",
      track,
    },
  }), (error) => {
    assert.equal(error instanceof TransactionError, true);
    assert.equal(error.issues.some((entry) => entry.code === "CLIPPING_CYCLE"), true);
    return true;
  });
  assert.deepEqual(session.project, before);
});

test("KeyArt clipping cycle is rejected before persistent commit", () => {
  const session = new EditorSession(evaluationProject());
  const before = structuredClone(session.project);
  const keyArt = structuredClone(session.project.keyArts[0]);
  keyArt.members.find((entry) => entry.nodeId === "mask").clipping = {
    sourceNodeId: "target",
  };
  assert.throws(() => session.execute({
    type: "keyart.update",
    payload: { keyArtId: keyArt.id, keyArt },
  }), (error) => {
    assert.equal(error instanceof TransactionError, true);
    assert.equal(error.issues.some((entry) => entry.code === "CLIPPING_CYCLE"), true);
    return true;
  });
  assert.deepEqual(session.project, before);
});

test("Save Open preserves clipping stable IDs and canonical collection order", () => {
  const project = domainProject();
  for (const id of ["source", "target_a", "target_b"]) addNode(project, id);
  project.clippingBindings.push(
    binding("clip_z", "target_b", "source"),
    binding("clip_a", "target_a", "source"),
  );
  const now = () => new Date("2026-09-06T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(opened.clippingBindings.map((entry) => entry.id), ["clip_a", "clip_z"]);
  assert.equal(serializeProject(opened, 2, { now }), serialized);
});

test("pre-Phase-6 schema migrates deterministically to an empty clipping collection", () => {
  const legacy = domainProject();
  legacy.schemaVersion = 4;
  delete legacy.clippingBindings;
  const migrated = migrateProjectSchema(legacy);
  assert.equal(migrated.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.deepEqual(migrated.clippingBindings, []);
  assert.deepEqual(validateProject(migrated), []);
});

test("evaluation projects a binding to a resolved render-instance relationship", () => {
  const evaluated = evaluateTransition(evaluationProject(), "transition_ab", 60000);
  const source = evaluated.evaluatedParts.find((part) => part.semanticSlotId === "slot_mask")
    .renderInstances[0];
  const target = evaluated.evaluatedParts.find((part) => part.semanticSlotId === "slot_target")
    .renderInstances[0];
  assert.deepEqual(target.clipping, {
    sourceRenderInstanceId: source.renderInstanceId,
    mode: "inside",
  });
  assert.equal(Object.hasOwn(target.clipping, "sourceNodeId"), false);
});

test("existing ClippingTrack remains discrete and step-switches resolved source identity", () => {
  const project = evaluationProject();
  project.temporalPrograms[0].tracks.push({
    trackId: "track_clipping",
    version: 1,
    kind: "ClippingTrack",
    target: { semanticSlotId: "slot_target" },
    channels: {
      clipping: {
        keyframes: [
          {
            id: "clip_key_a",
            timeTicks: 0,
            value: { sourceNodeId: "mask" },
            interpolationToNext: { kind: "step" },
          },
          {
            id: "clip_key_b",
            timeTicks: 60000,
            value: { sourceNodeId: "mask_alt" },
            interpolationToNext: { kind: "step" },
          },
        ],
      },
    },
  });
  assert.deepEqual(validateProject(project), []);
  const before = evaluateTransition(project, "transition_ab", 59999);
  const after = evaluateTransition(project, "transition_ab", 60000);
  const target = (evaluation) => evaluation.evaluatedParts
    .find((part) => part.semanticSlotId === "slot_target").renderInstances[0];
  assert.equal(target(before).clipping.sourceRenderInstanceId, "transition_ab:slot_mask:hold");
  assert.equal(target(after).clipping.sourceRenderInstanceId, "transition_ab:slot_mask_alt:hold");
});

test("disabled binding suppresses its static and tracked clipping relationship", () => {
  const project = evaluationProject();
  project.clippingBindings[0].enabled = false;
  project.temporalPrograms[0].tracks.push({
    trackId: "track_clipping",
    version: 1,
    kind: "ClippingTrack",
    target: { semanticSlotId: "slot_target" },
    channels: {
      clipping: {
        keyframes: [{
          id: "clip_key",
          timeTicks: 0,
          value: { sourceNodeId: "mask_alt" },
          interpolationToNext: { kind: "step" },
        }],
      },
    },
  });
  const evaluated = evaluateTransition(project, "transition_ab", 60000);
  const target = evaluated.evaluatedParts.find((part) =>
    part.semanticSlotId === "slot_target").renderInstances[0];
  assert.equal(target.clipping, null);
});

test("Morph also suppresses ClippingTrack when its binding is disabled", () => {
  const project = evaluationProject();
  project.clippingBindings[0].enabled = false;
  project.meshTopologies.push({
    id: "topology_target",
    vertexIds: ["vtx_target_1", "vtx_target_2", "vtx_target_3"],
    indices: [0, 1, 2],
  });
  project.meshKeyforms.push(
    {
      id: "keyform_target_a",
      topologyId: "topology_target",
      keyArtId: "keyart_a",
      semanticSlotId: "slot_target",
      positions: [0, 0, 10, 0, 0, 10],
      uvs: [0, 0, 1, 0, 0, 1],
    },
    {
      id: "keyform_target_b",
      topologyId: "topology_target",
      keyArtId: "keyart_b",
      semanticSlotId: "slot_target",
      positions: [1, 1, 11, 1, 1, 11],
      uvs: [0, 0, 1, 0, 0, 1],
    },
  );
  const part = project.transitions[0].partTransitions.find((entry) =>
    entry.semanticSlotId === "slot_target");
  Object.assign(part, {
    mode: "morph",
    topologyId: "topology_target",
    fromKeyformId: "keyform_target_a",
    toKeyformId: "keyform_target_b",
  });
  project.temporalPrograms[0].tracks.push(
    clippingTrack("track_clipping", { semanticSlotId: "slot_target" }, "mask_alt"),
  );
  assert.deepEqual(validateProject(project), []);
  const evaluated = evaluateTransition(project, "transition_ab", 60000);
  const target = evaluated.evaluatedParts.find((entry) =>
    entry.semanticSlotId === "slot_target").renderInstances[0];
  assert.equal(target.clipping, null);
});

test("clipping validation, queries, and evaluation ignore map and collection insertion order", () => {
  const left = evaluationProject();
  const right = structuredClone(left);
  right.scene.nodes = Object.fromEntries(Object.entries(right.scene.nodes).reverse());
  right.clippingBindings.reverse();
  assert.deepEqual(clippingValidationResult(right), clippingValidationResult(left));
  assert.deepEqual(
    new EditorSession(right).query("clipping.list"),
    new EditorSession(left).query("clipping.list"),
  );
  assert.deepEqual(
    evaluateTransition(right, "transition_ab", 60000),
    evaluateTransition(left, "transition_ab", 60000),
  );
});

test("headless adapter exposes the same typed clipping command and query boundary", () => {
  const project = domainProject();
  for (const id of ["source", "target"]) addNode(project, id);
  const adapter = new HeadlessProductAdapter(new EditorSession(project));
  assert.ok(adapter.capabilities().commands["clipping.create"]);
  assert.ok(adapter.capabilities().queries["clipping.validate"]);
  adapter.execute({
    type: "clipping.create",
    payload: { binding: binding("clip", "target", "source") },
  });
  assert.deepEqual(adapter.query("clipping.get_for_node", { nodeId: "target" }),
    binding("clip", "target", "source"));
});
