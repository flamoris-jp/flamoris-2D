import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DesktopMp4ExportJob } from "../src/ui/desktop-video-export.js";

function fixture() {
  return {
    id: "project",
    canvas: { width: 64, height: 64 },
    transitions: [{ id: "transition", temporalProgramId: "program" }],
    temporalPrograms: [{
      id: "program",
      durationTicks: 120000,
      tracks: [],
      events: [],
      regions: [],
    }],
  };
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

function request(overrides = {}) {
  return {
    project: fixture(),
    transitionId: "transition",
    frameRate: { numerator: 2, denominator: 1 },
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: [],
    suggestedName: "shot",
    ...overrides,
  };
}

function desktopHarness() {
  const writes = [];
  const encodes = [];
  const cancels = [];
  return {
    writes,
    encodes,
    cancels,
    api: {
      async beginVideoExport(options) {
        assert.equal(options.temporaryFrames, true);
        return {
          sessionId: "video-1",
          destination: "C:/exports/shot.mp4",
          temporaryFrames: true,
        };
      },
      async writeVideoFrame(frame) {
        writes.push({ ...frame, bytes: [...frame.bytes] });
        return { ok: true, writtenFrames: writes.length };
      },
      async encodeVideo(options) {
        encodes.push(options);
        return {
          ok: true,
          destination: "C:/exports/shot.mp4",
          frameCount: options.frameCount,
          diagnostics: [],
        };
      },
      async cancelVideoExport(options) {
        cancels.push(options);
        return { ok: true, canceled: true };
      },
    },
  };
}

test("one-shot MP4 export renders ordered PNG frames behind an opaque Desktop session", async () => {
  const desktop = desktopHarness();
  const progress = [];
  const job = new DesktopMp4ExportJob({
    desktopApi: desktop.api,
    frameRenderer: fakeFrameRenderer(),
    encodePng: async (frame) => new Uint8Array([frame.data[0], 80, 78, 71]),
  });

  const result = await job.run(request({
    onProgress: (entry) => progress.push(entry),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.totalFrames, 2);
  assert.equal(result.destination, "C:/exports/shot.mp4");
  assert.deepEqual(desktop.writes.map((entry) => entry.fileName), [
    "frame_000001.png",
    "frame_000002.png",
  ]);
  assert.equal(desktop.encodes.length, 1);
  assert.equal("frameDirectory" in desktop.encodes[0], false);
  assert.deepEqual(desktop.encodes[0].frameRate, { numerator: 2, denominator: 1 });
  assert.equal(desktop.encodes[0].frameCount, 2);
  assert.deepEqual(progress.map((entry) => entry.phase), [
    "rendering",
    "rendering",
    "encoding",
  ]);
  assert.equal(desktop.cancels.length, 0);
});

test("cancel between frame production and encoding closes the Desktop video session", async () => {
  const desktop = desktopHarness();
  const controller = new AbortController();
  let encodeCalls = 0;
  desktop.api.encodeVideo = async () => {
    encodeCalls += 1;
    return { ok: true, diagnostics: [] };
  };
  const job = new DesktopMp4ExportJob({
    desktopApi: desktop.api,
    frameRenderer: fakeFrameRenderer(),
    encodePng: async () => new Uint8Array([1]),
  });

  const result = await job.run(request({
    signal: controller.signal,
    onProgress(entry) {
      if (entry.phase === "encoding") controller.abort();
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  assert.equal(result.diagnostics[0].code, "export.cancelled");
  assert.equal(encodeCalls, 0);
  assert.deepEqual(desktop.cancels, [{ sessionId: "video-1" }]);
});

test("Desktop encoder diagnostics remain actionable at the export job boundary", async () => {
  const desktop = desktopHarness();
  desktop.api.encodeVideo = async () => ({
    desktopError: {
      code: "VIDEO_ENCODER_UNAVAILABLE",
      message: "ffmpeg missing",
    },
  });
  const job = new DesktopMp4ExportJob({
    desktopApi: desktop.api,
    frameRenderer: fakeFrameRenderer(),
    encodePng: async () => new Uint8Array([1]),
  });

  const result = await job.run(request());
  assert.equal(result.ok, false);
  assert.equal(result.canceled, false);
  assert.equal(result.diagnostics[0].code, "export.encoder_failure");
  assert.equal(result.diagnostics[0].sourceCode, "VIDEO_ENCODER_UNAVAILABLE");
  assert.match(result.diagnostics[0].message, /ffmpeg missing/);
});

test("Desktop MP4 export adapter is packaged and contains no direct filesystem/process access", async () => {
  const source = await readFile(
    new URL("../src/ui/desktop-video-export.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /node:fs|node:child_process|\bspawn\s*\(/);

  const productionFiles = await readFile(
    new URL("../production-files.txt", import.meta.url),
    "utf8",
  );
  assert.match(productionFiles, /^src\/ui\/desktop-video-export\.js$/m);
});
