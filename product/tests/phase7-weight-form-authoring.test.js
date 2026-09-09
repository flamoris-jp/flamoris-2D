import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { serializeProject } from "../src/io/project-json.js";
import { createProject, createIdFactory, createSceneNode } from "../src/model/project.js";
import { createBone, boneSceneTransform } from "../src/model/bone.js";
import { createSkinBinding } from "../src/model/skin-binding.js";
import { WeightAuthoringController } from "../src/ui/weight-authoring-controller.js";
import { FormCorrectionAuthoringController } from "../src/ui/form-correction-authoring-controller.js";
import { projectWeightOverlay } from "../src/ui/weight-viewport-overlay.js";

function fixture() {
  const project = createProject({ name: "Authoring", width: 100, height: 100,
    idFactory: createIdFactory("weight_form_authoring") });
  const rootId = project.scene.rootId;
  project.scene.nodes.part = createSceneNode({ id: "part", displayName: "Part", parentId: rootId });
  for (const [index, id] of ["a", "b", "c", "d", "e"].entries()) {
    project.scene.nodes[id] = createSceneNode({ id, kind: "bone", displayName: id,
      parentId: rootId, transform: boneSceneTransform({ x: index, y: 0, rotation: 0 }) });
    project.rig.bones.push(createBone({ id, parentNodeId: rootId,
      restLocalTransform: { x: index, y: 0, rotation: 0 }, length: 1 }));
  }
  project.scene.nodes[rootId].children.push("part", "a", "b", "c", "d", "e");
  project.keyArts.push(
    { id: "key_a", displayName: "A", rootNodeId: rootId, members: [{ nodeId: "part",
      appearanceId: "appearance_a", opacity: 1, presence: "present", drawOrder: 0,
      clipping: { sourceNodeId: null } }], metadata: {} },
    { id: "key_b", displayName: "B", rootNodeId: rootId, members: [{ nodeId: "part",
      appearanceId: "appearance_b", opacity: 1, presence: "present", drawOrder: 0,
      clipping: { sourceNodeId: null } }], metadata: {} },
  );
  project.semanticSlots.push({ id: "slot", displayName: "Slot", mappings: [
    { keyArtId: "key_a", nodeId: "part" }, { keyArtId: "key_b", nodeId: "part" },
  ], metadata: {} });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  for (const key of ["a", "b"]) project.meshKeyforms.push({ id: `mesh_${key}`,
    topologyId: "topology", keyArtId: `key_${key}`, semanticSlotId: "slot",
    positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] });
  project.rig.skinBindings.push(createSkinBinding({ id: "skin", targetNodeId: "part",
    topologyId: "topology", vertexWeights: ["v1", "v2", "v3"].map((vertexId) => ({
      vertexId, influences: [{ boneId: "a", weight: 1 }],
    })) }));
  return new EditorSession(project);
}

function weightController(session) {
  const controller = new WeightAuthoringController(session);
  controller.setContext({ bindingId: "skin", targetNodeId: "part", boneId: "b", keyArtId: "key_a" });
  return controller;
}

