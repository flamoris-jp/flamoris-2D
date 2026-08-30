import {
  cloneProject,
  createSceneNode,
  identityTransform,
} from "../model/project.js";
import { validateProject } from "../model/validation.js";
import { queryProject } from "../queries/project.js";

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

function normalizedTransform(value) {
  const base = identityTransform();
  return {
    position: { ...base.position, ...value?.position },
    rotation: value?.rotation ?? base.rotation,
    scale: { ...base.scale, ...value?.scale },
    pivot: { ...base.pivot, ...value?.pivot },
  };
}

const handlers = {
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
      payload: { nodeId: node.id, transform: cloneProject(node.transform) },
    };
    node.transform = normalizedTransform(payload.transform);
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_visibility": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_visibility",
      payload: { nodeId: node.id, visible: node.visible },
    };
    node.visible = Boolean(payload.visible);
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_locked": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_locked",
      payload: { nodeId: node.id, locked: node.locked },
    };
    node.locked = Boolean(payload.locked);
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

function applyToDraft(project, command) {
  if (
    !command ||
    typeof command.type !== "string" ||
    !handlers[command.type]
  ) {
    throw new CommandError(
      "Unknown command " + (command?.type || "(missing)") + ".",
      "command.unknown",
    );
  }
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
    };
    this.project = draft;
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
    entry.inverses.forEach((command) => applyToDraft(draft, command));
    const issues = validationErrors(draft);
    if (issues.length) throw new TransactionError(issues);
    this.project = draft;
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
    entry.commands.forEach((command) => applyToDraft(draft, command));
    const issues = validationErrors(draft);
    if (issues.length) throw new TransactionError(issues);
    this.project = draft;
    this.undoStack.push(entry);
    this.history.push({
      label: "Redo: " + entry.label,
      commandTypes: entry.commands.map((command) => command.type),
      affectedIds: entry.affectedIds,
    });
    this.onChange?.(cloneProject(this.project), entry);
    return { label: entry.label, affectedIds: entry.affectedIds };
  }
}
