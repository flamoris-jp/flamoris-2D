export const DEFAULT_PREFERENCES = Object.freeze({
  autosaveEnabled: true,
  autosaveIntervalSeconds: 180,
  recoveryVersions: 3,
  saveAfterMajorOperations: true,
  showRecoveryNotification: true,
  incrementalSaveWidth: 3,
});

const AUTOSAVE_INTERVALS = new Set([30, 60, 180, 300, 600]);
const RECOVERY_COUNTS = new Set([1, 3, 5, 10]);

export function normalizePreferences(value = {}) {
  const result = { ...DEFAULT_PREFERENCES };
  if (typeof value.autosaveEnabled === "boolean") {
    result.autosaveEnabled = value.autosaveEnabled;
  }
  if (AUTOSAVE_INTERVALS.has(Number(value.autosaveIntervalSeconds))) {
    result.autosaveIntervalSeconds = Number(value.autosaveIntervalSeconds);
  }
  if (RECOVERY_COUNTS.has(Number(value.recoveryVersions))) {
    result.recoveryVersions = Number(value.recoveryVersions);
  }
  if (typeof value.saveAfterMajorOperations === "boolean") {
    result.saveAfterMajorOperations = value.saveAfterMajorOperations;
  }
  if (typeof value.showRecoveryNotification === "boolean") {
    result.showRecoveryNotification = value.showRecoveryNotification;
  }
  const width = Number(value.incrementalSaveWidth);
  if (Number.isInteger(width) && width >= 1 && width <= 8) {
    result.incrementalSaveWidth = width;
  }
  return result;
}

export function createPreferencesStore(
  storage,
  { key = "flamoris2d.preferences.v1" } = {},
) {
  if (!storage?.getItem || !storage?.setItem) {
    throw new TypeError("A Storage-compatible adapter is required.");
  }
  return {
    load() {
      const raw = storage.getItem(key);
      if (!raw) return { ...DEFAULT_PREFERENCES };
      try {
        return normalizePreferences(JSON.parse(raw));
      } catch {
        return { ...DEFAULT_PREFERENCES };
      }
    },
    save(value) {
      const normalized = normalizePreferences(value);
      storage.setItem(key, JSON.stringify(normalized));
      return normalized;
    },
  };
}

export function createAutosaveScheduler({
  session,
  recovery,
  preferences,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let timer = null;
  const stop = () => {
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
  };
  const start = () => {
    stop();
    if (!preferences.autosaveEnabled) return;
    timer = setIntervalFn(() => {
      if (session.isDirty) recovery.save(session.project);
    }, preferences.autosaveIntervalSeconds * 1000);
  };
  start();
  return { start, stop, checkpoint: () => recovery.save(session.project) };
}
