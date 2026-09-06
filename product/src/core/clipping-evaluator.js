import { cloneProject } from "../model/project.js";
import { isRenderableClippingNode } from "../model/clipping-validation.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalCycle(renderInstanceIds) {
  if (!renderInstanceIds.length) return [];
  let start = 0;
  for (let index = 1; index < renderInstanceIds.length; index += 1) {
    if (compareText(renderInstanceIds[index], renderInstanceIds[start]) < 0) start = index;
  }
  return [...renderInstanceIds.slice(start), ...renderInstanceIds.slice(0, start)];
}

function clippingDiagnostic(code, target, sourceNodeId, details = {}) {
  return {
    code,
    severity: "error",
    semanticSlotId: target.semanticSlotId,
    renderInstanceId: target.renderInstance.renderInstanceId,
    targetNodeId: target.renderInstance.sourceNodeId,
    sourceNodeId,
    details,
  };
}

function sourceCandidates(project, entries) {
  const byNodeId = new Map();
  const bySemanticSlotId = new Map();
  for (const entry of entries) {
    const nodeId = entry.renderInstance.sourceNodeId;
    if (nodeId) {
      const candidates = byNodeId.get(nodeId) || [];
      candidates.push(entry);
      byNodeId.set(nodeId, candidates);
    }
    const semanticCandidates = bySemanticSlotId.get(entry.semanticSlotId) || [];
    semanticCandidates.push(entry);
    bySemanticSlotId.set(entry.semanticSlotId, semanticCandidates);
  }
  for (const candidates of [...byNodeId.values(), ...bySemanticSlotId.values()]) {
    candidates.sort((left, right) => compareText(
      left.renderInstance.renderInstanceId,
      right.renderInstance.renderInstanceId,
    ));
  }

  const slotIdsByNodeId = new Map();
  for (const slot of [...(project.semanticSlots || [])].sort((left, right) => compareText(left.id, right.id))) {
    for (const mapping of slot.mappings || []) {
      const slotIds = slotIdsByNodeId.get(mapping.nodeId) || [];
      if (!slotIds.includes(slot.id)) slotIds.push(slot.id);
      slotIdsByNodeId.set(mapping.nodeId, slotIds.sort(compareText));
    }
  }
  return { byNodeId, bySemanticSlotId, slotIdsByNodeId };
}

function resolveCandidate(index, sourceNodeId) {
  const exact = index.byNodeId.get(sourceNodeId) || [];
  if (exact.length) return exact;
  const semantic = [];
  for (const slotId of index.slotIdsByNodeId.get(sourceNodeId) || []) {
    semantic.push(...(index.bySemanticSlotId.get(slotId) || []));
  }
  const unique = new Map(semantic.map((entry) => [entry.renderInstance.renderInstanceId, entry]));
  return [...unique.values()].sort((left, right) => compareText(
    left.renderInstance.renderInstanceId,
    right.renderInstance.renderInstanceId,
  ));
}

function removeResolvedCycles(entries, diagnostics) {
  const byId = new Map(entries.map((entry) => [entry.renderInstance.renderInstanceId, entry]));
  const state = new Map();
  const stack = [];
  const stackIndex = new Map();
  const cycles = new Map();
  const visit = (renderInstanceId) => {
    state.set(renderInstanceId, "visiting");
    stackIndex.set(renderInstanceId, stack.length);
    stack.push(renderInstanceId);
    const sourceId = byId.get(renderInstanceId)?.renderInstance.clipping?.sourceRenderInstanceId;
    if (sourceId && byId.has(sourceId)) {
      if (state.get(sourceId) === "visiting") {
        const cycle = canonicalCycle(stack.slice(stackIndex.get(sourceId)));
        cycles.set(cycle.join("\u0000"), cycle);
      } else if (state.get(sourceId) !== "visited") visit(sourceId);
    }
    stack.pop();
    stackIndex.delete(renderInstanceId);
    state.set(renderInstanceId, "visited");
  };
  for (const renderInstanceId of [...byId.keys()].sort(compareText)) {
    if (!state.has(renderInstanceId)) visit(renderInstanceId);
  }
  for (const renderInstanceIds of [...cycles.values()].sort((left, right) =>
    compareText(left.join("\u0000"), right.join("\u0000")))) {
    const first = byId.get(renderInstanceIds[0]);
    diagnostics.push(clippingDiagnostic(
      "CLIPPING_CYCLE",
      first,
      first.renderInstance.clippingSourceNodeId || null,
      { renderInstanceIds },
    ));
    for (const renderInstanceId of renderInstanceIds) {
      byId.get(renderInstanceId).renderInstance.clipping = null;
    }
  }
}

/**
 * Resolves authored node references into renderer-ready evaluated-instance
 * references. It never searches Scene state on behalf of the renderer.
 */
export function resolveEvaluatedClipping(project, evaluatedParts) {
  const parts = cloneProject(evaluatedParts);
  const entries = parts.flatMap((part) => (part.renderInstances || []).map((renderInstance) => ({
    semanticSlotId: part.semanticSlotId,
    renderInstance,
  })));
  const index = sourceCandidates(project, entries);
  const diagnostics = [];
  for (const target of [...entries].sort((left, right) => compareText(
    left.renderInstance.renderInstanceId,
    right.renderInstance.renderInstanceId,
  ))) {
    const authored = target.renderInstance.clipping;
    const sourceNodeId = authored?.sourceNodeId || null;
    target.renderInstance.clipping = null;
    if (!sourceNodeId) continue;
    target.renderInstance.clippingSourceNodeId = sourceNodeId;
    const sourceNode = project.scene?.nodes?.[sourceNodeId];
    if (!sourceNode) {
      diagnostics.push(clippingDiagnostic(
        "CLIPPING_SOURCE_MISSING",
        target,
        sourceNodeId,
      ));
      delete target.renderInstance.clippingSourceNodeId;
      continue;
    }
    if (!isRenderableClippingNode(sourceNode)) {
      diagnostics.push(clippingDiagnostic(
        "CLIPPING_SOURCE_NOT_RENDERABLE",
        target,
        sourceNodeId,
        { reason: "source-node-kind", sourceNodeKind: sourceNode.kind },
      ));
      delete target.renderInstance.clippingSourceNodeId;
      continue;
    }
    const candidates = resolveCandidate(index, sourceNodeId);
    if (candidates.length !== 1) {
      diagnostics.push(clippingDiagnostic(
        "CLIPPING_SOURCE_NOT_RENDERABLE",
        target,
        sourceNodeId,
        {
          reason: candidates.length ? "ambiguous-evaluated-source" : "source-not-evaluated",
          candidateRenderInstanceIds: candidates.map((entry) => entry.renderInstance.renderInstanceId),
        },
      ));
      delete target.renderInstance.clippingSourceNodeId;
      continue;
    }
    target.renderInstance.clipping = {
      sourceRenderInstanceId: candidates[0].renderInstance.renderInstanceId,
      mode: authored.mode || "inside",
    };
  }
  removeResolvedCycles(entries, diagnostics);
  for (const entry of entries) delete entry.renderInstance.clippingSourceNodeId;
  diagnostics.sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.renderInstanceId, right.renderInstanceId) ||
    compareText(left.sourceNodeId || "", right.sourceNodeId || ""));
  return { evaluatedParts: parts, diagnostics };
}
