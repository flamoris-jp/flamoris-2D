import test from "node:test";
import assert from "node:assert/strict";

import {
  FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY,
  FrameSequenceExportJob,
  exportFrameFileName,
} from "../src/core/frame-sequence-export.js";
import { encodeRgba8Png } from "../src/core/png-frame-encoder.js";
import { createIdFactory, createProject } from "../src/model/project.js";

function fixture() {
  const project = createProject({
    name: "Sequence export",
    width: 64,
    height: 64,
    idFactory: createIdFactory("sequence"),
  });
  project.keyArts.push(
    { id: "a", displayName: "A", rootNodeId: project.scene.rootId, members: [], metadata: {} },
    { id: "b", displayName: "B", rootNodeId: project.scene.rootId, members: [], metadata: {} },
  );
  project.temporalPrograms.push({
    id: "program",
    durationTicks: 120000,
    tracks: [], events: [], regions: [],
  });
  project.transitions.push({
    id: "transition",
    displayName: "A to B",
    fromKeyArtId: "a",
    toKeyArtId: "b",
    temporalProgramId: "program",
    partTransitions: [],
    diagnosticOverrides: [],
  });
  return project;
}

function fakeFrameRenderer() {
  return {
    render({ frameIndex, outputWidth, outputHeight }) {
      return {
        ok: true,
        offscreenResult: {
          kind: "rgba8",
          width: outputWidth,
          height: outputHeight,
          rowOrder: "top-to-bottom",
          alphaMode: "premultiplied",
          data: new Uint8Array(outputWidth * outputHeight * 4).fill(frameIndex),
        },
        diagnostics: [],
      };
    },
  };
}

function recordingSink({ failAt = null } = {}) {
  const writes = [];
  const endings = [];
  return {
    writes,
    endings,
    async begin(request) {
      return { sessionId: "sequence-1", destination: "C:/exports/shot", request };
    },
    async write(_session, frame) {
      if (frame.frameIndex === failAt) throw new Error("disk full");
      writes.push({ fileName: frame.fileName, frameIndex: frame.frameIndex, bytes: [...frame.bytes] });
    },
    async end(_session, details) {
      endings.push(details);
    },
  };
}

test("frame sequence filenames are stable, one-based, and zero padded", () => {
  assert.equal(exportFrameFileName(0), "frame_000001.png");
  assert.equal(exportFrameFileName(23), "frame_000024.png");
  assert.equal(exportFrameFileName(999999), "frame_1000000.png");
  assert.throws(() => exportFrameFileName(-1), /non-negative/);
});

test("sequence export writes frames in exact planner order and reports progress", async () => {
  const sink = recordingSink();
  const progress = [];
  const job = new FrameSequenceExportJob({
    frameRenderer: fakeFrameRenderer(),
    encodePng: async (frame) => new Uint8Array([frame.data[0], 80, 78, 71]),
    sequenceSink: sink,
  });
  const result = await job.run({
    project: fixture(),
    transitionId: "transition",
    frameRate: { numerator: 24, denominator: 1 },
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: [],
    suggestedName: "shot",
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal(result.ok, true);
  assert.equal(result.writtenFrames, 24);
  assert.deepEqual(sink.writes.map((entry) => entry.fileName),
    Array.from({ length: 24 }, (_, index) => exportFrameFileName(index)));
  assert.deepEqual(progress.map((entry) => entry.completedFrames),
    Array.from({ length: 24 }, (_, index) => index + 1));
  assert.equal(sink.endings[0].status, "completed");
  assert.deepEqual(FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY, {
    onCancel: "keep-written-frames",
    onFailure: "keep-written-frames",
    overwrite: "reject-existing-output",
  });
});

test("cancel stops remaining work and preserves the written prefix", async () => {
  const sink = recordingSink();
  const signal = { aborted: false };
  const job = new FrameSequenceExportJob({
    frameRenderer: fakeFrameRenderer(),
    encodePng: async () => new Uint8Array([1]),
    sequenceSink: sink,
  });
  const result = await job.run({
    project: fixture(),
    transitionId: "transition",
    frameRate: { numerator: 24, denominator: 1 },
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: [],
    signal,
    onProgress(entry) {
      if (entry.completedFrames === 2) signal.aborted = true;
    },
  });

  assert.equal(result.canceled, true);
  assert.equal(result.writtenFrames, 2);
  assert.equal(sink.writes.length, 2);
  assert.equal(sink.endings[0].status, "cancelled");
  assert.equal(result.diagnostics[0].code, "export.cancelled");
});

test("frame write failure aborts without silently skipping later frames", async () => {
  const sink = recordingSink({ failAt: 2 });
  const job = new FrameSequenceExportJob({
    frameRenderer: fakeFrameRenderer(),
    encodePng: async () => new Uint8Array([1]),
    sequenceSink: sink,
  });
  const result = await job.run({
    project: fixture(),
    transitionId: "transition",
    frameRate: { numerator: 24, denominator: 1 },
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.writtenFrames, 2);
  assert.equal(sink.writes.length, 2);
  assert.equal(result.diagnostics[0].code, "export.frame_write_failure");
  assert.equal(sink.endings[0].status, "failed");
});

test("PNG encoder explicitly converts premultiplied RGBA to straight-alpha ImageData", async () => {
  let captured = null;
  class FakeCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext(kind) {
      if (kind !== "2d") return null;
      return {
        createImageData(width, height) {
          return { width, height, data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(imageData) {
          captured = [...imageData.data];
        },
      };
    }
    async convertToBlob() {
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    }
  }

  const bytes = await encodeRgba8Png({
    kind: "rgba8",
    width: 1,
    height: 1,
    rowOrder: "top-to-bottom",
    alphaMode: "premultiplied",
    data: new Uint8Array([64, 32, 16, 128]),
  }, { OffscreenCanvasCtor: FakeCanvas });

  assert.deepEqual(captured, [128, 64, 32, 128]);
  assert.deepEqual([...bytes], [137, 80, 78, 71]);
});
