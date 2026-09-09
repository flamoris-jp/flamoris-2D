import { canonicalizeSkinInfluences } from "../model/skin-binding.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalized(influences, vertexId) {
  const sum = influences.reduce((total, entry) => total + entry.weight, 0);
  if (!(sum > 0) || !Number.isFinite(sum)) {
    throw new Error("A weighted vertex must retain at least one positive influence.");
  }
  return canonicalizeSkinInfluences(influences.map((entry) => ({
    boneId: entry.boneId, weight: entry.weight / sum,
  })), { vertexId });
}

function editInfluence(influences, boneId, amount, operation, vertexId) {
  const next = influences.map((entry) => ({ ...entry }));
  const index = next.findIndex((entry) => entry.boneId === boneId);
  if (operation === "add") {
    if (index < 0 && next.length >= 4) {
      const error = new Error("Adding a fifth influence requires an explicit replace.");
      error.code = "SKIN_BINDING_INFLUENCE_COUNT_INVALID";
      throw error;
    }
    if (index < 0) next.push({ boneId, weight: amount });
    else next[index].weight += amount;
  } else if (operation === "subtract") {
    if (index < 0) return normalized(next, vertexId);
    next[index].weight -= amount;
    if (!(next[index].weight > 0)) next.splice(index, 1);
  } else throw new Error(`Unknown weight brush operation ${operation}.`);
  return normalized(next, vertexId);
}

