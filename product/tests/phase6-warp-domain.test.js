import test from "node:test";
import assert from "node:assert/strict";

import {
  createRegularWarpControlPoints,
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";
import {
  createIdFactory,
  createProject,
  createSceneNode,
  PROJECT_SCHEMA_VERSION,
} from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import {
  deserializeProject,
  migrateProjectSchema,
  serializeProject,
} from "../src/io/project-json.js";
import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import {
  createWarpEvaluationStages,
  evaluateWarpPoint,
  evaluateWarpPoints,
  evaluateWarpStageLattice,
  evaluateWarpStages,
  warpDeformerAncestors,
} from "../src/core/warp-deformer-evaluator.js";

function pointIds(count) {
  return Array.from({ length: count }, (_, index) => `cp_${index + 1}`);
}

function domainProject() {
  return createProject({
    name: "Warp",
    width: 320,
    height: 240,
    idFactory: createIdFactory("warp"),
  });
}

function addWarp(project, {
  id = "warp",
  parentNodeId = project.scene.rootId,
  size = 2,
  bounds = { left: 0, top: 0, right: 100, bottom: 100 },
  ids = pointIds(size * size).map((pointId) => `${id}_${pointId}`),
} = {}) {
  const created = createWarpDeformer({
    id,
    displayName: id,
    parentNodeId,
    columns: size,
    rows: size,
    bounds,
    controlPointIds: ids,
  });
  project.scene.nodes[id] = createSceneNode({
    id,
    kind: "deformer",
    displayName: id,
    parentId: parentNodeId,
  });
  project.scene.nodes[parentNodeId].children.push(id);
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  return created;
}

function addKeyArt(project, id = "key_art") {
  project.keyArts.push({
    id,
    displayName: id,
    rootNodeId: project.scene.rootId,
    sourceAssetId: null,
    members: [],
    metadata: {},
  });
}

function issueCodes(project) {
  return validateProject(project).map((entry) => entry.code);
}

function createWarpCommand({
  id = "warp",
  parentNodeId,
  size = 2,
  ids = pointIds(size * size).map((pointId) => `${id}_${pointId}`),
} = {}) {
  return {
    type: "deformer.create_warp",
    payload: {
      id,
      displayName: id,
      parentNodeId,
      columns: size,
      rows: size,
      bounds: { left: 0, top: 0, right: 100, bottom: 100 },
      controlPointIds: ids,
    },
  };
}

function evaluationStage(created, updates = {}) {
  const controlPoints = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints)
    .map((point) => ({ ...point, ...(updates[point.controlPointId] || {}) }));
  return {
    deformer: created.deformer,
    controlPoints: created.controlPoints,
    keyform: { deformerId: created.deformer.id, keyArtId: "key_art", controlPoints },
  };
}

for (const size of [2, 3, 4]) {
  test(`creates a deterministic ${size}x${size} WarpDeformer topology`, () => {
    const ids = pointIds(size * size);
    const { deformer, controlPoints } = createWarpDeformer({
      id: "warp",
      displayName: "Head Warp",
      parentNodeId: "root",
      columns: size,
      rows: size,
      bounds: { left: 10, top: 20, right: 110, bottom: 220 },
      controlPointIds: ids,
    });

    assert.deepEqual(deformer.controlPointIds, ids);
    assert.deepEqual(controlPoints.map(({ id, u, v }) => ({ id, u, v })),
      ids.map((id, index) => ({
        id,
        u: (index % size) / (size - 1),
        v: Math.floor(index / size) / (size - 1),
      })));
    assert.deepEqual(defaultWarpKeyformControlPoints(deformer, controlPoints),
      controlPoints.map((point) => ({
        controlPointId: point.id,
        x: 10 + point.u * 100,
        y: 20 + point.v * 200,
      })));
  });
}

test("regular topology identity is explicit rather than inferred from coordinates", () => {
  const first = createRegularWarpControlPoints({
    deformerId: "warp",
    columns: 2,
    rows: 2,
    controlPointIds: ["northwest", "northeast", "southwest", "southeast"],
  });
  const second = createRegularWarpControlPoints({
    deformerId: "warp",
    columns: 2,
    rows: 2,
    controlPointIds: ["a", "b", "c", "d"],
  });

  assert.deepEqual(first.map(({ u, v }) => ({ u, v })), second.map(({ u, v }) => ({ u, v })));
  assert.notDeepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
});

