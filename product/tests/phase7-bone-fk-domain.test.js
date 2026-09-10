import test from "node:test";
import assert from "node:assert/strict";

import {
  boneSceneTransform,
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
import {
  boneEvaluationOrder,
  evaluateBoneFk,
  interpolateBonePoseDeltas,
  projectBoneBindFrame,
} from "../src/core/bone-fk-evaluator.js";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

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
    transform: boneSceneTransform({ x, y, rotation }),
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

function createBoneCommand({
  id,
  parentNodeId,
  x = 0,
  y = 0,
  rotation = 0,
  length = 100,
} = {}) {
  return {
    type: "bone.create",
    payload: {
      id,
      displayName: id,
      parentNodeId,
      restLocalTransform: { x, y, rotation },
      length,
    },
  };
}

test("new schema contains empty typed Bone collections", () => {
  const project = boneProject();
  assert.equal(PROJECT_SCHEMA_VERSION, 15);
  assert.deepEqual(project.rig.bones, []);
  assert.deepEqual(project.rig.bonePoseKeyforms, []);
  assert.deepEqual(project.rig.rigidBoneBindings, []);
  assert.deepEqual(project.rig.skinBindings, []);
  assert.deepEqual(project.rig.boneRotationConstraints, []);
  assert.deepEqual(project.rig.twoBoneIkConstraints, []);
  assert.deepEqual(project.meshFormCorrectionKeyforms, []);
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
  project.rig.bones[0].unsupported = true;
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
  assert.deepEqual(migrated.rig.rigidBoneBindings, []);
  assert.deepEqual(migrated.rig.skinBindings, []);
  assert.deepEqual(migrated.rig.deformers, warpState.deformers);
  assert.deepEqual(migrated.rig.warpControlPoints, warpState.warpControlPoints);
  assert.deepEqual(migrated.rig.warpDeformerKeyforms, warpState.warpDeformerKeyforms);
  assert.deepEqual(validateProject(migrated), []);
});

test("FK rest pose is identity and exposes exact head and tip", () => {
  const project = boneProject();
  addBone(project, { id: "upper", x: 10, y: 20, length: 80 });
  const result = evaluateBoneFk(project, "unused");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.poses[0].head, { x: 10, y: 20 });
  assert.deepEqual(result.poses[0].tip, { x: 90, y: 20 });
  assert.deepEqual(result.poses[0].skinMatrix, [1, 0, 0, 1, 0, 0]);
});

test("FK evaluates parent-first and parent rotation moves descendant frames", () => {
  const project = boneProject();
  addKeyArt(project, "pose");
  addBone(project, { id: "upper", length: 10 });
  addBone(project, { id: "forearm", parentNodeId: "upper", x: 10, length: 5 });
  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({
    boneId: "upper",
    keyArtId: "pose",
    localDelta: { x: 0, y: 0, rotation: Math.PI / 2 },
  }));
  assert.deepEqual(boneEvaluationOrder(project).map(({ id }) => id), ["upper", "forearm"]);
  const result = evaluateBoneFk(project, "pose");
  assert.deepEqual(result.diagnostics, []);
  const forearm = result.poses.find(({ boneId }) => boneId === "forearm");
  assert.ok(Math.abs(forearm.head.x) < 1e-12);
  assert.ok(Math.abs(forearm.head.y - 10) < 1e-12);
  assert.ok(Math.abs(forearm.tip.x) < 1e-12);
  assert.ok(Math.abs(forearm.tip.y - 15) < 1e-12);
});

test("FK result is independent of Bone collection insertion order", () => {
  const project = boneProject();
  addKeyArt(project, "pose");
  addBone(project, { id: "z_root", x: 2, y: 3, length: 10 });
  addBone(project, { id: "a_child", parentNodeId: "z_root", x: 10, length: 5 });
  project.rig.bonePoseKeyforms.push(createBonePoseKeyform({
    boneId: "a_child",
    keyArtId: "pose",
    localDelta: { x: 0, y: 0, rotation: 0.25 },
  }));
  const expected = evaluateBoneFk(project, "pose");
  project.rig.bones.reverse();
  project.rig.bonePoseKeyforms.reverse();
  assert.deepEqual(evaluateBoneFk(project, "pose"), expected);
});

test("FK rejects Bone identity that does not match the authoritative Scene hierarchy", () => {
  const missingNode = boneProject();
  addBone(missingNode, { id: "upper", length: 10 });
  delete missingNode.scene.nodes.upper;
  assert.deepEqual(
    evaluateBoneFk(missingNode, "unused").diagnostics.map(({ code, boneId }) =>
      [code, boneId]),
    [["BONE_NODE_MISSING", "upper"]],
  );

  const mismatchedParent = boneProject();
  addBone(mismatchedParent, { id: "upper", length: 10 });
  addBone(mismatchedParent, {
    id: "forearm",
    parentNodeId: "upper",
    x: 10,
    length: 5,
  });
  mismatchedParent.rig.bones.find(({ id }) => id === "forearm").parentNodeId =
    mismatchedParent.scene.rootId;
  const mismatchResult = evaluateBoneFk(mismatchedParent, "unused");
  assert.deepEqual(mismatchResult.poses, []);
  assert.deepEqual(
    mismatchResult.diagnostics.map(({ code, boneId }) => [code, boneId]),
    [["BONE_SCENE_IDENTITY_MISMATCH", "forearm"]],
  );
});

