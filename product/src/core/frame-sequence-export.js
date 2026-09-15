import { planEvaluatedExportFrames } from "./export-frame-evaluator.js";
import { ExportFrameRenderer } from "./export-frame-renderer.js";
import { encodeRgba8Png } from "./png-frame-encoder.js";

import { FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY, exportFrameFileName } from "./frame-sequence-contract.js";
export { FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY, exportFrameFileName } from "./frame-sequence-contract.js";

function cancellationRequested(signal) {
  return Boolean(signal?.aborted || signal?.cancelled || signal?.canceled);
}

function failureDiagnostic(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}

export class FrameSequenceExportJob {
  constructor({
    frameRenderer = new ExportFrameRenderer(),
    encodePng = encodeRgba8Png,
    sequenceSink,
  } = {}) {
    if (!frameRenderer || typeof frameRenderer.render !== "function") {
      throw new TypeError("A frame renderer is required.");
    }
    if (typeof encodePng !== "function") {
      throw new TypeError("A PNG encoder is required.");
    }
    if (!sequenceSink ||
      typeof sequenceSink.begin !== "function" ||
      typeof sequenceSink.write !== "function" ||
      typeof sequenceSink.end !== "function") {
      throw new TypeError("A frame sequence sink is required.");
    }
    this.frameRenderer = frameRenderer;
    this.encodePng = encodePng;
    this.sequenceSink = sequenceSink;
  }

  async run({
    project,
    transitionId = null,
    sequenceId = null,
    frameRate,
    outputWidth,
    outputHeight,
    renderAssets,
    suggestedName,
    signal = null,
    onProgress = null,
  }) {
    let planner;
    try {
      planner = planEvaluatedExportFrames(project, { transitionId, sequenceId }, frameRate);
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        writtenFrames: 0,
        diagnostics: [failureDiagnostic(
          "export.sequence_plan_failure",
          error?.message || String(error),
        )],
      };
    }

    if (cancellationRequested(signal)) {
      return {
        ok: false,
        canceled: true,
        writtenFrames: 0,
        totalFrames: planner.frameCount,
        diagnostics: [failureDiagnostic("export.cancelled", "Export was cancelled before writing frames.")],
      };
    }

    let session;
    try {
      session = await this.sequenceSink.begin({
        suggestedName,
        frameCount: planner.frameCount,
        outputWidth,
        outputHeight,
        frameRate: planner.frameRate,
        partialOutputPolicy: FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY,
      });
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        writtenFrames: 0,
        totalFrames: planner.frameCount,
        diagnostics: [failureDiagnostic(
          error?.code === "EXPORT_OUTPUT_CONFLICT"
            ? "export.existing_output_conflict"
            : "export.destination_inaccessible",
          error?.message || String(error),
        )],
      };
    }
    if (!session || session.canceled) {
      return {
        ok: false,
        canceled: true,
        writtenFrames: 0,
        totalFrames: planner.frameCount,
        diagnostics: [failureDiagnostic("export.cancelled", "Export destination selection was cancelled.")],
      };
    }

    let writtenFrames = 0;
    let terminalStatus = "failed";
    try {
      for (let frameIndex = 0; frameIndex < planner.frameCount; frameIndex += 1) {
        if (cancellationRequested(signal)) {
          terminalStatus = "cancelled";
          return {
            ok: false,
            canceled: true,
            writtenFrames,
            totalFrames: planner.frameCount,
            destination: session.destination || null,
            diagnostics: [failureDiagnostic(
              "export.cancelled",
              "Export was cancelled. Frames already written were kept.",
            )],
          };
        }

        const rendered = this.frameRenderer.render({
          project,
          transitionId,
          sequenceId,
          frameRate: planner.frameRate,
          frameIndex,
          outputWidth,
          outputHeight,
          renderAssets,
        });
        if (!rendered.ok) {
          return {
            ok: false,
            canceled: false,
            writtenFrames,
            totalFrames: planner.frameCount,
            destination: session.destination || null,
            diagnostics: rendered.diagnostics?.length
              ? rendered.diagnostics
              : [failureDiagnostic("export.frame_render_failure", `Frame ${frameIndex} failed to render.`)],
          };
        }

        let pngBytes;
        try {
          pngBytes = await this.encodePng(rendered.offscreenResult);
        } catch (error) {
          return {
            ok: false,
            canceled: false,
            writtenFrames,
            totalFrames: planner.frameCount,
            destination: session.destination || null,
            diagnostics: [failureDiagnostic(
              "export.frame_encode_failure",
              `Failed to encode ${exportFrameFileName(frameIndex)}: ${error?.message || String(error)}`,
              { frameIndex },
            )],
          };
        }

        const fileName = exportFrameFileName(frameIndex);
        try {
          await this.sequenceSink.write(session, {
            fileName,
            frameIndex,
            bytes: pngBytes,
          });
        } catch (error) {
          return {
            ok: false,
            canceled: false,
            writtenFrames,
            totalFrames: planner.frameCount,
            destination: session.destination || null,
            diagnostics: [failureDiagnostic(
              error?.code === "EEXIST"
                ? "export.existing_output_conflict"
                : "export.frame_write_failure",
              `Failed to write ${fileName}: ${error?.message || String(error)}`,
              { frameIndex, fileName },
            )],
          };
        }

        writtenFrames += 1;
        if (typeof onProgress === "function") {
          onProgress(Object.freeze({
            completedFrames: writtenFrames,
            totalFrames: planner.frameCount,
            frameIndex,
            fileName,
          }));
        }
      }

      terminalStatus = "completed";
      return {
        ok: true,
        canceled: false,
        writtenFrames,
        totalFrames: planner.frameCount,
        destination: session.destination || null,
        diagnostics: [],
      };
    } finally {
      try {
        await this.sequenceSink.end(session, {
          status: terminalStatus,
          writtenFrames,
          totalFrames: planner.frameCount,
          partialOutputPolicy: FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY,
        });
      } catch {
        // The primary render/write result remains authoritative. Desktop/UI may
        // surface end-session cleanup diagnostics separately if needed.
      }
    }
  }
}
