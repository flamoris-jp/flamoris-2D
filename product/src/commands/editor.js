import {
  cloneProject,
  createSceneNode,
} from "../model/project.js";
import { validateProject } from "../model/validation.js";
import { queryProject } from "../queries/project.js";
import { validateCommand } from "./schemas.js";

export class CommandError extends Error {
  constructor(message, code = "command.invalid", details = null) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
}

export class TransactionError extends Error {
  constructor(issues) {
    super("Transaction failed project validation.");
    this.name = "TransactionError";
    this.code = "transaction.validation_failed";
    this.issues = issues;
  }
}

function nodeFor(project, nodeId) {
  const node = project.scene.nodes[nodeId];
  if (!node) {
    throw new CommandError(
      "Unknown node " + nodeId + ".",
      "scene.node_not_found",
      { nodeId },
    );
  }
  return node;
}

function temporalProgramFor(project, programId) {
  const program = project.temporalPrograms.find((entry) => entry.id === programId);
  if (!program) {
    throw new CommandError("Unknown TemporalProgram " + programId + ".", "animation.program_not_found", { programId });
  }
  return program;
}

function temporalTrackFor(program, trackId) {
  const track = program.tracks.find((entry) => entry.trackId === trackId);
  if (!track) {
    throw new CommandError("Unknown temporal track " + trackId + ".", "animation.track_not_found", { trackId });
  }
  return track;
}

function temporalChannelFor(track, channelName) {
  const channel = track.channels?.[channelName];
  if (!channel) {
    throw new CommandError("Unknown temporal channel " + channelName + ".", "animation.channel_not_found", { channelName });
  }
  return channel;
}

function keyframeIndex(channel, keyframeId) {
  const index = channel.keyframes.findIndex((entry) => entry.id === keyframeId);
  if (index < 0) {
    throw new CommandError("Unknown keyframe " + keyframeId + ".", "animation.keyframe_not_found", { keyframeId });
  }
  return index;
}

