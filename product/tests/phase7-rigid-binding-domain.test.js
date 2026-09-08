import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdFactory,
  createProject,
  createSceneNode,
  PROJECT_SCHEMA_VERSION,
} from "../src/model/project.js";
import { createBone } from "../src/model/bone.js";
import { createRigidBoneBinding } from "../src/model/rigid-bone-binding.js";
import {
  influenceBindingConflicts,
  rigidBoneBindingForTarget,
} from "../src/model/rigid-bone-binding-validation.js";
import { validateProject } from "../src/model/validation.js";
import { migrateProjectSchema, serializeProject, deserializeProject } from "../src/io/project-json.js";

function projectFixture() {
  const project = createProject({
    name: "Rigid binding",
    width: 320,
    height: 240,
    idFactory: createIdFactory("rigid"),
  });
  const rootId = project.scene.rootId;
  project.scene.nodes.bone = createSceneNode({
    id: "bone",
    kind: "bone",
    displayName: "Bone",
    parentId: rootId,
  });
  project.scene.nodes.part = createSceneNode({
    id: "part",
    kind: "part",
    displayName: "Part",
    parentId: rootId,
  });
  project.scene.nodes[rootId].children.push("bone", "part");
  project.rig.bones.push(createBone({
    id: "bone",
    parentNodeId: rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 },
    length: 10,
  }));
  return project;
}

function codes(project) {
  return validateProject(project).map((issue) => issue.code);
}

test("schema 8 adds an empty persistent rigid binding collection", () => {
  const project = projectFixture();
  assert.equal(PROJECT_SCHEMA_VERSION, 8);
  assert.deepEqual(project.rig.rigidBoneBindings, []);
  assert.deepEqual(validateProject(project), []);

  const schema7 = structuredClone(project);
  schema7.schemaVersion = 7;
  delete schema7.rig.rigidBoneBindings;
  const migrated = migrateProjectSchema(schema7);
  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.rig.rigidBoneBindings, []);
});

test("RigidBoneBinding validates target, Bone reference, exact shape, and conflicts", () => {
  const project = projectFixture();
  project.rig.rigidBoneBindings.push(createRigidBoneBinding({
    id: "binding_a",
    targetNodeId: "part",
    boneId: "bone",
  }));
  assert.deepEqual(validateProject(project), []);
  assert.equal(rigidBoneBindingForTarget(project, "part").id, "binding_a");

  project.rig.rigidBoneBindings.push(createRigidBoneBinding({
    id: "binding_b",
    targetNodeId: "part",
    boneId: "bone",
  }));
  assert.ok(codes(project).includes("RIGID_BINDING_CONFLICT"));
  project.rig.rigidBoneBindings[1].enabled = false;
  assert.deepEqual(validateProject(project), []);
  project.rig.rigidBoneBindings[1].unsupported = true;
  assert.ok(codes(project).includes("RIGID_BINDING_TARGET_INVALID"));
  delete project.rig.rigidBoneBindings[1].unsupported;
  project.rig.rigidBoneBindings[1].targetNodeId = "missing";
  project.rig.rigidBoneBindings[1].boneId = "missing";
  const found = codes(project);
  assert.ok(found.includes("RIGID_BINDING_TARGET_INVALID"));
  assert.ok(found.includes("BONE_NODE_MISSING"));
});

test("future SkinBinding conflict uses the shared influence boundary", () => {
  const binding = createRigidBoneBinding({
    id: "binding",
    targetNodeId: "part",
    boneId: "bone",
  });
  assert.deepEqual(influenceBindingConflicts([binding], new Set(["part"])), [{
    targetNodeId: "part",
    bindingIds: ["binding"],
    conflictsWithSkin: true,
  }]);
});

test("RigidBoneBinding saves and opens in canonical stable-ID order", () => {
  const project = projectFixture();
  project.rig.rigidBoneBindings.push(
    createRigidBoneBinding({
      id: "z_binding", targetNodeId: "part", boneId: "bone", enabled: false,
    }),
    createRigidBoneBinding({
      id: "a_binding", targetNodeId: "part", boneId: "bone", enabled: true,
    }),
  );
  const now = () => new Date("2026-09-08T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(
    opened.rig.rigidBoneBindings.map(({ id }) => id),
    ["a_binding", "z_binding"],
  );
  assert.equal(serializeProject(opened, 2, { now }), serialized);
});

