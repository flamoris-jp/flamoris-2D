import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { exclusiveWriteFile } from "./atomic-write.js";

const FRAME_NAME = /^frame_(\d{6,})\.png$/;

export function safeExportDirectoryName(value) {
  let name = String(value || "FLAMORIS-export").trim();
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  name = name.replace(/[. ]+$/g, "").slice(0, 120);
  if (!name || name === "." || name === "..") name = "FLAMORIS-export";
  return name;
}

export function assertFrameSequenceFileName(fileName) {
  const match = FRAME_NAME.exec(String(fileName || ""));
  if (!match) throw new RangeError("Frame sequence filenames must match frame_000001.png.");
  return { fileName: match[0], ordinal: Number(match[1]) };
}

export async function createFrameSequenceDirectory(
  parentDirectory,
  suggestedName,
  { makeDirectory = mkdir } = {},
) {
  if (typeof parentDirectory !== "string" || !parentDirectory.trim()) {
    throw new TypeError("A destination parent directory is required.");
  }
  const directoryName = safeExportDirectoryName(suggestedName);
  const target = join(parentDirectory, directoryName);
  try {
    await makeDirectory(target, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const conflict = new Error(`Export directory already exists: ${directoryName}`);
      conflict.code = "EXPORT_OUTPUT_CONFLICT";
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
  return Object.freeze({ directoryName, directoryPath: target });
}

export async function writeFrameSequenceFile(
  directoryPath,
  fileName,
  bytes,
  { writeFile = exclusiveWriteFile } = {},
) {
  const validated = assertFrameSequenceFileName(fileName);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new TypeError("PNG frame bytes must be a non-empty Uint8Array.");
  }
  const target = join(directoryPath, validated.fileName);
  await writeFile(target, bytes);
  return Object.freeze({ fileName: validated.fileName, filePath: target });
}

export class DesktopFrameSequenceSessionRegistry {
  constructor({ createDirectory = createFrameSequenceDirectory, writeFrame = writeFrameSequenceFile } = {}) {
    this.createDirectory = createDirectory;
    this.writeFrame = writeFrame;
    this.nextSessionId = 1;
    this.sessions = new Map();
  }

  async begin(parentDirectory, request = {}) {
    const directory = await this.createDirectory(parentDirectory, request.suggestedName);
    const sessionId = `frame-sequence-${this.nextSessionId++}`;
    this.sessions.set(sessionId, {
      directoryPath: directory.directoryPath,
      destination: directory.directoryPath,
      writtenFrames: 0,
    });
    return Object.freeze({
      sessionId,
      destination: directory.directoryPath,
      partialOutputPolicy: request.partialOutputPolicy || null,
    });
  }

  async write(sessionId, request = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown or completed frame sequence export session.");
    const result = await this.writeFrame(session.directoryPath, request.fileName, request.bytes);
    session.writtenFrames += 1;
    return Object.freeze({ ...result, writtenFrames: session.writtenFrames });
  }

  end(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.sessions.delete(sessionId);
    return Object.freeze({
      destination: session.destination,
      writtenFrames: session.writtenFrames,
    });
  }
}
