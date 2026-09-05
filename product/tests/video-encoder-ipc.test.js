import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { registerFrameSequenceIpc } from "../desktop/frame-sequence-ipc.mjs";
import { registerVideoEncoderIpc } from "../desktop/video-encoder-ipc.mjs";

const testRoot = resolve(process.cwd(), "test-video-encoder-ipc");
const exportDirectory = join(testRoot, "exports");
const videoOutputPath = join(exportDirectory, "shot.mp4");
const frameParentDirectory = join(testRoot, "frames");
const frameDirectory = join(frameParentDirectory, "shot");
const unapprovedFrameDirectory = join(testRoot, "private", "not-exported-by-desktop");

function harness(overrides = {}) {
  const handlers = new Map();
  const encodeCalls = [];
  const result = registerVideoEncoderIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: {
      async showSaveDialog() {
        return { canceled: false, filePath: videoOutputPath };
      },
    },
    mainWindow: () => ({ id: "window" }),
    assertTrusted: () => {},
    associatedDirectory: () => exportDirectory,
    isApprovedFrameDirectory: (path) => resolve(path) === frameDirectory,
    pathExists: () => false,
    probeEncoder: async () => ({ capability: { distributionSafe: true, h264Mf: true } }),
    encodeSequence: async (request) => {
      encodeCalls.push(request);
      return { ok: true, frameCount: request.frameCount };
    },
    ...overrides,
  });
  return { handlers, encodeCalls, result };
}

test("native MP4 destination is owned by an opaque Desktop video session", async () => {
  const { handlers, encodeCalls } = harness();
  const session = await handlers.get("desktop:begin-video-export")({}, {
    suggestedName: "My Shot",
  });
  assert.match(session.sessionId, /^video-export-/);
  assert.equal(session.destination, videoOutputPath);

  const encoded = await handlers.get("desktop:encode-video")({}, {
    sessionId: session.sessionId,
    frameDirectory,
    frameRate: { numerator: 30000, denominator: 1001 },
    frameCount: 30,
  });
  assert.equal(encoded.ok, true);
  assert.equal(encodeCalls.length, 1);
  assert.equal(encodeCalls[0].outputPath, videoOutputPath);
  assert.equal(encodeCalls[0].frameDirectory, frameDirectory);
});

test("renderer cannot ask FFmpeg to read an arbitrary filesystem directory", async () => {
  const { handlers, encodeCalls } = harness();
  const session = await handlers.get("desktop:begin-video-export")({}, {});
  const result = await handlers.get("desktop:encode-video")({}, {
    sessionId: session.sessionId,
    frameDirectory: unapprovedFrameDirectory,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
  });
  assert.equal(result.desktopError.code, "VIDEO_FRAME_SOURCE_NOT_APPROVED");
  assert.equal(encodeCalls.length, 0);
});

test("existing MP4 destination is rejected before a video session is created", async () => {
  const { handlers } = harness({ pathExists: () => true });
  const result = await handlers.get("desktop:begin-video-export")({}, {});
  assert.equal(result.desktopError.code, "VIDEO_OUTPUT_CONFLICT");
});

test("encoder probe is exposed as a trusted Desktop capability operation", async () => {
  const capability = { distributionSafe: true, h264Mf: true };
  const { handlers } = harness({
    probeEncoder: async () => ({ executablePath: "ffmpeg", capability }),
  });
  const result = await handlers.get("desktop:probe-video-encoder")({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.capability, capability);
});

test("cancel aborts the active encoder process through the Desktop session", async () => {
  let activeSignal;
  const { handlers } = harness({
    encodeSequence: ({ signal }) => new Promise((_resolve, reject) => {
      activeSignal = signal;
      signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.code = "VIDEO_ENCODER_CANCELLED";
        reject(error);
      }, { once: true });
    }),
  });
  const session = await handlers.get("desktop:begin-video-export")({}, {});
  const encoding = handlers.get("desktop:encode-video")({}, {
    sessionId: session.sessionId,
    frameDirectory,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
  });
  await Promise.resolve();
  const cancelled = await handlers.get("desktop:cancel-video-export")({}, {
    sessionId: session.sessionId,
  });
  assert.equal(cancelled.canceled, true);
  assert.equal(activeSignal.aborted, true);
  const result = await encoding;
  assert.equal(result.desktopError.code, "VIDEO_ENCODER_CANCELLED");
});

