import test from "node:test";
import assert from "node:assert/strict";

import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";
import { interpolateWarpKeyforms } from "../src/core/warp-deformer-evaluator.js";
import { EditorSession } from "../src/commands/editor.js";
import { DeformerAuthoringController } from "../src/ui/deformer-authoring-controller.js";

function member(nodeId, appearanceId) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder: 1,
    clipping: { sourceNodeId: null },
  };
}

function fixture({ mode = "morph" } = {}) {
  const project = createProject({
    name: "Warp Transition",
    width: 300,
    height: 200,
    idFactory: createIdFactory("phase6_4"),
  });
  const controlPointIds = ["warp_tl", "warp_tr", "warp_bl", "warp_br"];
  const created = createWarpDeformer({
    id: "head_warp",
    displayName: "Head Warp",
    parentNodeId: project.scene.rootId,
    columns: 2,
    rows: 2,
    bounds: { left: 0, top: 0, right: 20, bottom: 20 },
    controlPointIds,
  });
  project.scene.nodes.head_warp = createSceneNode({
    id: "head_warp",
    kind: "deformer",
    displayName: "Head Warp",
    parentId: project.scene.rootId,
  });
  project.scene.nodes.node_a = createSceneNode({
    id: "node_a",
    displayName: "Face A",
    parentId: "head_warp",
  });
  project.scene.nodes.node_b = createSceneNode({
    id: "node_b",
    displayName: "Face B",
    parentId: "head_warp",
  });
  project.scene.nodes[project.scene.rootId].children = ["head_warp"];
  project.scene.nodes.head_warp.children = ["node_a", "node_b"];
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  const regular = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints);
  project.rig.warpDeformerKeyforms.push(
    { deformerId: "head_warp", keyArtId: "keyart_a", controlPoints: regular },
    {
      deformerId: "head_warp",
      keyArtId: "keyart_b",
      controlPoints: regular.map((point) => ({ ...point, x: point.x + 10 })),
    },
  );
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "appearance_b")], metadata: {} },
  );
  project.semanticSlots.push({
    id: "semantic.face",
    displayName: "Face",
    mappings: [
      { keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" },
    ],
    metadata: {},
  });
  project.meshTopologies.push({
    id: "face_topology",
    vertexIds: ["v0", "v1", "v2"],
    indices: [0, 1, 2],
  });
  project.meshKeyforms.push(
    { id: "face_a", topologyId: "face_topology", keyArtId: "keyart_a", semanticSlotId: "semantic.face", positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "face_b", topologyId: "face_topology", keyArtId: "keyart_b", semanticSlotId: "semantic.face", positions: [2, 2, 12, 2, 2, 12], uvs: [0, 0, 1, 0, 0, 1] },
  );
  project.temporalPrograms.push({ id: "program", durationTicks: 100, tracks: [], events: [], regions: [] });
  project.transitions.push({
    id: "transition",
    displayName: "A to B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program",
    partTransitions: [{
      id: "face_transition",
      semanticSlotId: "semantic.face",
      mode,
      topologyId: mode === "morph" ? "face_topology" : null,
      fromKeyformId: "face_a",
      toKeyformId: "face_b",
      configuration: mode === "replace" ? { compositeGroupId: "face_replace" } : {},
    }],
    diagnosticOverrides: [],
  });
  return { project, deformer: created.deformer, regular };
}

function positionsAt(project, tick) {
  return evaluateTransition(project, "transition", tick)
    .evaluatedParts[0].renderInstances.map((instance) => instance.mesh.positions);
}

test("Warp Transition endpoints are exact and midpoint cage interpolation follows mesh interpolation", () => {
  const { project } = fixture();
  assert.deepEqual(positionsAt(project, 0), [[0, 0, 10, 0, 0, 10]]);
  assert.deepEqual(positionsAt(project, 50), [[6, 1, 16, 1, 6, 11]]);
  assert.deepEqual(positionsAt(project, 100), [[12, 2, 22, 2, 12, 12]]);
  assert.deepEqual(positionsAt(project, 50), positionsAt(project, 50));
});

test("Warp cage uses the sampled GeometryBlendTrack weight and world transform remains downstream", () => {
  const { project } = fixture();
  project.scene.nodes.node_a.transform.position.x = 100;
  project.scene.nodes.node_b.transform.position.x = 200;
  project.temporalPrograms[0].tracks.push({
    trackId: "geometry",
    version: 1,
    kind: "GeometryBlendTrack",
    target: { semanticSlotId: "semantic.face" },
    channels: { geometryWeight: { keyframes: [
      { id: "g0", timeTicks: 0, value: 0.25, interpolationToNext: { kind: "step" } },
    ] } },
  });
  const instance = evaluateTransition(project, "transition", 50).evaluatedParts[0].renderInstances[0];
  assert.deepEqual(instance.mesh.positions, [3, 0.5, 13, 0.5, 3, 10.5]);
  assert.equal(instance.transform[4], 125);
});

