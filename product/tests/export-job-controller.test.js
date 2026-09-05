import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EXPORT_FORMATS,
  ExportJobController,
  validateExportRequest,
} from "../src/core/export-job-controller.js";

function fixtureProject() {
  return {
    id: "project",
    displayName: "Export UX",
    canvas: { width: 1280, height: 720 },
    transitions: [{ id: "transition", temporalProgramId: "program" }],
    temporalPrograms: [{ id: "program", durationTicks: 120000, tracks: [], events: [], regions: [] }],
  };
}

function request(project = fixtureProject(), overrides = {}) {
  return {
    project,
    transitionId: "transition",
    outputWidth: 1280,
    outputHeight: 720,
    frameRate: { numerator: 60000, denominator: 2002 },
    format: "png-sequence",
    renderAssets: [],
    suggestedName: "shot",
    ...overrides,
  };
}

test("export request validation normalizes rational FPS without inventing a second time model", () => {
  const project = fixtureProject();
  const result = validateExportRequest(request(project));
  assert.equal(result.ok, true);
  assert.deepEqual(result.request.frameRate, { numerator: 30000, denominator: 1001 });
  assert.equal(result.request.outputWidth, 1280);
  assert.equal(result.request.outputHeight, 720);
  assert.deepEqual(EXPORT_FORMATS, ["png-sequence", "mp4"]);

  const invalid = validateExportRequest(request(project, {
    transitionId: "missing",
    outputWidth: 0,
    frameRate: { numerator: 0, denominator: 1 },
    format: "avi",
  }));
  assert.equal(invalid.ok, false);
  assert.deepEqual(new Set(invalid.diagnostics.map((entry) => entry.code)), new Set([
    "export.missing_transition",
    "export.invalid_output_resolution",
    "export.invalid_fps",
    "export.unsupported_format",
  ]));
});

test("controller delegates one normalized request, projects progress, and never mutates Project", async () => {
  const project = fixtureProject();
  const before = JSON.stringify(project);
  const calls = [];
  const reasons = [];
  const runner = {
    async run(runRequest) {
      calls.push(runRequest);
      runRequest.onProgress({ completedFrames: 1, totalFrames: 2, frameIndex: 0 });
      runRequest.onProgress({ completedFrames: 2, totalFrames: 2, frameIndex: 1 });
      return {
        ok: true,
        canceled: false,
        writtenFrames: 2,
        totalFrames: 2,
        destination: "C:/exports/shot",
        diagnostics: [],
      };
    },
  };
  const controller = new ExportJobController({
    runners: { "png-sequence": runner },
    onChange: (reason) => reasons.push(reason),
  });

  const result = await controller.start(request(project));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].frameRate, { numerator: 30000, denominator: 1001 });
  assert.equal(calls[0].signal instanceof AbortSignal, true);
  assert.equal(controller.getState().status, "completed");
  assert.equal(controller.getState().progress.completedFrames, 2);
  assert.equal(controller.getState().progress.ratio, 1);
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(reasons, [
    "export-started",
    "export-progress",
    "export-progress",
    "export-completed",
  ]);
});

test("supported format without a runtime runner fails before any export side effect", async () => {
  const controller = new ExportJobController({
    runners: { "png-sequence": { run: async () => ({ ok: true, diagnostics: [] }) } },
  });
  const result = await controller.start(request(fixtureProject(), { format: "mp4" }));
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "export.format_unavailable");
  assert.equal(controller.getState().status, "failed");
});

test("cancel aborts the active runner and leaves the controller reusable", async () => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const runner = {
    run({ signal }) {
      markStarted();
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({
          ok: false,
          canceled: true,
          diagnostics: [{ code: "export.cancelled", message: "cancelled" }],
        }), { once: true });
      });
    },
  };
  const controller = new ExportJobController({ runners: { "png-sequence": runner } });
  const active = controller.start(request());
  await started;
  assert.equal(controller.getState().status, "running");
  assert.equal(controller.cancel(), true);
  const result = await active;
  assert.equal(result.canceled, true);
  assert.equal(controller.getState().status, "cancelled");
  assert.equal(controller.getState().cancelRequested, true);
  assert.equal(controller.cancel(), false);

  controller.reset();
  assert.equal(controller.getState().status, "idle");
});

test("a second export cannot replace an active job", async () => {
  let release;
  const runner = {
    run() {
      return new Promise((resolve) => { release = resolve; });
    },
  };
  const controller = new ExportJobController({ runners: { "png-sequence": runner } });
  const active = controller.start(request());
  await Promise.resolve();
  await assert.rejects(
    () => controller.start(request()),
    (error) => error.code === "EXPORT_JOB_ALREADY_RUNNING",
  );
  release({ ok: true, canceled: false, diagnostics: [] });
  await active;
  assert.equal(controller.getState().status, "completed");
});

test("export job controller is DOM-independent and packaged as production core", async () => {
  const source = await readFile(
    new URL("../src/core/export-job-controller.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|HTMLElement|EditorSession/);

  const productionFiles = await readFile(
    new URL("../production-files.txt", import.meta.url),
    "utf8",
  );
  assert.match(productionFiles, /^src\/core\/export-job-controller\.js$/m);
});