const handlers = {
  "animation.temporal.create_program": (project, payload) => {
    if (project.temporalPrograms.some((entry) => entry.id === payload.programId)) {
      throw new CommandError("TemporalProgram ID already exists.", "identity.duplicate", { programId: payload.programId });
    }
    project.temporalPrograms.push({
      id: payload.programId,
      durationTicks: payload.durationTicks,
      tracks: [],
      events: [],
      regions: [],
    });
    return {
      inverse: { type: "animation.temporal.remove_program", payload: { programId: payload.programId } },
      affectedIds: [payload.programId],
    };
  },

  "animation.temporal.remove_program": (project, payload) => {
    const index = project.temporalPrograms.findIndex((entry) => entry.id === payload.programId);
    if (index < 0) throw new CommandError("Unknown TemporalProgram.", "animation.program_not_found");
    const [program] = project.temporalPrograms.splice(index, 1);
    return {
      inverse: { type: "animation.temporal.restore_program", payload: { program, index } },
      affectedIds: [payload.programId],
    };
  },

  "animation.temporal.restore_program": (project, payload) => {
    project.temporalPrograms.splice(payload.index, 0, cloneProject(payload.program));
    return {
      inverse: { type: "animation.temporal.remove_program", payload: { programId: payload.program.id } },
      affectedIds: [payload.program.id],
    };
  },

  "animation.temporal.add_track": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    if (program.tracks.some((entry) => entry.trackId === payload.track.trackId)) {
      throw new CommandError("Temporal track ID already exists.", "identity.duplicate", { trackId: payload.track.trackId });
    }
    program.tracks.push(cloneProject(payload.track));
    return {
      inverse: {
        type: "animation.temporal.remove_track",
        payload: { programId: program.id, trackId: payload.track.trackId },
      },
      affectedIds: [program.id, payload.track.trackId],
    };
  },

  "animation.temporal.remove_track": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const index = program.tracks.findIndex((entry) => entry.trackId === payload.trackId);
    if (index < 0) throw new CommandError("Unknown temporal track.", "animation.track_not_found");
    const [track] = program.tracks.splice(index, 1);
    return {
      inverse: {
        type: "animation.temporal.restore_track",
        payload: { programId: program.id, track, index },
      },
      affectedIds: [program.id, track.trackId],
    };
  },

  "animation.temporal.restore_track": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.tracks.splice(payload.index, 0, cloneProject(payload.track));
    return {
      inverse: {
        type: "animation.temporal.remove_track",
        payload: { programId: program.id, trackId: payload.track.trackId },
      },
      affectedIds: [program.id, payload.track.trackId],
    };
  },

  "animation.temporal.add_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    channel.keyframes.push(cloneProject(payload.keyframe));
    return {
      inverse: {
        type: "animation.temporal.remove_keyframe",
        payload: {
          programId: program.id,
          trackId: track.trackId,
          channel: payload.channel,
          keyframeId: payload.keyframe.id,
        },
      },
      affectedIds: [program.id, track.trackId, payload.keyframe.id],
    };
  },

  "animation.temporal.update_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    const index = keyframeIndex(channel, payload.keyframeId);
    if (payload.keyframe.id !== payload.keyframeId) {
      throw new CommandError("Keyframe updates must preserve the stable ID.", "animation.keyframe_identity_changed");
    }
    const previous = cloneProject(channel.keyframes[index]);
    channel.keyframes[index] = cloneProject(payload.keyframe);
    return {
      inverse: {
        type: "animation.temporal.update_keyframe",
        payload: {
          programId: program.id,
          trackId: track.trackId,
          channel: payload.channel,
          keyframeId: payload.keyframe.id,
          keyframe: previous,
        },
      },
      affectedIds: [program.id, track.trackId, payload.keyframe.id],
    };
  },

  "animation.temporal.remove_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    const index = keyframeIndex(channel, payload.keyframeId);
    const [keyframe] = channel.keyframes.splice(index, 1);
    return {
      inverse: {
        type: "animation.temporal.restore_keyframe",
        payload: { programId: program.id, trackId: track.trackId, channel: payload.channel, keyframe, index },
      },
      affectedIds: [program.id, track.trackId, keyframe.id],
    };
  },

  "animation.temporal.restore_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    channel.keyframes.splice(payload.index, 0, cloneProject(payload.keyframe));
    return {
      inverse: {
        type: "animation.temporal.remove_keyframe",
        payload: { programId: program.id, trackId: track.trackId, channel: payload.channel, keyframeId: payload.keyframe.id },
      },
      affectedIds: [program.id, track.trackId, payload.keyframe.id],
    };
  },

  "animation.temporal.add_event": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.events.push(cloneProject(payload.event));
    return {
      inverse: { type: "animation.temporal.remove_event", payload: { programId: program.id, eventId: payload.event.id } },
      affectedIds: [program.id, payload.event.id],
    };
  },

  "animation.temporal.remove_event": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const index = program.events.findIndex((entry) => entry.id === payload.eventId);
    if (index < 0) throw new CommandError("Unknown motion event.", "animation.event_not_found");
    const [event] = program.events.splice(index, 1);
    return {
      inverse: { type: "animation.temporal.restore_event", payload: { programId: program.id, event, index } },
      affectedIds: [program.id, event.id],
    };
  },

  "animation.temporal.restore_event": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.events.splice(payload.index, 0, cloneProject(payload.event));
    return {
      inverse: { type: "animation.temporal.remove_event", payload: { programId: program.id, eventId: payload.event.id } },
      affectedIds: [program.id, payload.event.id],
    };
  },

  "animation.temporal.add_region": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.regions.push(cloneProject(payload.region));
    return {
      inverse: { type: "animation.temporal.remove_region", payload: { programId: program.id, regionId: payload.region.id } },
      affectedIds: [program.id, payload.region.id],
    };
  },

  "animation.temporal.remove_region": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const index = program.regions.findIndex((entry) => entry.id === payload.regionId);
    if (index < 0) throw new CommandError("Unknown motion region.", "animation.region_not_found");
    const [region] = program.regions.splice(index, 1);
    return {
      inverse: { type: "animation.temporal.restore_region", payload: { programId: program.id, region, index } },
      affectedIds: [program.id, region.id],
    };
  },

  "animation.temporal.restore_region": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.regions.splice(payload.index, 0, cloneProject(payload.region));
    return {
      inverse: { type: "animation.temporal.remove_region", payload: { programId: program.id, regionId: payload.region.id } },
      affectedIds: [program.id, payload.region.id],
    };
  },

  "source.apply_psd_reimport": (project, payload) => {
    const next = cloneProject(payload.project);
    if (next.id !== project.id) {
      throw new CommandError(
        "PSD re-import must preserve the logical Project ID.",
        "project.identity_changed",
      );
    }
    const inverse = {
      type: "source.apply_psd_reimport",
      payload: { project: cloneProject(project) },
    };
    const affectedIds = new Set([
      ...Object.keys(project.scene.nodes),
      ...Object.keys(next.scene.nodes),
    ]);
    for (const key of Object.keys(project)) delete project[key];
    Object.assign(project, next);
    return { inverse, affectedIds: [...affectedIds] };
  },

  "scene.rename_node": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const next = String(payload.displayName ?? "").trim();
    if (!next) {
      throw new CommandError(
        "Display name must not be empty.",
        "scene.empty_display_name",
      );
    }
    const inverse = {
      type: "scene.rename_node",
      payload: { nodeId: node.id, displayName: node.displayName },
    };
    node.displayName = next;
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_transform": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_transform",
      payload: {
        nodeId: node.id,
        coordinateSpace: "node-local",
        transform: cloneProject(node.transform),
      },
    };
    node.transform = cloneProject(payload.transform);
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_visibility": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_visibility",
      payload: { nodeId: node.id, visible: node.visible },
    };
    node.visible = payload.visible;
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_locked": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_locked",
      payload: { nodeId: node.id, locked: node.locked },
    };
    node.locked = payload.locked;
    return { inverse, affectedIds: [node.id] };
  },

  "scene.create_group": (project, payload) => {
    if (project.scene.nodes[payload.id]) {
      throw new CommandError(
        "Node " + payload.id + " already exists.",
        "identity.duplicate",
      );
    }
    const parent = nodeFor(project, payload.parentId);
    if (parent.kind !== "group") {
      throw new CommandError(
        "Groups can only be created under a group.",
        "scene.invalid_parent_kind",
      );
    }
    const displayName = String(payload.displayName ?? "").trim();
    if (!displayName) {
      throw new CommandError(
        "Display name must not be empty.",
        "scene.empty_display_name",
      );
    }
    const node = createSceneNode({
      id: payload.id,
      kind: "group",
      displayName,
      parentId: parent.id,
    });
    project.scene.nodes[node.id] = node;
    const index = payload.index == null
      ? parent.children.length
      : Math.max(0, Math.min(parent.children.length, payload.index));
    parent.children.splice(index, 0, node.id);
    return {
      inverse: {
        type: "scene.remove_empty_group",
        payload: { nodeId: node.id },
      },
      affectedIds: [parent.id, node.id],
    };
  },

  "scene.remove_empty_group": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    if (
      node.id === project.scene.rootId ||
      node.kind !== "group" ||
      node.children.length
    ) {
      throw new CommandError(
        "Only an empty non-root group can be removed.",
        "scene.group_not_empty",
      );
    }
    const parent = nodeFor(project, node.parentId);
    const index = parent.children.indexOf(node.id);
    parent.children.splice(index, 1);
    delete project.scene.nodes[node.id];
    return {
      inverse: {
        type: "scene.create_group",
        payload: {
          id: node.id,
          parentId: parent.id,
          displayName: node.displayName,
          index,
        },
      },
      affectedIds: [parent.id, node.id],
    };
  },

  "scene.reparent_node": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const nextParent = nodeFor(project, payload.parentId);
    if (node.id === project.scene.rootId) {
      throw new CommandError(
        "The scene root cannot be reparented.",
        "scene.reparent_root",
      );
    }
    if (nextParent.kind !== "group") {
      throw new CommandError(
        "Parent must be a group.",
        "scene.invalid_parent_kind",
      );
    }
    let ancestor = nextParent;
    while (ancestor) {
      if (ancestor.id === node.id) {
        throw new CommandError(
          "Reparenting would create a cycle.",
          "scene.cycle",
        );
      }
      ancestor = ancestor.parentId
        ? project.scene.nodes[ancestor.parentId]
        : null;
    }
    const previousParent = nodeFor(project, node.parentId);
    const previousIndex = previousParent.children.indexOf(node.id);
    previousParent.children.splice(previousIndex, 1);
    const index = payload.index == null
      ? nextParent.children.length
      : Math.max(0, Math.min(nextParent.children.length, payload.index));
    nextParent.children.splice(index, 0, node.id);
    node.parentId = nextParent.id;
    return {
      inverse: {
        type: "scene.reparent_node",
        payload: {
          nodeId: node.id,
          parentId: previousParent.id,
          index: previousIndex,
        },
      },
      affectedIds: [node.id, previousParent.id, nextParent.id],
    };
  },
};

