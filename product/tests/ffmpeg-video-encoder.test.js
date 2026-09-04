import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  encodePngSequenceWithFfmpeg,
  probeFfmpegVideoEncoder,
  runEncoderProcess,
} from "../desktop/ffmpeg-video-encoder.mjs";

function fakeChild({ code = 0, stdout = "", stderr = "", closeSignal = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    child.emit("close", code, closeSignal);
  });
  return child;
}

function queuedSpawner(specs, calls = []) {
  const queue = [...specs];
  return {
    calls,
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      const spec = queue.shift();
      if (spec instanceof Error) throw spec;
      return fakeChild(spec || {});
    },
  };
}

test("process adapter preserves argv and captures stdout/stderr", async () => {
  const spawner = queuedSpawner([{ code: 0, stdout: "out", stderr: "warn" }]);
  const result = await runEncoderProcess("ffmpeg.exe", ["-version"], {
    spawnProcess: spawner.spawn,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "warn");
  assert.deepEqual(spawner.calls[0].args, ["-version"]);
  assert.equal(spawner.calls[0].options.windowsHide, true);
});

test("capability probe requires h264_mf and LGPL-only build policy", async () => {
  const spawner = queuedSpawner([
    { code: 0, stdout: "ffmpeg version 8.0" },
    { code: 0, stdout: "configuration: --enable-shared --disable-gpl" },
    { code: 0, stdout: " V..... h264_mf H.264 via MediaFoundation" },
  ]);
  const result = await probeFfmpegVideoEncoder({
    executablePath: "C:/tools/ffmpeg.exe",
    spawnProcess: spawner.spawn,
  });
  assert.equal(result.capability.distributionSafe, true);
  assert.equal(spawner.calls.length, 3);
});

test("successful encode uses deterministic PNG ordering contract", async () => {
  const spawner = queuedSpawner([{ code: 0, stderr: "encoded" }]);
  const result = await encodePngSequenceWithFfmpeg({
    executablePath: "ffmpeg.exe",
    frameDirectory: "C:/temp/frames",
    outputPath: "C:/exports/shot.mp4",
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
    spawnProcess: spawner.spawn,
    skipProbe: true,
  });
  assert.equal(result.ok, true);
  const args = spawner.calls[0].args;
  assert.equal(args[args.indexOf("-start_number") + 1], "1");
  assert.equal(args[args.indexOf("-frames:v") + 1], "24");
  assert.equal(args[args.indexOf("-c:v") + 1], "h264_mf");
  assert.equal(args[args.indexOf("-i") + 1], "C:/temp/frames/frame_%06d.png");
});

test("encoder failure removes incomplete MP4 and preserves diagnostic stderr", async () => {
  const removed = [];
  const spawner = queuedSpawner([{ code: 1, stderr: "encoder exploded" }]);
  await assert.rejects(() => encodePngSequenceWithFfmpeg({
    executablePath: "ffmpeg.exe",
    frameDirectory: "C:/temp/frames",
    outputPath: "C:/exports/shot.mp4",
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
    spawnProcess: spawner.spawn,
    removeFile: async (path) => removed.push(path),
    skipProbe: true,
  }), (error) => {
    assert.equal(error.code, "VIDEO_ENCODER_FAILED");
    assert.match(error.message, /encoder exploded/);
    return true;
  });
  assert.deepEqual(removed, ["C:/exports/shot.mp4"]);
});

test("existing output conflict is explicit and incomplete output cleanup still runs", async () => {
  const removed = [];
  const spawner = queuedSpawner([{ code: 1, stderr: "File already exists. Exiting. Not overwriting" }]);
  await assert.rejects(() => encodePngSequenceWithFfmpeg({
    executablePath: "ffmpeg.exe",
    frameDirectory: "C:/temp/frames",
    outputPath: "C:/exports/shot.mp4",
    frameRate: { numerator: 30, denominator: 1 },
    frameCount: 30,
    spawnProcess: spawner.spawn,
    removeFile: async (path) => removed.push(path),
    skipProbe: true,
  }), (error) => error.code === "VIDEO_OUTPUT_CONFLICT");
  assert.equal(removed.length, 1);
});

test("cancellation terminates FFmpeg and removes partial output", async () => {
  const controller = new AbortController();
  const removed = [];
  let child;
  const spawnProcess = () => {
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killCalls = [];
    child.kill = (signal) => {
      child.killCalls.push(signal);
      queueMicrotask(() => child.emit("close", null, signal));
      return true;
    };
    queueMicrotask(() => controller.abort());
    return child;
  };

  await assert.rejects(() => encodePngSequenceWithFfmpeg({
    executablePath: "ffmpeg.exe",
    frameDirectory: "C:/temp/frames",
    outputPath: "C:/exports/shot.mp4",
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
    signal: controller.signal,
    spawnProcess,
    removeFile: async (path) => removed.push(path),
    skipProbe: true,
  }), (error) => error.code === "VIDEO_ENCODER_CANCELLED");
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
  assert.deepEqual(removed, ["C:/exports/shot.mp4"]);
});
