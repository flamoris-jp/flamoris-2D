import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession } from "../src/commands/editor.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { cloneProject, createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { EditorUiAdapter } from "../src/ui/editor-adapter.js";

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

function phase2cProject() {
  const project = createProject({
    name: "Phase 2C regression",
    width: 256,
    height: 256,
    idFactory: createIdFactory("phase2c"),
  });
  for (const [id, x] of [["node_a", 0], ["node_b", 20]]) {
    project.scene.nodes[id] = createSceneNode({
      id,
      displayName: id,
      parentId: project.scene.rootId,
      bounds: { left: x, top: 0, right: x + 20, bottom: 20 },
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "appearance_b")], metadata: {} },
  );
  project.semanticSlots.push({
    id: "slot_face",
    displayName: "Face",
    role: "face",
    mappings: [
      { keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" },
    ],
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology_face",
    vertexIds: ["vertex_1", "vertex_2", "vertex_3"],
    indices: [0, 1, 2],
  });
  project.meshKeyforms.push(
    {
      id: "keyform_a", topologyId: "topology_face", keyArtId: "keyart_a", semanticSlotId: "slot_face",
      positions: [0, 0, 20, 0, 0, 20], uvs: [0, 0, 1, 0, 0, 1],
    },
    {
      id: "keyform_b", topologyId: "topology_face", keyArtId: "keyart_b", semanticSlotId: "slot_face",
      positions: [5, 2, 25, 2, 5, 22], uvs: [0.1, 0.1, 0.9, 0.1, 0.1, 0.9],
    },
  );
  project.temporalPrograms.push({
    id: "program_face",
    durationTicks: 120000,
    tracks: [{
      trackId: "track_opacity",
      version: 1,
      kind: "OpacityTrack",
      target: { semanticSlotId: "slot_face" },
      channels: {
        opacity: { keyframes: [{
          id: "key_opacity",
          timeTicks: 0,
          value: 0.75,
          interpolationToNext: { kind: "linear" },
        }] },
      },
    }],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition_face",
    displayName: "Face A → B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program_face",
    partTransitions: [{
      id: "part_face",
      semanticSlotId: "slot_face",
      mode: "morph",
      topologyId: "topology_face",
      fromKeyformId: "keyform_a",
      toKeyformId: "keyform_b",
      configuration: {},
    }],
    diagnosticOverrides: [{
      key: "acknowledged-evidence",
      code: "TRANSITION_TRIANGLE_INVERSION",
      semanticSlotId: "slot_face",
      evidenceFingerprint: "00000000",
    }],
  });
  return project;
}

function phase2cSession() {
  const session = new EditorSession(phase2cProject());
  const editor = new EditorUiAdapter(session);
  editor.transitionAuthoring.selectTransition("transition_face");
  editor.transitionAuthoring.selectKeyArt("keyart_b");
  editor.transitionAuthoring.selectSemanticSlot("slot_face");
  return { session, editor };
}

test("Phase 2C persistent domains save/open exactly and evaluate equivalently", () => {
  const { session, editor } = phase2cSession();
  editor.endpointMesh.selectEndpoint("to");
  editor.endpointMesh.selectTopology("topology_face");
  editor.endpointMesh.selectKeyform("to", "keyform_b");
  editor.endpointMesh.selectVertex(2);
  editor.transitionPreview.setTick(43111);
  editor.transitionPreview.setRenderReport({ unsupportedReasons: [], renderInstanceCount: 1 });
  editor.transitionPreview.selectTrack("track_opacity");
  editor.transitionPreview.selectKeyframe("track_opacity", "opacity", "key_opacity");
  editor.transitionDiagnostics.selectDiagnostic("transient-diagnostic-selection");

  const beforeEvaluation = session.query("transition.evaluate", {
    transitionId: "transition_face",
    timeTicks: 43111,
  });
  const serialized = serializeProject(session.project, 0, {
    now: () => new Date("2026-09-03T00:00:00.000Z"),
  });
  const opened = deserializeProject(serialized);
  const openedSession = new EditorSession(opened);
  const afterEvaluation = openedSession.query("transition.evaluate", {
    transitionId: "transition_face",
    timeTicks: 43111,
  });

  for (const key of [
    "keyArts", "semanticSlots", "meshTopologies", "meshKeyforms", "temporalPrograms", "transitions",
  ]) assert.deepEqual(opened[key], session.project[key], key);
  assert.deepEqual(afterEvaluation, beforeEvaluation);
  for (const transientName of [
    "activeTransitionId", "selectedSemanticSlotId", "selectedKeyArtId", "activeEndpoint",
    "selectedTopologyId", "selectedKeyformIds", "selectedVertexIndex", "currentTick", "viewMode",
    "selectedTrackId", "selectedKeyframe", "selectedDiagnosticKey", "authoritative", "renderReport",
  ]) assert.equal(serialized.includes(`\"${transientName}\"`), false, transientName);
});

