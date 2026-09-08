import test from "node:test";
import assert from "node:assert/strict";

import {
  createBone,
  createBonePoseKeyform,
  identityBonePoseDelta,
} from "../src/model/bone.js";
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

function boneProject() {
  return createProject({
    name: "Bones",
    width: 640,
    height: 480,
    idFactory: createIdFactory("bones"),
  });
}

function addKeyArt(project, id) {
  project.keyArts.push({
    id,
    displayName: id,
    rootNodeId: project.scene.rootId,
    sourceAssetId: null,
    members: [],
    metadata: {},
  });
}

function addBone(project, {
  id,
  parentNodeId = project.scene.rootId,
  x = 0,
  y = 0,
  rotation = 0,
  length = 100,
  enabled = true,
} = {}) {
  project.scene.nodes[id] = createSceneNode({
    id,
    kind: "bone",
    displayName: id,
    parentId: parentNodeId,
  });
  project.scene.nodes[parentNodeId].children.push(id);
  const bone = createBone({
    id,
    parentNodeId,
    restLocalTransform: { x, y, rotation },
    length,
    enabled,
  });
  project.rig.bones.push(bone);
  return bone;
}

function codes(project) {
  return validateProject(project).map(({ code }) => code);
}

test("new schema contains empty typed Bone collections", () => {
  const project = boneProject();
  assert.equal(PROJECT_SCHEMA_VERSION, 7);
  assert.deepEqual(project.rig.bones, []);
  assert.deepEqual(project.rig.bonePoseKeyforms, []);
  assert.deepEqual(validateProject(project), []);
});

test("Bone and BoneNode share stable identity while Scene owns hierarchy", () => {
  const project = boneProject();
  addBone(project, { id: "upper", x: 10, y: 20, length: 80 });
  addBone(project, {
    id: "forearm",
    parentNodeId: "upper",
    x: 80,
    length: 70,
  });
  assert.deepEqual(validateProject(project), []);
  assert.equal(project.rig.bones.find(({ id }) => id === "forearm").parentNodeId, "upper");
  assert.equal(project.scene.nodes.forearm.parentId, "upper");
  assert.equal(Object.hasOwn(project.rig.bones[0], "children"), false);
});

test("Bone validation diagnoses identity parent rest length and child-kind violations", () => {
  const project = boneProject();
  addBone(project, { id: "upper" });
  project.rig.bones[0].parentNodeId = "missing";
  project.rig.bones[0].restLocalTransform.rotation = Number.NaN;
  project.rig.bones[0].length = 0;
  project.scene.nodes.part = createSceneNode({
    id: "part",
    kind: "part",
    displayName: "part",
    parentId: "upper",
  });
  project.scene.nodes.upper.children.push("part");
  const found = codes(project);
  assert.ok(found.includes("BONE_SCENE_IDENTITY_MISMATCH"));
  assert.ok(found.includes("BONE_PARENT_INVALID"));
  assert.ok(found.includes("BONE_REST_INVALID"));
  assert.ok(found.includes("BONE_LENGTH_INVALID"));
});

test("BoneNode without capability and capability without BoneNode are rejected", () => {
  const nodeOnly = boneProject();
  nodeOnly.scene.nodes.loose = createSceneNode({
    id: "loose",
    kind: "bone",
    displayName: "loose",
    parentId: nodeOnly.scene.rootId,
  });
  nodeOnly.scene.nodes[nodeOnly.scene.rootId].children.push("loose");
  assert.ok(codes(nodeOnly).includes("BONE_NODE_MISSING"));

  const capabilityOnly = boneProject();
  capabilityOnly.rig.bones.push(createBone({
    id: "missing",
    parentNodeId: capabilityOnly.scene.rootId,
    restLocalTransform: { x: 0, y: 0, rotation: 0 },
    length: 10,
  }));
  assert.ok(codes(capabilityOnly).includes("BONE_NODE_MISSING"));
});

test("BonePoseKeyform is Key-Art specific and absent pose has identity semantics", () => {
  const project = boneProject();
  addKeyArt(project, "key_b");
  addKeyArt(project, "key_a");
  addBone(project, { id: "upper" });
  assert.deepEqual(identityBonePoseDelta(), { x: 0, y: 0, rotation: 0 });
  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({
    boneId: "upper",
    keyArtId: "key_b",
    localDelta: { x: 4, y: -2, rotation: 0.5 },
  }));
  assert.deepEqual(validateProject(project), []);

  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({
    boneId: "upper",
    keyArtId: "key_b",
    localDelta: { x: 0, y: 0, rotation: 0 },
  }));
  assert.ok(codes(project).includes("BONE_POSE_INVALID"));
  project.rig.bonePoseKeyforms.pop();
  project.rig.bonePoseKeyforms[0].keyArtId = "missing";
  assert.ok(codes(project).includes("BONE_KEYART_REFERENCE_INVALID"));
});

test("Save Open preserves canonical Bone and pose order", () => {
  const project = boneProject();
  addKeyArt(project, "key_b");
  addKeyArt(project, "key_a");
  addBone(project, { id: "z_upper" });
  addBone(project, { id: "a_forearm", parentNodeId: "z_upper", x: 100 });
  project.rig.bones.reverse();
  project.rig.bonePoseKeyforms.push(
    createBonePoseKeyform({
      boneId: "z_upper",
      keyArtId: "key_b",
      localDelta: { x: 0, y: 0, rotation: 0.4 },
    }),
    createBonePoseKeyform({
      boneId: "a_forearm",
      keyArtId: "key_a",
      localDelta: { x: 0, y: 0, rotation: -0.2 },
    }),
  );
  project.rig.bonePoseKeyforms.reverse();
  const now = () => new Date("2026-09-08T00:00:00.000Z");
  const serialized = serializeProject(project, 2, { now });
  const opened = deserializeProject(serialized);
  assert.deepEqual(opened.rig.bones.map(({ id }) => id), ["a_forearm", "z_upper"]);
  assert.deepEqual(
    opened.rig.bonePoseKeyforms.map(({ boneId, keyArtId }) => [boneId, keyArtId]),
    [["a_forearm", "key_a"], ["z_upper", "key_b"]],
  );
  assert.equal(serializeProject(opened, 2, { now }), serialized);
});

test("schema 6 migration initializes typed Bone state and preserves Phase 6 Warp data", () => {
  const legacy = boneProject();
  legacy.schemaVersion = 6;
  legacy.rig.bones.push({ id: "untyped_placeholder", arbitrary: true });
  delete legacy.rig.bonePoseKeyforms;
  const warpState = {
    deformers: structuredClone(legacy.rig.deformers),
    warpControlPoints: structuredClone(legacy.rig.warpControlPoints),
    warpDeformerKeyforms: structuredClone(legacy.rig.warpDeformerKeyforms),
  };
  const migrated = migrateProjectSchema(legacy);
  assert.equal(migrated.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.deepEqual(migrated.rig.bones, []);
  assert.deepEqual(migrated.rig.bonePoseKeyforms, []);
  assert.deepEqual(migrated.rig.deformers, warpState.deformers);
  assert.deepEqual(migrated.rig.warpControlPoints, warpState.warpControlPoints);
  assert.deepEqual(migrated.rig.warpDeformerKeyforms, warpState.warpDeformerKeyforms);
  assert.deepEqual(validateProject(migrated), []);
});
