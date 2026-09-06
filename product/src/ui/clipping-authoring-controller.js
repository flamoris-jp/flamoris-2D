function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return () => `clipping_binding_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function flattenTree(root) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

export class ClippingAuthoringController {
  constructor(session, { onChange = null, idFactory = defaultIdFactory() } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.idFactory = idFactory;
    this.showMask = false;
  }

  notify(reason) {
    this.onChange?.(reason, this);
  }

  bindingForNode(nodeId) {
    return this.session.query("clipping.get_for_node", { nodeId });
  }

  bindingTargetIds() {
    return new Set(this.session.query("clipping.list").map((binding) => binding.targetNodeId));
  }

  sourceCandidates(targetNodeId) {
    return flattenTree(this.session.query("scene.get_tree", { includeHidden: true }))
      .filter((node) => node.kind === "part" && node.id !== targetNodeId)
      .map((node) => ({ id: node.id, displayName: node.displayName }))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
  }

  getState(targetNodeId) {
    if (!targetNodeId) {
      return { available: false, binding: null, sourceCandidates: [], showMask: this.showMask };
    }
    const node = this.session.query("scene.get_node", { nodeId: targetNodeId });
    const available = node.kind === "part";
    return {
      available,
      binding: available ? this.bindingForNode(targetNodeId) : null,
      sourceCandidates: available ? this.sourceCandidates(targetNodeId) : [],
      showMask: this.showMask,
    };
  }

  setSource(targetNodeId, sourceNodeId) {
    const current = this.bindingForNode(targetNodeId);
    const result = current
      ? this.session.execute({
        type: "clipping.set_source",
        payload: { bindingId: current.id, sourceNodeId },
      }, { label: "Set clipping source" })
      : this.session.execute({
        type: "clipping.create",
        payload: {
          binding: {
            id: this.idFactory("clipping_binding"),
            targetNodeId,
            sourceNodeId,
            mode: "inside",
            enabled: true,
          },
        },
      }, { label: "Create clipping binding" });
    return result;
  }

  setEnabled(targetNodeId, enabled) {
    const current = this.bindingForNode(targetNodeId);
    if (!current) throw new Error("Choose Clip To before enabling clipping.");
    return this.session.execute({
      type: "clipping.set_enabled",
      payload: { bindingId: current.id, enabled },
    }, { label: enabled ? "Enable clipping" : "Disable clipping" });
  }

  remove(targetNodeId) {
    const current = this.bindingForNode(targetNodeId);
    if (!current) return null;
    return this.session.execute({
      type: "clipping.remove",
      payload: { bindingId: current.id },
    }, { label: "Remove clipping binding" });
  }

  setShowMask(visible) {
    const next = Boolean(visible);
    if (next === this.showMask) return;
    this.showMask = next;
    this.notify("clipping-mask-visibility");
  }
}