export class WeightAuthoringController {
  constructor(session, { onChange = null, idFactory = null } = {}) {
    this.session = session;
    this.onChange = onChange;
    let sequence = 0;
    const nonce = Date.now().toString(36);
    this.idFactory = idFactory || ((kind) =>
      `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`);
    this.activeBindingId = null;
    this.targetNodeId = null;
    this.activeBoneId = null;
    this.activeKeyArtId = null;
    this.selectedVertexId = null;
    this.operation = "add";
    this.strength = 0.1;
    this.stroke = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  setContext({ bindingId, targetNodeId = null, boneId = null, keyArtId = null }) {
    if (bindingId) this.session.query("skin.get_binding", { bindingId });
    this.activeBindingId = bindingId || null;
    this.targetNodeId = targetNodeId;
    this.activeBoneId = boneId;
    this.activeKeyArtId = keyArtId;
    this.cancelStroke();
    this.notify("weight-context");
  }

  setSelectedVertex(vertexId) { this.selectedVertexId = vertexId; this.notify("weight-selection"); }
  setBrush({ operation = this.operation, strength = this.strength } = {}) {
    if (!["add", "subtract"].includes(operation)) throw new Error("Unknown weight brush operation.");
    if (!Number.isFinite(strength) || !(strength > 0) || strength > 1) {
      throw new RangeError("Weight brush strength must be within 0..1.");
    }
    this.operation = operation;
    this.strength = strength;
    this.notify("weight-brush");
  }

  binding() {
    if (!this.activeBindingId) throw new Error("Select an active SkinBinding first.");
    return this.session.query("skin.get_binding", { bindingId: this.activeBindingId });
  }

  createBinding({ targetNodeId = this.targetNodeId, topologyId, boneId = this.activeBoneId,
    bindingId = this.idFactory("skin_binding") }) {
    if (!targetNodeId || !topologyId || !boneId) {
      throw new Error("Creating a SkinBinding requires target Part, topology, and active Bone.");
    }
    const topology = this.session.query("mesh.get_topology", { topologyId });
    const result = this.session.execute({ type: "skin.create_binding", payload: { binding: {
      id: bindingId,
      targetNodeId,
      topologyId,
      enabled: true,
      vertexWeights: topology.vertexIds.map((vertexId) => ({
        vertexId, influences: [{ boneId, weight: 1 }],
      })),
    } } }, { label: "Create SkinBinding" });
    this.activeBindingId = bindingId;
    this.targetNodeId = targetNodeId;
    this.activeBoneId = boneId;
    this.notify("weight-binding-created");
    return result;
  }

  beginStroke() {
    if (!this.activeBoneId) throw new Error("Select an active Bone first.");
    this.stroke = { original: new Map(), preview: new Map(), touched: new Set() };
    this.notify("weight-stroke-begin");
  }

  previewStroke(vertexIds) {
    if (!this.stroke) throw new Error("Begin a weight stroke first.");
    const binding = this.binding();
    for (const vertexId of [...new Set(vertexIds)].sort(compareText)) {
      if (this.stroke.touched.has(vertexId)) continue;
      const entry = binding.vertexWeights.find((value) => value.vertexId === vertexId);
      if (!entry) throw new Error(`Stable vertex ${vertexId} has no weight entry.`);
      this.stroke.original.set(vertexId, structuredClone(entry.influences));
      this.stroke.preview.set(vertexId, editInfluence(
        entry.influences, this.activeBoneId, this.strength, this.operation, vertexId,
      ));
      this.stroke.touched.add(vertexId);
    }
    this.notify("weight-stroke-preview");
    return this.getState().previewVertexWeights;
  }

  commitStroke() {
    if (!this.stroke) return null;
    const vertexWeights = [...this.stroke.preview]
      .map(([vertexId, influences]) => ({ vertexId, influences }))
      .sort((left, right) => compareText(left.vertexId, right.vertexId));
    this.stroke = null;
    if (!vertexWeights.length) { this.notify("weight-stroke-cancel"); return null; }
    const result = this.session.execute({ type: "skin.set_weights_bulk", payload: {
      bindingId: this.activeBindingId, vertexWeights,
    } }, { label: "Paint skin weights" });
    this.notify("weight-stroke-commit");
    return result;
  }

  cancelStroke() { this.stroke = null; this.notify("weight-stroke-cancel"); }

  setNumericWeight(vertexId, weight) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new RangeError("Numeric weight must be within 0..1.");
    }
    const entry = this.binding().vertexWeights.find((value) => value.vertexId === vertexId);
    if (!entry) throw new Error(`Stable vertex ${vertexId} has no weight entry.`);
    const others = entry.influences.filter((value) => value.boneId !== this.activeBoneId);
    let influences;
    if (weight === 1) influences = [{ boneId: this.activeBoneId, weight: 1 }];
    else if (weight === 0) influences = normalized(others, vertexId);
    else {
      if (!entry.influences.some((value) => value.boneId === this.activeBoneId) &&
        entry.influences.length >= 4) {
        const error = new Error("Adding a fifth influence requires an explicit replace.");
        error.code = "SKIN_BINDING_INFLUENCE_COUNT_INVALID";
        throw error;
      }
      const normalizedOthers = others.length ? normalized(others, vertexId) : [];
      influences = canonicalizeSkinInfluences([
        ...normalizedOthers.map((value) => ({ ...value, weight: value.weight * (1 - weight) })),
        { boneId: this.activeBoneId, weight },
      ], { vertexId });
    }
    return this.replaceInfluences(vertexId, influences, "Set numeric skin weight");
  }

  normalize(vertexId) {
    const entry = this.binding().vertexWeights.find((value) => value.vertexId === vertexId);
    if (!entry) throw new Error(`Stable vertex ${vertexId} has no weight entry.`);
    return this.replaceInfluences(vertexId, normalized(entry.influences, vertexId),
      "Normalize skin weights");
  }

  clearActiveInfluence(vertexId) { return this.setNumericWeight(vertexId, 0); }

  replaceInfluences(vertexId, influences, label = "Replace skin influences") {
    const canonical = canonicalizeSkinInfluences(influences, { vertexId });
    return this.session.execute({ type: "skin.set_vertex_weights", payload: {
      bindingId: this.activeBindingId, vertexId, influences: canonical,
    } }, { label });
  }

  getState() {
    const previewVertexWeights = this.stroke ? [...this.stroke.preview]
      .map(([vertexId, influences]) => ({ vertexId, influences: structuredClone(influences) }))
      .sort((left, right) => compareText(left.vertexId, right.vertexId)) : [];
    return {
      activeBindingId: this.activeBindingId,
      targetNodeId: this.targetNodeId,
      activeBoneId: this.activeBoneId,
      activeKeyArtId: this.activeKeyArtId,
      selectedVertexId: this.selectedVertexId,
      operation: this.operation,
      strength: this.strength,
      strokeActive: Boolean(this.stroke),
      previewVertexWeights,
    };
  }
}