test("Hold and Replace apply endpoint Warp without changing composition semantics", () => {
  const held = fixture({ mode: "hold" }).project;
  assert.deepEqual(positionsAt(held, 50), [[0, 0, 10, 0, 0, 10]]);

  const replaced = fixture({ mode: "replace" }).project;
  assert.deepEqual(positionsAt(replaced, 50), [
    [0, 0, 10, 0, 0, 10],
    [12, 2, 22, 2, 12, 12],
  ]);
  assert.equal(evaluateTransition(replaced, "transition", 50).compositeGroups[0].members.length, 2);
});

test("missing and incompatible Warp endpoint state emits deterministic diagnostics", () => {
  const missing = fixture().project;
  missing.rig.warpDeformerKeyforms = missing.rig.warpDeformerKeyforms
    .filter((entry) => entry.keyArtId !== "keyart_b");
  const first = evaluateTransition(missing, "transition", 50);
  const second = evaluateTransition(missing, "transition", 50);
  assert.ok(first.diagnostics.some((entry) => entry.code === "DEFORMER_KEYFORM_MISSING"));
  assert.deepEqual(first, second);

  const incompatible = fixture().project;
  incompatible.scene.nodes.node_b.parentId = incompatible.scene.rootId;
  incompatible.scene.nodes.head_warp.children = ["node_a"];
  incompatible.scene.nodes[incompatible.scene.rootId].children.push("node_b");
  assert.ok(evaluateTransition(incompatible, "transition", 50).diagnostics
    .some((entry) => entry.code === "DEFORMER_KEYFORM_INCOMPATIBLE"));
});

test("explicit Reset All authors an identity B keyform for a deformed A Transition", () => {
  const { project, regular } = fixture();
  project.rig.warpDeformerKeyforms = project.rig.warpDeformerKeyforms
    .filter((entry) => entry.keyArtId !== "keyart_b");
  const session = new EditorSession(project);
  let endpoint = "from";
  const controller = new DeformerAuthoringController(session, {
    getState: () => ({
      editingEnabled: true,
      activeEndpoint: endpoint,
      activeTransition: session.query("transition.get", { transitionId: "transition" }),
      endpoints: {
        from: { keyArt: { id: "keyart_a", displayName: "A" } },
        to: { keyArt: { id: "keyart_b", displayName: "B" } },
      },
    }),
  });
  controller.selectDeformer("head_warp");
  controller.selectControlPoint("warp_tl");
  controller.beginDrag();
  controller.previewDrag({ x: 10, y: 0 });
  controller.commitDrag();

  endpoint = "to";
  assert.equal(controller.getState().keyform, null);
  controller.resetAll();
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "head_warp", keyArtId: "keyart_b",
  }).controlPoints, regular);

  const midpoint = evaluateTransition(session.project, "transition", 50);
  assert.equal(midpoint.diagnostics.some((entry) =>
    entry.code === "DEFORMER_KEYFORM_MISSING"), false);
  assert.deepEqual(positionsAt(session.project, 100), [[2, 2, 12, 2, 2, 12]]);
  assert.equal(session.undoStack.at(-1).label, "Create identity Warp keyform");
  session.undo();
  assert.equal(session.query("deformer.get_keyform", {
    deformerId: "head_warp", keyArtId: "keyart_b",
  }), null);
  session.redo();
  assert.deepEqual(session.query("deformer.get_keyform", {
    deformerId: "head_warp", keyArtId: "keyart_b",
  }).controlPoints, regular);
});

test("Warp keyform interpolation is canonical and independent of collection insertion order", () => {
  const { deformer, regular } = fixture();
  const from = { deformerId: deformer.id, keyArtId: "a", controlPoints: [...regular].reverse() };
  const to = {
    deformerId: deformer.id,
    keyArtId: "b",
    controlPoints: regular.map((point) => ({ ...point, y: point.y + 8 })).reverse(),
  };
  const interpolated = interpolateWarpKeyforms(deformer, from, to, 0.25);
  assert.deepEqual(interpolated.controlPoints.map((point) => point.controlPointId), deformer.controlPointIds);
  assert.deepEqual(interpolated.controlPoints.map((point) => point.y), [2, 2, 22, 22]);
});
