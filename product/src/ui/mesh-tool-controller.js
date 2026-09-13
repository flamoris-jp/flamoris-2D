import { cloneProject } from "../model/project.js";

export const MESH_AUTHORING_MODES = Object.freeze({
  DEFORM: "deform",
  TOPOLOGY: "topology",
});

export class MeshToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.id || !Object.values(MESH_AUTHORING_MODES).includes(tool.mode) ||
      typeof tool.execute !== "function") {
      throw new TypeError("A mesh tool requires an id, authoring mode, and execute function.");
    }
    if (this.tools.has(tool.id)) throw new Error(`Mesh tool ${tool.id} is already registered.`);
    this.tools.set(tool.id, Object.freeze({ ...tool }));
    return this;
  }

  get(toolId) {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Unknown mesh tool ${toolId}.`);
    return tool;
  }

  list(mode = null) {
    return [...this.tools.values()]
      .filter((tool) => !mode || tool.mode === mode)
      .map(({ execute: _execute, ...projection }) => ({ ...projection }));
  }

  execute(controller, toolId, input = {}) {
    const tool = this.get(toolId);
    if (tool.mode !== controller.mode) {
      throw new Error(`${toolId} is unavailable in ${controller.mode} mode.`);
    }
    return tool.execute(controller, input);
  }
}

export function createDefaultMeshToolRegistry() {
  return new MeshToolRegistry()
    .register({
      id: "deform.move",
      mode: MESH_AUTHORING_MODES.DEFORM,
      label: "頂点を移動",
      execute: (controller, input) => controller.commitDeformPositions(input.positions),
    })
    .register({
      id: "topology.select",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "頂点を選択",
      execute: (_controller, input) => input,
    })
    .register({
      id: "topology.add",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "頂点を追加",
      execute: (controller, input) => controller.addVertex(input),
    })
    .register({
      id: "topology.remove",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "頂点を削除",
      execute: (controller, input) => controller.removeVertex(input),
    })
    .register({
      id: "topology.connect",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "面を作成",
      execute: (controller, input) => controller.connectVertices(input),
    })
    .register({
      id: "topology.subdivide",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "辺を分割",
      execute: (controller, input) => controller.subdivideEdge(input),
    })
    .register({
      id: "topology.set-label",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "頂点名を設定",
      execute: (controller, input) => controller.setSemanticLabel(input),
    })
    .register({
      id: "topology.clear-label",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "頂点名を消去",
      execute: (controller, input) => controller.clearSemanticLabel(input),
    })
    .register({
      id: "topology.automesh",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "輪郭から自動作成",
      execute: (controller, input) => controller.applyGeneratedMesh(input),
    });
}

function allocateStableVertexIds(topologies, count, topology = null) {
  const used = new Set(topologies.flatMap((entry) => entry.vertexIds || []));
  let sequence = Math.max(
    1,
    Number.isSafeInteger(topology?.nextVertexSequence) ? topology.nextVertexSequence : 1,
    ...[...used].map((vertexId) => {
      const match = /^vtx_(\d+)$/.exec(vertexId);
      return match ? Number(match[1]) + 1 : 1;
    }),
  );
  const result = [];
  while (result.length < count) {
    const candidate = `vtx_${String(sequence++).padStart(4, "0")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

/**
 * Transient mesh authoring state and the only UI/controller boundary allowed to
 * dispatch mode-sensitive mesh tools. Persistent mutations still use the
 * ordinary EditorSession Command/Transaction path.
 */
export class MeshToolController {
  constructor(session, meshContext, {
    onChange = null,
    registry = null,
    isPreviewReadOnly = () => false,
  } = {}) {
    this.session = session;
    this.meshContext = meshContext;
    this.onChange = onChange;
    this.registry = registry || createDefaultMeshToolRegistry();
    this.isPreviewReadOnly = isPreviewReadOnly;
    this.mode = MESH_AUTHORING_MODES.DEFORM;
    this.activeToolId = "deform.move";
    this.selectedVertexIds = new Set();
    this.vertexIdOverlayVisible = false;
  }

  notify(reason) { this.onChange?.(reason, this); }

  setContextController(meshContext) {
    if (!meshContext || typeof meshContext.getState !== "function" ||
      typeof meshContext.activeKeyform !== "function") {
      throw new TypeError("Mesh authoring context must expose state and an active MeshKeyform.");
    }
    if (this.meshContext === meshContext) return;
    this.meshContext = meshContext;
    this.selectedVertexIds.clear();
    this.notify("mesh-context");
  }

  getContextController() {
    return this.meshContext;
  }

  setMode(mode) {
    if (!Object.values(MESH_AUTHORING_MODES).includes(mode)) {
      throw new Error(`Unknown mesh authoring mode ${mode}.`);
    }
    if (this.mode === mode) return;
    this.mode = mode;
    this.activeToolId = mode === MESH_AUTHORING_MODES.DEFORM
      ? "deform.move"
      : "topology.select";
    this.notify("mesh-mode");
  }

  setActiveTool(toolId) {
    const tool = this.registry.get(toolId);
    if (tool.mode !== this.mode) throw new Error(`${toolId} is unavailable in ${this.mode} mode.`);
    this.activeToolId = toolId;
    this.notify("mesh-tool");
  }

  execute(toolId = this.activeToolId, input = {}) {
    if (this.isPreviewReadOnly()) {
      throw new Error("Preview is read-only. Select a Key State marker before editing.");
    }
    return this.registry.execute(this, toolId, input);
  }

  setVertexIdOverlayVisible(visible) {
    this.vertexIdOverlayVisible = Boolean(visible);
    this.notify("mesh-overlay");
  }

  clearSelection() {
    this.selectedVertexIds.clear();
    this.notify("mesh-selection");
  }

  selectVertexByIndex(vertexIndex, additive = false) {
    const topology = this.activeTopology();
    const vertexId = topology?.vertexIds?.[vertexIndex] || null;
    if (!additive) this.selectedVertexIds.clear();
    if (vertexId) {
      if (additive && this.selectedVertexIds.has(vertexId)) this.selectedVertexIds.delete(vertexId);
      else this.selectedVertexIds.add(vertexId);
    }
    this.notify("mesh-selection");
    return vertexId;
  }

  activeTopology() {
    const topologyId = this.meshContext.getState().selectedTopologyId;
    if (!topologyId) return null;
    return this.session.query("mesh.get_topology", { topologyId });
  }

  selectedVertices() {
    const topology = this.activeTopology();
    if (!topology) return [];
    return topology.vertexIds
      .map((vertexId, index) => ({
        id: vertexId,
        index,
        semanticLabel: topology.vertexMetadata?.[vertexId]?.semanticLabel || null,
      }))
      .filter((vertex) => this.selectedVertexIds.has(vertex.id));
  }

  commitDeformPositions(positions) {
    if (this.isPreviewReadOnly()) {
      throw new Error("Preview is read-only. Select a Key State marker before editing.");
    }
    if (this.mode !== MESH_AUTHORING_MODES.DEFORM) {
      throw new Error("MeshKeyform deformation is available only in Deform Mode.");
    }
    const keyform = this.meshContext.activeKeyform();
    if (!keyform) throw new Error("Select an endpoint MeshKeyform first.");
    return this.session.execute({
      type: "mesh_keyform.move_vertices",
      payload: { keyformId: keyform.id, positions: [...positions] },
    }, { label: "Move MeshKeyform vertices" });
  }

  assertTopologyMode() {
    if (this.isPreviewReadOnly()) {
      throw new Error("Preview is read-only. Select a Key State marker before editing.");
    }
    if (this.mode !== MESH_AUTHORING_MODES.TOPOLOGY) {
      throw new Error("Topology mutation is disabled in Deform Mode.");
    }
    const topology = this.activeTopology();
    if (!topology) throw new Error("Select a MeshTopology first.");
    return topology;
  }

  addVertex({ position, uv, semanticLabel = null, vertexId = null }) {
    const topology = this.assertTopologyMode();
    const allocatedId = vertexId || topology.nextVertexId;
    const result = this.session.execute({
      type: "mesh_topology.add_vertex",
      payload: {
        topologyId: topology.id,
        vertexId: allocatedId,
        position,
        uv,
        ...(semanticLabel ? { semanticLabel } : {}),
      },
    }, { label: "Add MeshTopology vertex" });
    this.selectedVertexIds = new Set([allocatedId]);
    this.notify("mesh-topology");
    return result;
  }

  removeVertex({ vertexId = null } = {}) {
    const topology = this.assertTopologyMode();
    const targetId = vertexId || this.selectedVertices()[0]?.id;
    if (!targetId) throw new Error("Select one vertex to remove.");
    const result = this.session.execute({
      type: "mesh_topology.remove_vertex",
      payload: { topologyId: topology.id, vertexId: targetId },
    }, { label: "Remove MeshTopology vertex" });
    this.selectedVertexIds.delete(targetId);
    this.notify("mesh-topology");
    return result;
  }

  connectVertices({ vertexIds = null } = {}) {
    const topology = this.assertTopologyMode();
    const ids = vertexIds || this.selectedVertices().map((vertex) => vertex.id);
    return this.session.execute({
      type: "mesh_topology.create_triangle",
      payload: { topologyId: topology.id, vertexIds: [...ids] },
    }, { label: "Create MeshTopology triangle" });
  }

  subdivideEdge({ vertexIds = null, newVertexId = null } = {}) {
    const topology = this.assertTopologyMode();
    const ids = vertexIds || this.selectedVertices().map((vertex) => vertex.id);
    const allocatedId = newVertexId || topology.nextVertexId;
    const result = this.session.execute({
      type: "mesh_topology.subdivide_edge",
      payload: { topologyId: topology.id, vertexIds: [...ids], newVertexId: allocatedId },
    }, { label: "Subdivide MeshTopology edge" });
    this.selectedVertexIds = new Set([allocatedId]);
    this.notify("mesh-topology");
    return result;
  }

  setSemanticLabel({ vertexId = null, semanticLabel }) {
    const topology = this.assertTopologyMode();
    const targetId = vertexId || this.selectedVertices()[0]?.id;
    if (!targetId) throw new Error("Select one vertex to label.");
    return this.session.execute({
      type: "mesh_topology.set_vertex_label",
      payload: { topologyId: topology.id, vertexId: targetId, semanticLabel },
    }, { label: "Set vertex semantic label" });
  }

  clearSemanticLabel({ vertexId = null } = {}) {
    const topology = this.assertTopologyMode();
    const targetId = vertexId || this.selectedVertices()[0]?.id;
    if (!targetId) throw new Error("Select one vertex to clear its label.");
    return this.session.execute({
      type: "mesh_topology.clear_vertex_label",
      payload: { topologyId: topology.id, vertexId: targetId },
    }, { label: "Clear vertex semantic label" });
  }

  applyGeneratedMesh({ candidate, replaceExisting = false }) {
    if (this.isPreviewReadOnly()) {
      throw new Error("Preview is read-only. Select a Key State marker before editing.");
    }
    if (this.mode !== MESH_AUTHORING_MODES.TOPOLOGY) {
      throw new Error("Contour AutoMesh is available only in Topology Edit Mode.");
    }
    if (!candidate || !Array.isArray(candidate.positions) || !Array.isArray(candidate.indices) ||
      !Array.isArray(candidate.uvs)) throw new Error("Generate a valid AutoMesh preview before Apply.");
    const topology = this.activeTopology();
    const vertexIds = allocateStableVertexIds(
      this.session.query("mesh.list_topologies"),
      candidate.positions.length / 2,
      topology,
    );
    let result;
    if (!topology) {
      result = typeof this.meshContext.createGeneratedMesh === "function"
        ? this.meshContext.createGeneratedMesh({
          vertexIds,
          indices: candidate.indices,
          positions: candidate.positions,
          uvs: candidate.uvs,
        })
        : this.meshContext.createSharedTopologyAndKeyforms({
          vertexIds,
          indices: candidate.indices,
          fromPositions: candidate.positions,
          fromUvs: candidate.uvs,
          toPositions: candidate.positions,
          toUvs: candidate.uvs,
        });
    } else {
      result = this.session.execute({
        type: "mesh_topology.apply_generated_mesh",
        payload: {
          topologyId: topology.id,
          vertexIds,
          indices: [...candidate.indices],
          positions: [...candidate.positions],
          uvs: [...candidate.uvs],
          replaceExisting: Boolean(replaceExisting),
        },
      }, { label: "Apply Contour AutoMesh" });
    }
    this.selectedVertexIds.clear();
    this.notify("mesh-automesh-applied");
    return { ...result, vertexIds };
  }

  getState() {
    const topology = this.activeTopology();
    const selectedVertices = this.selectedVertices();
    const affectedKeyforms = topology
      ? this.session.query("mesh.list_keyforms", { topologyId: topology.id })
      : [];
    return {
      contextKind: this.meshContext.kind || "endpoint",
      mode: this.mode,
      activeToolId: this.activeToolId,
      tools: this.registry.list(this.mode),
      vertexIdOverlayVisible: this.vertexIdOverlayVisible,
      selectedVertexIds: selectedVertices.map((vertex) => vertex.id),
      selectedVertex: selectedVertices.length === 1 ? cloneProject(selectedVertices[0]) : null,
      topology: cloneProject(topology),
      affectedKeyformIds: affectedKeyforms.map((keyform) => keyform.id),
    };
  }
}
