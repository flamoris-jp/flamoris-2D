import assert from "node:assert/strict";
import test from "node:test";

import { EditorSession } from "../src/commands/editor.js";
import { ExportFrameRenderer } from "../src/core/export-frame-renderer.js";
import { FrameSequenceExportJob } from "../src/core/frame-sequence-export.js";
import { encodeRgba8Png } from "../src/core/png-frame-encoder.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { DesktopMp4ExportJob } from "../src/ui/desktop-video-export.js";
import { renderEvaluatedViewport } from "../src/ui/viewport-renderer.js";
import {
  PROOF_TICKS,
  buildPhase8ProductionProof,
  semanticSnapshot,
} from "./helpers/phase8-production-proof.js";

const FRAME_RATE = Object.freeze({ numerator: 2400, denominator: 1 });
const EXPORT_TICKS = Object.freeze([0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550]);

function assertOneHistoryEdit(session, timeline, edit) {
  const before = structuredClone(session.project);
  const undoDepth = session.undoStack.length;
  edit();
  const after = structuredClone(session.project);
  assert.equal(session.undoStack.length, undoDepth + 1);
  assert.notDeepEqual(after, before);
  session.undo();
  timeline.projectChanged();
  assert.deepEqual(session.project, before);
  session.redo();
  timeline.projectChanged();
  assert.deepEqual(session.project, after);
  return after;
}

function renderAssets(project) {
  return Object.keys(project.scene.nodes).map((nodeId) => ({
    nodeId,
    status: "ready",
    image: {},
  }));
}

function recordingFrameRenderer(records) {
  const renderer = new ExportFrameRenderer({
    createOffscreenRenderer: () => ({
      compositionCapabilities: { clippingRasterization: true },
      renderEvaluated(plan) {
        return {
          kind: "rgba8",
          width: 64,
          height: 64,
          rowOrder: "top-to-bottom",
          alphaMode: "premultiplied",
          data: new Uint8Array(64 * 64 * 4),
        };
      },
    }),
  });
  return {
    render(input) {
      const result = renderer.render(input);
      if (result.ok) records.push({
        timeTicks: result.frame.timeTicks,
        evaluation: semanticSnapshot(result.evaluatedFrame),
        renderPlan: result.renderPlan,
      });
      return result;
    },
  };
}

class ProofCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  getContext(kind) {
    if (kind !== "2d") return null;
    return {
      createImageData: (width, height) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData() {},
    };
  }

  async convertToBlob() {
    return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      { type: "image/png" });
  }
}

const encodeProofPng = (frame) => encodeRgba8Png(frame, { OffscreenCanvasCtor: ProofCanvas });

