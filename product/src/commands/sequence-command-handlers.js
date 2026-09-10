import { cloneProject } from "../model/project.js";
import {
  canonicalizeViewLaneItems,
  normalizeSequence,
} from "../model/sequence.js";
import { CommandError } from "./errors.js";

function sequenceIndex(project, sequenceId) {
  const index = project.sequences.findIndex((entry) => entry.id === sequenceId);
  if (index < 0) throw new CommandError("Unknown Sequence.", "sequence.not_found", { sequenceId });
  return index;
}

function sequenceFor(project, sequenceId) {
  return project.sequences[sequenceIndex(project, sequenceId)];
}

function viewItemIndex(sequence, viewItemId) {
  const index = sequence.viewLaneItems.findIndex((entry) => entry.id === viewItemId);
  if (index < 0) throw new CommandError("Unknown ViewLane item.", "sequence.view_item_not_found", { viewItemId });
  return index;
}

function sortSequences(project) {
  project.sequences.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export const sequenceCommandHandlers = {
  "sequence.create": (project, payload) => {
    const sequence = normalizeSequence(payload.sequence);
    if (project.sequences.some((entry) => entry.id === sequence.id)) {
      throw new CommandError("Sequence ID already exists.", "identity.duplicate", { sequenceId: sequence.id });
    }
    project.sequences.push(sequence);
    sortSequences(project);
    return {
      inverse: { type: "sequence.remove_internal", payload: { sequenceId: sequence.id } },
      affectedIds: [sequence.id, sequence.temporalProgramId],
    };
  },

  "sequence.update": (project, payload) => {
    const index = sequenceIndex(project, payload.sequenceId);
    const previous = cloneProject(project.sequences[index]);
    const next = normalizeSequence(payload.sequence);
    if (next.id !== payload.sequenceId) {
      throw new CommandError("Sequence updates must preserve stable identity.", "identity.changed");
    }
    project.sequences[index] = next;
    sortSequences(project);
    return {
      inverse: { type: "sequence.update", payload: { sequenceId: previous.id, sequence: previous } },
      affectedIds: [next.id, previous.temporalProgramId, next.temporalProgramId],
    };
  },

  "sequence.remove": (project, payload) => {
    const index = sequenceIndex(project, payload.sequenceId);
    const [sequence] = project.sequences.splice(index, 1);
    return {
      inverse: { type: "sequence.restore", payload: { sequence, index } },
      affectedIds: [sequence.id, sequence.temporalProgramId],
    };
  },

  "sequence.remove_internal": (project, payload) => {
    return sequenceCommandHandlers["sequence.remove"](project, payload);
  },

  "sequence.restore": (project, payload) => {
    project.sequences.splice(payload.index, 0, normalizeSequence(payload.sequence));
    sortSequences(project);
    return {
      inverse: { type: "sequence.remove_internal", payload: { sequenceId: payload.sequence.id } },
      affectedIds: [payload.sequence.id, payload.sequence.temporalProgramId],
    };
  },

  "sequence.add_view_item": (project, payload) => {
    const sequence = sequenceFor(project, payload.sequenceId);
    if (sequence.viewLaneItems.some((entry) => entry.id === payload.viewItem.id)) {
      throw new CommandError("ViewLane item ID already exists.", "identity.duplicate", { viewItemId: payload.viewItem.id });
    }
    sequence.viewLaneItems.push(cloneProject(payload.viewItem));
    sequence.viewLaneItems = canonicalizeViewLaneItems(sequence.viewLaneItems);
    return {
      inverse: { type: "sequence.remove_view_item_internal", payload: {
        sequenceId: sequence.id, viewItemId: payload.viewItem.id,
      } },
      affectedIds: [sequence.id, payload.viewItem.id],
    };
  },

  "sequence.update_view_item": (project, payload) => {
    const sequence = sequenceFor(project, payload.sequenceId);
    const index = viewItemIndex(sequence, payload.viewItemId);
    const previous = cloneProject(sequence.viewLaneItems[index]);
    if (payload.viewItem.id !== payload.viewItemId) {
      throw new CommandError("ViewLane item updates must preserve stable identity.", "identity.changed");
    }
    sequence.viewLaneItems[index] = cloneProject(payload.viewItem);
    sequence.viewLaneItems = canonicalizeViewLaneItems(sequence.viewLaneItems);
    return {
      inverse: { type: "sequence.update_view_item", payload: {
        sequenceId: sequence.id, viewItemId: previous.id, viewItem: previous,
      } },
      affectedIds: [sequence.id, previous.id],
    };
  },

  "sequence.remove_view_item": (project, payload) => {
    const sequence = sequenceFor(project, payload.sequenceId);
    const index = viewItemIndex(sequence, payload.viewItemId);
    const [viewItem] = sequence.viewLaneItems.splice(index, 1);
    return {
      inverse: { type: "sequence.restore_view_item", payload: {
        sequenceId: sequence.id, viewItem, index,
      } },
      affectedIds: [sequence.id, viewItem.id],
    };
  },

  "sequence.remove_view_item_internal": (project, payload) => {
    return sequenceCommandHandlers["sequence.remove_view_item"](project, payload);
  },

  "sequence.restore_view_item": (project, payload) => {
    const sequence = sequenceFor(project, payload.sequenceId);
    sequence.viewLaneItems.splice(payload.index, 0, cloneProject(payload.viewItem));
    sequence.viewLaneItems = canonicalizeViewLaneItems(sequence.viewLaneItems);
    return {
      inverse: { type: "sequence.remove_view_item_internal", payload: {
        sequenceId: sequence.id, viewItemId: payload.viewItem.id,
      } },
      affectedIds: [sequence.id, payload.viewItem.id],
    };
  },
};
