import { normalizeFrameRate } from "./temporal.js";

export const EXPORT_FORMATS = Object.freeze([
  "png-sequence",
  "mp4",
]);

export const EXPORT_JOB_STATUSES = Object.freeze([
  "idle",
  "running",
  "completed",
  "cancelled",
  "failed",
]);

function diagnostic(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}

function immutableState(state) {
  return Object.freeze({
    ...state,
    diagnostics: Object.freeze([...(state.diagnostics || [])]),
    progress: state.progress ? Object.freeze({ ...state.progress }) : null,
  });
}

function positiveDimension(value, label, diagnostics) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    diagnostics.push(diagnostic(
      "export.invalid_output_resolution",
      `${label} must be a positive safe integer.`,
      { field: label === "Output width" ? "outputWidth" : "outputHeight" },
    ));
    return null;
  }
  return value;
}

function normalizedProgress(progress) {
  if (!progress || typeof progress !== "object") return null;
  const completedFrames = Number.isSafeInteger(progress.completedFrames) &&
    progress.completedFrames >= 0
    ? progress.completedFrames : 0;
  const totalFrames = Number.isSafeInteger(progress.totalFrames) &&
    progress.totalFrames >= 0
    ? progress.totalFrames : 0;
  const ratio = totalFrames > 0
    ? Math.min(1, Math.max(0, completedFrames / totalFrames))
    : 0;
  return Object.freeze({
    ...progress,
    completedFrames,
    totalFrames,
    ratio,
  });
}

export function validateExportRequest(request = {}) {
  const diagnostics = [];
  const project = request.project;
  if (!project || typeof project !== "object") {
    diagnostics.push(diagnostic(
      "export.missing_project",
      "An export Project is required.",
    ));
  }

  const transitionId = typeof request.transitionId === "string"
    ? request.transitionId.trim() : "";
  if (!transitionId) {
    diagnostics.push(diagnostic(
      "export.missing_transition",
      "A Transition must be selected for export.",
    ));
  } else if (project && !project.transitions?.some((entry) => entry.id === transitionId)) {
    diagnostics.push(diagnostic(
      "export.missing_transition",
      `Unknown Transition ${transitionId}.`,
      { transitionId },
    ));
  }

  const outputWidth = positiveDimension(request.outputWidth, "Output width", diagnostics);
  const outputHeight = positiveDimension(request.outputHeight, "Output height", diagnostics);

  let frameRate = null;
  try {
    frameRate = normalizeFrameRate(request.frameRate);
  } catch (error) {
    diagnostics.push(diagnostic(
      "export.invalid_fps",
      error?.message || String(error),
    ));
  }

  const format = request.format || "png-sequence";
  if (!EXPORT_FORMATS.includes(format)) {
    diagnostics.push(diagnostic(
      "export.unsupported_format",
      `Unsupported export format ${format}.`,
      { format },
    ));
  }

  if (diagnostics.length) {
    return Object.freeze({
      ok: false,
      request: null,
      diagnostics: Object.freeze(diagnostics),
    });
  }

  return Object.freeze({
    ok: true,
    request: Object.freeze({
      ...request,
      transitionId,
      outputWidth,
      outputHeight,
      frameRate: Object.freeze(frameRate),
      format,
    }),
    diagnostics: Object.freeze([]),
  });
}

export class ExportJobController {
  constructor({ runners = {}, onChange = null } = {}) {
    this.runners = new Map();
    for (const [format, runner] of Object.entries(runners)) {
      if (!EXPORT_FORMATS.includes(format)) {
        throw new Error(`Unsupported export runner format ${format}.`);
      }
      if (!runner || typeof runner.run !== "function") {
        throw new TypeError(`Export runner ${format} must provide run().`);
      }
      this.runners.set(format, runner);
    }
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.abortController = null;
    this.state = immutableState({
      status: "idle",
      format: null,
      progress: null,
      diagnostics: [],
      result: null,
      cancelRequested: false,
    });
  }

  notify(reason) {
    this.onChange?.(reason, this.getState());
  }

  getState() {
    return this.state;
  }

  availableFormats() {
    return Object.freeze([...this.runners.keys()]);
  }

  setState(next, reason) {
    this.state = immutableState(next);
    this.notify(reason);
  }

