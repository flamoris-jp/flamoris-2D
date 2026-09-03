import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { TransitionAuthoringController } from "../src/ui/transition-authoring-controller.js";
import { TransitionPreviewController } from "../src/ui/transition-preview-controller.js";

function member(nodeId, appearanceId, drawOrder) {
  return {
    nodeId, appearanceId, opacity: 1, presence: "present", drawOrder,
    clipping: { sourceNodeId: null },
  };
}

function fixture() {
  const project = createProject({
    name: "Preview", width: 100, height: 100,
    idFactory: createIdFactory("preview"),
  });
  for (const [id, left] of [["node_a", 0], ["node_b", 10]]) {
    project.scene.nodes[id] = createSceneNode({
      id, displayName: id, parentId: project.scene.rootId,
      bounds: { left, top: 0, right: left + 10, bottom: 10 },
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "appearance_a", 1)], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "appearance_b", 2)], metadata: {} },
  );
  project.semanticSlots.push({
    id: "semantic_eye", displayName: "Eye", role: "eye", metadata: {},
    mappings: [
      { keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" },
    ],
  });
  project.meshTopologies.push({ id: "topology_eye", vertexIds: ["v1", "v2", "v3"], indices: [0, 1, 2] });
  project.meshKeyforms.push(
    { id: "keyform_a", topologyId: "topology_eye", keyArtId: "keyart_a", semanticSlotId: "semantic_eye", positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "keyform_b", topologyId: "topology_eye", keyArtId: "keyart_b", semanticSlotId: "semantic_eye", positions: [5, 5, 15, 5, 5, 15], uvs: [0.1, 0.2, 0.9, 0.2, 0.1, 0.8] },
  );
  project.temporalPrograms.push({ id: "program_ab", durationTicks: 120000, tracks: [], events: [], regions: [] });
  project.transitions.push({
    id: "transition_ab", displayName: "A → B", fromKeyArtId: "keyart_a", toKeyArtId: "keyart_b",
    temporalProgramId: "program_ab", diagnosticOverrides: [],
    partTransitions: [{
      id: "part_eye", semanticSlotId: "semantic_eye", mode: "morph",
      topologyId: "topology_eye", fromKeyformId: "keyform_a", toKeyformId: "keyform_b", configuration: {},
    }],
  });
  const session = new EditorSession(project);
  const authoring = new TransitionAuthoringController(session);
  authoring.selectTransition("transition_ab");
  authoring.selectSemanticSlot("semantic_eye");
  let sequence = 0;
  const preview = new TransitionPreviewController(session, authoring, {
    idFactory: (kind) => `${kind}_preview_${++sequence}`,
  });
  return { session, authoring, preview };
}

test("preview view/tick state is transient, clamps to the program, and never enters Undo history", () => {
  const { session, preview } = fixture();
  const before = JSON.stringify(session.project);
  const historyLength = session.history.length;
  preview.selectViewMode("preview");
  preview.setTick(37001);
  preview.jumpToStart();
  preview.jumpToEnd();
  assert.equal(preview.getState().currentTick, 120000);
  assert.equal(preview.getState().normalizedProgress, 1);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, historyLength);
  assert.doesNotMatch(serializeProject(session.project), /currentTick|viewMode|selectedTrack/);
});

test("start, end, and arbitrary ticks all use transition.evaluate and remain deterministic", () => {
  const { session, preview } = fixture();
  const originalQuery = session.query.bind(session);
  const calls = [];
  session.query = (name, input) => {
    if (name === "transition.evaluate") calls.push({ ...input });
    return originalQuery(name, input);
  };
  const first = preview.setTick(41321);
  const second = preview.setTick(41321);
  preview.jumpToStart();
  preview.jumpToEnd();
  assert.deepEqual(first, second);
  assert.deepEqual(calls.map((entry) => entry.timeTicks), [41321, 41321, 0, 120000]);
  assert.equal(calls.every((entry) => entry.transitionId === "transition_ab"), true);
});

test("focused tracks distinguish default/override and keyframe edits use normal commands", () => {
  const { session, preview } = fixture();
  preview.addTrack({ kind: "OpacityTrack", target: { transitionDefault: true }, trackId: "track_default" });
  preview.addTrack({ kind: "OpacityTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "track_eye" });
  assert.deepEqual(preview.getState().tracks.map((track) => track.targetKind), ["default", "override"]);

  preview.addKeyframe("track_eye", "opacity", {
    id: "key_eye", timeTicks: 0, value: 0.25, interpolationToNext: { kind: "linear" },
  });
  preview.updateKeyframe("track_eye", "opacity", "key_eye", {
    timeTicks: 60000, value: 0.75, interpolationToNext: { kind: "bezier", x1: 0.2, y1: 0, x2: 0.8, y2: 1 },
  });
  assert.equal(session.query("animation.get_program", { programId: "program_ab" })
    .tracks.find((track) => track.trackId === "track_eye").channels.opacity.keyframes[0].timeTicks, 60000);
  preview.removeKeyframe("track_eye", "opacity", "key_eye");
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.remove_keyframe"]);
  session.undo();
  assert.equal(session.query("animation.get_program", { programId: "program_ab" })
    .tracks.find((track) => track.trackId === "track_eye").channels.opacity.keyframes.length, 1);
  session.redo();
  assert.equal(session.query("animation.get_program", { programId: "program_ab" })
    .tracks.find((track) => track.trackId === "track_eye").channels.opacity.keyframes.length, 0);
});

test("invalid interpolation and duplicate/conflicting typed state are rejected without repair", () => {
  const { session, preview } = fixture();
  preview.addTrack({ kind: "PresenceTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "track_presence" });
  const before = JSON.stringify(session.project);
  assert.throws(() => preview.addKeyframe("track_presence", "presence", {
    id: "invalid_presence", timeTicks: 0, value: "present", interpolationToNext: { kind: "linear" },
  }), TransactionError);
  assert.equal(JSON.stringify(session.project), before);
  assert.throws(() => preview.addTrack({
    kind: "TransformTrack", target: { transitionDefault: true }, trackId: "not_focused",
  }), /outside the focused/);
});

test("preview controller is DOM-free and never writes session.project directly", async () => {
  const source = await readFile(new URL("../src/ui/transition-preview-controller.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b/);
  assert.doesNotMatch(source, /session\.project/);
  assert.match(source, /session\.query\("transition\.evaluate"/);
  assert.match(source, /animation\.temporal\.add_keyframe/);
  assert.match(source, /animation\.temporal\.update_keyframe/);
  assert.match(source, /animation\.temporal\.remove_keyframe/);
});
