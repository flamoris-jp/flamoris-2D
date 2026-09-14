import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NODE_RUNTIME_PREREQUISITES = Object.freeze([
  { name: "Blob", available: () => typeof Blob === "function" },
  { name: "DecompressionStream", available: () => typeof DecompressionStream === "function" },
  { name: "TextDecoder", available: () => typeof TextDecoder === "function" },
  { name: "structuredClone", available: () => typeof structuredClone === "function" },
]);

export function assertNodeRuntimeCapabilities() {
  const major = Number(process.versions.node.split(".")[0]);
  const missing = NODE_RUNTIME_PREREQUISITES
    .filter((entry) => !entry.available())
    .map((entry) => entry.name);
  if (major < 24 || missing.length) {
    const error = new Error("Product Host requires the reviewed Node 24 runtime surface.");
    error.code = "host.runtime_unsupported";
    error.details = { requiredNodeMajor: 24, actual: process.versions.node, missing };
    throw error;
  }
}

const STATIC_IMPORT = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const UNOWNED_BROWSER_MARKERS = [
  { name: "window", pattern: /\bwindow\s*\./ },
  { name: "DOM document", pattern: /\bdocument\s*\.(?:create|query|getElement|addEvent)/ },
  { name: "localStorage", pattern: /\blocalStorage\b/ },
  { name: "OffscreenCanvas", pattern: /\b(?:globalThis\s*\.\s*)?OffscreenCanvas\b/ },
  { name: "HTML canvas", pattern: /\b(?:HTMLCanvasElement|CanvasRenderingContext2D)\b/ },
  { name: "WebGL", pattern: /\bWebGL(?:2)?RenderingContext\b/ },
];

function localImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(fromFile), specifier);
  return extname(candidate) ? candidate : `${candidate}.js`;
}

export async function auditModuleGraph(entryUrl) {
  const entry = typeof entryUrl === "string" ? resolve(entryUrl) : fileURLToPath(entryUrl);
  const visited = new Set();
  const violations = [];
  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const marker of UNOWNED_BROWSER_MARKERS) {
      if (marker.pattern.test(source)) violations.push({ file, marker: marker.name });
    }
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const dependency = localImport(file, match[1]);
      if (dependency) await visit(dependency);
    }
  }
  await visit(entry);
  return {
    entry,
    modules: [...visited].sort(),
    violations: violations.sort((left, right) => left.file.localeCompare(right.file)),
  };
}
