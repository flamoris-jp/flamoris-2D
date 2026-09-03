import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { EndpointMeshController } from "../src/ui/endpoint-mesh-controller.js";
import {
  KeyStateStripController,
  projectKeyStateStrip,
} from "../src/ui/key-state-strip-controller.js";
import { TransitionAuthoringController } from "../src/ui/transition-authoring-controller.js";
import { TransitionPreviewController } from "../src/ui/transition-preview-controller.js";
import { MeshToolController } from "../src/ui/mesh-tool-controller.js";

function member(nodeId, appearanceId) {
  return {
    nodeId, appearanceId, opacity: 1, presence: "present", drawOrder: 0,
    clipping: { sourceNodeId: null },
  };
}

function fixture() {
  const project = createProject({
    name: "Key State Strip", width: 100, height: 100,
    idFactory: createIdFactory("key-state-strip"),
  });
  for (const id of ["node_a", "node_b"]) {
    project.scene.nodes[id] = createSceneNode({
      id, displayName: id, parentId: project.scene.rootId,
      bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "appearance_a")], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "appearance_b")], metadata: {} },
  );
  project.semanticSlots.push({
    id: "semantic", displayName: "Part", role: "part", metadata: {},
    mappings: [
      { keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" },
    ],
  });
  project.meshTopologies.push({
    id: "topology", vertexIds: ["vtx_0001", "vtx_0002", "vtx_0003"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 4,
  });
  project.meshKeyforms.push(
    { id: "keyform_a", topologyId: "topology", keyArtId: "keyart_a", semanticSlotId: "semantic", positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "keyform_b", topologyId: "topology", keyArtId: "keyart_b", semanticSlotId: "semantic", positions: [10, 10, 20, 10, 10, 20], uvs: [0, 0, 1, 0, 0, 1] },
  );
  project.temporalPrograms.push({ id: "program", durationTicks: 120000, tracks: [], events: [], regions: [] });
  project.transitions.push({
    id: "transition", displayName: "A → B", fromKeyArtId: "keyart_a", toKeyArtId: "keyart_b",
    temporalProgramId: "program", diagnosticOverrides: [],
    partTransitions: [{
      id: "part", semanticSlotId: "semantic", mode: "morph", topologyId: "topology",
      fromKeyformId: "keyform_a", toKeyformId: "keyform_b", configuration: {},
    }],
  });
  const session = new EditorSession(project);
  const authoring = new TransitionAuthoringController(session);
  authoring.selectTransition("transition");
  authoring.selectSemanticSlot("semantic");
  const endpoint = new EndpointMeshController(session, authoring);
  endpoint.selectTopology("topology");
  endpoint.selectKeyform("from", "keyform_a");
  endpoint.selectKeyform("to", "keyform_b");
  const preview = new TransitionPreviewController(session, authoring);
  const meshTools = new MeshToolController(session, endpoint, {
    isPreviewReadOnly: () => preview.getState().viewMode === "preview",
  });
  const scheduled = [];
  const cancelled = [];
  const endpointEdits = [];
  const strip = new KeyStateStripController(preview, endpoint, {
    meshTools,
    scheduleFrame(callback) { scheduled.push(callback); return scheduled.length; },
    cancelFrame(handle) { cancelled.push(handle); },
    onEndpointEdit(state) { endpointEdits.push(state.id); },
  });
  return { session, endpoint, preview, meshTools, strip, scheduled, cancelled, endpointEdits };
}

test("generic Key State Strip projection accepts any number of states", () => {
  const state = projectKeyStateStrip({
    states: [
      { id: "a", label: "A", tick: 0 },
      { id: "b", label: "B", tick: 25 },
      { id: "c", label: "C", tick: 90 },
    ],
    currentTick: 37,
    durationTicks: 100,
    activeStateId: "b",
    interactionMode: "edit",
  });
  assert.deepEqual(state.states.map(({ id, progress, active }) => ({ id, progress, active })), [
    { id: "a", progress: 0, active: false },
    { id: "b", progress: 0.25, active: true },
    { id: "c", progress: 0.9, active: false },
  ]);
  assert.equal(state.percentage, 37);
});

test("Phase 3-2 projection maps current Transition A/B without persistent multi-state data", () => {
  const { session, strip } = fixture();
  const state = strip.getState();
  assert.equal(state.interactionMode, "idle");
  assert.deepEqual(state.states.map(({ id, label, tick, endpoint, keyArtId }) =>
    ({ id, label, tick, endpoint, keyArtId })), [
    { id: "endpoint-a", label: "A", tick: 0, endpoint: "from", keyArtId: "keyart_a" },
    { id: "endpoint-b", label: "B", tick: 120000, endpoint: "to", keyArtId: "keyart_b" },
  ]);
  assert.equal(Object.hasOwn(session.project, "keyStates"), false);
});

test("marker selection enters the matching endpoint edit context in Deform Mode", () => {
  const { endpoint, preview, meshTools, strip, endpointEdits } = fixture();
  meshTools.setMode("topology");
  strip.selectState("endpoint-b");
  assert.equal(endpoint.getState().activeEndpoint, "to");
  assert.equal(endpoint.getState().editingEnabled, true);
  assert.equal(preview.getState().viewMode, "endpoint-b");
  assert.equal(strip.getState().interactionMode, "edit");
  assert.equal(meshTools.getState().mode, "deform");
  strip.selectState("endpoint-a");
  assert.equal(endpoint.getState().activeEndpoint, "from");
  assert.deepEqual(endpointEdits, ["endpoint-b", "endpoint-a"]);
});

test("scrubbing is read-only, evaluator-backed, and history-free at all ticks", () => {
  const { session, endpoint, preview, meshTools, strip } = fixture();
  const originalProject = JSON.stringify(session.project);
  const originalQuery = session.query.bind(session);
  const evaluatedTicks = [];
  session.query = (name, input) => {
    if (name === "transition.evaluate") evaluatedTicks.push(input.timeTicks);
    return originalQuery(name, input);
  };
  const historyLength = session.history.length;
  for (const tick of [0, 60000, 120000]) strip.scrubToTick(tick);
  assert.deepEqual(evaluatedTicks, [0, 60000, 120000]);
  assert.equal(preview.getState().viewMode, "preview");
  assert.equal(endpoint.getState().editingEnabled, false);
  assert.equal(strip.getState().interactionMode, "preview");
  assert.throws(() => meshTools.execute("deform.move", {
    positions: [0, 0, 10, 0, 0, 10],
  }), /Preview is read-only/);
  assert.equal(session.history.length, historyLength);
  assert.equal(JSON.stringify(session.project), originalProject);
  assert.deepEqual(strip.getState().evaluation, session.query("transition.evaluate", {
    transitionId: "transition", timeTicks: 120000,
  }));
});

test("duration seconds derive from ticks and duration edit uses Command/Undo/Redo", () => {
  const { session, strip } = fixture();
  assert.equal(strip.getState().durationSeconds, 1);
  strip.setDurationSeconds(10);
  assert.equal(session.project.temporalPrograms[0].durationTicks, 1200000);
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.set_duration"]);
  session.undo();
  assert.equal(session.project.temporalPrograms[0].durationTicks, 120000);
  session.redo();
  assert.equal(session.project.temporalPrograms[0].durationTicks, 1200000);
});

test("Once playback reaches the integer end tick and stops without history", () => {
  const { session, strip, scheduled } = fixture();
  const historyLength = session.history.length;
  strip.setPlaybackMode("once");
  strip.play(0);
  scheduled.shift()(500);
  assert.equal(strip.getState().currentTick, 60000);
  scheduled.shift()(1000);
  assert.equal(strip.getState().currentTick, 120000);
  assert.equal(strip.getState().playing, false);
  assert.equal(session.history.length, historyLength);
});

test("Loop playback wraps the integer tick to zero and remains transient", () => {
  const { session, strip, scheduled } = fixture();
  const historyLength = session.history.length;
  strip.setPlaybackMode("loop");
  strip.play(0);
  scheduled.shift()(1000);
  assert.equal(strip.getState().currentTick, 0);
  assert.equal(strip.getState().playing, true);
  assert.equal(session.history.length, historyLength);
  assert.doesNotMatch(serializeProject(session.project), /playbackMode|playing|currentTick|percentage/);
  strip.pause();
});

test("Key State Strip controller and evaluator path are DOM-independent", async () => {
  const [stripSource, viewSource, previewSource] = await Promise.all([
    readFile(new URL("../src/ui/key-state-strip-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/key-state-strip-view.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/transition-preview-controller.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(stripSource, /document\.|querySelector|createElement/);
  assert.match(viewSource, /stripState\.states\.map\(marker\)/);
  assert.match(previewSource, /this\.session\.query\("transition\.evaluate"/);
});
