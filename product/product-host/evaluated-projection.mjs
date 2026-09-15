import { evaluateKeyArtBaseState, evaluateTransition } from '../src/core/transition-evaluator.js';
import { evaluateSequence } from '../src/core/sequence-evaluator.js';
import { createEvaluatedRenderPlan } from '../src/core/evaluated-render.js';
import { ticksToSeconds } from '../src/core/temporal.js';
import { createClippingRasterPlan } from '../src/core/clipping-raster-plan.js';
import { executeRigTool } from './rig-authoring.mjs';

export function evaluatedProjection(document, assets, { keyArtId, transitionId, sequenceId, timeTicks = 0, layoutPreview = null, rigPreview = null } = {}) {
  if (!Number.isSafeInteger(timeTicks) || timeTicks < 0) throw new Error('Expected non-negative integer Product ticks.');
  const selected = [keyArtId, transitionId, sequenceId].filter(Boolean);
  if (selected.length !== 1) throw new Error('Select exactly one Key Art, Transition or Sequence.');
  if (rigPreview) {
    if (!keyArtId || rigPreview.context?.keyArtId !== keyArtId || layoutPreview) throw new Error('Rig preview Key Art mismatch.');
    const commands = [];
    const recorder = { project: document.session.project, currentRevision: document.session.currentRevision,
      query: (...args) => document.session.query(...args),
      execute: c => { commands.push(c); return {}; }, executeTransaction: cs => { commands.push(...cs); return {}; } };
    executeRigTool(recorder, rigPreview);
    return document.session.previewTransaction(commands, project => projectFrame(document, assets, project, {keyArtId,transitionId,sequenceId,timeTicks}));
  }
  if (layoutPreview) {
    if (!keyArtId) throw new Error('Layout preview requires a Key Art.');
    const keyform = document.session.project.meshKeyforms.find(k => k.id === layoutPreview.keyformId);
    if (!keyform || keyform.keyArtId !== keyArtId) throw new Error('Layout preview Key Art mismatch.');
    return document.session.previewTransaction([{type:'mesh_keyform.move_vertices', payload:layoutPreview}], project =>
      projectFrame(document, assets, project, {keyArtId, transitionId, sequenceId, timeTicks}));
  }
  return projectFrame(document, assets, document.session.project, {keyArtId, transitionId, sequenceId, timeTicks});
}
function projectFrame(document, assets, project, {keyArtId, transitionId, sequenceId, timeTicks}) {
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
  const owner=sequenceId?project.sequences.find(s=>s.id===sequenceId):transitionId?project.transitions.find(t=>t.id===transitionId):null;
  const durationTicks=owner?project.temporalPrograms.find(p=>p.id===owner.temporalProgramId).durationTicks:0;
  const authoringMeshes = keyArtId ? evaluation.evaluatedParts.flatMap(part => {
    const forms = project.meshKeyforms.filter(k => k.keyArtId === keyArtId && k.semanticSlotId === part.semanticSlotId);
    if (forms.length !== 1 || part.renderInstances.length !== 1) return [];
    const instance = part.renderInstances[0], form = forms[0];
    if (instance.mesh.positions.length !== form.positions.length) return [];
    return [{nodeId:instance.sourceNodeId,keyformId:form.id,topologyId:form.topologyId,positions:instance.mesh.positions,worldTransform:instance.transform}];
  }) : [];
  return { plan, artwork, maskSourceIds:clipping.maskSourceIds,
    authoringMeshes,
    contributions:Object.fromEntries(clipping.contributionById), diagnostics:evaluation.diagnostics || [],
    canvas:project.canvas, timeTicks, durationTicks, timeLabel:`${ticksToSeconds(timeTicks).toFixed(3)} 秒 · ${timeTicks} ticks` };
}
