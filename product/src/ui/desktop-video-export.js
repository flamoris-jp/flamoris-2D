import { FrameSequenceExportJob } from "../core/frame-sequence-export.js";

function desktopFailure(result, fallbackMessage) {
  if (!result?.desktopError) return null;
  const error = new Error(result.desktopError.message || fallbackMessage);
  error.code = result.desktopError.code;
  return error;
}

function diagnosticFromDesktop(result) {
  const error = result?.desktopError;
  if (!error) return null;
  const code = error.code === "VIDEO_ENCODER_CANCELLED"
    ? "export.cancelled"
    : error.code === "VIDEO_OUTPUT_CONFLICT"
      ? "export.existing_output_conflict"
      : error.code?.startsWith("VIDEO_ENCODER_")
        ? "export.encoder_failure"
        : "export.video_failure";
  return Object.freeze({
    code,
    message: error.message || "Video export failed.",
    sourceCode: error.code || null,
  });
}

export function createDesktopVideoFrameSink(desktopApi) {
  if (!desktopApi ||
    typeof desktopApi.beginVideoExport !== "function" ||
    typeof desktopApi.writeVideoFrame !== "function" ||
    typeof desktopApi.cancelVideoExport !== "function") {
    throw new TypeError("Desktop temporary video frame APIs are unavailable.");
  }

  let completedSession = null;
  return Object.freeze({
    async begin(request) {
      completedSession = null;
      const result = await desktopApi.beginVideoExport({
        suggestedName: request.suggestedName,
        temporaryFrames: true,
      });
      if (!result || result.canceled) return { canceled: true };
      const failure = desktopFailure(result, "Video destination failed.");
      if (failure) {
        if (failure.code === "VIDEO_OUTPUT_CONFLICT") failure.code = "EXPORT_OUTPUT_CONFLICT";
        throw failure;
      }
      if (!result.temporaryFrames) {
        throw new Error("Desktop video session did not enable temporary frames.");
      }
      return Object.freeze({
        sessionId: result.sessionId,
        destination: result.destination || null,
      });
    },

    async write(session, frame) {
      const result = await desktopApi.writeVideoFrame({
        sessionId: session.sessionId,
        fileName: frame.fileName,
        bytes: frame.bytes,
      });
      const failure = desktopFailure(result, "Temporary video frame write failed.");
      if (failure) throw failure;
      return result;
    },

    async end(session, details) {
      if (!session?.sessionId) return null;
      if (details?.status === "completed") {
        completedSession = session;
        return { ok: true, completed: true };
      }
      return desktopApi.cancelVideoExport({ sessionId: session.sessionId });
    },

    completedSession() {
      return completedSession;
    },
  });
}

export class DesktopMp4ExportJob {
  constructor({
    desktopApi,
    frameRenderer = null,
    encodePng = null,
  } = {}) {
    if (!desktopApi ||
      typeof desktopApi.encodeVideo !== "function" ||
      typeof desktopApi.cancelVideoExport !== "function") {
      throw new TypeError("Desktop video encoder APIs are unavailable.");
    }
    this.desktopApi = desktopApi;
    this.frameRenderer = frameRenderer;
    this.encodePng = encodePng;
  }

  async run(request) {
    const sink = createDesktopVideoFrameSink(this.desktopApi);
    const options = { sequenceSink: sink };
    if (this.frameRenderer) options.frameRenderer = this.frameRenderer;
    if (this.encodePng) options.encodePng = this.encodePng;
    const frameJob = new FrameSequenceExportJob(options);
    const callerProgress = typeof request.onProgress === "function"
      ? request.onProgress : null;

    const sequenceResult = await frameJob.run({
      ...request,
      onProgress(entry) {
        callerProgress?.(Object.freeze({ ...entry, phase: "rendering" }));
      },
    });
    if (!sequenceResult.ok) return sequenceResult;

    const session = sink.completedSession();
    if (!session?.sessionId) {
      return Object.freeze({
        ok: false,
        canceled: false,
        writtenFrames: sequenceResult.writtenFrames,
        totalFrames: sequenceResult.totalFrames,
        destination: sequenceResult.destination || null,
        diagnostics: [Object.freeze({
          code: "export.video_session_missing",
          message: "Completed video frames have no Desktop encoder session.",
        })],
      });
    }

    let cancellationRequest = null;
    const cancelEncoder = () => {
      cancellationRequest ||= Promise.resolve(this.desktopApi.cancelVideoExport({
        sessionId: session.sessionId,
      })).catch(() => null);
    };
    request.signal?.addEventListener?.("abort", cancelEncoder, { once: true });

    try {
      callerProgress?.(Object.freeze({
        phase: "encoding",
        completedFrames: sequenceResult.totalFrames,
        totalFrames: sequenceResult.totalFrames,
        frameIndex: Math.max(0, sequenceResult.totalFrames - 1),
      }));
      if (request.signal?.aborted) {
        cancelEncoder();
        await cancellationRequest;
        return Object.freeze({
          ...sequenceResult,
          ok: false,
          canceled: true,
          diagnostics: [Object.freeze({
            code: "export.cancelled",
            message: "Video export was cancelled before encoding.",
          })],
        });
      }

      const encoded = await this.desktopApi.encodeVideo({
        sessionId: session.sessionId,
        frameRate: request.frameRate,
        frameCount: sequenceResult.totalFrames,
      });
      const failureDiagnostic = diagnosticFromDesktop(encoded);
      if (failureDiagnostic) {
        return Object.freeze({
          ...sequenceResult,
          ok: false,
          canceled: failureDiagnostic.code === "export.cancelled",
          diagnostics: Object.freeze([
            failureDiagnostic,
            ...(encoded?.diagnostics || []).map((entry) => Object.freeze({
              code: "export.temp_cleanup_failure",
              message: entry.message || String(entry),
              sourceCode: entry.code || null,
            })),
          ]),
        });
      }

      return Object.freeze({
        ...sequenceResult,
        ok: true,
        canceled: false,
        destination: encoded?.destination || sequenceResult.destination || null,
        diagnostics: Object.freeze((encoded?.diagnostics || []).map((entry) => Object.freeze({
          code: "export.temp_cleanup_failure",
          message: entry.message || String(entry),
          sourceCode: entry.code || null,
        }))),
      });
    } finally {
      request.signal?.removeEventListener?.("abort", cancelEncoder);
    }
  }
}