test("production ViewLane, ClipInstance move/resize, track, key, and ease edits Undo/Redo exactly", () => {
  const { session, timeline } = buildPhase8ProductionProof();
  const original = structuredClone(session.project);
  const undoDepth = session.undoStack.length;
  timeline.previewViewBoundary("hold_a", "view_transition_ab", 90);
  assert.deepEqual(session.project, original);
  assert.equal(session.undoStack.length, undoDepth);
  assertOneHistoryEdit(session, timeline, () => timeline.commitViewBoundary());
  assert.equal(session.query("sequence.evaluate",
    { sequenceId: "sequence_proof", timeTicks: 95 }).activeViewLaneItem.kind,
  "TransitionInstance");

  const beforeMove = structuredClone(session.project);
  const beforeMoveDepth = session.undoStack.length;
  timeline.previewClipInstance("background_accent", { startTicks: 210, endTicks: 410 });
  assert.deepEqual(session.project, beforeMove);
  assert.equal(session.undoStack.length, beforeMoveDepth);
  assertOneHistoryEdit(session, timeline, () => timeline.commitClipInstance("background_accent"));
  assertOneHistoryEdit(session, timeline, () => timeline.commitClipInstance(
    "background_accent", { endTicks: 390 }, "Resize ClipInstance"));

  timeline.selectClip("clip_node_motion", { editProgram: true });
  assertOneHistoryEdit(session, timeline, () => timeline.addTrack("OpacityTrack",
    { nodeId: "background" }, { trackId: "accent_opacity" }));
  assertOneHistoryEdit(session, timeline, () => timeline.addKeyframe("accent_opacity", "opacity", {
    keyframeId: "accent_opacity_key", timeTicks: 50, value: 0.8,
  }));
  assertOneHistoryEdit(session, timeline, () => timeline.updateKeyframe(
    "accent_opacity", "opacity", "accent_opacity_key", { value: 0.7 }));
  assertOneHistoryEdit(session, timeline, () => timeline.applyEasePreset(
    "accent_opacity", "opacity", "accent_opacity_key", "ease-out"));
  timeline.selectKeyframe("accent_opacity", "opacity", "accent_opacity_key");
  assert.deepEqual(timeline.getState().selectedKeyframeValue.interpolationToNext,
    { kind: "bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 });
});

test("scrub and drag preview remain transient in the production project", () => {
  const { session, timeline } = buildPhase8ProductionProof();
  const before = structuredClone(session.project);
  const history = session.history.length;
  const undoDepth = session.undoStack.length;
  timeline.scrubToTick(PROOF_TICKS.transitionAB);
  timeline.previewClipInstance("blink_hold_c", { startTicks: 430, endTicks: 470 });
  assert.equal(timeline.getState().currentTick, PROOF_TICKS.transitionAB);
  assert.equal(timeline.getState().clipInstances.find(({ id }) => id === "blink_hold_c").startTicks,
    430);
  timeline.cancelClipPreview("blink_hold_c");
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, history);
  assert.equal(session.undoStack.length, undoDepth);
  assert.doesNotMatch(serializeProject(session.project),
    /currentTick|selectedSequence|selectedClip|dragPreview|displayUnit/u);
});

test("Save/Open preserves stable semantic evaluation at every representative production tick", () => {
  const { session } = buildPhase8ProductionProof();
  const serialized = serializeProject(session.project);
  const reopened = new EditorSession(deserializeProject(serialized));
  for (const timeTicks of Object.values(PROOF_TICKS)) {
    const before = semanticSnapshot(session.query("sequence.evaluate",
      { sequenceId: "sequence_proof", timeTicks }));
    const after = semanticSnapshot(reopened.query("sequence.evaluate",
      { sequenceId: "sequence_proof", timeTicks }));
    assert.deepEqual(after, before, `semantic evaluation changed at tick ${timeTicks}`);
  }
  assert.equal(reopened.project.schemaVersion, session.project.schemaVersion);
});

test("Preview, PNG source, and MP4 source share identical production EvaluatedFrames", async () => {
  const { project, session } = buildPhase8ProductionProof();
  const assets = renderAssets(project);
  const previewPlans = new Map();
  for (const timeTicks of [50, 150, 250, 350, 450]) {
    const evaluation = session.query("sequence.evaluate", { sequenceId: "sequence_proof", timeTicks });
    let plan = null;
    const report = renderEvaluatedViewport({
      evaluation,
      view: { originX: 0, originY: 0, scale: 1 },
      renderer: {
        compositionCapabilities: { clippingRasterization: true },
        renderEvaluated(value) { plan = value; },
      },
      resolveArtwork: () => ({}),
    });
    assert.deepEqual(report.unsupportedReasons, []);
    assert.ok(report.renderInstanceCount > 0);
    previewPlans.set(timeTicks, plan);
  }

  const pngRecords = [];
  const pngWrites = [];
  const pngJob = new FrameSequenceExportJob({
    frameRenderer: recordingFrameRenderer(pngRecords),
    encodePng: encodeProofPng,
    sequenceSink: {
      async begin() { return { sessionId: "png-proof", destination: "proof/png" }; },
      async write(_session, frame) { pngWrites.push(frame); },
      async end() {},
    },
  });
  const pngResult = await pngJob.run({
    project,
    sequenceId: "sequence_proof",
    frameRate: FRAME_RATE,
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: assets,
    suggestedName: "phase8-production-proof",
  });
  assert.equal(pngResult.ok, true);
  assert.equal(pngResult.writtenFrames, EXPORT_TICKS.length);
  assert.ok(pngWrites.every(({ bytes }) => bytes[0] === 137 && bytes[1] === 80));

  const mp4Records = [];
  const videoWrites = [];
  const videoEncodes = [];
  const mp4Job = new DesktopMp4ExportJob({
    desktopApi: {
      async beginVideoExport() {
        return { sessionId: "video-proof", destination: "proof/shot.mp4", temporaryFrames: true };
      },
      async writeVideoFrame(frame) { videoWrites.push(frame); return { ok: true }; },
      async encodeVideo(request) {
        videoEncodes.push(request);
        return { ok: true, destination: "proof/shot.mp4", diagnostics: [] };
      },
      async cancelVideoExport() { return { ok: true, canceled: true }; },
    },
    frameRenderer: recordingFrameRenderer(mp4Records),
    encodePng: encodeProofPng,
  });
  const mp4Result = await mp4Job.run({
    project,
    sequenceId: "sequence_proof",
    frameRate: FRAME_RATE,
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: assets,
    suggestedName: "phase8-production-proof",
  });
  assert.equal(mp4Result.ok, true);
  assert.equal(videoWrites.length, EXPORT_TICKS.length);
  assert.deepEqual(videoEncodes[0].frameRate, FRAME_RATE);
  assert.equal(videoEncodes[0].frameCount, EXPORT_TICKS.length);
  assert.deepEqual(pngRecords.map(({ timeTicks }) => timeTicks), EXPORT_TICKS);
  assert.deepEqual(mp4Records.map(({ timeTicks }) => timeTicks), EXPORT_TICKS);

  for (const timeTicks of EXPORT_TICKS) {
    const expected = semanticSnapshot(session.query("sequence.evaluate",
      { sequenceId: "sequence_proof", timeTicks }));
    const png = pngRecords.find((entry) => entry.timeTicks === timeTicks);
    const mp4 = mp4Records.find((entry) => entry.timeTicks === timeTicks);
    assert.deepEqual(png.evaluation, expected);
    assert.deepEqual(mp4.evaluation, expected);
    if (previewPlans.has(timeTicks)) {
      assert.deepEqual(png.renderPlan, previewPlans.get(timeTicks));
      assert.deepEqual(mp4.renderPlan, previewPlans.get(timeTicks));
    }
  }
  assert.equal(EXPORT_TICKS.includes(PROOF_TICKS.terminal), false,
    "export remains half-open while terminal inspection remains a Query concern");
});
