import { basename, dirname, join, resolve } from "node:path";
import {
  incrementalFilename,
  normalizeFl2dFilename,
} from "../io/project-files.js";

export const RECENT_FILE_LIMIT = 10;

export function filePickerConfiguration(purpose = "open") {
  if (purpose === "import-psd" || purpose === "reimport-psd") {
    return {
      title: "Select PSD",
      requiredExtension: ".psd",
      filters: [{ name: "Adobe Photoshop", extensions: ["psd"] }],
    };
  }
  if (purpose === "import-cutwork-flimg") {
    return {
      title: "Select Cutwork Image",
      requiredExtension: ".flimg",
      filters: [{ name: "Cutwork Image", extensions: ["flimg"] }],
    };
  }
  return {
    title: "Open",
    requiredExtension: null,
    filters: [
      { name: "FLAMORIS 2D / Source", extensions: ["fl2d", "psd", "png"] },
      { name: "FLAMORIS 2D Project", extensions: ["fl2d"] },
      { name: "Adobe Photoshop", extensions: ["psd"] },
      { name: "PNG Image", extensions: ["png"] },
    ],
  };
}

export function documentTitle({
  filePath = null,
  fileName = null,
  displayName = "Untitled",
  dirty = false,
  recovered = false,
} = {}) {
  const rawName = filePath ? basename(filePath) : (fileName || displayName);
  const name = normalizeFl2dFilename(rawName || "Untitled");
  return `${name}${dirty ? " *" : ""}${recovered ? " · Recovered" : ""}`;
}

export function updateRecentFiles(
  recentFiles,
  candidate = null,
  {
    exists = () => true,
    limit = RECENT_FILE_LIMIT,
    caseInsensitive = process.platform === "win32",
  } = {},
) {
  const values = candidate
    ? [candidate, ...(Array.isArray(recentFiles) ? recentFiles : [])]
    : (Array.isArray(recentFiles) ? recentFiles : []);
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const absolute = resolve(value);
    if (!absolute.toLocaleLowerCase().endsWith(".fl2d") || !exists(absolute)) {
      continue;
    }
    const key = caseInsensitive ? absolute.toLocaleLowerCase() : absolute;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(absolute);
    if (result.length >= Math.max(1, limit)) break;
  }
  return result;
}

export function nextIncrementalFilePath({
  currentFilePath = null,
  directory = null,
  suggestedName = "Untitled.fl2d",
  existingFileNames = [],
  width = 3,
} = {}) {
  const currentName = currentFilePath
    ? basename(currentFilePath)
    : normalizeFl2dFilename(suggestedName);
  const targetDirectory = currentFilePath
    ? dirname(currentFilePath)
    : resolve(directory || ".");
  return join(
    targetDirectory,
    incrementalFilename(currentName, existingFileNames, width),
  );
}

export function resolveUnsavedDecision(
  { dirty, choice, saveSucceeded = false } = {},
) {
  if (!dirty) return { proceed: true, save: false };
  if (choice === "discard") return { proceed: true, save: false };
  if (choice === "save") {
    return { proceed: Boolean(saveSucceeded), save: true };
  }
  return { proceed: false, save: false };
}