test("completed Desktop PNG sequence becomes the only approved video input path", async () => {
  const handlers = new Map();
  const encodeCalls = [];
  const registry = {
    async begin() {
      return { sessionId: "frames-1", destination: frameDirectory };
    },
    async write() {
      return { writtenFrames: 1 };
    },
    end() {
      return { destination: frameDirectory, writtenFrames: 24 };
    },
  };
  registerFrameSequenceIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: {
      async showOpenDialog() { return { canceled: false, filePaths: [frameParentDirectory] }; },
      async showSaveDialog() { return { canceled: false, filePath: videoOutputPath }; },
    },
    mainWindow: () => ({ id: "window" }),
    assertTrusted: () => {},
    associatedDirectory: () => exportDirectory,
    registry,
    videoEncoderOptions: {
      pathExists: () => false,
      probeEncoder: async () => ({ capability: { distributionSafe: true, h264Mf: true } }),
      encodeSequence: async (request) => {
        encodeCalls.push(request);
        return { ok: true, frameCount: request.frameCount };
      },
    },
  });

  const before = await handlers.get("desktop:begin-video-export")({}, {});
  const rejected = await handlers.get("desktop:encode-video")({}, {
    sessionId: before.sessionId,
    frameDirectory,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
  });
  assert.equal(rejected.desktopError.code, "VIDEO_FRAME_SOURCE_NOT_APPROVED");

  await handlers.get("desktop:end-frame-sequence-export")({}, {
    sessionId: "frames-1",
    status: "completed",
  });
  const after = await handlers.get("desktop:begin-video-export")({}, {});
  const encoded = await handlers.get("desktop:encode-video")({}, {
    sessionId: after.sessionId,
    frameDirectory,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
  });
  assert.equal(encoded.ok, true);
  assert.equal(encodeCalls.length, 1);
});

test("temporary video frames stay behind the Desktop session and encode in exact order", async () => {
  const temporaryDirectory = join(testRoot, "temporary", "video-1");
  const writes = [];
  const removed = [];
  const { handlers, encodeCalls } = harness({
    createTemporaryDirectory: async () => temporaryDirectory,
    writeTemporaryFrame: async (directory, fileName, bytes) => {
      writes.push({ directory, fileName, bytes: [...bytes] });
      return { fileName };
    },
    removeTemporaryDirectory: async (directory) => { removed.push(directory); },
  });

  const session = await handlers.get("desktop:begin-video-export")({}, {
    suggestedName: "shot",
    temporaryFrames: true,
  });
  assert.equal(session.temporaryFrames, true);
  assert.equal("frameDirectory" in session, false);

  const outOfOrder = await handlers.get("desktop:write-video-frame")({}, {
    sessionId: session.sessionId,
    fileName: "frame_000002.png",
    bytes: new Uint8Array([2]),
  });
  assert.equal(outOfOrder.desktopError.code, "VIDEO_FRAME_ORDER_INVALID");

  for (const ordinal of [1, 2]) {
    const written = await handlers.get("desktop:write-video-frame")({}, {
      sessionId: session.sessionId,
      fileName: `frame_${String(ordinal).padStart(6, "0")}.png`,
      bytes: new Uint8Array([ordinal]),
    });
    assert.equal(written.ok, true);
    assert.equal(written.writtenFrames, ordinal);
  }

  const encoded = await handlers.get("desktop:encode-video")({}, {
    sessionId: session.sessionId,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 2,
  });
  assert.equal(encoded.ok, true);
  assert.equal(encodeCalls.length, 1);
  assert.equal(encodeCalls[0].frameDirectory, temporaryDirectory);
  assert.deepEqual(writes.map((entry) => entry.fileName), [
    "frame_000001.png",
    "frame_000002.png",
  ]);
  assert.deepEqual(removed, [temporaryDirectory]);
});

test("temporary video session rejects renderer filesystem paths and mismatched frame counts", async () => {
  const temporaryDirectory = join(testRoot, "temporary", "video-2");
  const { handlers, encodeCalls } = harness({
    createTemporaryDirectory: async () => temporaryDirectory,
    writeTemporaryFrame: async () => ({}),
    removeTemporaryDirectory: async () => {},
  });
  const session = await handlers.get("desktop:begin-video-export")({}, { temporaryFrames: true });
  await handlers.get("desktop:write-video-frame")({}, {
    sessionId: session.sessionId,
    fileName: "frame_000001.png",
    bytes: new Uint8Array([1]),
  });

  const pathRejected = await handlers.get("desktop:encode-video")({}, {
    sessionId: session.sessionId,
    frameDirectory,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 1,
  });
  assert.equal(pathRejected.desktopError.code, "VIDEO_FRAME_SOURCE_INVALID");

  const countRejected = await handlers.get("desktop:encode-video")({}, {
    sessionId: session.sessionId,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 2,
  });
  assert.equal(countRejected.desktopError.code, "VIDEO_FRAME_COUNT_MISMATCH");
  assert.equal(encodeCalls.length, 0);
});

test("cancel before encoding removes Desktop-owned temporary frames", async () => {
  const temporaryDirectory = join(testRoot, "temporary", "video-3");
  const removed = [];
  const { handlers } = harness({
    createTemporaryDirectory: async () => temporaryDirectory,
    removeTemporaryDirectory: async (directory) => { removed.push(directory); },
  });
  const session = await handlers.get("desktop:begin-video-export")({}, { temporaryFrames: true });
  const cancelled = await handlers.get("desktop:cancel-video-export")({}, {
    sessionId: session.sessionId,
  });
  assert.equal(cancelled.canceled, true);
  assert.equal(cancelled.active, false);
  assert.deepEqual(removed, [temporaryDirectory]);
});