  cancel() {
    if (this.state.status !== "running" || !this.abortController) return false;
    if (!this.state.cancelRequested) {
      this.setState({
        ...this.state,
        cancelRequested: true,
      }, "export-cancel-requested");
    }
    this.abortController.abort();
    return true;
  }

  reset() {
    if (this.state.status === "running") {
      const error = new Error("Cannot reset an active export job.");
      error.code = "EXPORT_JOB_RUNNING";
      throw error;
    }
    this.setState({
      status: "idle",
      format: null,
      progress: null,
      diagnostics: [],
      result: null,
      cancelRequested: false,
    }, "export-reset");
  }

  async start(request = {}) {
    if (this.state.status === "running") {
      const error = new Error("An export job is already running.");
      error.code = "EXPORT_JOB_ALREADY_RUNNING";
      throw error;
    }

    const validation = validateExportRequest(request);
    if (!validation.ok) {
      const result = Object.freeze({
        ok: false,
        canceled: false,
        diagnostics: validation.diagnostics,
      });
      this.setState({
        status: "failed",
        format: request.format || null,
        progress: null,
        diagnostics: validation.diagnostics,
        result,
        cancelRequested: false,
      }, "export-validation-failed");
      return result;
    }

    const normalizedRequest = validation.request;
    const runner = this.runners.get(normalizedRequest.format);
    if (!runner) {
      const diagnostics = [diagnostic(
        "export.format_unavailable",
        `Export format ${normalizedRequest.format} is unavailable in this runtime.`,
        { format: normalizedRequest.format },
      )];
      const result = Object.freeze({ ok: false, canceled: false, diagnostics });
      this.setState({
        status: "failed",
        format: normalizedRequest.format,
        progress: null,
        diagnostics,
        result,
        cancelRequested: false,
      }, "export-format-unavailable");
      return result;
    }

    const abortController = new AbortController();
    this.abortController = abortController;
    this.setState({
      status: "running",
      format: normalizedRequest.format,
      progress: null,
      diagnostics: [],
      result: null,
      cancelRequested: false,
    }, "export-started");

    const callerProgress = typeof normalizedRequest.onProgress === "function"
      ? normalizedRequest.onProgress : null;
    const onProgress = (progress) => {
      const nextProgress = normalizedProgress(progress);
      this.setState({
        ...this.state,
        progress: nextProgress,
      }, "export-progress");
      callerProgress?.(nextProgress);
    };

    let result;
    try {
      result = await runner.run({
        ...normalizedRequest,
        signal: abortController.signal,
        onProgress,
      });
      const canceled = Boolean(result?.canceled || abortController.signal.aborted);
      const diagnostics = Array.isArray(result?.diagnostics)
        ? result.diagnostics : [];
      const normalizedResult = Object.freeze({
        ...(result || {}),
        ok: Boolean(result?.ok) && !canceled,
        canceled,
        diagnostics: Object.freeze([...diagnostics]),
      });
      this.setState({
        ...this.state,
        status: canceled ? "cancelled" : normalizedResult.ok ? "completed" : "failed",
        diagnostics: normalizedResult.diagnostics,
        result: normalizedResult,
        cancelRequested: canceled || this.state.cancelRequested,
      }, canceled ? "export-cancelled" : normalizedResult.ok ? "export-completed" : "export-failed");
      return normalizedResult;
    } catch (error) {
      const canceled = abortController.signal.aborted ||
        error?.code === "VIDEO_ENCODER_CANCELLED" ||
        error?.code === "EXPORT_CANCELLED";
      const diagnostics = [diagnostic(
        canceled ? "export.cancelled" : "export.job_failure",
        error?.message || String(error),
        error?.code ? { sourceCode: error.code } : {},
      )];
      result = Object.freeze({
        ok: false,
        canceled,
        diagnostics: Object.freeze(diagnostics),
      });
      this.setState({
        ...this.state,
        status: canceled ? "cancelled" : "failed",
        diagnostics,
        result,
        cancelRequested: canceled || this.state.cancelRequested,
      }, canceled ? "export-cancelled" : "export-failed");
      return result;
    } finally {
      if (this.abortController === abortController) this.abortController = null;
    }
  }
}
