import { evaluateKeyArtBaseState, evaluateTransition } from '../src/core/transition-evaluator.js';
import { evaluateSequence } from '../src/core/sequence-evaluator.js';
import { createEvaluatedRenderPlan } from '../src/core/evaluated-render.js';
import { createClippingRasterPlan } from '../src/core/clipping-raster-plan.js';

export function evaluatedProjection(document, assets, { keyArtId, transitionId, sequenceId, timeTicks = 0 } = {}) {
  if (!Number.isSafeInteger(timeTicks) || timeTicks < 0) throw new Error('Expected non-negative integer Product ticks.');
  const selected = [keyArtId, transitionId, sequenceId].filter(Boolean);
  if (selected.length !== 1) throw new Error('Select exactly one Key Art, Transition or Sequence.');
  const project = document.session.project;
  const evaluation = sequenceId ? evaluateSequence(project, sequenceId, timeTicks)
    : transitionId ? evaluateTransition(project, transitionId, timeTicks) : evaluateKeyArtBaseState(project, keyArtId);
  const plan = createEvaluatedRenderPlan(evaluation, {
    resolveArtwork: nodeId => document.bindings?.has(nodeId), clippingRasterization: true,
  });
  if (plan.unsupportedReasons.length) throw Object.assign(new Error(plan.unsupportedReasons.join('\n')), { code: 'render.unsupported' });
  const clipping = createClippingRasterPlan(plan);
  const nodeIds = new Set(plan.batches.flatMap(b => b.renderInstances.flatMap(i => i.appearanceSamples.map(s => s.sourceNodeId))));
  const artwork = [...nodeIds].map(nodeId => {
    const id = document.bindings.get(nodeId), a = assets.get(id, document.token, document.revision);
    return { id, nodeId, width:a.width, height:a.height, byteLength:a.byteLength };
  });
  return { plan, artwork, maskSourceIds:clipping.maskSourceIds,
    contributions:Object.fromEntries(clipping.contributionById), diagnostics:evaluation.diagnostics || [],
    canvas:project.canvas, timeTicks };
}