test("regular topology rejects unsupported grid dimensions and missing stable IDs", () => {
  assert.throws(() => createRegularWarpControlPoints({
    deformerId: "warp", columns: 5, rows: 2, controlPointIds: pointIds(10),
  }), /2x2, 3x3, or 4x4/);
  assert.throws(() => createRegularWarpControlPoints({
    deformerId: "warp", columns: 2, rows: 3, controlPointIds: pointIds(6),
  }), /2x2, 3x3, or 4x4/);
  assert.throws(() => createRegularWarpControlPoints({
    deformerId: "warp", columns: 2, rows: 2, controlPointIds: pointIds(3),
  }), /one stable ID per control point/);
});

test("persistent WarpDeformer validates with its canonical Scene identity", () => {
  const project = domainProject();
  const created = addWarp(project, { size: 3 });
  addKeyArt(project);
  project.rig.warpDeformerKeyforms.push({
    deformerId: created.deformer.id,
    keyArtId: "key_art",
    controlPoints: defaultWarpKeyformControlPoints(created.deformer, created.controlPoints),
  });
  assert.deepEqual(validateProject(project), []);
});

test("deformer validation rejects invalid bounds, dimensions, duplicate and missing points", () => {
  const project = domainProject();
  addWarp(project);
  project.rig.deformers[0].columns = 5;
  project.rig.deformers[0].bounds.right = Number.NaN;
  project.rig.deformers[0].controlPointIds = ["warp_cp_1", "warp_cp_1"];
  assert.ok(issueCodes(project).filter((code) => code === "DEFORMER_CONTROL_POINT_INVALID").length >= 3);
});

test("deformer validation rejects a missing parent and hierarchy cycles", () => {
  const missing = domainProject();
  addWarp(missing);
  missing.rig.deformers[0].parentNodeId = "missing";
  assert.ok(issueCodes(missing).includes("DEFORMER_PARENT_MISSING"));

  const cyclic = domainProject();
  addWarp(cyclic, { id: "body" });
  addWarp(cyclic, { id: "head", parentNodeId: "body" });
  cyclic.scene.nodes[cyclic.scene.rootId].children = [];
  cyclic.scene.nodes.body.parentId = "head";
  cyclic.rig.deformers.find(({ id }) => id === "body").parentNodeId = "head";
  cyclic.scene.nodes.head.children.push("body");
  assert.ok(issueCodes(cyclic).includes("DEFORMER_CYCLE"));
});

test("keyform validation rejects missing, duplicate, incompatible, and non-finite points", () => {
  const project = domainProject();
  const { deformer, controlPoints } = addWarp(project);
  addKeyArt(project);
  const positions = defaultWarpKeyformControlPoints(deformer, controlPoints);
  positions.pop();
  positions[1].controlPointId = positions[0].controlPointId;
  positions[0].x = Number.POSITIVE_INFINITY;
  project.rig.warpDeformerKeyforms.push({
    deformerId: deformer.id,
    keyArtId: "key_art",
    controlPoints: positions,
  });
  const codes = issueCodes(project);
  assert.ok(codes.includes("DEFORMER_KEYFORM_INCOMPATIBLE"));
  assert.ok(codes.includes("DEFORMER_CONTROL_POINT_INVALID"));
});

