import { createProjectCanvasRenderTarget } from "./composition-render-target.js";
import { evaluateTransitionExportFrame } from "./export-frame-evaluator.js";
import { renderEvaluatedComposition } from "./shared-composition-renderer.js";

function diagnostic(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}

function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((entry) => {
    const key = `${entry.code}:${entry.nodeId || ""}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderAssetMap(renderAssets) {
  if (renderAssets instanceof Map) return new Map(renderAssets);
  if (!Array.isArray(renderAssets)) return new Map();
  return new Map(renderAssets
    .filter((asset) => asset && typeof asset.nodeId === "string")
    .map((asset) => [asset.nodeId, asset]));
}

function classifyEvaluationFailure(error) {
  const message = error?.message || String(error);
  if (message.startsWith("Unknown Transition ")) {
    return diagnostic("export.missing_transition", message);
  }
  if (message.startsWith("Unknown TemporalProgram ")) {
    return diagnostic("export.missing_temporal_program", message);
  }
  return diagnostic("export.frame_evaluation_failure", message);
}

function invalidTransformDiagnostics(evaluation) {
  const diagnostics = [];
  for (const part of evaluation.evaluatedParts || []) {
    for (const instance of part.renderInstances || []) {
      if (!Array.isArray(instance.transform) || instance.transform.length !== 6 ||
        instance.transform.some((value) => !Number.isFinite(value))) {
        diagnostics.push(diagnostic(
          "export.invalid_transform",
          `Render instance ${instance.renderInstanceId} has an invalid or non-finite transform.`,
          { renderInstanceId: instance.renderInstanceId },
        ));
      }
    }
  }
  return diagnostics;
}

export class ExportFrameRenderer {
  constructor({ createOffscreenRenderer }) {
    if (typeof createOffscreenRenderer !== "function") {
      throw new TypeError("An offscreen renderer factory is required.");
    }
    this.createOffscreenRenderer = createOffscreenRenderer;
  }

  render({
    project,
    transitionId,
    frameRate,
    frameIndex,
    outputWidth,
    outputHeight,
    renderAssets,
  }) {
    let renderTarget;
    try {
      renderTarget = createProjectCanvasRenderTarget({
        projectWidth: project?.canvas?.width,
        projectHeight: project?.canvas?.height,
        outputWidth,
        outputHeight,
      });
    } catch (error) {
      return {
        ok: false,
        diagnostics: [diagnostic("export.invalid_output_resolution", error.message)],
      };
    }

    let evaluatedFrame;
    try {
      evaluatedFrame = evaluateTransitionExportFrame(project, {
        transitionId,
        frameRate,
        frameIndex,
      });
    } catch (error) {
      return { ok: false, diagnostics: [classifyEvaluationFailure(error)] };
    }

    const diagnostics = invalidTransformDiagnostics(
      evaluatedFrame.evaluatedTransition,
    );
    const assets = renderAssetMap(renderAssets);
    const resolveArtwork = (nodeId) => {
      const asset = assets.get(nodeId);
      if (!asset || asset.status === "missing") {
        diagnostics.push(diagnostic(
          "export.missing_render_asset",
          `Render asset is missing for node ${nodeId}.`,
          { nodeId },
        ));
        return null;
      }
      if (asset.status === "decode-failed" || asset.decodeFailed === true) {
        diagnostics.push(diagnostic(
          "export.decode_failed_asset",
          `Render asset failed to decode for node ${nodeId}.`,
          { nodeId },
        ));
        return null;
      }
      const image = asset.canvas || asset.image ||
        (asset.status === "ready" || asset.nodeId ? null : asset);
      if (!image) {
        diagnostics.push(diagnostic(
          "export.missing_render_asset",
          `Render asset is missing for node ${nodeId}.`,
          { nodeId },
        ));
      }
      return image;
    };

    let renderer;
    try {
      renderer = this.createOffscreenRenderer(renderTarget);
    } catch (error) {
      return {
        ok: false,
        diagnostics: [diagnostic(
          "export.render_failure",
          error?.message || String(error),
        )],
      };
    }
    let composition;
    try {
      composition = renderEvaluatedComposition({
        evaluation: evaluatedFrame.evaluatedTransition,
        renderTarget,
        renderer,
        resolveArtwork,
        requireComplete: true,
      });
    } catch (error) {
      return {
        ok: false,
        frame: evaluatedFrame.frame,
        renderTarget,
        diagnostics: [diagnostic(
          "export.render_failure",
          error?.message || String(error),
        )],
      };
    }
    for (const reason of composition.unsupportedReasons) {
      diagnostics.push(diagnostic("export.unsupported_render_state", reason));
    }
    if (composition.failure) {
      diagnostics.push(diagnostic(
        composition.failure.stage === "render"
          ? "export.render_failure"
          : "export.invalid_render_state",
        composition.failure.error?.message || String(composition.failure.error),
      ));
    }
    const finalDiagnostics = uniqueDiagnostics(diagnostics);
    if (!composition.rendered || finalDiagnostics.length) {
      return {
        ok: false,
        frame: evaluatedFrame.frame,
        renderTarget,
        diagnostics: finalDiagnostics,
      };
    }
    return {
      ok: true,
      frame: evaluatedFrame.frame,
      evaluatedTransition: evaluatedFrame.evaluatedTransition,
      renderTarget,
      renderPlan: composition.plan,
      offscreenResult: composition.output,
      diagnostics: [],
    };
  }
}
