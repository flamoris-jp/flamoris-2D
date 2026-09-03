function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function mixWeightedPremultiplied(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { premultipliedColor: [0, 0, 0], alpha: 0 };
  }
  const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new RangeError("Weighted appearance samples require a positive finite weight sum.");
  }
  const color = [0, 0, 0];
  let alpha = 0;
  for (const sample of samples) {
    if (!Array.isArray(sample.color) || sample.color.length !== 3 ||
      sample.color.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(sample.alpha) || sample.alpha < 0 || sample.alpha > 1 ||
      !Number.isFinite(sample.weight) || sample.weight < 0) {
      throw new TypeError("Appearance sample color, alpha, and weight must be finite.");
    }
    const weight = sample.weight / totalWeight;
    alpha += weight * sample.alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      color[channel] += weight * sample.alpha * sample.color[channel];
    }
  }
  return { premultipliedColor: color, alpha };
}

export function rendererProofBatches(evaluatedTransition) {
  const instances = evaluatedTransition.evaluatedParts
    .flatMap((part) => part.renderInstances.map((renderInstance) => ({
      semanticSlotId: part.semanticSlotId,
      ...structuredClone(renderInstance),
    })));
  const byOrder = new Map();
  for (const renderInstance of instances) {
    const atOrder = byOrder.get(renderInstance.drawOrder) || [];
    atOrder.push(renderInstance);
    byOrder.set(renderInstance.drawOrder, atOrder);
  }
  for (const [drawOrder, atOrder] of byOrder) {
    if (atOrder.length < 2) continue;
    const groupIds = new Set(atOrder.map((entry) => entry.compositeGroupId || null));
    if (groupIds.size !== 1 || groupIds.has(null)) {
      throw new Error("Evaluated render instances conflict at drawOrder " + drawOrder + ".");
    }
  }
  return instances.sort((left, right) =>
    left.drawOrder - right.drawOrder ||
    compareText(left.compositeGroupId || "", right.compositeGroupId || "") ||
    compareText(left.renderInstanceId, right.renderInstanceId));
}

function rendererInstances(evaluatedTransition) {
  const instances = [];
  const unsupportedReasons = [];
  for (const part of evaluatedTransition.evaluatedParts) {
    if (part.presence === "absent" || part.presence === "occluded") continue;
    if (part.presence !== "present") {
      unsupportedReasons.push(`Unsupported presence state ${part.presence} for ${part.semanticSlotId}.`);
      continue;
    }
    for (const renderInstance of part.renderInstances) instances.push(renderInstance);
  }
  return { instances, unsupportedReasons };
}

/**
 * Validates and orders the evaluator's own RenderInstance objects for a
 * renderer. The objects are intentionally not cloned or reinterpreted: the
 * evaluator remains the only owner of Transition semantics.
 */
export function createEvaluatedRenderPlan(evaluatedTransition, {
  resolveArtwork = () => null,
  maxAppearanceSamples = 2,
  clippingRasterization = false,
} = {}) {
  const collected = rendererInstances(evaluatedTransition);
  const unsupportedReasons = [...collected.unsupportedReasons];
  const usable = [];
  for (const renderInstance of collected.instances) {
    const label = renderInstance.renderInstanceId;
    if (!Number.isSafeInteger(renderInstance.drawOrder)) {
      unsupportedReasons.push(`Render instance ${label} has no supported explicit draw order.`);
      continue;
    }
    if (!renderInstance.mesh || renderInstance.mesh.positions.length % 2 !== 0 ||
      renderInstance.mesh.indices.length % 3 !== 0) {
      unsupportedReasons.push(`Render instance ${label} has unsupported mesh geometry.`);
      continue;
    }
    if (renderInstance.clipping?.sourceNodeId && !clippingRasterization) {
      unsupportedReasons.push(`Clipping rasterization is unsupported for ${label}.`);
    }
    const samples = renderInstance.appearanceSamples || [];
    if (!samples.length || samples.length > maxAppearanceSamples) {
      unsupportedReasons.push(`Render instance ${label} requires ${samples.length} appearance samples; renderer supports 1..${maxAppearanceSamples}.`);
      continue;
    }
    let appearanceSupported = true;
    for (const sample of samples) {
      if (!sample.sourceNodeId || !resolveArtwork(sample.sourceNodeId)) {
        unsupportedReasons.push(`Source artwork is unavailable for appearance ${sample.appearanceId}.`);
        appearanceSupported = false;
      }
      if (!Array.isArray(sample.uvs) || sample.uvs.length !== renderInstance.mesh.positions.length) {
        unsupportedReasons.push(`Per-Key-Art UVs are unavailable for appearance ${sample.appearanceId}.`);
        appearanceSupported = false;
      }
      if (!Number.isFinite(sample.weight) || sample.weight < 0) {
        unsupportedReasons.push(`Appearance weight is invalid for ${sample.appearanceId}.`);
        appearanceSupported = false;
      }
    }
    if (appearanceSupported) usable.push(renderInstance);
  }

  const grouped = new Map();
  const batches = [];
  for (const renderInstance of usable) {
    if (!renderInstance.compositeGroupId) {
      batches.push({
        kind: "instance",
        drawOrder: renderInstance.drawOrder,
        renderInstances: [renderInstance],
      });
      continue;
    }
    const members = grouped.get(renderInstance.compositeGroupId) || [];
    members.push(renderInstance);
    grouped.set(renderInstance.compositeGroupId, members);
  }
  for (const [compositeGroupId, renderInstances] of grouped) {
    if (renderInstances.some((entry) => !Number.isFinite(entry.compositeWeight) || entry.compositeWeight < 0)) {
      unsupportedReasons.push(`Composite group ${compositeGroupId} has invalid weights.`);
      continue;
    }
    batches.push({
      kind: "weighted-premultiplied",
      compositeGroupId,
      drawOrder: Math.min(...renderInstances.map((entry) => entry.drawOrder)),
      renderInstances: [...renderInstances].sort((left, right) =>
        left.drawOrder - right.drawOrder || compareText(left.renderInstanceId, right.renderInstanceId)),
    });
  }
  batches.sort((left, right) =>
    left.drawOrder - right.drawOrder ||
    compareText(left.compositeGroupId || left.renderInstances[0].renderInstanceId,
      right.compositeGroupId || right.renderInstances[0].renderInstanceId));
  return {
    batches,
    unsupportedReasons: [...new Set(unsupportedReasons)],
    renderInstanceCount: usable.length,
  };
}
