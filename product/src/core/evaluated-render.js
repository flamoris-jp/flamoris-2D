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
