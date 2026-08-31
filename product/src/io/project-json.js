import { cloneProject } from "../model/project.js";
import { validateProject } from "../model/validation.js";
import {
  EditorSession,
  TransactionError,
} from "../commands/editor.js";

export const FL2D_FORMAT = "flamoris-2d-project";
export const FL2D_FORMAT_VERSION = 1;

export class ProjectFormatError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "ProjectFormatError";
    this.code = code;
    this.details = details;
  }
}

function assertValid(project) {
  const issues = validateProject(project);
  if (issues.some((entry) => entry.severity === "error")) {
    throw new TransactionError(issues);
  }
}

function isoTimestamp(value, fallback) {
  const parsed = new Date(value || fallback);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

export function createFl2dDocument(
  project,
  { createdAt, modifiedAt, now = () => new Date() } = {},
) {
  assertValid(project);
  const timestamp = now().toISOString();
  const body = cloneProject(project);
  delete body.id;
  delete body.displayName;
  return {
    format: FL2D_FORMAT,
    formatVersion: FL2D_FORMAT_VERSION,
    projectId: project.id,
    name: project.displayName,
    createdAt: isoTimestamp(createdAt, timestamp),
    modifiedAt: isoTimestamp(modifiedAt, timestamp),
    project: body,
  };
}

export function serializeProject(project, spacing = 2, metadata = {}) {
  return JSON.stringify(createFl2dDocument(project, metadata), null, spacing);
}

function migrateLegacyProject(value) {
  // Pre-.fl2d Phase 1A/1B JSON was the Project model itself.
  if (value?.schemaVersion && value?.scene) {
    assertValid(value);
    return {
      project: cloneProject(value),
      metadata: {
        format: FL2D_FORMAT,
        formatVersion: FL2D_FORMAT_VERSION,
        projectId: value.id,
        name: value.displayName,
        createdAt: null,
        modifiedAt: null,
        migratedFrom: 0,
      },
    };
  }
  throw new ProjectFormatError(
    "This file is not a FLAMORIS 2D project.",
    "project.format_invalid",
  );
}

export function parseProjectDocument(source) {
  let value;
  try {
    value = typeof source === "string" ? JSON.parse(source) : cloneProject(source);
  } catch (error) {
    throw new ProjectFormatError(
      "The project file is not valid JSON.",
      "project.json_invalid",
      { cause: error.message },
    );
  }
  if (!value?.format) return migrateLegacyProject(value);
  if (value.format !== FL2D_FORMAT) {
    throw new ProjectFormatError(
      "This file is not a FLAMORIS 2D project.",
      "project.format_invalid",
    );
  }
  if (!Number.isInteger(value.formatVersion)) {
    throw new ProjectFormatError(
      "The project format version is missing or invalid.",
      "project.format_version_invalid",
    );
  }
  if (value.formatVersion > FL2D_FORMAT_VERSION) {
    throw new ProjectFormatError(
      "This project was created with a newer version of FLAMORIS 2D.",
      "project.format_newer",
      { formatVersion: value.formatVersion },
    );
  }
  if (value.formatVersion < 1) return migrateLegacyProject(value.project || value);
  if (typeof value.projectId !== "string" || !value.projectId.trim() ||
    typeof value.name !== "string" || !value.name.trim() ||
    !value.createdAt || !Number.isFinite(new Date(value.createdAt).getTime()) ||
    !value.modifiedAt || !Number.isFinite(new Date(value.modifiedAt).getTime())) {
    throw new ProjectFormatError(
      "The project file identity metadata is missing or invalid.",
      "project.identity_invalid",
    );
  }
  const project = {
    ...cloneProject(value.project),
    id: value.projectId,
    displayName: value.name,
  };
  assertValid(project);
  return {
    project,
    metadata: {
      format: value.format,
      formatVersion: value.formatVersion,
      projectId: value.projectId,
      name: value.name,
      createdAt: value.createdAt || null,
      modifiedAt: value.modifiedAt || null,
    },
  };
}

export function deserializeProject(source) {
  return parseProjectDocument(source).project;
}

export function createRecoveryStore(
  storage,
  { key = "flamoris2d.recovery.v1", maxVersions = 3, now = () => new Date() } = {},
) {
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) {
    throw new TypeError("A Storage-compatible adapter is required.");
  }
  const limit = Math.max(1, Number(maxVersions) || 1);
  const readEntries = () => {
    const value = storage.getItem(key);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [{ savedAt: null, document: value }];
    } catch {
      return [{ savedAt: null, document: value }];
    }
  };
  return {
    save(project) {
      const entries = readEntries();
      entries.unshift({
        savedAt: now().toISOString(),
        projectId: project.id,
        document: serializeProject(project, 0, { now }),
      });
      storage.setItem(key, JSON.stringify(entries.slice(0, limit)));
    },
    load(index = 0) {
      const entry = readEntries()[index];
      return entry ? deserializeProject(entry.document) : null;
    },
    list() {
      return readEntries().map(({ document, ...summary }) => summary);
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

export function createAutosavingSession(
  project,
  storage,
  { recovery: recoveryOptions, session: sessionOptions } = {},
) {
  const recovery = createRecoveryStore(storage, recoveryOptions);
  const userOnChange = sessionOptions?.onChange;
  const session = new EditorSession(project, {
    ...sessionOptions,
    onChange(updatedProject, entry) {
      if (!entry?.transient) recovery.save(updatedProject);
      userOnChange?.(updatedProject, entry);
    },
  });
  return { session, recovery };
}
