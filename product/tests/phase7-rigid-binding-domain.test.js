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
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

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

test("schema 8 adds rigid bindings and migrates forward with empty skin bindings", () => {
  const project = projectFixture();
  assert.equal(PROJECT_SCHEMA_VERSION, 10);
  assert.deepEqual(project.rig.rigidBoneBindings, []);
  assert.deepEqual(project.rig.skinBindings, []);
  assert.deepEqual(project.meshFormCorrectionKeyforms, []);
  assert.deepEqual(validateProject(project), []);

  const schema7 = structuredClone(project);
  schema7.schemaVersion = 7;
  delete schema7.rig.rigidBoneBindings;
  const migrated = migrateProjectSchema(schema7);
  assert.equal(migrated.schemaVersion, 10);
  assert.deepEqual(migrated.rig.rigidBoneBindings, []);
  assert.deepEqual(migrated.rig.skinBindings, []);
  assert.deepEqual(migrated.meshFormCorrectionKeyforms, []);
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

test("rigid binding Commands, Queries, MCP, and Undo Redo share one boundary", () => {
  const session = new EditorSession(projectFixture());
  const adapter = new HeadlessProductAdapter(session);
  const parentBefore = session.project.scene.nodes.part.parentId;
  const drawOrderBefore = session.project.scene.nodes[session.project.scene.rootId]
    .children.indexOf("part");
  adapter.execute({
    type: "bone.create_rigid_binding",
    payload: {
      binding: {
        id: "binding",
        targetNodeId: "part",
        boneId: "bone",
        enabled: true,
      },
    },
  });
  assert.equal(adapter.query("bone.get_rigid_binding", { bindingId: "binding" }).boneId,
    "bone");
  assert.equal(adapter.query("bone.get_rigid_binding_for_target", {
    targetNodeId: "part",
  }).id, "binding");
  assert.equal(session.project.scene.nodes.part.parentId, parentBefore);
  assert.equal(session.project.scene.nodes[session.project.scene.rootId]
    .children.indexOf("part"), drawOrderBefore);
  assert.deepEqual(adapter.query("bone.validate_rigid_bindings", {}), {
    valid: true,
    issues: [],
  });

  session.undo();
  assert.deepEqual(adapter.query("bone.list_rigid_bindings", {}), []);
  session.redo();
  assert.equal(adapter.query("bone.get_rigid_binding_for_target", {
    targetNodeId: "part",
  }).id, "binding");
  adapter.execute({
    type: "bone.set_rigid_binding_enabled",
    payload: { bindingId: "binding", enabled: false },
  });
  assert.equal(adapter.query("bone.get_rigid_binding_for_target", {
    targetNodeId: "part",
  }), null);
  adapter.execute({
    type: "bone.remove_rigid_binding",
    payload: { bindingId: "binding" },
  });
  assert.deepEqual(adapter.query("bone.list_rigid_bindings", {}), []);
  session.undo();
  assert.equal(adapter.query("bone.get_rigid_binding", { bindingId: "binding" }).enabled,
    false);
});

test("Bone structural edits reject dependent rigid bindings", () => {
  const session = new EditorSession(projectFixture());
  session.execute({
    type: "bone.create_rigid_binding",
    payload: {
      binding: {
        id: "binding", targetNodeId: "part", boneId: "bone", enabled: true,
      },
    },
  });
  for (const command of [
    { type: "bone.remove", payload: { boneId: "bone" } },
    {
      type: "bone.set_rest",
      payload: {
        boneId: "bone",
        restLocalTransform: { x: 1, y: 0, rotation: 0 },
        length: 10,
      },
    },
  ]) {
    assert.throws(() => session.execute(command), /rigid bindings/);
  }
});