test("active Transition and SemanticSlot selections survive Undo/Redo disappearance by stable ID", () => {
  const { session, editor } = phase2cSession();
  session.execute({
    type: "transition.remove",
    payload: { transitionId: "transition_face" },
  }, { label: "Remove active Transition" });
  assert.equal(editor.transitionAuthoring.getState().activeTransitionMissing, true);
  assert.equal(editor.transitionPreview.getState().activeTransition, null);
  assert.doesNotThrow(() => editor.transitionDiagnostics.getState());

  editor.undo();
  assert.equal(editor.transitionAuthoring.getState().activeTransition.id, "transition_face");
  editor.redo();
  assert.equal(editor.transitionAuthoring.getState().activeTransitionMissing, true);
  editor.undo();

  session.execute({
    type: "semantic_slot.create",
    payload: { semanticSlot: {
      id: "slot_temporary", displayName: "Temporary", role: null, mappings: [], metadata: {},
    } },
  }, { label: "Create temporary SemanticSlot" });
  editor.transitionAuthoring.selectSemanticSlot("slot_temporary");
  editor.undo();
  assert.equal(editor.transitionAuthoring.getState().selectedSemanticSlot, null);
  assert.equal(editor.transitionAuthoring.getState().selectedSemanticSlotId, "slot_temporary");
  editor.redo();
  assert.equal(editor.transitionAuthoring.getState().selectedSemanticSlot.id, "slot_temporary");
});

test("MeshKeyform and keyframe selections remain safe through Undo/Redo", () => {
  const { session, editor } = phase2cSession();
  editor.endpointMesh.selectEndpoint("to");
  editor.endpointMesh.selectTopology("topology_face");
  editor.endpointMesh.selectKeyform("to", "keyform_b");
  editor.endpointMesh.selectVertex(1);
  session.executeTransaction([
    {
      type: "transition.set_part_mode",
      payload: {
        transitionId: "transition_face", partTransitionId: "part_face", semanticSlotId: "slot_face",
        mode: "replace", configuration: { compositeGroupId: "face_handoff" },
      },
    },
    { type: "mesh_keyform.remove", payload: { keyformId: "keyform_b" } },
  ], { label: "Remove selected MeshKeyform" });
  assert.equal(editor.endpointMesh.getState().activeKeyform, null);
  assert.equal(editor.endpointMesh.getState().selectedVertexIndex, 1);
  editor.undo();
  assert.equal(editor.endpointMesh.getState().activeKeyform.id, "keyform_b");
  editor.redo();
  assert.equal(editor.endpointMesh.getState().activeKeyform, null);
  editor.undo();

  editor.transitionPreview.selectTrack("track_opacity");
  editor.transitionPreview.addKeyframe("track_opacity", "opacity", {
    id: "key_temporary",
    timeTicks: 60000,
    value: 0.5,
    interpolationToNext: { kind: "linear" },
  });
  assert.equal(editor.transitionPreview.getState().selectedKeyframe.keyframeId, "key_temporary");
  editor.undo();
  assert.equal(editor.transitionPreview.getState().selectedKeyframe, null);
  editor.redo();
  assert.equal(session.query("animation.get_program", { programId: "program_face" })
    .tracks[0].channels.opacity.keyframes.some((entry) => entry.id === "key_temporary"), true);
});

test("preview tick clamps safely when an opened Project shortens duration", () => {
  const { session, editor } = phase2cSession();
  editor.transitionPreview.setTick(100000);
  const replacement = cloneProject(session.project);
  replacement.temporalPrograms[0].durationTicks = 60000;
  session.replaceProject(replacement);
  const state = editor.transitionPreview.getState();
  assert.equal(state.currentTick, 60000);
  assert.equal(state.evaluation.timeTicks, 60000);
});
