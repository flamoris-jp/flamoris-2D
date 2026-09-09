import test from "node:test";
import assert from "node:assert/strict";

import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createBoneRotationConstraint } from "../src/model/bone-rotation-constraint.js";
import { createIdFactory, createProject, createSceneNode, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { deserializeProject, migrateProjectSchema, serializeProject } from "../src/io/project-json.js";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function fixture() {
  const project = createProject({ name: "Constraints", width: 100, height: 100,
    idFactory: createIdFactory("constraints") });
  const parentNodeId = project.scene.rootId;
  project.scene.nodes.bone = createSceneNode({ id: "bone", kind: "bone",
    displayName: "Bone", parentId: parentNodeId,
    transform: boneSceneTransform({ x: 0, y: 0, rotation: 0 }) });
  project.scene.nodes[parentNodeId].children.push("bone");
  project.rig.bones.push(createBone({ id: "bone", parentNodeId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 }, length: 10 }));
  return project;
}

test("current schema initializes typed Bone rotation constraints", () => {
  const project = fixture();
  assert.equal(PROJECT_SCHEMA_VERSION, 12);
  assert.deepEqual(project.rig.boneRotationConstraints, []);
  assert.deepEqual(validateProject(project), []);
});

test("BoneRotationConstraint validates finite ordered radians and Bone references", () => {
  const project = fixture();
  project.rig.boneRotationConstraints.push(createBoneRotationConstraint({
    id: "limit", boneId: "bone", minRotation: -1, maxRotation: 1,
  }));
  assert.deepEqual(validateProject(project), []);
  project.rig.boneRotationConstraints[0].minRotation = 2;
  assert.ok(validateProject(project).some((entry) =>
    entry.code === "BONE_ROTATION_CONSTRAINT_INVALID"));
  project.rig.boneRotationConstraints[0].minRotation = -1;
  project.rig.boneRotationConstraints[0].boneId = "missing";
  assert.ok(validateProject(project).some((entry) =>
    entry.code === "BONE_ROTATION_CONSTRAINT_BONE_MISSING"));
});

test("only one enabled rotation constraint is allowed per Bone", () => {
  const project = fixture();
  project.rig.boneRotationConstraints.push(
    createBoneRotationConstraint({ id: "a", boneId: "bone", minRotation: -1, maxRotation: 1 }),
    createBoneRotationConstraint({ id: "b", boneId: "bone", minRotation: -2, maxRotation: 2 }),
  );
  assert.ok(validateProject(project).some((entry) =>
    entry.code === "BONE_ROTATION_CONSTRAINT_CONFLICT"));
  project.rig.boneRotationConstraints[1].enabled = false;
  assert.deepEqual(validateProject(project), []);
});

test("rotation constraints Save/Open canonically and schema 10 migrates without Phase 7-4 loss", () => {
  const project = fixture();
  project.rig.boneRotationConstraints.push(
    createBoneRotationConstraint({ id: "z", boneId: "bone", minRotation: -1, maxRotation: 1, enabled: false }),
    createBoneRotationConstraint({ id: "a", boneId: "bone", minRotation: -0.5, maxRotation: 0.5 }),
  );
  const now = () => new Date("2026-09-09T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(opened.rig.boneRotationConstraints.map((entry) => entry.id), ["a", "z"]);
  assert.equal(serializeProject(opened, 2, { now }), serialized);

  const schema10 = structuredClone(project);
  schema10.schemaVersion = 10;
  delete schema10.rig.boneRotationConstraints;
  schema10.meshFormCorrectionKeyforms.push({ id: "kept", topologyId: "t",
    keyArtId: "k", semanticSlotId: "s", vertexOffsets: [] });
  const migrated = migrateProjectSchema(schema10);
  assert.equal(migrated.schemaVersion, 12);
  assert.deepEqual(migrated.rig.boneRotationConstraints, []);
  assert.equal(migrated.meshFormCorrectionKeyforms[0].id, "kept");
});

test("rotation constraint Commands Queries and Undo Redo preserve exact state", () => {
  const session = new EditorSession(fixture());
  const adapter = new HeadlessProductAdapter(session);
  adapter.execute({ type: "bone.create_rotation_constraint", payload: { constraint: {
    id: "limit", boneId: "bone", enabled: true, minRotation: -1, maxRotation: 1,
  } } });
  assert.equal(adapter.query("bone.get_rotation_constraint_for_bone", { boneId: "bone" }).id,
    "limit");
  assert.equal(adapter.query("bone.validate_rotation_constraints", {}).valid, true);
  adapter.execute({ type: "bone.set_rotation_constraint_bounds", payload: {
    constraintId: "limit", minRotation: -0.5, maxRotation: 0.75,
  } });
  adapter.execute({ type: "bone.set_rotation_constraint_enabled", payload: {
    constraintId: "limit", enabled: false,
  } });
  const exact = structuredClone(session.project.rig.boneRotationConstraints);
  session.undo();
  session.redo();
  assert.deepEqual(session.project.rig.boneRotationConstraints, exact);
  adapter.execute({ type: "bone.remove_rotation_constraint", payload: { constraintId: "limit" } });
  assert.deepEqual(adapter.query("bone.list_rotation_constraints", {}), []);
  session.undo();
  assert.deepEqual(session.project.rig.boneRotationConstraints, exact);
});

test("Bone deletion is locked while a rotation constraint references it", () => {
  const project = fixture();
  project.rig.boneRotationConstraints.push(createBoneRotationConstraint({
    id: "limit", boneId: "bone", minRotation: -1, maxRotation: 1,
  }));
  const session = new EditorSession(project);
  assert.throws(() => session.execute({ type: "bone.remove", payload: { boneId: "bone" } }),
    { code: "bone.delete_locked_by_rotation_constraint" });
  assert.equal(session.undoStack.length, 0);
});
