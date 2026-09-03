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
      label: "Move",
      execute: (controller, input) => controller.commitDeformPositions(input.positions),
    })
    .register({
      id: "topology.select",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Select",
      execute: (_controller, input) => input,
    })
    .register({
      id: "topology.add",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Add Vertex",
      execute: (controller, input) => controller.addVertex(input),
    })
    .register({
      id: "topology.remove",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Remove Vertex",
      execute: (controller, input) => controller.removeVertex(input),
    })
    .register({
      id: "topology.connect",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Create Triangle",
      execute: (controller, input) => controller.connectVertices(input),
    })
    .register({
      id: "topology.subdivide",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Subdivide Edge",
      execute: (controller, input) => controller.subdivideEdge(input),
    })
    .register({
      id: "topology.set-label",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Set Label",
      execute: (controller, input) => controller.setSemanticLabel(input),
    })
    .register({
      id: "topology.clear-label",
      mode: MESH_AUTHORING_MODES.TOPOLOGY,
      label: "Clear Label",
      execute: (controller, input) => controller.clearSemanticLabel(input),
    });
}

/**
 * Transient mesh authoring state and the only UI/controller boundary allowed to
 * dispatch mode-sensitive mesh tools. Persistent mutations still use the
 * ordinary EditorSession Command/Transaction path.
 */
export class MeshToolController {
  constructor(session, endpointMesh, { onChange = null, registry = null } = {}) {
    this.session = session;
    this.endpointMesh = endpointMesh;
    this.onChange = onChange;
    this.registry = registry || createDefaultMeshToolRegistry();
    this.mode = MESH_AUTHORING_MODES.DEFORM;
    this.activeToolId = "deform.move";
    this.selectedVertexIds = new Set();
    this.vertexIdOverlayVisible = false;
  }

  notify(reason) { this.onChange?.(reason, this); }

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
    const topologyId = this.endpointMesh.getState().selectedTopologyId;
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
    if (this.mode !== MESH_AUTHORING_MODES.DEFORM) {
      throw new Error("MeshKeyform deformation is available only in Deform Mode.");
    }
    const keyform = this.endpointMesh.activeKeyform();
    if (!keyform) throw new Error("Select an endpoint MeshKeyform first.");
    return this.session.execute({
      type: "mesh_keyform.move_vertices",
      payload: { keyformId: keyform.id, positions: [...positions] },
    }, { label: "Move MeshKeyform vertices" });
  }

  assertTopologyMode() {
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

  getState() {
    const topology = this.activeTopology();
    const selectedVertices = this.selectedVertices();
    const affectedKeyforms = topology
      ? this.session.query("mesh.list_keyforms", { topologyId: topology.id })
      : [];
    return {
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
