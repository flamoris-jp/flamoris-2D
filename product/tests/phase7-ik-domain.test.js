import test from "node:test";
import assert from "node:assert/strict";

import { boneSceneTransform, createBone } from "../src/model/bone.js";
import { createTwoBoneIkConstraint } from "../src/model/two-bone-ik-constraint.js";
import { createIdFactory, createProject, createSceneNode, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { deserializeProject, migrateProjectSchema, serializeProject } from "../src/io/project-json.js";

function addBone(project, id, parentNodeId, x, length) {
  project.scene.nodes[id] = createSceneNode({ id, kind: "bone", displayName: id,
    parentId: parentNodeId, transform: boneSceneTransform({ x, y: 0, rotation: 0 }) });
  project.scene.nodes[parentNodeId].children.push(id);
  project.rig.bones.push(createBone({ id, parentNodeId,
    restLocalTransform: { x, y: 0, rotation: 0 }, length }));
}

function fixture() {
  const project = createProject({ name: "IK", width: 100, height: 100,
    idFactory: createIdFactory("ik") });
  const root = project.scene.rootId;
  addBone(project, "root", root, 0, 10);
  addBone(project, "mid", "root", 10, 8);
  addBone(project, "end", "mid", 8, 2);
  return project;
}

function chain(overrides = {}) {
  return createTwoBoneIkConstraint({ id: "ik", rootBoneId: "root", midBoneId: "mid",
    endBoneId: "end", bendDirection: "counterclockwise", ...overrides });
}

test("schema 12 initializes an empty typed two-bone IK collection", () => {
  const project = fixture();
  assert.equal(PROJECT_SCHEMA_VERSION, 12);
  assert.deepEqual(project.rig.twoBoneIkConstraints, []);
  assert.deepEqual(validateProject(project), []);
});

test("TwoBoneIkConstraint validates direct distinct contiguous Scene chain", () => {
  const project = fixture();
  project.rig.twoBoneIkConstraints.push(chain());
  assert.deepEqual(validateProject(project), []);
  project.rig.twoBoneIkConstraints[0].midBoneId = "root";
  assert.ok(validateProject(project).some((entry) => entry.code === "TWO_BONE_IK_BONES_INVALID"));
  project.rig.twoBoneIkConstraints[0] = chain({ endBoneId: "missing" });
  assert.ok(validateProject(project).some((entry) => entry.code === "TWO_BONE_IK_BONE_MISSING"));
  project.rig.twoBoneIkConstraints[0] = chain();
  project.scene.nodes.end.parentId = "root";
  assert.ok(validateProject(project).some((entry) => entry.code === "TWO_BONE_IK_HIERARCHY_INVALID"));
});

test("IK chain rest geometry and enabled end-Bone conflicts are explicit", () => {
  const project = fixture();
  project.rig.twoBoneIkConstraints.push(chain());
  project.rig.bones.find((entry) => entry.id === "mid").restLocalTransform.x = 9;
  project.scene.nodes.mid.transform = boneSceneTransform({ x: 9, y: 0, rotation: 0 });
  assert.ok(validateProject(project).some((entry) =>
    entry.code === "TWO_BONE_IK_CHAIN_GEOMETRY_INVALID"));
  project.rig.bones.find((entry) => entry.id === "mid").restLocalTransform.x = 10;
  project.scene.nodes.mid.transform = boneSceneTransform({ x: 10, y: 0, rotation: 0 });
  project.rig.twoBoneIkConstraints.push(chain({ id: "ik2", bendDirection: "clockwise" }));
  assert.ok(validateProject(project).some((entry) => entry.code === "TWO_BONE_IK_END_CONFLICT"));
});

test("IK settings Save/Open canonically and schema 11 migration preserves constraints", () => {
  const project = fixture();
  project.rig.twoBoneIkConstraints.push(chain({ id: "z" }), chain({ id: "a", enabled: false }));
  const now = () => new Date("2026-09-09T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(opened.rig.twoBoneIkConstraints.map((entry) => entry.id), ["a", "z"]);
  assert.equal(serializeProject(opened, 2, { now }), serialized);

  const schema11 = structuredClone(project);
  schema11.schemaVersion = 11;
  delete schema11.rig.twoBoneIkConstraints;
  const limits = structuredClone(schema11.rig.boneRotationConstraints);
  const migrated = migrateProjectSchema(schema11);
  assert.equal(migrated.schemaVersion, 12);
  assert.deepEqual(migrated.rig.twoBoneIkConstraints, []);
  assert.deepEqual(migrated.rig.boneRotationConstraints, limits);
});
