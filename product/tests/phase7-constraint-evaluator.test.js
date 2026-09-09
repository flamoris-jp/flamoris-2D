import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { applyBoneRotationConstraint } from "../src/core/bone-rotation-constraint-evaluator.js";
import { evaluateBoneFk } from "../src/core/bone-fk-evaluator.js";
import { boneSceneTransform, createBone, createBonePoseKeyform } from "../src/model/bone.js";
import { createBoneRotationConstraint } from "../src/model/bone-rotation-constraint.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";

const delta = (rotation) => ({ x: 2, y: -3, rotation });
const limit = (enabled = true) => createBoneRotationConstraint({
  id: "limit", boneId: "bone", enabled, minRotation: -0.5, maxRotation: 0.75,
});

test("rotation constraint clamps min and max while preserving translation", () => {
  assert.deepEqual(applyBoneRotationConstraint(delta(-2), limit()), delta(-0.5));
  assert.deepEqual(applyBoneRotationConstraint(delta(2), limit()), delta(0.75));
});

test("rotation constraint leaves inside and disabled authored intent unchanged", () => {
  assert.deepEqual(applyBoneRotationConstraint(delta(0.25), limit()), delta(0.25));
  assert.deepEqual(applyBoneRotationConstraint(delta(2), limit(false)), delta(2));
});

function fixture() {
  const project = createProject({ name: "Constrained FK", width: 100, height: 100,
    idFactory: createIdFactory("constrained_fk") });
  const parentNodeId = project.scene.rootId;
  project.scene.nodes.bone = createSceneNode({ id: "bone", kind: "bone",
    displayName: "Bone", parentId: parentNodeId,
    transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }) });
  project.scene.nodes[parentNodeId].children.push("bone");
  project.rig.bones.push(createBone({ id: "bone", parentNodeId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 }, length: 10 }));
  project.keyArts.push({ id: "key", displayName: "Key", rootNodeId: parentNodeId,
    sourceAssetId: null, members: [], metadata: {} });
  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({ boneId: "bone", keyArtId: "key",
    localDelta: delta(2) }));
  project.rig.boneRotationConstraints.push(limit());
  return project;
}

test("FK evaluates constrained pose without rewriting authored BonePoseKeyform", () => {
  const project = fixture();
  const authored = structuredClone(project.rig.bonePoseKeyforms);
  const result = evaluateBoneFk(project, "key");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(Math.abs(result.poses[0].tip.x - (2 + 10 * Math.cos(0.75))) < 1e-12);
  assert.ok(Math.abs(result.poses[0].tip.y - (-3 + 10 * Math.sin(0.75))) < 1e-12);
  assert.deepEqual(project.rig.bonePoseKeyforms, authored);
});

test("disabled Bone remains identity even when its constraint excludes zero", () => {
  const project = fixture();
  project.rig.bones[0].enabled = false;
  project.rig.boneRotationConstraints[0].minRotation = 1;
  const result = evaluateBoneFk(project, "key");
  assert.deepEqual(result.poses[0].skinMatrix, [1, 0, 0, 1, 0, 0]);
});

test("rotation constraint evaluator remains DOM-independent", async () => {
  const source = await readFile(
    new URL("../src/core/bone-rotation-constraint-evaluator.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b/);
});
