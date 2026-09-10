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
import { canonicalizeClipInstances } from "../model/clip-instance.js";

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
  const byId = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  body.temporalPrograms = [...body.temporalPrograms]
    .sort(byId)
    .map(sortTemporalProgram);
  body.keyArts = [...body.keyArts].sort(byId).map((keyArt) => ({
    ...keyArt,
    members: [...(keyArt.members || [])].sort((a, b) =>
      a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0),
  }));
  body.semanticSlots = [...body.semanticSlots].sort(byId).map((slot) => ({
    ...slot,
    mappings: [...(slot.mappings || [])].sort((a, b) =>
      a.keyArtId < b.keyArtId ? -1 : a.keyArtId > b.keyArtId ? 1 :
        a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0),
  }));
  body.meshTopologies = [...body.meshTopologies].sort(byId).map((topology) => {
    if (!Object.hasOwn(topology, "vertexMetadata")) return topology;
    return {
      ...topology,
      vertexMetadata: Object.fromEntries(
        (topology.vertexIds || [])
          .filter((vertexId) => topology.vertexMetadata?.[vertexId])
          .map((vertexId) => [vertexId, topology.vertexMetadata[vertexId]]),
      ),
    };
  });
  body.meshKeyforms = [...body.meshKeyforms].sort(byId);
  body.meshFormCorrectionKeyforms = [...body.meshFormCorrectionKeyforms]
    .sort(byId)
    .map((keyform) => ({
      ...keyform,
      vertexOffsets: [...keyform.vertexOffsets].sort((left, right) =>
        left.vertexId < right.vertexId ? -1 : left.vertexId > right.vertexId ? 1 : 0),
    }));
  body.clippingBindings = [...body.clippingBindings].sort(byId);
  body.rig.deformers = [...body.rig.deformers].sort(byId).map((deformer) => ({
    ...deformer,
    controlPointIds: [...deformer.controlPointIds],
  }));
  body.rig.warpControlPoints = [...body.rig.warpControlPoints].sort(byId);
  body.rig.warpDeformerKeyforms = [...body.rig.warpDeformerKeyforms]
    .sort((left, right) =>
      left.deformerId < right.deformerId ? -1 : left.deformerId > right.deformerId ? 1 :
        left.keyArtId < right.keyArtId ? -1 : left.keyArtId > right.keyArtId ? 1 : 0)
    .map((keyform) => ({
      ...keyform,
      controlPoints: (() => {
        const deformer = body.rig.deformers.find((entry) => entry.id === keyform.deformerId);
        const order = new Map((deformer?.controlPointIds || [])
          .map((controlPointId, index) => [controlPointId, index]));
        return [...keyform.controlPoints].sort((left, right) =>
          (order.get(left.controlPointId) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.controlPointId) ?? Number.MAX_SAFE_INTEGER) ||
          (left.controlPointId < right.controlPointId ? -1 : left.controlPointId > right.controlPointId ? 1 : 0));
      })(),
    }));
  body.rig.bones = [...body.rig.bones].sort(byId).map((bone) => ({
    ...bone,
    restLocalTransform: cloneProject(bone.restLocalTransform),
  }));
  body.rig.bonePoseKeyforms = [...body.rig.bonePoseKeyforms]
    .sort((left, right) =>
      left.boneId < right.boneId ? -1 : left.boneId > right.boneId ? 1 :
        left.keyArtId < right.keyArtId ? -1 : left.keyArtId > right.keyArtId ? 1 : 0)
    .map((keyform) => ({
      ...keyform,
      localDelta: cloneProject(keyform.localDelta),
    }));
  body.rig.rigidBoneBindings = [...body.rig.rigidBoneBindings].sort(byId);
  body.rig.skinBindings = [...body.rig.skinBindings]
    .sort(byId)
    .map((binding) => ({
      ...binding,
      vertexWeights: [...binding.vertexWeights]
        .sort((left, right) => left.vertexId < right.vertexId ? -1 :
          left.vertexId > right.vertexId ? 1 : 0)
        .map((entry) => ({
          ...entry,
          influences: [...entry.influences].sort((left, right) =>
            left.boneId < right.boneId ? -1 : left.boneId > right.boneId ? 1 : 0),
        })),
    }));
  body.rig.boneRotationConstraints = [...body.rig.boneRotationConstraints].sort(byId);
  body.rig.twoBoneIkConstraints = [...body.rig.twoBoneIkConstraints].sort(byId);
  body.transitions = [...body.transitions].sort(byId).map((transition) => ({
    ...transition,
    partTransitions: [...transition.partTransitions].sort(byId),
    diagnosticOverrides: [...transition.diagnosticOverrides].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  }));
  body.animation.clips = [...body.animation.clips].sort(byId);
  body.animation.deformationSamples = [...body.animation.deformationSamples].sort(byId);
  body.sequences = [...body.sequences].sort(byId).map((sequence) => ({
    ...sequence,
    viewLaneItems: [...sequence.viewLaneItems].sort((left, right) =>
      left.startTicks - right.startTicks || left.endTicks - right.endTicks || byId(left, right)),
    clipInstances: canonicalizeClipInstances(sequence.clipInstances),
  }));
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
  if (project?.schemaVersion === 2) {
    project.keyArts = (project.keyArts || []).map((keyArt) => ({
      ...keyArt,
      members: Array.isArray(keyArt.members) ? keyArt.members : [],
      metadata: keyArt.metadata && typeof keyArt.metadata === "object"
        ? keyArt.metadata
        : {},
    }));
    project.semanticSlots = (project.semanticSlots || []).map((slot) => ({
      ...slot,
      mappings: Array.isArray(slot.mappings) ? slot.mappings : [],
      metadata: slot.metadata && typeof slot.metadata === "object"
        ? slot.metadata
        : {},
    }));
    project.meshTopologies = [];
    project.meshKeyforms = [];
    project.transitions = Array.isArray(project.transitions)
      ? project.transitions
      : [];
    project.schemaVersion = 3;
  }
  if (project?.schemaVersion === 3) {
    project.meshTopologies = (project.meshTopologies || []).map((topology) => ({
      ...topology,
      vertexMetadata: topology.vertexMetadata &&
        typeof topology.vertexMetadata === "object" &&
        !Array.isArray(topology.vertexMetadata)
        ? topology.vertexMetadata
        : {},
      nextVertexSequence: Math.max(0, ...(topology.vertexIds || []).map((vertexId) => {
        const match = /^vtx_(\d+)$/.exec(vertexId);
        return match ? Number(match[1]) : 0;
      })) + 1,
    }));
    project.schemaVersion = 4;
  }
  if (project?.schemaVersion === 4) {
    project.clippingBindings = Array.isArray(project.clippingBindings)
      ? project.clippingBindings
      : [];
    project.schemaVersion = 5;
  }
  if (project?.schemaVersion === 5) {
    project.rig = project.rig && typeof project.rig === "object"
      ? project.rig
      : { deformers: [], bones: [], constraints: [] };
    // Schema 5 reserved this as an untyped rig placeholder. It predates the
    // WarpDeformer contract, so preserving entries would misinterpret legacy
    // data as authored Warp topology in schema 6.
    project.rig.deformers = [];
    project.rig.warpControlPoints = [];
    project.rig.warpDeformerKeyforms = [];
    project.rig.bones = Array.isArray(project.rig.bones) ? project.rig.bones : [];
    project.rig.constraints = Array.isArray(project.rig.constraints) ? project.rig.constraints : [];
    project.schemaVersion = 6;
  }
  if (project?.schemaVersion === 6) {
    project.rig = project.rig && typeof project.rig === "object"
      ? project.rig
      : { deformers: [], warpControlPoints: [], warpDeformerKeyforms: [], constraints: [] };
    // Schema 6 exposed bones only as an untyped future placeholder. Do not
    // reinterpret arbitrary placeholder entries as the Phase 7 Bone contract.
    project.rig.bones = [];
    project.rig.bonePoseKeyforms = [];
    project.rig.constraints = Array.isArray(project.rig.constraints) ? project.rig.constraints : [];
    project.schemaVersion = 7;
  }
  if (project?.schemaVersion === 7) {
    project.rig = project.rig && typeof project.rig === "object"
      ? project.rig
      : { bones: [], bonePoseKeyforms: [], constraints: [] };
    project.rig.rigidBoneBindings = [];
    project.schemaVersion = 8;
  }
  if (project?.schemaVersion === 8) {
    project.rig = project.rig && typeof project.rig === "object"
      ? project.rig
      : { rigidBoneBindings: [], constraints: [] };
    project.rig.skinBindings = [];
    project.schemaVersion = 9;
  }
  if (project?.schemaVersion === 9) {
    project.meshFormCorrectionKeyforms = [];
    project.schemaVersion = 10;
  }
  if (project?.schemaVersion === 10) {
    project.rig.boneRotationConstraints = [];
    project.schemaVersion = 11;
  }
  if (project?.schemaVersion === 11) {
    project.rig.twoBoneIkConstraints = [];
    project.schemaVersion = 12;
  }
  if (project?.schemaVersion === 12) {
    // Schema 12 reserved these as untyped future placeholders. No authored
    // Phase 8 contract existed, so placeholder entries must not be promoted.
    project.animation = {
      clips: [],
      deformationSamples: [],
    };
    project.sequences = [];
    delete project.sequence;
    if (project.renderSettings && typeof project.renderSettings === "object") {
      // Existing TemporalProgram durations are already authoritative. The
      // project-level legacy field is deliberately dropped, never copied.
      delete project.renderSettings.durationTicks;
    }
    project.schemaVersion = 13;
  }
  if (project?.schemaVersion === 13) {
    // Schema 13 exposed both collections only as unsupported placeholders.
    // Phase 8-2 starts their typed lifetime from empty state rather than
    // reinterpreting arbitrary legacy placeholder objects.
    project.animation = {
      clips: [],
      deformationSamples: [],
    };
    const schema13Sequences = Array.isArray(project.sequences) ? project.sequences : [];
    project.sequences = schema13Sequences.map((sequence) => ({
      ...sequence,
      clipInstances: [],
    }));
    project.schemaVersion = 14;
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
