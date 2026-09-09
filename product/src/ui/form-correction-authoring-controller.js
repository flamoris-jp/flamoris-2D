import { canonicalizeMeshFormVertexOffsets } from "../model/mesh-form-correction.js";

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

export class FormCorrectionAuthoringController {
  constructor(session, { onChange = null, idFactory = null } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.idFactory = idFactory || defaultIdFactory();
    this.topologyId = null;
    this.keyArtId = null;
    this.semanticSlotId = null;
    this.targetNodeId = null;
    this.selectedVertexIds = new Set();
    this.gesture = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  setContext({ topologyId, keyArtId, semanticSlotId, targetNodeId = null }) {
    if (topologyId) this.session.query("mesh.get_topology", { topologyId });
    this.topologyId = topologyId || null;
    this.keyArtId = keyArtId || null;
    this.semanticSlotId = semanticSlotId || null;
    this.targetNodeId = targetNodeId;
    this.selectedVertexIds.clear();
    this.gesture = null;
    this.notify("form-context");
  }

  selectVertex(vertexId, additive = false) {
    if (!additive) this.selectedVertexIds.clear();
    if (vertexId) {
      if (additive && this.selectedVertexIds.has(vertexId)) this.selectedVertexIds.delete(vertexId);
      else this.selectedVertexIds.add(vertexId);
    }
    this.notify("form-selection");
  }

  correction() {
    if (!this.topologyId || !this.keyArtId || !this.semanticSlotId) return null;
    return this.session.query("mesh_form.get_for_context", {
      topologyId: this.topologyId,
      keyArtId: this.keyArtId,
      semanticSlotId: this.semanticSlotId,
    });
  }

  beginGesture() {
    if (!this.selectedVertexIds.size) throw new Error("Select at least one stable vertex first.");
    const correction = this.correction();
    this.gesture = {
      correction,
      original: correction?.vertexOffsets || [],
      preview: correction?.vertexOffsets || [],
    };
    this.notify("form-gesture-begin");
  }

  previewGesture({ x, y }) {
    if (!this.gesture) throw new Error("Begin a form-correction gesture first.");
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("Gesture delta must be finite.");
    const values = new Map(this.gesture.original.map((entry) => [entry.vertexId, { ...entry }]));
    for (const vertexId of this.selectedVertexIds) {
      const original = values.get(vertexId) || { vertexId, x: 0, y: 0 };
      values.set(vertexId, { vertexId, x: original.x + x, y: original.y + y });
    }
    this.gesture.preview = canonicalizeMeshFormVertexOffsets([...values.values()]);
    this.notify("form-gesture-preview");
    return structuredClone(this.gesture.preview);
  }

  commitGesture() {
    if (!this.gesture) return null;
    const { correction, preview } = this.gesture;
    this.gesture = null;
    let result;
    if (correction) {
      result = this.session.execute({ type: "mesh_form.set_vertex_offsets", payload: {
        keyformId: correction.id, vertexOffsets: preview,
      } }, { label: "Edit form correction" });
    } else {
      result = this.session.execute({ type: "mesh_form.create_keyform", payload: { keyform: {
        id: this.idFactory("mesh_form_correction"),
        topologyId: this.topologyId,
        keyArtId: this.keyArtId,
        semanticSlotId: this.semanticSlotId,
        vertexOffsets: preview,
      } } }, { label: "Create and edit form correction" });
    }
    this.notify("form-gesture-commit");
    return result;
  }

  cancelGesture() { this.gesture = null; this.notify("form-gesture-cancel"); }

  reset() {
    const correction = this.correction();
    if (!correction) return null;
    const result = this.session.execute({ type: "mesh_form.reset_keyform", payload: {
      keyformId: correction.id,
    } }, { label: "Reset form correction" });
    this.notify("form-reset");
    return result;
  }

  getState() {
    return {
      topologyId: this.topologyId,
      keyArtId: this.keyArtId,
      semanticSlotId: this.semanticSlotId,
      targetNodeId: this.targetNodeId,
      selectedVertexIds: [...this.selectedVertexIds].sort(),
      gestureActive: Boolean(this.gesture),
      previewVertexOffsets: structuredClone(this.gesture?.preview || []),
    };
  }
}
