import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  assertFrameSequenceFileName,
  writeFrameSequenceFile,
} from "../src/desktop/frame-sequence-files.js";
import {
  encodePngSequenceWithFfmpeg,
  probeFfmpegVideoEncoder,
} from "./ffmpeg-video-encoder.mjs";

const maximumFrameBytes = 256 * 1024 * 1024;

function desktopError(code, message) {
  return { desktopError: { code, message } };
}

function diagnostic(code, message) {
  return Object.freeze({ code, message });
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

function encoderErrorResult(error, cleanupError = null) {
  const result = desktopError(
    error?.code || "VIDEO_ENCODER_FAILED",
    error?.message || String(error),
  );
  if (!cleanupError) return result;
  return {
    ...result,
    diagnostics: [diagnostic(
      "VIDEO_TEMP_CLEANUP_FAILED",
      cleanupError?.message || String(cleanupError),
    )],
  };
}

async function defaultCreateTemporaryDirectory() {
  return mkdtemp(join(tmpdir(), "flamoris-video-"));
}

async function defaultRemoveTemporaryDirectory(directoryPath) {
  await rm(directoryPath, { recursive: true, force: true });
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
  createTemporaryDirectory = defaultCreateTemporaryDirectory,
  writeTemporaryFrame = writeFrameSequenceFile,
  removeTemporaryDirectory = defaultRemoveTemporaryDirectory,
}) {
  const sessions = new Map();
  let nextSessionId = 1;

  async function cleanupTemporaryFrames(session) {
    if (!session?.temporaryFrameDirectory) return null;
    const directory = session.temporaryFrameDirectory;
    session.temporaryFrameDirectory = null;
    try {
      await removeTemporaryDirectory(directory);
      return null;
    } catch (error) {
      return error;
    }
  }

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

    let temporaryFrameDirectory = null;
    if (request.temporaryFrames === true) {
      try {
        temporaryFrameDirectory = await createTemporaryDirectory();
      } catch (error) {
        return desktopError(
          "VIDEO_TEMP_CREATE_FAILED",
          error?.message || "Unable to create temporary video frame storage.",
        );
      }
    }

    const sessionId = `video-export-${nextSessionId++}`;
    sessions.set(sessionId, {
      outputPath,
      active: false,
      controller: null,
      temporaryFrameDirectory,
      writtenFrames: 0,
    });
    return Object.freeze({
      sessionId,
      destination: outputPath,
      fileName: basename(outputPath),
      temporaryFrames: Boolean(temporaryFrameDirectory),
    });
  });

  ipcMain.handle("desktop:write-video-frame", async (event, request = {}) => {
    assertTrusted(event);
    const sessionId = String(request.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session) return desktopError("VIDEO_EXPORT_SESSION_INVALID", "Unknown video export session.");
    if (session.active) {
      return desktopError("VIDEO_EXPORT_ALREADY_RUNNING", "Video encoding is already running.");
    }
    if (!session.temporaryFrameDirectory) {
      return desktopError(
        "VIDEO_TEMP_FRAMES_NOT_ENABLED",
        "This video session does not own temporary render frames.",
      );
    }
    if (!(request.bytes instanceof Uint8Array) || request.bytes.length === 0 ||
      request.bytes.length > maximumFrameBytes) {
      return desktopError(
        "VIDEO_FRAME_BYTES_INVALID",
        `PNG frame bytes must be between 1 and ${maximumFrameBytes} bytes.`,
      );
    }

    let validated;
    try {
      validated = assertFrameSequenceFileName(request.fileName);
    } catch (error) {
      return desktopError("VIDEO_FRAME_NAME_INVALID", error?.message || String(error));
    }
    const expectedOrdinal = session.writtenFrames + 1;
    if (validated.ordinal !== expectedOrdinal) {
      return desktopError(
        "VIDEO_FRAME_ORDER_INVALID",
        `Expected frame_${String(expectedOrdinal).padStart(6, "0")}.png next.`,
      );
    }

    try {
      await writeTemporaryFrame(
        session.temporaryFrameDirectory,
        validated.fileName,
        request.bytes,
      );
      session.writtenFrames += 1;
      return Object.freeze({
        ok: true,
        fileName: validated.fileName,
        writtenFrames: session.writtenFrames,
      });
    } catch (error) {
      return desktopError(
        "VIDEO_FRAME_WRITE_FAILED",
        error?.message || String(error),
      );
    }
  });

  ipcMain.handle("desktop:encode-video", async (event, request = {}) => {
    assertTrusted(event);
    const sessionId = String(request.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session) return desktopError("VIDEO_EXPORT_SESSION_INVALID", "Unknown video export session.");
    if (session.active) return desktopError("VIDEO_EXPORT_ALREADY_RUNNING", "Video encoding is already running.");

    let frameDirectory;
    if (session.temporaryFrameDirectory) {
      if (request.frameDirectory) {
        return desktopError(
          "VIDEO_FRAME_SOURCE_INVALID",
          "A temporary-frame video session does not accept renderer-selected filesystem paths.",
        );
      }
      if (!Number.isSafeInteger(request.frameCount) || request.frameCount <= 0 ||
        request.frameCount !== session.writtenFrames) {
        return desktopError(
          "VIDEO_FRAME_COUNT_MISMATCH",
          `Video frame count ${request.frameCount} does not match ${session.writtenFrames} written temporary frames.`,
        );
      }
      frameDirectory = session.temporaryFrameDirectory;
    } else {
      const rawFrameDirectory = String(request.frameDirectory || "");
      if (!isAbsolute(rawFrameDirectory)) {
        return desktopError("VIDEO_FRAME_SOURCE_INVALID", "PNG frame directory must be an absolute Desktop-approved path.");
      }
      frameDirectory = resolve(rawFrameDirectory);
      if (typeof isApprovedFrameDirectory !== "function" || !isApprovedFrameDirectory(frameDirectory)) {
        return desktopError("VIDEO_FRAME_SOURCE_NOT_APPROVED", "PNG frame directory was not created by the Desktop export bridge.");
      }
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
      const cleanupError = await cleanupTemporaryFrames(session);
      sessions.delete(sessionId);
      return {
        ok: true,
        destination: session.outputPath,
        fileName: basename(session.outputPath),
        frameCount: result.frameCount,
        diagnostics: cleanupError
          ? [diagnostic("VIDEO_TEMP_CLEANUP_FAILED", cleanupError?.message || String(cleanupError))]
          : [],
      };
    } catch (error) {
      const cleanupError = await cleanupTemporaryFrames(session);
      sessions.delete(sessionId);
      return encoderErrorResult(error, cleanupError);
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
    const cleanupError = await cleanupTemporaryFrames(session);
    sessions.delete(sessionId);
    return {
      ok: true,
      canceled: true,
      active: false,
      diagnostics: cleanupError
        ? [diagnostic("VIDEO_TEMP_CLEANUP_FAILED", cleanupError?.message || String(cleanupError))]
        : [],
    };
  });

  return Object.freeze({
    hasSession(sessionId) { return sessions.has(sessionId); },
  });
}
