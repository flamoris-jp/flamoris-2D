import { cloneProject } from "../model/project.js";
import { screenToMeshLocal } from "./canvas-interaction.js";

const ENDPOINTS = Object.freeze(["from", "to"]);

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function endpointKey(endpoint) {
  return endpoint === "from" ? "fromKeyArtId" : "toKeyArtId";
}

function endpointKeyformKey(endpoint) {
  return endpoint === "from" ? "fromKeyformId" : "toKeyformId";
}

/**
 * The endpoint mesh workflow deliberately owns only workspace state.  All
 * topology, keyform, and PartTransition changes go back through EditorSession.
 */
export class EndpointMeshController {
  constructor(session, transitionAuthoring, { onChange = null, idFactory } = {}) {
    this.session = session;
    this.transitionAuthoring = transitionAuthoring;
    this.onChange = onChange;
    this.idFactory = idFactory || defaultIdFactory();
    this.activeEndpoint = "from";
    this.editingEnabled = false;
    this.selectedTopologyId = null;
    this.selectedKeyformIds = { from: null, to: null };
    this.selectedVertexIndex = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  selectEndpoint(endpoint) {
    if (!ENDPOINTS.includes(endpoint)) throw new Error(`Unknown endpoint ${endpoint}.`);
    this.activeEndpoint = endpoint;
    this.editingEnabled = true;
    this.selectedVertexIndex = null;
    this.notify("endpoint-selection");
  }

  exitEditing() {
    this.editingEnabled = false;
    this.selectedVertexIndex = null;
    this.notify("endpoint-exit");
  }

  selectTopology(topologyId) {
    if (topologyId !== null) this.session.query("mesh.get_topology", { topologyId });
    this.selectedTopologyId = topologyId;
    this.selectedKeyformIds = { from: null, to: null };
    this.selectedVertexIndex = null;
    this.notify("topology-selection");
  }

  selectKeyform(endpoint, keyformId) {
    if (!ENDPOINTS.includes(endpoint)) throw new Error(`Unknown endpoint ${endpoint}.`);
    if (keyformId !== null) {
      const state = this.getState();
      const keyform = this.session.query("mesh.get_keyform", { keyformId });
      if (!keyform || !state.activeTransition || !state.selectedSemanticSlot ||
        keyform.keyArtId !== state.activeTransition[endpointKey(endpoint)] ||
        keyform.semanticSlotId !== state.selectedSemanticSlot.id ||
        (this.selectedTopologyId && keyform.topologyId !== this.selectedTopologyId)) {
        throw new Error("MeshKeyform is not compatible with this endpoint context.");
      }
      this.selectedTopologyId ||= keyform.topologyId;
    }
    this.selectedKeyformIds[endpoint] = keyformId;
    this.selectedVertexIndex = null;
    this.syncPartTopology();
    this.notify("keyform-selection");
  }

  selectVertex(vertexIndex) {
    const keyform = this.activeKeyform();
    const count = keyform ? keyform.positions.length / 2 : 0;
    this.selectedVertexIndex = Number.isSafeInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < count
      ? vertexIndex : null;
    this.notify("vertex-selection");
  }

  createTopology({
    topologyId = this.idFactory("topology"),
    vertexIds,
    indices,
  }) {
    const result = this.session.execute({
      type: "mesh_topology.create",
      payload: { topology: { id: topologyId, vertexIds: [...vertexIds], indices: [...indices], vertexMetadata: {} } },
    }, { label: "Create MeshTopology" });
    this.selectTopology(topologyId);
    return result;
  }

  updateTopology(topologyId, { vertexIds, indices }) {
    const current = this.session.query("mesh.get_topology", { topologyId });
    return this.session.execute({
      type: "mesh_topology.update",
      payload: { topologyId, topology: {
        id: topologyId,
        vertexIds: [...vertexIds],
        indices: [...indices],
        vertexMetadata: cloneProject(current.vertexMetadata),
        ...(Number.isSafeInteger(current.nextVertexSequence)
          ? { nextVertexSequence: current.nextVertexSequence }
          : {}),
      } },
    }, { label: "Update MeshTopology" });
  }

  removeTopology(topologyId) {
    const result = this.session.execute({
      type: "mesh_topology.remove",
      payload: { topologyId },
    }, { label: "Remove MeshTopology" });
    if (this.selectedTopologyId === topologyId) this.selectTopology(null);
    return result;
  }

  removeKeyform(keyformId) {
    const result = this.session.execute({
      type: "mesh_keyform.remove",
      payload: { keyformId },
    }, { label: "Remove MeshKeyform" });
    for (const endpoint of ENDPOINTS) {
      if (this.selectedKeyformIds[endpoint] === keyformId) this.selectedKeyformIds[endpoint] = null;
    }
    this.selectedVertexIndex = null;
    this.notify("keyform-removed");
    return result;
  }

  /** Create the minimum valid Morph authoring set atomically.  This is the
   * command/query path used by UI and MCP when no PartTransition exists yet. */
  createSharedTopologyAndKeyforms({
    topologyId = this.idFactory("topology"),
    fromKeyformId = this.idFactory("keyform"),
    toKeyformId = this.idFactory("keyform"),
    vertexIds,
    indices,
    fromPositions,
    fromUvs,
    toPositions,
    toUvs,
  }) {
    const state = this.getState();
    if (!state.activeTransition || !state.selectedSemanticSlot) {
      throw new Error("Select a Transition and SemanticSlot first.");
    }
    const expected = vertexIds.length * 2;
    const part = state.selectedSemanticSlot.partTransition;
    const commands = [
      { type: "mesh_topology.create", payload: { topology: { id: topologyId, vertexIds: [...vertexIds], indices: [...indices], vertexMetadata: {} } } },
      { type: "mesh_keyform.create", payload: { keyform: {
        id: fromKeyformId, topologyId, keyArtId: state.activeTransition.fromKeyArtId,
        semanticSlotId: state.selectedSemanticSlot.id, positions: fromPositions ? [...fromPositions] : Array(expected).fill(0), uvs: fromUvs ? [...fromUvs] : Array(expected).fill(0),
      } } },
      { type: "mesh_keyform.create", payload: { keyform: {
        id: toKeyformId, topologyId, keyArtId: state.activeTransition.toKeyArtId,
        semanticSlotId: state.selectedSemanticSlot.id, positions: toPositions ? [...toPositions] : Array(expected).fill(0), uvs: toUvs ? [...toUvs] : Array(expected).fill(0),
      } } },
      { type: "transition.set_part_mode", payload: {
        transitionId: state.activeTransition.id, partTransitionId: part?.id || this.idFactory("part_transition"),
        semanticSlotId: state.selectedSemanticSlot.id, mode: "morph", configuration: {},
      } },
      { type: "transition.set_part_topology", payload: {
        transitionId: state.activeTransition.id, semanticSlotId: state.selectedSemanticSlot.id,
        topologyId, fromKeyformId, toKeyformId,
      } },
    ];
    const result = this.session.executeTransaction(commands, { label: "Create shared endpoint mesh" });
    this.selectedTopologyId = topologyId;
    this.selectedKeyformIds = { from: fromKeyformId, to: toKeyformId };
    this.notify("endpoint-mesh-created");
    return result;
  }

  createKeyform(endpoint, {
    keyformId = this.idFactory("keyform"),
    positions,
    uvs,
  }) {
    if (!ENDPOINTS.includes(endpoint)) throw new Error(`Unknown endpoint ${endpoint}.`);
    const state = this.getState();
    if (!state.activeTransition || !state.selectedSemanticSlot || !this.selectedTopologyId) {
      throw new Error("Select a Transition, SemanticSlot, and MeshTopology first.");
    }
    const topology = this.session.query("mesh.get_topology", { topologyId: this.selectedTopologyId });
    const expected = topology.vertexIds.length * 2;
    const keyform = {
      id: keyformId,
      topologyId: topology.id,
      keyArtId: state.activeTransition[endpointKey(endpoint)],
      semanticSlotId: state.selectedSemanticSlot.id,
      positions: positions ? [...positions] : Array(expected).fill(0),
      uvs: uvs ? [...uvs] : Array(expected).fill(0),
    };
    const result = this.session.execute({
      type: "mesh_keyform.create",
      payload: { keyform },
    }, { label: `Create ${endpoint === "from" ? "A" : "B"} MeshKeyform` });
    this.selectedKeyformIds[endpoint] = keyformId;
    this.syncPartTopology();
    this.notify("keyform-created");
    return result;
  }

  syncPartTopology() {
    const state = this.getState();
    const part = state.selectedSemanticSlot?.partTransition;
    const fromKeyformId = this.selectedKeyformIds.from || part?.fromKeyformId;
    const toKeyformId = this.selectedKeyformIds.to || part?.toKeyformId;
    if (!state.activeTransition || !state.selectedSemanticSlot || !this.selectedTopologyId ||
      !fromKeyformId || !toKeyformId) return null;
    return this.session.execute({
      type: "transition.set_part_topology",
      payload: {
        transitionId: state.activeTransition.id,
        semanticSlotId: state.selectedSemanticSlot.id,
        topologyId: this.selectedTopologyId,
        fromKeyformId,
        toKeyformId,
      },
    }, { label: "Set shared Morph topology" });
  }

  moveVertex(keyformId, vertexIndex, localPoint) {
    const keyform = this.session.query("mesh.get_keyform", { keyformId });
    if (!Number.isSafeInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= keyform.positions.length / 2) {
      throw new Error("Unknown MeshKeyform vertex.");
    }
    const next = cloneProject(keyform);
    next.positions[vertexIndex * 2] = localPoint.x;
    next.positions[vertexIndex * 2 + 1] = localPoint.y;
    return this.session.execute({
      type: "mesh_keyform.update",
      payload: { keyformId, keyform: next },
    }, { label: "Move MeshKeyform vertex" });
  }

  updateKeyformPositions(keyformId, positions) {
    const keyform = this.session.query("mesh.get_keyform", { keyformId });
    if (positions.length !== keyform.positions.length || positions.some((value) => !Number.isFinite(value))) {
      throw new Error("MeshKeyform positions must contain two finite values per topology vertex.");
    }
    return this.session.execute({
      type: "mesh_keyform.move_vertices",
      payload: { keyformId, positions: [...positions] },
    }, { label: "Move MeshKeyform vertices" });
  }

  commitActiveMeshPositions(positions) {
    const keyform = this.activeKeyform();
    return keyform ? this.updateKeyformPositions(keyform.id, positions) : null;
  }

  /** Resolve the endpoint node from the SemanticSlot mapping, then use the
   * exact same world transform used by viewport rendering. */
  screenToActiveKeyformLocal(screenPoint, view) {
    return this.screenToEndpointKeyformLocal(this.activeEndpoint, screenPoint, view);
  }

  screenToEndpointKeyformLocal(endpoint, screenPoint, view) {
    if (!ENDPOINTS.includes(endpoint)) throw new Error(`Unknown endpoint ${endpoint}.`);
    return screenToMeshLocal(screenPoint, view, {
      worldTransform: this.endpointWorldTransform(endpoint),
    });
  }

  activeEndpointNodeId() {
    return this.endpointNodeId(this.activeEndpoint);
  }

  endpointNodeId(endpoint) {
    if (!ENDPOINTS.includes(endpoint)) throw new Error(`Unknown endpoint ${endpoint}.`);
    const mapping = this.getState().selectedSemanticSlot?.[endpoint]?.mapping;
    if (!mapping) throw new Error(`${endpoint} endpoint has no mapped PartNode.`);
    return mapping.nodeId;
  }

  // Viewport callers use this same resolved matrix for artwork/mesh rendering.
  activeEndpointWorldTransform() {
    return this.endpointWorldTransform(this.activeEndpoint);
  }

  endpointWorldTransform(endpoint) {
    return this.session.query("scene.get_node", {
      nodeId: this.endpointNodeId(endpoint),
    }).worldTransform;
  }

  moveActiveVertexAtScreenPoint(screenPoint, view) {
    const keyform = this.activeKeyform();
    if (!keyform || this.selectedVertexIndex === null) return null;
    return this.moveVertex(
      keyform.id,
      this.selectedVertexIndex,
      this.screenToActiveKeyformLocal(screenPoint, view),
    );
  }

  activeKeyform() {
    const part = this.transitionAuthoring.getState().selectedSemanticSlot?.partTransition;
    const id = this.selectedKeyformIds[this.activeEndpoint] ||
      part?.[endpointKeyformKey(this.activeEndpoint)];
    if (!id) return null;
    return this.session.query("mesh.list_keyforms")
      .find((entry) => entry.id === id) || null;
  }

  getState() {
    const authoring = this.transitionAuthoring.getState();
    const slot = authoring.selectedSemanticSlot;
    const transition = authoring.activeTransition;
    const topologyId = this.selectedTopologyId || slot?.morphReferences?.topologyId || null;
    const candidates = transition && slot
      ? this.session.query("mesh.list_keyforms", {
        semanticSlotId: slot.id,
        ...(topologyId ? { topologyId } : {}),
      }).filter((keyform) =>
        [transition.fromKeyArtId, transition.toKeyArtId].includes(keyform.keyArtId))
      : [];
    const part = slot?.partTransition;
    const resolvedKeyformIds = {
      from: this.selectedKeyformIds.from || part?.fromKeyformId || null,
      to: this.selectedKeyformIds.to || part?.toKeyformId || null,
    };
    const endpointCandidates = Object.fromEntries(ENDPOINTS.map((endpoint) => [endpoint,
      candidates.filter((keyform) => keyform.keyArtId === transition?.[endpointKey(endpoint)])
        .map(cloneProject),
    ]));
    return {
      ...authoring,
      activeEndpoint: this.activeEndpoint,
      editingEnabled: this.editingEnabled,
      selectedTopologyId: topologyId,
      selectedKeyformIds: resolvedKeyformIds,
      selectedVertexIndex: this.selectedVertexIndex,
      topologies: this.session.query("mesh.list_topologies"),
      endpointCandidates,
      activeKeyform: cloneProject(this.activeKeyform()),
    };
  }
}