test("Save Open preserves Warp stable IDs, hierarchy, keyforms, and canonical order", () => {
  const project = domainProject();
  const body = addWarp(project, { id: "z_body" });
  const head = addWarp(project, { id: "a_head", parentNodeId: "z_body" });
  addKeyArt(project);
  for (const created of [body, head]) {
    project.rig.warpDeformerKeyforms.unshift({
      deformerId: created.deformer.id,
      keyArtId: "key_art",
      controlPoints: defaultWarpKeyformControlPoints(created.deformer, created.controlPoints).reverse(),
    });
  }
  project.rig.deformers.reverse();
  project.rig.warpControlPoints.reverse();
  const now = () => new Date("2026-09-06T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(opened.rig.deformers.map(({ id }) => id), ["a_head", "z_body"]);
  assert.equal(opened.scene.nodes.a_head.parentId, "z_body");
  assert.deepEqual(opened.rig.warpDeformerKeyforms.map(({ deformerId }) => deformerId),
    ["a_head", "z_body"]);
  assert.equal(serializeProject(opened, 2, { now }), serialized);
});

test("pre-Phase-6-3 schema migrates to empty Warp collections without losing clipping", () => {
  const legacy = domainProject();
  legacy.schemaVersion = 5;
  legacy.clippingBindings.push({
    id: "clip", targetNodeId: "target", sourceNodeId: "source", mode: "inside", enabled: true,
  });
  legacy.scene.nodes.source = createSceneNode({
    id: "source", displayName: "source", parentId: legacy.scene.rootId,
  });
  legacy.scene.nodes.target = createSceneNode({
    id: "target", displayName: "target", parentId: legacy.scene.rootId,
  });
  legacy.scene.nodes[legacy.scene.rootId].children.push("source", "target");
  delete legacy.rig.warpControlPoints;
  delete legacy.rig.warpDeformerKeyforms;
  const migrated = migrateProjectSchema(legacy);
  assert.equal(migrated.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.deepEqual(migrated.rig.warpControlPoints, []);
  assert.deepEqual(migrated.rig.warpDeformerKeyforms, []);
  assert.equal(migrated.clippingBindings[0].id, "clip");
  assert.deepEqual(validateProject(migrated), []);
});

test("Warp commands create rename reparent and remove through normal Undo Redo", () => {
  const project = domainProject();
  const session = new EditorSession(project);
  session.execute(createWarpCommand({ id: "body", parentNodeId: project.scene.rootId }));
  session.execute(createWarpCommand({ id: "head", parentNodeId: "body" }));
  session.execute({
    type: "deformer.rename", payload: { deformerId: "head", displayName: "Head Warp" },
  });
  assert.equal(session.query("deformer.get", { deformerId: "head" }).displayName, "Head Warp");
  assert.deepEqual(session.query("deformer.list").map(({ id }) => id), ["body", "head"]);

  session.execute({
    type: "deformer.reparent_node",
    payload: { nodeId: "head", parentId: project.scene.rootId },
  });
  assert.equal(session.query("deformer.get", { deformerId: "head" }).parentNodeId, project.scene.rootId);
  session.undo();
  assert.equal(session.query("deformer.get", { deformerId: "head" }).parentNodeId, "body");

  session.execute({ type: "deformer.remove", payload: { deformerId: "body" } });
  assert.equal(session.query("deformer.get", { deformerId: "head" }).parentNodeId, project.scene.rootId);
  session.undo();
  assert.equal(session.query("deformer.get", { deformerId: "head" }).parentNodeId, "body");
  session.redo();
  assert.equal(session.query("deformer.get", { deformerId: "head" }).parentNodeId, project.scene.rootId);
});

test("set grid rejects authored keyform loss and all keyform edits are undoable", () => {
  const project = domainProject();
  addKeyArt(project);
  const session = new EditorSession(project);
  session.execute(createWarpCommand({ parentNodeId: project.scene.rootId }));
  const deformer = session.query("deformer.get", { deformerId: "warp" });
  const positions = defaultWarpKeyformControlPoints(deformer, deformer.controlPoints);
  session.execute({
    type: "deformer.set_keyform",
    payload: { deformerId: "warp", keyArtId: "key_art", controlPoints: positions.reverse() },
  });
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "key_art",
  }).controlPoints.map(({ controlPointId }) => controlPointId), deformer.controlPointIds);
  session.execute({
    type: "deformer.move_control_points",
    payload: {
      deformerId: "warp", keyArtId: "key_art",
      controlPoints: [{ controlPointId: deformer.controlPointIds[0], x: 20, y: 30 }],
    },
  });
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "key_art",
  }).controlPoints[0], { controlPointId: deformer.controlPointIds[0], x: 20, y: 30 });
  session.undo();
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "key_art",
  }).controlPoints[0].x, 0);
  session.execute({
    type: "deformer.reset_control_points",
    payload: { deformerId: "warp", keyArtId: "key_art" },
  });
  assert.throws(() => session.execute({
    type: "deformer.set_grid",
    payload: {
      deformerId: "warp", columns: 3, rows: 3,
      bounds: { left: 0, top: 0, right: 100, bottom: 100 },
      controlPointIds: pointIds(9).map((id) => `new_${id}`),
    },
  }), /Remove authored keyforms/);
});

