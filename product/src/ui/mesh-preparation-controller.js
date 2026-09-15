import { cloneProject } from "../model/project.js";

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function matchingKeyArt(project, nodeId) {
  const matches = project.keyArts.filter((keyArt) =>
    keyArt.members.some((member) => member.nodeId === nodeId));
  return matches.length === 1 ? matches[0] : null;
}

function matchingSlot(project, keyArtId, nodeId) {
  const matches = project.semanticSlots.filter((slot) =>
    (slot.mappings || []).some((mapping) =>
      mapping.keyArtId === keyArtId && mapping.nodeId === nodeId));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Transient context for preparing one imported Key Art part before any
 * Transition exists. Persistent work still uses SemanticSlot, MeshTopology,
 * MeshKeyform, and the ordinary EditorSession transaction history.
 */
export class MeshPreparationController {
  constructor(session, { onChange = null, idFactory = null } = {}) {
    this.session = session;
    this.kind = "preparation";
    this.onChange = onChange;
    this.idFactory = idFactory || defaultIdFactory();
    this.selectedNodeId = null;
    this.selectedKeyArtId = null;
    this.selectedTopologyId = null;
    this.selectedKeyformId = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  selectKeyArt(keyArtId) {
    if (keyArtId !== null) this.session.query("keyart.get", { keyArtId });
    if (this.selectedKeyArtId === keyArtId) return;
    this.selectedKeyArtId = keyArtId; this.selectedTopologyId = null; this.selectedKeyformId = null;
    const state = this.getState();
    if (state.keyforms.length === 1) {
      this.selectedKeyformId = state.keyforms[0].id; this.selectedTopologyId = state.keyforms[0].topologyId;
    }
  }

  selectPart(nodeId) {
    if (this.selectedNodeId === nodeId) return this.getState();
    if (nodeId !== null) this.session.query("scene.get_node", { nodeId });
    this.selectedNodeId = nodeId;
    this.selectedTopologyId = null;
    this.selectedKeyformId = null;
    const state = this.getState();
    if (state.keyforms.length === 1) {
      this.selectedKeyformId = state.keyforms[0].id;
      this.selectedTopologyId = state.keyforms[0].topologyId;
    }
    this.notify("mesh-preparation-selection");
    return this.getState();
  }

  selectTopology(topologyId) {
    if (topologyId !== null) this.session.query("mesh.get_topology", { topologyId });
    this.selectedTopologyId = topologyId;
    if (this.activeKeyform()?.topologyId !== topologyId) this.selectedKeyformId = null;
    this.notify("mesh-preparation-topology");
  }

  selectKeyform(keyformId) {
    if (keyformId === null) {
      this.selectedKeyformId = null;
      this.notify("mesh-preparation-keyform");
      return;
    }
    const state = this.getState();
    const keyform = state.keyforms.find((entry) => entry.id === keyformId);
    if (!keyform) throw new Error("MeshKeyform does not belong to the selected Key Art part.");
    this.selectedKeyformId = keyform.id;
    this.selectedTopologyId = keyform.topologyId;
    this.notify("mesh-preparation-keyform");
  }

  projectChanged() {
    if (this.selectedNodeId && !this.session.project.scene.nodes[this.selectedNodeId]) {
      this.selectedNodeId = null;
      this.selectedTopologyId = null;
      this.selectedKeyformId = null;
      return;
    }
    const state = this.getState();
    if (this.selectedKeyformId && !state.keyforms.some(({ id }) => id === this.selectedKeyformId)) {
      this.selectedKeyformId = null;
    }
    if (this.selectedTopologyId &&
      !this.session.project.meshTopologies.some(({ id }) => id === this.selectedTopologyId)) {
      this.selectedTopologyId = null;
    }
    if (!this.selectedKeyformId && state.keyforms.length === 1) {
      this.selectedKeyformId = state.keyforms[0].id;
      this.selectedTopologyId = state.keyforms[0].topologyId;
    }
  }

  activeKeyform() {
    if (!this.selectedKeyformId) return null;
    return this.session.query("mesh.list_keyforms")
      .find((entry) => entry.id === this.selectedKeyformId) || null;
  }

  activeTopology() {
    const topologyId = this.selectedTopologyId || this.activeKeyform()?.topologyId;
    return topologyId
      ? this.session.query("mesh.list_topologies").find(({ id }) => id === topologyId) || null
      : null;
  }

  activeWorldTransform() {
    return this.selectedNodeId
      ? this.session.query("scene.get_node", { nodeId: this.selectedNodeId }).worldTransform
      : null;
  }

  createGeneratedMesh({ vertexIds, indices, positions, uvs }) {
    const state = this.getState();
    if (!state.available || !state.keyArt || !state.node) {
      throw new Error(state.reason || "Select one Key Art render part first.");
    }
    const expected = vertexIds.length * 2;
    if (vertexIds.length < 3 || positions.length !== expected || uvs.length !== expected ||
      indices.length < 3 || indices.length % 3 !== 0) {
      throw new Error("Generated mesh must contain compatible vertices, UVs, and triangles.");
    }
    let semanticSlotId = state.semanticSlot?.id || this.idFactory("semantic_slot");
    const topologyId = this.idFactory("topology");
    const keyformId = this.idFactory("keyform");
    const commands = [];
    if (!state.semanticSlot) {
      commands.push({
        type: "semantic_slot.create",
        payload: { semanticSlot: {
          id: semanticSlotId,
          displayName: state.node.displayName,
          role: null,
          mappings: [],
          metadata: {},
        } },
      }, {
        type: "semantic_slot.map_node",
        payload: { semanticSlotId, keyArtId: state.keyArt.id, nodeId: state.node.id },
      });
    }
    commands.push({
      type: "mesh_topology.create",
      payload: { topology: {
        id: topologyId,
        vertexIds: [...vertexIds],
        indices: [...indices],
        vertexMetadata: {},
      } },
    }, {
      type: "mesh_keyform.create",
      payload: { keyform: {
        id: keyformId,
        topologyId,
        keyArtId: state.keyArt.id,
        semanticSlotId,
        positions: [...positions],
        uvs: [...uvs],
      } },
    });
    const result = this.session.executeTransaction(commands, {
      label: `Create mesh for ${state.node.displayName}`,
    });
    this.selectedTopologyId = topologyId;
    this.selectedKeyformId = keyformId;
    this.notify("mesh-preparation-created");
    return result;
  }

  getState() {
    const node = this.selectedNodeId
      ? this.session.project.scene.nodes[this.selectedNodeId] || null
      : null;
    const keyArtMatches = node
      ? this.session.project.keyArts.filter((keyArt) =>
        keyArt.members.some((member) => member.nodeId === node.id))
      : [];
    const keyArt = this.selectedKeyArtId ? keyArtMatches.find(k => k.id === this.selectedKeyArtId)
      : matchingKeyArt(this.session.project, this.selectedNodeId);
    const slotMatches = keyArt && node
      ? this.session.project.semanticSlots.filter((slot) =>
        (slot.mappings || []).some((mapping) =>
          mapping.keyArtId === keyArt.id && mapping.nodeId === node.id))
      : [];
    const semanticSlot = keyArt && node
      ? matchingSlot(this.session.project, keyArt.id, node.id)
      : null;
    const keyforms = semanticSlot
      ? this.session.query("mesh.list_keyforms", {
        keyArtId: keyArt.id,
        semanticSlotId: semanticSlot.id,
      })
      : [];
    const activeKeyform = this.selectedKeyformId
      ? keyforms.find(({ id }) => id === this.selectedKeyformId) || null
      : null;
    const topologyId = this.selectedTopologyId || activeKeyform?.topologyId || null;
    const topology = topologyId
      ? this.session.query("mesh.list_topologies").find(({ id }) => id === topologyId) || null
      : null;
    let reason = "";
    if (!node) reason = "パーツを選択してください";
    else if (node.kind !== "part") reason = "メッシュを作成する描画パーツを選択してください";
    else if (!keyArt) reason = keyArtMatches.length
      ? "パーツが複数のKey Artに所属しています。編集対象を明示してください"
      : "選択パーツを含むKey Artがありません";
    else if (slotMatches.length > 1) reason = "パーツのSemanticSlot対応が曖昧です";
    else if (keyforms.length > 1 && !activeKeyform) reason = "編集するメッシュを選択してください";
    return {
      available: !reason,
      reason,
      editingEnabled: Boolean(node && keyArt && !reason),
      node: cloneProject(node),
      nodeId: node?.id || null,
      keyArt: cloneProject(keyArt),
      semanticSlot: cloneProject(semanticSlot),
      keyforms: cloneProject(keyforms),
      selectedKeyformId: activeKeyform?.id || null,
      selectedTopologyId: topology?.id || null,
      activeKeyform: cloneProject(activeKeyform),
      topology: cloneProject(topology),
      topologies: topology ? [cloneProject(topology)] : [],
    };
  }
}
