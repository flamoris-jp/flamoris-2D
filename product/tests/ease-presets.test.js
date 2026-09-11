import assert from "node:assert/strict";
import test from "node:test";

import { EditorSession } from "../src/commands/editor.js";
import { serializeProject, deserializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { compileEasePreset, listEasePresets } from "../src/ui/ease-presets.js";
import { SequenceTimelineController } from "../src/ui/sequence-timeline-controller.js";

const EXPECTED = [
  ["ease-in", { kind: "bezier", x1: 0.42, y1: 0, x2: 1, y2: 1 }],
  ["ease-out", { kind: "bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 }],
  ["ease-in-out", { kind: "bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 }],
];

function fixture() {
  const project = createProject({ name: "Ease", width: 16, height: 16,
    idFactory: createIdFactory("ease") });
  project.scene.nodes.part = createSceneNode({ id: "part", displayName: "Part",
    parentId: project.scene.rootId });
  project.scene.nodes[project.scene.rootId].children.push("part");
  const session = new EditorSession(project);
  const timeline = new SequenceTimelineController(session, { idFactory: (kind) => `${kind}_1` });
  timeline.createClip({ displayName: "Motion", durationTicks: 120,
    clipId: "clip", programId: "program" });
  timeline.addTrack("TransformTrack", { nodeId: "part", coordinateSpace: "node-local" },
    { trackId: "transform" });
  timeline.addKeyframe("transform", "positionX", { keyframeId: "key", value: 0 });
  return { project, session, timeline };
}

test("ease presets compile to documented explicit Bezier points", () => {
  assert.deepEqual(listEasePresets().map(({ id }) => id), EXPECTED.map(([id]) => id));
  for (const [id, interpolation] of EXPECTED) {
    assert.deepEqual(compileEasePreset(id), interpolation);
  }
  assert.throws(() => compileEasePreset("magic"), /Unknown ease preset/);
});

test("applying a preset is one ordinary keyframe update and persists no preset identity", () => {
  const { session, timeline } = fixture();
  const history = session.history.length;
  timeline.applyEasePreset("transform", "positionX", "key", "ease-in-out");
  assert.equal(session.history.length, history + 1);
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.update_keyframe"]);
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    EXPECTED[2][1]);
  const serialized = serializeProject(session.project);
  assert.doesNotMatch(serialized, /ease-in|easePreset|presetName|curvePreset/iu);
  const reopened = deserializeProject(serialized);
  assert.deepEqual(reopened.temporalPrograms.find(({ id }) => id === "program")
    .tracks[0].channels.positionX.keyframes[0].interpolationToNext, EXPECTED[2][1]);
  session.undo();
  timeline.projectChanged();
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    { kind: "linear" });
  session.redo();
  timeline.projectChanged();
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    EXPECTED[2][1]);
});

test("presets reject discrete channels and numeric Bezier editing remains available", () => {
  const { session, timeline } = fixture();
  timeline.addTrack("PresenceTrack", { nodeId: "part" }, { trackId: "presence" });
  timeline.addKeyframe("presence", "presence", {
    keyframeId: "presence_key", value: "present", interpolationKind: "step",
  });
  const history = session.history.length;
  assert.throws(() => timeline.applyEasePreset(
    "presence", "presence", "presence_key", "ease-in"), /continuous channels/);
  assert.equal(session.history.length, history);
  timeline.selectKeyframe("transform", "positionX", "key");
  timeline.setKeyframeInterpolation("transform", "positionX", "key", "bezier",
    { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.8 });
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    { kind: "bezier", x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.8 });
});
