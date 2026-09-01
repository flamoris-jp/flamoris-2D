import { serializeProject } from "./project-json.js";

export class ProjectFileOperationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ProjectFileOperationError";
    this.code = code;
  }
}

export function normalizeFl2dFilename(fileName) {
  const trimmed = String(fileName || "").trim();
  if (!trimmed) {
    throw new ProjectFileOperationError(
      "A project filename is required.",
      "file.name_required",
    );
  }
  return trimmed.toLocaleLowerCase().endsWith(".fl2d")
    ? trimmed
    : trimmed + ".fl2d";
}

export function incrementalFilename(
  currentFileName,
  existingFileNames = [],
  width = 3,
) {
  const normalized = normalizeFl2dFilename(currentFileName);
  const stem = normalized.slice(0, -5);
  const suffix = stem.match(/^(.*)_([0-9]+)$/);
  const base = suffix ? suffix[1] : stem;
  const numbers = suffix ? [Number(suffix[2])] : [0];
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp("^" + escaped + "_([0-9]+)\\.fl2d$", "i");
  for (const fileName of existingFileNames) {
    const match = String(fileName).match(matcher);
    if (match) numbers.push(Number(match[1]));
  }
  const next = Math.max(...numbers) + 1;
  return `${base}_${String(next).padStart(Math.max(1, width), "0")}.fl2d`;
}

export class ProjectDocumentController {
  constructor(
    session,
    {
      writer,
      currentFileName = null,
      currentFilePath = null,
      metadata = {},
      recovery = null,
      now = () => new Date(),
      incrementalWidth = 3,
    } = {},
  ) {
    if (!writer?.write) {
      throw new TypeError("A project file writer is required.");
    }
    this.session = session;
    this.writer = writer;
    this.currentFileName = currentFileName;
    this.currentFilePath = currentFilePath;
    this.metadata = { ...metadata };
    this.recovery = recovery;
    this.now = now;
    this.incrementalWidth = incrementalWidth;
  }

  async write(fileName, {
    operation = "save",
    makeCurrent,
    markClean,
    allowOverwrite = true,
  } = {}) {
    const normalized = normalizeFl2dFilename(fileName);
    const timestamp = this.now().toISOString();
    const createdAt = this.metadata.createdAt || timestamp;
    const contents = serializeProject(this.session.project, 2, {
      createdAt,
      modifiedAt: timestamp,
      now: this.now,
    });
    const writeResult = await this.writer.write({
      operation,
      fileName: normalized,
      currentFilePath: this.currentFilePath,
      contents,
      allowOverwrite,
      mimeType: "application/x-flamoris-2d+json",
    });
    if (writeResult?.canceled) return null;
    const writtenFileName = normalizeFl2dFilename(
      writeResult?.fileName || normalized,
    );
    if (makeCurrent) {
      this.currentFileName = writtenFileName;
      this.currentFilePath = writeResult?.filePath || this.currentFilePath;
    }
    if (markClean) {
      this.metadata = { createdAt, modifiedAt: timestamp };
      this.session.markSaved();
      this.recovery?.clear?.();
    }
    return {
      fileName: writtenFileName,
      filePath: writeResult?.filePath || null,
      projectId: this.session.project.id,
    };
  }

  async save() {
    if (!this.currentFileName && !this.currentFilePath) {
      throw new ProjectFileOperationError(
        "Save As is required for an unsaved project.",
        "file.save_as_required",
      );
    }
    return this.write(
      this.currentFileName || this.session.project.displayName,
      {
        operation: "save",
        makeCurrent: true,
        markClean: true,
      },
    );
  }

  async saveAs(fileName) {
    return this.write(fileName, {
      operation: "save-as",
      makeCurrent: true,
      markClean: true,
    });
  }

  async saveIncremental(existingFileNames = []) {
    let candidate = incrementalFilename(
      this.currentFileName || this.session.project.displayName,
      existingFileNames,
      this.incrementalWidth,
    );
    while (await this.writer.exists?.(candidate)) {
      candidate = incrementalFilename(
        candidate,
        [...existingFileNames, candidate],
        this.incrementalWidth,
      );
    }
    return this.write(candidate, {
      operation: "save-incremental",
      makeCurrent: true,
      markClean: true,
      allowOverwrite: false,
    });
  }

  async saveCopy(fileName) {
    return this.write(fileName, {
      operation: "save-copy",
      makeCurrent: false,
      markClean: false,
    });
  }
}
