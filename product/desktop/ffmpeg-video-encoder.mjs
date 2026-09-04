import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";

import {
  assertOfficialFfmpegCapability,
  buildH264MfEncodeArgs,
  parseFfmpegCapability,
} from "../src/core/video-encoder.js";

function boundedAppend(current, chunk, maximum = 1024 * 1024) {
  const next = current + String(chunk || "");
  return next.length > maximum ? next.slice(next.length - maximum) : next;
}

async function defaultOutputExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function runEncoderProcess(executablePath, args, {
  spawnProcess = spawn,
  signal = null,
} = {}) {
  if (typeof executablePath !== "string" || !executablePath.trim()) {
    return Promise.reject(new TypeError("FFmpeg executable path is required."));
  }
  if (!Array.isArray(args)) {
    return Promise.reject(new TypeError("FFmpeg argv must be an array."));
  }
  if (signal?.aborted) {
    return Promise.resolve({
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
      canceled: true,
    });
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executablePath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let canceled = false;
    let settled = false;
    const onAbort = () => {
      canceled = true;
      try { child.kill("SIGTERM"); } catch {}
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdout?.on?.("data", (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr?.on?.("data", (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      resolve({ code, signal: childSignal, stdout, stderr, canceled });
    });
  });
}

async function checkedProbeCommand(executablePath, args, options) {
  const result = await runEncoderProcess(executablePath, args, options);
  if (result.canceled) {
    const error = new Error("FFmpeg capability probe was cancelled.");
    error.code = "VIDEO_ENCODER_CANCELLED";
    throw error;
  }
  if (result.code !== 0) {
    const error = new Error(result.stderr || `FFmpeg probe exited with code ${result.code}.`);
    error.code = "VIDEO_ENCODER_PROBE_FAILED";
    throw error;
  }
  return `${result.stdout}\n${result.stderr}`;
}

export async function probeFfmpegVideoEncoder({
  executablePath = "ffmpeg",
  spawnProcess = spawn,
  signal = null,
} = {}) {
  const options = { spawnProcess, signal };
  const versionText = await checkedProbeCommand(executablePath, ["-hide_banner", "-version"], options);
  const buildConfText = await checkedProbeCommand(executablePath, ["-hide_banner", "-buildconf"], options);
  const encodersText = await checkedProbeCommand(executablePath, ["-hide_banner", "-encoders"], options);
  const capability = parseFfmpegCapability({ versionText, buildConfText, encodersText });
  assertOfficialFfmpegCapability(capability);
  return Object.freeze({ executablePath, capability });
}

function encodeFailureCode(result) {
  if (/already exists|not overwriting/i.test(result.stderr)) return "VIDEO_OUTPUT_CONFLICT";
  return "VIDEO_ENCODER_FAILED";
}

function outputConflictError() {
  const error = new Error("Video output already exists; overwrite is not allowed.");
  error.code = "VIDEO_OUTPUT_CONFLICT";
  return error;
}

/**
 * Encodes the canonical Phase 4-2 PNG sequence to MP4. Incomplete MP4 output
 * is removed on failure/cancellation; a pre-existing destination is never
 * deleted. The PNG sequence remains authoritative.
 */
export async function encodePngSequenceWithFfmpeg({
  executablePath = "ffmpeg",
  frameDirectory,
  outputPath,
  frameRate,
  frameCount,
  signal = null,
  spawnProcess = spawn,
  removeFile = (path) => rm(path, { force: true }),
  outputExists = defaultOutputExists,
  skipProbe = false,
} = {}) {
  if (await outputExists(outputPath)) throw outputConflictError();
  if (!skipProbe) {
    await probeFfmpegVideoEncoder({ executablePath, spawnProcess, signal });
  }
  const args = buildH264MfEncodeArgs({ frameDirectory, outputPath, frameRate, frameCount });
  let result;
  try {
    result = await runEncoderProcess(executablePath, args, { spawnProcess, signal });
  } catch (error) {
    error.code ||= "VIDEO_ENCODER_SPAWN_FAILED";
    throw error;
  }

  if (result.canceled) {
    await removeFile(outputPath).catch(() => {});
    const error = new Error("Video encoding was cancelled; incomplete MP4 output was removed.");
    error.code = "VIDEO_ENCODER_CANCELLED";
    throw error;
  }
  if (result.code !== 0) {
    const code = encodeFailureCode(result);
    if (code !== "VIDEO_OUTPUT_CONFLICT") {
      await removeFile(outputPath).catch(() => {});
    }
    const error = new Error(result.stderr || `FFmpeg exited with code ${result.code}.`);
    error.code = code;
    error.exitCode = result.code;
    throw error;
  }

  return Object.freeze({
    ok: true,
    outputPath,
    frameCount,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}
