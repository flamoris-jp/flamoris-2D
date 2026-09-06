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
  ids = pointIds(size * size).map((pointId) => `${id}_${pointId}`),
} = {}) {
  const created = createWarpDeformer({
    id,
    displayName: id,
    parentNodeId,
    columns: size,
    rows: size,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
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