test("set grid is undoable when no authored keyforms exist", () => {
  const project = domainProject();
  const session = new EditorSession(project);
  session.execute(createWarpCommand({ parentNodeId: project.scene.rootId }));
  const nextIds = pointIds(9).map((id) => `new_${id}`);
  session.execute({
    type: "deformer.set_grid",
    payload: {
      deformerId: "warp", columns: 3, rows: 3,
      bounds: { left: -10, top: -20, right: 90, bottom: 80 }, controlPointIds: nextIds,
    },
  });
  assert.deepEqual(session.query("deformer.get", { deformerId: "warp" }).controlPointIds, nextIds);
  session.undo();
  assert.equal(session.query("deformer.get", { deformerId: "warp" }).columns, 2);
  session.redo();
  assert.equal(session.query("deformer.get", { deformerId: "warp" }).columns, 3);
});

test("failed Warp transaction rolls back and hierarchy cycles are rejected", () => {
  const project = domainProject();
  const session = new EditorSession(project);
  const before = structuredClone(session.project);
  assert.throws(() => session.executeTransaction([
    createWarpCommand({ id: "body", parentNodeId: project.scene.rootId }),
    createWarpCommand({ id: "head", parentNodeId: "missing" }),
  ]));
  assert.deepEqual(session.project, before);

  session.execute(createWarpCommand({ id: "body", parentNodeId: project.scene.rootId }));
  session.execute(createWarpCommand({ id: "head", parentNodeId: "body" }));
  assert.throws(() => session.execute({
    type: "deformer.reparent_node", payload: { nodeId: "body", parentId: "head" },
  }), /cycle/);
});

test("invalid keyform is rejected by transaction validation without partial state", () => {
  const project = domainProject();
  addKeyArt(project);
  const session = new EditorSession(project);
  session.execute(createWarpCommand({ parentNodeId: project.scene.rootId }));
  assert.throws(() => session.execute({
    type: "deformer.set_keyform",
    payload: {
      deformerId: "warp", keyArtId: "key_art",
      controlPoints: [{ controlPointId: "warp_cp_1", x: 0, y: 0 }],
    },
  }), (error) => {
    assert.equal(error instanceof TransactionError, true);
    return true;
  });
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "warp", keyArtId: "key_art",
  }), null);
});

test("headless capabilities expose deterministic Warp commands and queries", () => {
  const project = domainProject();
  const adapter = new HeadlessProductAdapter(new EditorSession(project));
  assert.ok(adapter.capabilities().commands["deformer.create_warp"]);
  assert.ok(adapter.capabilities().commands["deformer.set_keyform"]);
  assert.ok(adapter.capabilities().queries["deformer.get_keyform"]);
  adapter.execute(createWarpCommand({ parentNodeId: project.scene.rootId }));
  assert.equal(adapter.query("deformer.get", { deformerId: "warp" }).id, "warp");
  assert.deepEqual(adapter.query("deformer.validate", {}), { valid: true, issues: [] });
});

test("undeformed 2x2 lattice is identity at corners edges center and boundaries", () => {
  const project = domainProject();
  const created = addWarp(project);
  const stage = evaluationStage(created);
  const positions = [0, 0, 50, 0, 50, 50, 100, 100, 0, 100, 100, 0];
  assert.deepEqual(evaluateWarpPoints(stage, positions), positions);
});

test("bilinear displacement is easy to audit at a corner edge and center", () => {
  const project = domainProject();
  const created = addWarp(project);
  const stage = evaluationStage(created, { warp_cp_1: { x: 10, y: 0 } });
  assert.deepEqual(evaluateWarpPoint(stage, { x: 0, y: 0 }), { x: 10, y: 0 });
  assert.deepEqual(evaluateWarpPoint(stage, { x: 50, y: 0 }), { x: 55, y: 0 });
  assert.deepEqual(evaluateWarpPoint(stage, { x: 50, y: 50 }), { x: 52.5, y: 50 });
  assert.deepEqual(evaluateWarpPoint(stage, { x: 100, y: 100 }), { x: 100, y: 100 });
});

