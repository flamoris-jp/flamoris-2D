import { cloneProject } from "../model/project.js";
import { validateProject } from "../model/validation.js";
import {
  EditorSession,
  TransactionError,
} from "../commands/editor.js";
import { PROJECT_SCHEMA_VERSION } from "../model/project.js";
import {
  TIMEBASE_TICKS_PER_SECOND,
  normalizeFrameRate,
  secondsToTicks,
  sortTemporalProgram,
} from "../core/temporal.js";

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
  {
    createdAt,
    modifiedAt,
    renderAssets = [],
    now = () => new Date(),
  } = {},
) {
  assertValid(project);
  const timestamp = now().toISOString();
  const body = cloneProject(project);
  body.temporalPrograms = [...body.temporalPrograms]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(sortTemporalProgram);
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
    renderAssets: Array.isArray(renderAssets) ? cloneProject(renderAssets) : [],
  };
}

export function serializeProject(project, spacing = 2, metadata = {}) {
  return JSON.stringify(createFl2dDocument(project, metadata), null, spacing);
}

export function migrateProjectSchema(value) {
  const project = cloneProject(value);
  if (project?.schemaVersion === 1) {
    const legacyFps = project.renderSettings?.fps;
    let frameRate;
    if (legacyFps === 23.976) frameRate = { numerator: 24000, denominator: 1001 };
    else if (legacyFps === 29.97) frameRate = { numerator: 30000, denominator: 1001 };
    else if (legacyFps === 59.94) frameRate = { numerator: 60000, denominator: 1001 };
    else if (Number.isFinite(legacyFps) && legacyFps > 0) {
      frameRate = normalizeFrameRate({
        numerator: Math.round(legacyFps * 1000000),
        denominator: 1000000,
      });
    } else frameRate = { numerator: 30, denominator: 1 };
    project.timebaseTicksPerSecond = TIMEBASE_TICKS_PER_SECOND;
    project.renderSettings = {
      frameRate,
      durationTicks: secondsToTicks(project.renderSettings?.duration ?? 8),
      alpha: project.renderSettings?.alpha !== false,
    };
    project.temporalPrograms = [];
    project.schemaVersion = 2;
  }
  if (project?.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectFormatError(
      "This project uses an unsupported Project schema.",
      "project.schema_unsupported",
      { schemaVersion: project?.schemaVersion },
    );
  }
  return project;
}

function migrateLegacyProject(value) {
  // Pre-.fl2d Phase 1A/1B JSON was the Project model itself.
  if (value?.schemaVersion && value?.scene) {
    const project = migrateProjectSchema(value);
    assertValid(project);
    return {
      project,
      metadata: {
        format: FL2D_FORMAT,
        formatVersion: FL2D_FORMAT_VERSION,
        projectId: project.id,
        name: project.displayName,
        createdAt: null,
        modifiedAt: null,
        migratedFrom: 0,
      },
      renderAssets: [],
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
  const project = migrateProjectSchema({
    ...cloneProject(value.project),
    id: value.projectId,
    displayName: value.name,
  });
  assertValid(project);
  return {
    project,
    renderAssets: Array.isArray(value.renderAssets)
      ? cloneProject(value.renderAssets)
      : [],
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