test("weight Add and Subtract stroke commits once and Undo Redo restores exact stable IDs", () => {
  const session = fixture();
  const controller = weightController(session);
  session.markSaved();
  controller.setBrush({ operation: "add", strength: 0.5 });
  controller.beginStroke();
  controller.previewStroke(["v2"]);
  controller.previewStroke(["v2", "v3"]);
  assert.equal(session.isDirty, false);
  assert.equal(session.undoStack.length, 0);
  controller.commitStroke();
  assert.equal(session.undoStack.length, 1);
  assert.deepEqual(session.undoStack[0].commands.map((entry) => entry.type), ["skin.set_weights_bulk"]);
  const edited = session.query("skin.get_binding", { bindingId: "skin" });
  assert.deepEqual(edited.vertexWeights.map((entry) => entry.vertexId), ["v1", "v2", "v3"]);
  assert.ok(Math.abs(edited.vertexWeights[1].influences[1].weight - 1 / 3) < 1e-15);
  session.undo();
  assert.deepEqual(session.query("skin.get_vertex_weights", {
    bindingId: "skin", vertexId: "v2",
  }).influences, [{ boneId: "a", weight: 1 }]);
  session.redo();
  assert.deepEqual(session.query("skin.get_binding", { bindingId: "skin" }), edited);

  controller.setBrush({ operation: "subtract", strength: 0.2 });
  controller.beginStroke();
  controller.previewStroke(["v2"]);
  controller.commitStroke();
  assert.ok(session.query("skin.get_vertex_weights", { bindingId: "skin", vertexId: "v2" })
    .influences.find((entry) => entry.boneId === "b").weight < 1 / 3);
});

test("first human weight action can create a complete stable-ID SkinBinding", () => {
  const session = fixture();
  session.execute({ type: "skin.remove_binding", payload: { bindingId: "skin" } });
  const controller = new WeightAuthoringController(session, { idFactory: () => "new_skin" });
  controller.setContext({ bindingId: null, targetNodeId: "part", boneId: "b", keyArtId: "key_a" });
  controller.createBinding({ topologyId: "topology" });
  const binding = session.query("skin.get_binding", { bindingId: "new_skin" });
  assert.deepEqual(binding.vertexWeights.map((entry) => entry.vertexId), ["v1", "v2", "v3"]);
  assert.ok(binding.vertexWeights.every((entry) => entry.influences[0].boneId === "b"));
});

test("numeric normalize clear and replace operations reuse canonical SkinBinding representation", () => {
  const session = fixture();
  const controller = weightController(session);
  controller.setNumericWeight("v1", 0.25);
  assert.deepEqual(session.query("skin.get_vertex_weights", { bindingId: "skin", vertexId: "v1" })
    .influences, [{ boneId: "a", weight: 0.75 }, { boneId: "b", weight: 0.25 }]);
  controller.normalize("v1");
  controller.clearActiveInfluence("v1");
  assert.deepEqual(session.query("skin.get_vertex_weights", { bindingId: "skin", vertexId: "v1" })
    .influences, [{ boneId: "a", weight: 1 }]);
  controller.replaceInfluences("v1", [
    { boneId: "c", weight: 0.5 }, { boneId: "a", weight: 0.5 },
  ]);
  assert.deepEqual(session.query("skin.get_vertex_weights", { bindingId: "skin", vertexId: "v1" })
    .influences.map((entry) => entry.boneId), ["a", "c"]);
});

test("weight authoring rejects a fifth influence until explicit replacement", () => {
  const session = fixture();
  const controller = weightController(session);
  controller.replaceInfluences("v1", ["a", "c", "d", "e"].map((boneId) =>
    ({ boneId, weight: 0.25 })));
  assert.throws(() => controller.setNumericWeight("v1", 0.1), {
    code: "SKIN_BINDING_INFLUENCE_COUNT_INVALID",
  });
});

test("weight selection active Bone Key Art and stroke preview stay transient", () => {
  const session = fixture();
  const controller = weightController(session);
  session.markSaved();
  const now = () => new Date("2026-09-09T00:00:00.000Z");
  const before = serializeProject(session.project, 2, { now });
  controller.setSelectedVertex("v2");
  controller.setBrush({ operation: "add", strength: 0.2 });
  controller.beginStroke();
  controller.previewStroke(["v1", "v2"]);
  assert.equal(session.isDirty, false);
  assert.equal(serializeProject(session.project, 2, { now }), before);
  assert.equal(controller.getState().activeBoneId, "b");
  assert.equal(controller.getState().activeKeyArtId, "key_a");
});

