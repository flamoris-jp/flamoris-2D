import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  encodePngSequenceWithFfmpeg,
  probeFfmpegVideoEncoder,
} from "./ffmpeg-video-encoder.mjs";

function desktopError(code, message) {
  return { desktopError: { code, message } };
}

function safeMp4Name(value) {
  let name = basename(String(value || "FLAMORIS-export.mp4").trim());
  name = name.replace(/[<>:\"/\\|?*\u0000-\u001f]/g, "_");
  name = name.replace(/[. ]+$/g, "").slice(0, 180);
  if (!name || name === "." || name === "..") name = "FLAMORIS-export.mp4";
  if (!name.toLocaleLowerCase().endsWith(".mp4")) name += ".mp4";
  return name;
}

function ensureMp4Path(filePath) {
  return filePath.toLocaleLowerCase().endsWith(".mp4") ? filePath : `${filePath}.mp4`;
}

function encoderErrorResult(error) {
  return desktopError(
    error?.code || "VIDEO_ENCODER_FAILED",
    error?.message || String(error),
  );
}

export function registerVideoEncoderIpc({
  ipcMain,
  dialog,
  mainWindow,
  assertTrusted,
  associatedDirectory,
  isApprovedFrameDirectory,
  executablePath = "ffmpeg",
  probeEncoder = probeFfmpegVideoEncoder,
  encodeSequence = encodePngSequenceWithFfmpeg,
  pathExists = existsSync,
}) {
  const sessions = new Map();
  let nextSessionId = 1;

  ipcMain.handle("desktop:probe-video-encoder", async (event) => {
    assertTrusted(event);
    try {
      const result = await probeEncoder({ executablePath });
      return { ok: true, capability: result.capability };
    } catch (error) {
      return encoderErrorResult(error);
    }
  });

  ipcMain.handle("desktop:begin-video-export", async (event, request = {}) => {
    assertTrusted(event);
    const result = await dialog.showSaveDialog(mainWindow(), {
      title: "Export MP4 Video",
      defaultPath: join(associatedDirectory(), safeMp4Name(request.suggestedName)),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = ensureMp4Path(result.filePath);
    if (pathExists(outputPath)) {
      return desktopError("VIDEO_OUTPUT_CONFLICT", "Video output already exists; choose a new filename.");
    }
    const sessionId = `video-export-${nextSessionId++}`;
    sessions.set(sessionId, {
      outputPath,
      active: false,
      controller: null,
    });
    return Object.freeze({
      sessionId,
      destination: outputPath,
      fileName: basename(outputPath),
    });
  });

  ipcMain.handle("desktop:encode-video", async (event, request = {}) => {
    assertTrusted(event);
    const sessionId = String(request.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session) return desktopError("VIDEO_EXPORT_SESSION_INVALID", "Unknown video export session.");
    if (session.active) return desktopError("VIDEO_EXPORT_ALREADY_RUNNING", "Video encoding is already running.");

    const rawFrameDirectory = String(request.frameDirectory || "");
    if (!isAbsolute(rawFrameDirectory)) {
      return desktopError("VIDEO_FRAME_SOURCE_INVALID", "PNG frame directory must be an absolute Desktop-approved path.");
    }
    const frameDirectory = resolve(rawFrameDirectory);
    if (typeof isApprovedFrameDirectory !== "function" || !isApprovedFrameDirectory(frameDirectory)) {
      return desktopError("VIDEO_FRAME_SOURCE_NOT_APPROVED", "PNG frame directory was not created by the Desktop export bridge.");
    }

    session.active = true;
    session.controller = new AbortController();
    try {
      const result = await encodeSequence({
        executablePath,
        frameDirectory,
        outputPath: session.outputPath,
        frameRate: request.frameRate,
        frameCount: request.frameCount,
        signal: session.controller.signal,
      });
      sessions.delete(sessionId);
      return {
        ok: true,
        destination: session.outputPath,
        fileName: basename(session.outputPath),
        frameCount: result.frameCount,
      };
    } catch (error) {
      sessions.delete(sessionId);
      return encoderErrorResult(error);
    }
  });

  ipcMain.handle("desktop:cancel-video-export", async (event, request = {}) => {
    assertTrusted(event);
    const sessionId = String(request.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session) return { ok: true, canceled: false };
    if (session.controller) {
      session.controller.abort();
      return { ok: true, canceled: true, active: true };
    }
    sessions.delete(sessionId);
    return { ok: true, canceled: true, active: false };
  });

  return Object.freeze({
    hasSession(sessionId) { return sessions.has(sessionId); },
  });
}