test("outside points use clamped boundary displacement without boundary collapse", () => {
  const project = domainProject();
  const created = addWarp(project);
  const stage = evaluationStage(created, {
    warp_cp_1: { x: 10, y: 0 },
    warp_cp_3: { x: 10, y: 100 },
  });
  assert.deepEqual(evaluateWarpPoint(stage, { x: -20, y: 50 }), { x: -10, y: 50 });
  assert.deepEqual(evaluateWarpPoint(stage, { x: 120, y: 50 }), { x: 120, y: 50 });
});

test("Warp evaluation is repeatable and independent of point collection insertion order", () => {
  const project = domainProject();
  const created = addWarp(project, { size: 3 });
  const stage = evaluationStage(created, { warp_cp_5: { x: 60, y: 40 } });
  const reversed = {
    ...stage,
    controlPoints: [...stage.controlPoints].reverse(),
    keyform: { ...stage.keyform, controlPoints: [...stage.keyform.controlPoints].reverse() },
  };
  const expected = evaluateWarpPoints(stage, [25, 25, 50, 50, 75, 75]);
  assert.deepEqual(evaluateWarpPoints(stage, [25, 25, 50, 50, 75, 75]), expected);
  assert.deepEqual(evaluateWarpPoints(reversed, [25, 25, 50, 50, 75, 75]), expected);
});

test("explicit Deformer-local transforms preserve the evaluation-stage boundary", () => {
  const project = domainProject();
  const created = addWarp(project);
  const stage = {
    ...evaluationStage(created, { warp_cp_1: { x: 10, y: 0 } }),
    toDeformerLocal: [1, 0, 0, 1, -100, -200],
    fromDeformerLocal: [1, 0, 0, 1, 100, 200],
  };
  assert.deepEqual(evaluateWarpPoints(stage, [100, 200]), [110, 200]);
});

test("nested Warp evaluates a non-affine parent on the child cage and its vertex", () => {
  const project = domainProject();
  const body = addWarp(project, { id: "body" });
  const head = addWarp(project, {
    id: "head",
    parentNodeId: "body",
    bounds: { left: 20, top: 20, right: 80, bottom: 80 },
  });
  project.scene.nodes.face = createSceneNode({
    id: "face", displayName: "face", parentId: "head",
  });
  project.scene.nodes.head.children.push("face");
  addKeyArt(project);
  const parentStage = evaluationStage(body, {
    body_cp_2: { x: 130, y: 0 },
    body_cp_4: { x: 100, y: 130 },
  });
  const childStage = evaluationStage(head, {
    head_cp_2: { x: 90, y: 20 },
    head_cp_4: { x: 90, y: 80 },
  });
  for (const stage of [parentStage, childStage]) {
    project.rig.warpDeformerKeyforms.push(stage.keyform);
  }

  assert.deepEqual(warpDeformerAncestors(project, "face"), ["body", "head"]);
  const resolved = createWarpEvaluationStages(project, "face", "key_art");
  assert.deepEqual(resolved.diagnostics, []);
  assert.deepEqual(resolved.stages.map(({ deformer }) => deformer.id), ["body", "head"]);
  const evaluatedChild = evaluateWarpStageLattice(childStage, [parentStage]);
  assert.deepEqual(evaluatedChild.evaluatedLattice.base.slice(0, 2), [24.8, 21.2]);
  const parentOnly = evaluateWarpPoints(parentStage, [50, 50]);
  assert.deepEqual(parentOnly, [57.5, 57.5]);
  assert.deepEqual(evaluateWarpStages([50, 50], [parentStage, childStage]), [63.25, 58.25]);
  assert.notDeepEqual(evaluateWarpPoints(childStage, parentOnly), [63.25, 58.25]);
});

test("evaluation-stage resolution diagnoses a missing Key Art keyform deterministically", () => {
  const project = domainProject();
  addWarp(project);
  project.scene.nodes.face = createSceneNode({
    id: "face", displayName: "face", parentId: "warp",
  });
  project.scene.nodes.warp.children.push("face");
  const result = createWarpEvaluationStages(project, "face", "missing_key_art");
  assert.deepEqual(result.stages, []);
  assert.equal(result.diagnostics[0].code, "DEFORMER_KEYFORM_MISSING");
});