test("FK rejects a Scene parent outside the supported Bone hierarchy", () => {
  const project = boneProject();
  project.scene.nodes.part = createSceneNode({
    id: "part",
    kind: "part",
    displayName: "part",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push("part");
  addBone(project, { id: "upper", parentNodeId: "part", length: 10 });

  const result = evaluateBoneFk(project, "unused");
  assert.deepEqual(result.poses, []);
  assert.deepEqual(
    result.diagnostics.map(({ code, boneId }) => [code, boneId]),
    [["BONE_PARENT_INVALID", "upper"]],
  );
});

test("projected post-Warp bind frame is explicit and deterministic", () => {
  const project = boneProject();
  addBone(project, { id: "upper", length: 10 });
  const shear = ({ x, y }) => ({ x: x + y * 0.5, y });
  const result = evaluateBoneFk(project, "unused", { projectPoint: shear });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.poses[0].bindMatrix, [1, 0, 0.5, 1, 0, 0]);
  assert.deepEqual(result.poses[0].skinMatrix, [1, 0, 0, 1, 0, 0]);

  const frame = projectBoneBindFrame(project.rig.bones[0],
    [1, 0, 0, 1, 0, 0], shear);
  assert.deepEqual(frame, [1, 0, 0.5, 1, 0, 0]);
});

test("degenerate projected bind frame produces a deterministic diagnostic", () => {
  const project = boneProject();
  addBone(project, { id: "upper", length: 10 });
  addBone(project, { id: "forearm", parentNodeId: "upper", x: 10, length: 5 });
  const result = evaluateBoneFk(project, "unused", {
    projectPoint: ({ x }) => ({ x, y: 0 }),
  });
  assert.deepEqual(result.poses, []);
  assert.deepEqual(result.diagnostics.map(({ code, boneId }) => [code, boneId]), [
    ["BONE_PARENT_INVALID", "forearm"],
    ["BONE_PROJECTED_FRAME_DEGENERATE", "upper"],
  ]);
});

test("Bone pose interpolation uses linear translation and shortest-arc rotation", () => {
  const degrees = (value) => value * Math.PI / 180;
  const from = { x: 0, y: 10, rotation: degrees(170) };
  const to = { x: 20, y: -10, rotation: degrees(-170) };
  assert.deepEqual(interpolateBonePoseDeltas(from, to, 0), from);
  assert.deepEqual(interpolateBonePoseDeltas(from, to, 1), to);
  const midpoint = interpolateBonePoseDeltas(from, to, 0.5);
  assert.deepEqual({ x: midpoint.x, y: midpoint.y }, { x: 10, y: 0 });
  assert.ok(Math.abs(midpoint.rotation - Math.PI) < 1e-12);
});

test("Bone commands create rename enable and pose through normal Undo Redo", () => {
  const project = boneProject();
  addKeyArt(project, "pose");
  const session = new EditorSession(project);
  session.execute(createBoneCommand({
    id: "upper",
    parentNodeId: project.scene.rootId,
    length: 10,
  }));
  session.execute(createBoneCommand({
    id: "forearm",
    parentNodeId: "upper",
    x: 10,
    length: 5,
  }));
  session.execute({
    type: "bone.rename",
    payload: { boneId: "forearm", displayName: "Forearm" },
  });
  session.execute({
    type: "bone.set_enabled",
    payload: { boneId: "forearm", enabled: false },
  });
  session.execute({
    type: "bone.set_keyform",
    payload: {
      boneId: "upper",
      keyArtId: "pose",
      localDelta: { x: 0, y: 0, rotation: Math.PI / 2 },
    },
  });

  assert.equal(session.query("bone.get", { boneId: "forearm" }).displayName, "Forearm");
  assert.equal(session.query("bone.get", { boneId: "forearm" }).enabled, false);
  assert.deepEqual(session.query("bone.list").map(({ id }) => id), ["forearm", "upper"]);
  assert.equal(session.query("bone.get_keyform", {
    boneId: "upper", keyArtId: "pose",
  }).localDelta.rotation, Math.PI / 2);
  const evaluated = session.query("bone.get_evaluated_pose", {
    boneId: "forearm", keyArtId: "pose",
  });
  assert.deepEqual(evaluated.diagnostics, []);
  assert.ok(Math.abs(evaluated.pose.head.y - 10) < 1e-12);

  session.undo();
  assert.equal(session.query("bone.get_keyform", {
    boneId: "upper", keyArtId: "pose",
  }), null);
  session.redo();
  assert.equal(session.query("bone.get_keyform", {
    boneId: "upper", keyArtId: "pose",
  }).localDelta.rotation, Math.PI / 2);
});

test("Bone rest and hierarchy changes reject authored pose reinterpretation", () => {
  const project = boneProject();
  addKeyArt(project, "pose");
  const session = new EditorSession(project);
  session.execute(createBoneCommand({
    id: "upper", parentNodeId: project.scene.rootId, length: 10,
  }));
  session.execute(createBoneCommand({
    id: "forearm", parentNodeId: "upper", x: 10, length: 5,
  }));
  session.execute({
    type: "bone.set_keyform",
    payload: {
      boneId: "forearm",
      keyArtId: "pose",
      localDelta: { x: 0, y: 0, rotation: 0.2 },
    },
  });
  const before = structuredClone(session.project);
  for (const command of [
    {
      type: "bone.set_rest",
      payload: {
        boneId: "forearm",
        restLocalTransform: { x: 10, y: 2, rotation: 0 },
        length: 5,
      },
    },
    {
      type: "bone.set_rest",
      payload: {
        boneId: "upper",
        restLocalTransform: { x: 1, y: 0, rotation: 0 },
        length: 10,
      },
    },
    {
      type: "bone.reparent",
      payload: { boneId: "upper", parentNodeId: "forearm" },
    },
  ]) {
    assert.throws(() => session.execute(command));
    assert.deepEqual(session.project, before);
  }
  session.execute({
    type: "bone.reset_keyform",
    payload: { boneId: "forearm", keyArtId: "pose" },
  });
  session.execute({
    type: "bone.set_rest",
    payload: {
      boneId: "forearm",
      restLocalTransform: { x: 10, y: 2, rotation: 0 },
      length: 6,
    },
  });
  assert.equal(session.query("bone.get", { boneId: "forearm" }).length, 6);
  assert.deepEqual(session.query("scene.get_node", { nodeId: "forearm" }).transform,
    boneSceneTransform({ x: 10, y: 2, rotation: 0 }));
  session.undo();
  assert.equal(session.query("bone.get", { boneId: "forearm" }).length, 5);
});

test("generic Scene transform cannot silently diverge from Bone rest semantics", () => {
  const project = boneProject();
  const session = new EditorSession(project);
  session.execute(createBoneCommand({
    id: "upper", parentNodeId: project.scene.rootId, x: 10, y: 20, length: 10,
  }));
  const before = structuredClone(session.project);
  assert.throws(() => session.execute({
    type: "scene.set_transform",
    payload: {
      nodeId: "upper",
      coordinateSpace: "node-local",
      transform: {
        position: { x: 30, y: 40 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        pivot: { x: 0, y: 0 },
      },
    },
  }));
  assert.deepEqual(session.project, before);
});

test("Bone reparent and leaf removal preserve exact history state", () => {
  const project = boneProject();
  const session = new EditorSession(project);
  session.execute(createBoneCommand({
    id: "upper", parentNodeId: project.scene.rootId, length: 10,
  }));
  session.execute(createBoneCommand({
    id: "forearm", parentNodeId: "upper", x: 10, length: 5,
  }));
  assert.throws(() => session.execute({
    type: "bone.remove", payload: { boneId: "upper" },
  }), /leaf Bone/);
  session.execute({
    type: "bone.reparent",
    payload: { boneId: "forearm", parentNodeId: project.scene.rootId },
  });
  assert.equal(session.query("bone.get", { boneId: "forearm" }).parentNodeId,
    project.scene.rootId);
  session.undo();
  assert.equal(session.query("bone.get", { boneId: "forearm" }).parentNodeId, "upper");
  session.redo();
  session.execute({ type: "bone.remove", payload: { boneId: "forearm" } });
  assert.deepEqual(session.query("bone.list").map(({ id }) => id), ["upper"]);
  session.undo();
  assert.deepEqual(session.query("bone.list").map(({ id }) => id), ["forearm", "upper"]);
});

test("headless capabilities expose the same typed Bone commands and queries", () => {
  const project = boneProject();
  const adapter = new HeadlessProductAdapter(new EditorSession(project));
  assert.ok(adapter.capabilities().commands["bone.create"]);
  assert.ok(adapter.capabilities().commands["bone.set_keyform"]);
  assert.ok(adapter.capabilities().queries["bone.get_evaluated_pose"]);
  adapter.execute(createBoneCommand({
    id: "upper", parentNodeId: project.scene.rootId, length: 10,
  }));
  assert.equal(adapter.query("bone.get", { boneId: "upper" }).id, "upper");
  assert.deepEqual(adapter.query("bone.validate", {}), { valid: true, issues: [] });
});
