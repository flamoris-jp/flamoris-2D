function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Builds the renderer-only alpha-surface dependency order from already
 * resolved render-instance IDs. No Project, Scene, or Transition semantics
 * cross this boundary.
 */
export function createClippingRasterPlan(renderPlan) {
  const instancesById = new Map();
  const contributionById = new Map();
  for (const batch of renderPlan.batches || []) {
    const weightSum = batch.kind === "weighted-premultiplied"
      ? batch.renderInstances.reduce((sum, instance) => sum + instance.compositeWeight, 0)
      : 1;
    for (const instance of batch.renderInstances) {
      if (instancesById.has(instance.renderInstanceId)) {
        throw new Error(`Duplicate evaluated render instance ${instance.renderInstanceId}.`);
      }
      instancesById.set(instance.renderInstanceId, instance);
      contributionById.set(
        instance.renderInstanceId,
        batch.kind === "weighted-premultiplied" ? instance.compositeWeight / weightSum : 1,
      );
    }
  }

  const state = new Map();
  const stack = [];
  const maskSourceIds = [];
  const sourceId = (instance) => {
    if (instance.clipping.mode !== "inside") {
      throw new Error(`Evaluated clipping mode ${instance.clipping.mode} is unsupported for ${instance.renderInstanceId}.`);
    }
    if (!instance.clipping.sourceRenderInstanceId) {
      throw new Error(`Evaluated clipping source is unresolved for ${instance.renderInstanceId}.`);
    }
    return instance.clipping.sourceRenderInstanceId;
  };
  const visit = (renderInstanceId) => {
    const status = state.get(renderInstanceId);
    if (status === "visiting") {
      const cycle = stack.slice(stack.indexOf(renderInstanceId)).sort(compareText);
      throw new Error(`Evaluated clipping dependency cycle includes ${cycle.join(", ")}.`);
    }
    if (status === "visited") return;
    const instance = instancesById.get(renderInstanceId);
    if (!instance) {
      throw new Error(`Evaluated clipping source ${renderInstanceId} is unavailable.`);
    }
    state.set(renderInstanceId, "visiting");
    stack.push(renderInstanceId);
    const clipping = instance.clipping;
    if (clipping) {
      visit(sourceId(instance));
    }
    stack.pop();
    state.set(renderInstanceId, "visited");
    maskSourceIds.push(renderInstanceId);
  };

  const targets = [...instancesById.values()]
    .filter((instance) => instance.clipping)
    .sort((left, right) => compareText(left.renderInstanceId, right.renderInstanceId));
  for (const target of targets) visit(sourceId(target));

  return {
    instancesById,
    contributionById,
    maskSourceIds,
  };
}
