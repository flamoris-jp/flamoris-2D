import { cloneProject } from "../model/project.js";
import { validateProject } from "../model/validation.js";
import {
  EditorSession,
  TransactionError,
} from "../commands/editor.js";

function assertValid(project) {
  const issues = validateProject(project);
  if (issues.some((entry) => entry.severity === "error")) {
    throw new TransactionError(issues);
  }
}

export function serializeProject(project, spacing = 2) {
  assertValid(project);
  return JSON.stringify(project, null, spacing);
}

export function deserializeProject(source) {
  const project = typeof source === "string"
    ? JSON.parse(source)
    : cloneProject(source);
  assertValid(project);
  return project;
}

export function createRecoveryStore(
  storage,
  { key = "flamoris2d.recovery.v1" } = {},
) {
  if (
    !storage?.getItem ||
    !storage?.setItem ||
    !storage?.removeItem
  ) {
    throw new TypeError("A Storage-compatible adapter is required.");
  }
  return {
    save(project) {
      storage.setItem(key, serializeProject(project, 0));
    },
    load() {
      const value = storage.getItem(key);
      return value ? deserializeProject(value) : null;
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
      recovery.save(updatedProject);
      userOnChange?.(updatedProject, entry);
    },
  });
  return { session, recovery };
}