function assertCommand(command, { allowInternal = false } = {}) {
  const issues = validateCommand(command, { allowInternal });
  if (issues.length) {
    throw new CommandError(
      "Malformed command payload.",
      "command.payload_invalid",
      { issues },
    );
  }
}

function applyToDraft(project, command) {
  return handlers[command.type](project, command.payload || {});
}

function validationErrors(project) {
  return validateProject(project)
    .filter((entry) => entry.severity === "error");
}

export class EditorSession {
  constructor(project, { onChange = null } = {}) {
    const errors = validationErrors(project);
    if (errors.length) throw new TransactionError(errors);
    this.project = cloneProject(project);
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
    this.history = [];
    this.revisionCounter = 0;
    this.currentRevision = 0;
    this.savedRevision = 0;
  }

  query(name, input) {
    return queryProject(this.project, name, input);
  }

  execute(command, options = {}) {
    return this.executeTransaction([command], options);
  }

  executeTransaction(commands, { label = "Edit" } = {}) {
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new CommandError(
        "A transaction needs at least one command.",
        "transaction.empty",
      );
    }
    commands.forEach((command) => assertCommand(command));
    const draft = cloneProject(this.project);
    const inverses = [];
    const affected = new Set();
    for (const command of commands) {
      const result = applyToDraft(draft, command);
      inverses.unshift(result.inverse);
      result.affectedIds.forEach((id) => affected.add(id));
    }
    const issues = validateProject(draft);
    if (issues.some((entry) => entry.severity === "error")) {
      throw new TransactionError(issues);
    }
    const entry = {
      label,
      commands: cloneProject(commands),
      inverses,
      affectedIds: [...affected],
      beforeRevision: this.currentRevision,
      afterRevision: ++this.revisionCounter,
    };
    this.project = draft;
    this.currentRevision = entry.afterRevision;
    this.undoStack.push(entry);
    this.redoStack = [];
    this.history.push({
      label,
      commandTypes: commands.map((command) => command.type),
      affectedIds: [...affected],
    });
    this.onChange?.(cloneProject(this.project), entry);
    return {
      applied: commands.length,
      affectedIds: [...affected],
      validation: { valid: true, issues },
      historyIndex: this.history.length - 1,
    };
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const draft = cloneProject(this.project);
    entry.inverses.forEach((command) => {
      assertCommand(command, { allowInternal: true });
      applyToDraft(draft, command);
    });
    const issues = validationErrors(draft);
    if (issues.length) throw new TransactionError(issues);
    this.project = draft;
    this.currentRevision = entry.beforeRevision;
    this.redoStack.push(entry);
    this.history.push({
      label: "Undo: " + entry.label,
      commandTypes: entry.inverses.map((command) => command.type),
      affectedIds: entry.affectedIds,
    });
    this.onChange?.(cloneProject(this.project), entry);
    return { label: entry.label, affectedIds: entry.affectedIds };
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const draft = cloneProject(this.project);
    entry.commands.forEach((command) => {
      assertCommand(command);
      applyToDraft(draft, command);
    });
    const issues = validationErrors(draft);
    if (issues.length) throw new TransactionError(issues);
    this.project = draft;
    this.currentRevision = entry.afterRevision;
    this.undoStack.push(entry);
    this.history.push({
      label: "Redo: " + entry.label,
      commandTypes: entry.commands.map((command) => command.type),
      affectedIds: entry.affectedIds,
    });
    this.onChange?.(cloneProject(this.project), entry);
    return { label: entry.label, affectedIds: entry.affectedIds };
  }

  markSaved(revision = this.currentRevision) {
    if (!Number.isInteger(revision) || revision < 0 ||
      revision > this.revisionCounter) {
      throw new CommandError(
        "The saved revision is invalid.",
        "history.saved_revision_invalid",
      );
    }
    this.savedRevision = revision;
    this.onChange?.(cloneProject(this.project), {
      label: "Save point",
      transient: true,
    });
  }

  replaceProject(project, { saved = true } = {}) {
    const errors = validationErrors(project);
    if (errors.length) throw new TransactionError(errors);
    this.project = cloneProject(project);
    this.undoStack = [];
    this.redoStack = [];
    this.history = [];
    this.revisionCounter = 0;
    this.currentRevision = 0;
    this.savedRevision = saved ? 0 : -1;
    this.onChange?.(cloneProject(this.project), {
      label: "Replace project",
      transient: true,
    });
  }

  get isDirty() {
    return this.currentRevision !== this.savedRevision;
  }
}
