import { createEvaluatedRenderPlan } from "./evaluated-render.js";

/**
 * Shared projection and backend boundary for preview and export composition.
 * The canonical Transition evaluator remains the sole source of render state.
 */
export class SharedCompositionRenderer {
  constructor(renderer) {
    if (!renderer || typeof renderer.renderEvaluated !== "function") {
      throw new TypeError("A composition renderer backend is required.");
    }
    this.renderer = renderer;
  }

  render({
    evaluation,
    renderTarget,
    resolveArtwork,
    requireComplete = false,
  }) {
    let plan;
    try {
      plan = createEvaluatedRenderPlan(evaluation, {
        resolveArtwork,
        clippingRasterization:
          this.renderer.compositionCapabilities?.clippingRasterization === true,
      });
    } catch (error) {
      return {
        rendered: false,
        plan: null,
        output: null,
        unsupportedReasons: [],
        renderInstanceCount: 0,
        failure: { stage: "plan", error },
      };
    }
    if (requireComplete && plan.unsupportedReasons.length) {
      return {
        rendered: false,
        plan,
        output: null,
        unsupportedReasons: plan.unsupportedReasons,
        renderInstanceCount: plan.renderInstanceCount,
        failure: null,
      };
    }
    try {
      const output = this.renderer.renderEvaluated(
        plan,
        renderTarget,
        resolveArtwork,
      );
      return {
        rendered: true,
        plan,
        output: output ?? null,
        unsupportedReasons: plan.unsupportedReasons,
        renderInstanceCount: plan.renderInstanceCount,
        failure: null,
      };
    } catch (error) {
      return {
        rendered: false,
        plan,
        output: null,
        unsupportedReasons: plan.unsupportedReasons,
        renderInstanceCount: plan.renderInstanceCount,
        failure: { stage: "render", error },
      };
    }
  }
}

export function renderEvaluatedComposition(input) {
  return new SharedCompositionRenderer(input.renderer).render(input);
}
