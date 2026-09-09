import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { evaluateBoneFk } from "../src/core/bone-fk-evaluator.js";
import { solveProjectTwoBoneIk } from "../src/core/two-bone-ik-authoring-solver.js";
import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createBoneRotationConstraint } from "../src/model/bone-rotation-constraint.js";
import { createTwoBoneIkConstraint } from "../src/model/two-bone-ik-constraint.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function addBone(project, id, parentNodeId, x, length) {
  project.scene.nodes[id] = createSceneNode({ id, kind: "bone", displayName: id,
    parentId: parentNodeId, transform: boneSceneTransform({ x, y: 0, rotation: 0 }) });
  project.scene.nodes[parentNodeId].children.push(id);
  project.rig.bones.push(createBone({ id, parentNodeId,
    restLocalTransform: { x, y: 0, rotation: 0 }, length }));
}

function fixture() {
  const project = createProject({ name: "IK solve", width: 100, height: 100,
    idFactory: createIdFactory("ik_solve") });
  const rootId = project.scene.rootId;
  addBone(project, "root", rootId, 0, 10);
  addBone(project, "mid", "root", 10, 10);
  addBone(project, "end", "mid", 10, 2);
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: rootId,
    sourceAssetId: null, members: [], metadata: {} });
  project.rig.twoBoneIkConstraints.push(createTwoBoneIkConstraint({ id: "ik",
    rootBoneId: "root", midBoneId: "mid", endBoneId: "end",
    bendDirection: "counterclockwise" }));
  return project;
}

function closePoint(actual, expected) {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9,
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

function addShearedWarpAncestor(project) {
  const rootId = project.scene.rootId;
  const created = createWarpDeformer({
    id: "warp", displayName: "Warp", parentNodeId: rootId,
    columns: 2, rows: 2,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    controlPointIds: ["warp_tl", "warp_tr", "warp_bl", "warp_br"],
  });
  project.scene.nodes.warp = createSceneNode({ id: "warp", kind: "deformer",
    displayName: "Warp", parentId: rootId });
  project.scene.nodes.warp.children = ["root"];
  project.scene.nodes[rootId].children = ["warp"];
  project.scene.nodes.root.parentId = "warp";
  project.rig.bones.find((bone) => bone.id === "root").parentNodeId = "warp";
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  const points = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints)
    .map((point) => point.controlPointId === "warp_tr"
      ? { ...point, y: point.y + 25 } : point);
  project.rig.warpDeformerKeyforms.push({
    deformerId: "warp", keyArtId: "key", controlPoints: points,
  });
}

test("project IK solve outputs ordinary local pose deltas consumed by existing FK", () => {
  const project = fixture();
  const target = { x: 10, y: 10 };
  const result = solveProjectTwoBoneIk(project, { constraintId: "ik", keyArtId: "key", target });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.solution.poseDeltas.map((entry) => entry.boneId), ["root", "mid"]);
  const byBone = new Map(result.solution.poseDeltas.map((entry) => [entry.boneId, entry]));
  project.rig.bonePoseKeyforms.push(...result.solution.poseDeltas.map((entry) => ({ ...entry })));
  const fk = evaluateBoneFk(project, "key");
  closePoint(fk.poses.find((entry) => entry.boneId === "end").head, target);
  assert.equal(byBone.get("root").localDelta.x, 0);
});

test("IK solve respects local rotation constraints without mutating authored pose", () => {
  const project = fixture();
  project.rig.boneRotationConstraints.push(createBoneRotationConstraint({ id: "root_limit",
    boneId: "root", minRotation: 0, maxRotation: 0 }));
  const before = structuredClone(project);
  const result = solveProjectTwoBoneIk(project, { constraintId: "ik", keyArtId: "key",
    target: { x: 10, y: 10 } });
  assert.equal(result.solution.poseDeltas[0].localDelta.rotation, 0);
  assert.equal(result.solution.limited, true);
  assert.deepEqual(project, before);
});

test("headless IK solve Query is deterministic and history-free", () => {
  const session = new EditorSession(fixture());
  const adapter = new HeadlessProductAdapter(session);
  const input = { constraintId: "ik", keyArtId: "key", target: { x: 8, y: 12 } };
  const first = adapter.query("bone.solve_two_bone_ik", input);
  const second = adapter.query("bone.solve_two_bone_ik", input);
  assert.deepEqual(first, second);
  assert.equal(session.undoStack.length, 0);
  assert.equal(session.isDirty, false);
});

test("IK rejects a sheared post-Warp projected frame instead of baking document angles", () => {
  const project = fixture();
  addShearedWarpAncestor(project);
  const before = structuredClone(project.rig.bonePoseKeyforms);
  const result = solveProjectTwoBoneIk(project, {
    constraintId: "ik", keyArtId: "key", target: { x: 10, y: 10 },
  });
  assert.equal(result.solution, null);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code),
    ["TWO_BONE_IK_PROJECTED_FRAME_INCOMPATIBLE"]);
  assert.equal(result.diagnostics[0].details.boneId, "root");
  assert.deepEqual(project.rig.bonePoseKeyforms, before);
});

test("project IK authoring solver reuses projected FK and analytic solver", async () => {
  const source = await readFile(
    new URL("../src/core/two-bone-ik-authoring-solver.js", import.meta.url), "utf8");
  assert.match(source, /evaluateEndpointProjectedBoneFk/);
  assert.match(source, /solveTwoBoneIk/);
  assert.doesNotMatch(source, /evaluateBoneFk\s*\(/);
});
