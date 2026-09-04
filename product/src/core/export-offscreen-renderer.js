import { MeshRenderer } from "../renderer.js";

function assertTarget(renderTarget) {
  const { width, height } = renderTarget || {};
  if (!Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError("Export offscreen target dimensions must be positive safe integers.");
  }
}

/**
 * Creates the production raster surface. This intentionally does not reuse a
 * DOM viewport: output pixels are allocated at the requested target size.
 */
export function createExportOffscreenSurface(renderTarget, {
  OffscreenCanvasCtor = globalThis.OffscreenCanvas,
} = {}) {
  assertTarget(renderTarget);
  if (typeof OffscreenCanvasCtor !== "function") {
    throw new Error("OffscreenCanvas is unavailable for export rendering.");
  }
  const surface = new OffscreenCanvasCtor(renderTarget.width, renderTarget.height);
  if (surface.width !== renderTarget.width || surface.height !== renderTarget.height) {
    throw new Error("Export offscreen surface did not preserve the requested pixel dimensions.");
  }
  return surface;
}

/**
 * Production backend for ExportFrameRenderer. It reuses MeshRenderer's WebGL
 * composition path, then exposes a concrete top-left RGBA8 image buffer.
 */
export function createExportOffscreenRenderer(renderTarget, dependencies = {}) {
  const surface = (dependencies.createSurface || createExportOffscreenSurface)(
    renderTarget,
    dependencies,
  );
  const Renderer = dependencies.MeshRendererClass || MeshRenderer;
  const renderer = new Renderer(surface);
  return Object.freeze({
    renderEvaluated(plan, target, resolveArtwork) {
      renderer.renderEvaluated(plan, target, resolveArtwork);
      return Object.freeze({
        kind: "rgba8",
        width: surface.width,
        height: surface.height,
        rowOrder: "top-to-bottom",
        data: renderer.readRgbaPixels(),
      });
    },
  });
}