test("form correction first gesture creates active-Key-Art keyform once and A B stay independent", () => {
  const session = fixture();
  let sequence = 0;
  const controller = new FormCorrectionAuthoringController(session, {
    idFactory: () => `correction_${++sequence}`,
  });
  controller.setContext({ topologyId: "topology", keyArtId: "key_a",
    semanticSlotId: "slot", targetNodeId: "part" });
  controller.selectVertex("v2");
  controller.beginGesture();
  controller.previewGesture({ x: 1, y: 2 });
  controller.previewGesture({ x: 3, y: 4 });
  assert.equal(session.undoStack.length, 0);
  controller.commitGesture();
  assert.equal(session.undoStack.length, 1);
  assert.deepEqual(session.query("mesh_form.get_for_context", { topologyId: "topology",
    keyArtId: "key_a", semanticSlotId: "slot" }).vertexOffsets,
  [{ vertexId: "v2", x: 3, y: 4 }]);
  assert.equal(session.query("mesh_form.get_for_context", { topologyId: "topology",
    keyArtId: "key_b", semanticSlotId: "slot" }), null);
  session.undo();
  assert.equal(session.query("mesh_form.get_for_context", { topologyId: "topology",
    keyArtId: "key_a", semanticSlotId: "slot" }), null);
  session.redo();
  assert.equal(session.query("mesh_form.get_for_context", { topologyId: "topology",
    keyArtId: "key_a", semanticSlotId: "slot" }).vertexOffsets[0].x, 3);
});

test("form correction preview selection and context stay transient and reset is Undoable", () => {
  const session = fixture();
  const controller = new FormCorrectionAuthoringController(session, { idFactory: () => "correction" });
  controller.setContext({ topologyId: "topology", keyArtId: "key_a", semanticSlotId: "slot" });
  controller.selectVertex("v1");
  session.markSaved();
  const now = () => new Date("2026-09-09T00:00:00.000Z");
  const before = serializeProject(session.project, 2, { now });
  controller.beginGesture();
  controller.previewGesture({ x: 5, y: -1 });
  assert.equal(session.isDirty, false);
  assert.equal(serializeProject(session.project, 2, { now }), before);
  controller.commitGesture();
  controller.reset();
  assert.equal(session.query("mesh_form.get_for_context", { topologyId: "topology",
    keyArtId: "key_a", semanticSlotId: "slot" }), null);
  session.undo();
  assert.equal(session.query("mesh_form.get_for_context", { topologyId: "topology",
    keyArtId: "key_a", semanticSlotId: "slot" }).vertexOffsets[0].x, 5);
});

test("CPU weight overlay exposes selected Bone weight by stable vertex ID", () => {
  const session = fixture();
  const overlay = projectWeightOverlay({
    topology: session.query("mesh.get_topology", { topologyId: "topology" }),
    positions: [0, 0, 10, 0, 0, 10],
    binding: session.query("skin.get_binding", { bindingId: "skin" }),
    boneId: "a", view: { originX: 2, originY: 3, scale: 2 },
  });
  assert.deepEqual(overlay.vertices.map((entry) => [entry.vertexId, entry.weight]),
    [["v1", 1], ["v2", 1], ["v3", 1]]);
  assert.deepEqual(overlay.vertices[1].point, { x: 22, y: 3 });
});

test("weight and form controllers are DOM-independent and production packaged", async () => {
  const files = [
    "../src/ui/weight-authoring-controller.js",
    "../src/ui/form-correction-authoring-controller.js",
    "../src/ui/weight-viewport-overlay.js",
  ];
  const [sources, manifest] = await Promise.all([
    Promise.all(files.map((path) => readFile(new URL(path, import.meta.url), "utf8"))),
    readFile(new URL("../production-files.txt", import.meta.url), "utf8"),
  ]);
  for (const source of sources) assert.doesNotMatch(source, /document\.|window\./);
  for (const path of files) assert.match(manifest, new RegExp(path.split("/").at(-1).replace(".", "\\.")));
});
