import { cloneProject } from "../model/project.js";
import { validateProject } from "../model/validation.js";
import { queryProject } from "../queries/project.js";
import { CommandError, TransactionError } from "./errors.js";
import { sceneCommandHandlers } from "./scene-command-handlers.js";
import { validateCommand } from "./schemas.js";
import { temporalCommandHandlers } from "./temporal-command-handlers.js";
import { transitionCommandHandlers } from "./transition-command-handlers.js";
import { meshTopologyCommandHandlers } from "./mesh-topology-command-handlers.js";
import { clippingCommandHandlers } from "./clipping-command-handlers.js";
import { warpDeformerCommandHandlers } from "./warp-deformer-command-handlers.js";

export { CommandError, TransactionError } from "./errors.js";

const handlers = {
  ...temporalCommandHandlers,
  ...sceneCommandHandlers,
  ...transitionCommandHandlers,
  ...meshTopologyCommandHandlers,
  ...clippingCommandHandlers,
  ...warpDeformerCommandHandlers,
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
