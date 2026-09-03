import { cloneProject } from "../model/project.js";
import { worldTransformMatrix } from "../core/transforms.js";
import { TransitionAuthoringController } from "./transition-authoring-controller.js";
import { EndpointMeshController } from "./endpoint-mesh-controller.js";

function filterTree(node, matches) {
  const children = node.children
    .map((child) => filterTree(child, matches))
    .filter(Boolean);
  return matches.has(node.id) || children.length
    ? { ...node, children }
    : null;
}

function transformCommand(nodeId, transform) {
  return {
    type: "scene.set_transform",
    payload: {
      nodeId,
      coordinateSpace: "node-local",
      transform: cloneProject(transform),
    },
  };
}

export class EditorUiAdapter {
  constructor(session, { onChange = null } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.selectedNodeId = null;
    this.expandedNodeIds = new Set();
    this.filterText = "";
    this.activeTool = "translate";
    this.transformDrag = null;
    this.transitionAuthoring = new TransitionAuthoringController(session, {
      onChange: (reason) => this.notify(reason),
    });
    this.endpointMesh = new EndpointMeshController(session, this.transitionAuthoring, {
      onChange: (reason) => this.notify(reason),
    });
    this.expandAllGroups();

    const sessionOnChange = session.onChange;
    session.onChange = (...args) => {
      sessionOnChange?.(...args);
      this.notify("project");
    };
  }

  notify(reason) {
    this.onChange?.(reason, this);
  }

  expandAllGroups() {
    const tree = this.session.query("scene.get_tree", { includeHidden: true });
    const walk = (node) => {
      if (node.kind === "group") this.expandedNodeIds.add(node.id);
      node.children.forEach(walk);
    };
    walk(tree);
  }

  getTree() {
    const tree = this.session.query("scene.get_tree", { includeHidden: true });
    const needle = this.filterText.trim();
    if (!needle) return tree;
    const matches = new Set(
      this.session.query("scene.search", {
        text: needle,
        includeHidden: true,
      }).map((node) => node.id),
    );
    return filterTree(tree, matches) || { ...tree, children: [] };
  }

  setFilter(text) {
    this.filterText = String(text || "");
    this.notify("filter");
  }

  toggleExpanded(nodeId) {
    if (this.expandedNodeIds.has(nodeId)) this.expandedNodeIds.delete(nodeId);
    else this.expandedNodeIds.add(nodeId);
    this.notify("expanded");
  }

  selectNode(nodeId) {
    if (nodeId !== null) this.session.query("scene.get_node", { nodeId });
    if (this.selectedNodeId === nodeId) return;
    this.selectedNodeId = nodeId;
    this.cancelTransformDrag();
    this.notify("selection");
  }

  selectedNode() {
    return this.selectedNodeId
      ? this.getNode(this.selectedNodeId)
      : null;
  }

  isDescendantOrSelf(nodeId, ancestorId) {
    let current = this.session.project.scene.nodes[nodeId];
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parentId
        ? this.session.project.scene.nodes[current.parentId]
        : null;
    }
    return false;
  }

  getNode(nodeId) {
    const node = this.session.query("scene.get_node", { nodeId });
    if (this.transformDrag?.nodeId !== nodeId) return node;
    return {
      ...node,
      transform: cloneProject(this.transformDrag.previewTransform),
      worldTransform: this.worldTransform(nodeId),
    };
  }

  worldTransform(nodeId) {
    const overrides = this.transformDrag
      ? new Map([[
        this.transformDrag.nodeId,
        this.transformDrag.previewTransform,
      ]])
      : null;
    return worldTransformMatrix(this.session.project, nodeId, overrides);
  }

  setActiveTool(tool) {
    if (!["translate", "rotate", "scale", "pivot"].includes(tool)) {
      throw new Error("Unknown transform tool " + tool + ".");
    }
    this.activeTool = tool;
    this.notify("tool");
  }

  renameSelected(displayName) {
    if (!this.selectedNodeId) return null;
    return this.session.execute({
      type: "scene.rename_node",
      payload: { nodeId: this.selectedNodeId, displayName },
    }, { label: "Rename node" });
  }

  setVisibility(nodeId, visible) {
    return this.session.execute({
      type: "scene.set_visibility",
      payload: { nodeId, visible },
    }, { label: "Set visibility" });
  }

  setLocked(nodeId, locked) {
    return this.session.execute({
      type: "scene.set_locked",
      payload: { nodeId, locked },
    }, { label: "Set lock" });
  }

  setSelectedTransform(transform, label = "Set transform") {
    if (!this.selectedNodeId) return null;
    return this.session.execute(
      transformCommand(this.selectedNodeId, transform),
      { label },
    );
  }

  beginTransformDrag(label = "Transform node") {
    if (!this.selectedNodeId) return null;
    const node = this.session.query("scene.get_node", {
      nodeId: this.selectedNodeId,
    });
    if (node.locked) return null;
    this.transformDrag = {
      nodeId: node.id,
      label,
      initialTransform: cloneProject(node.transform),
      previewTransform: cloneProject(node.transform),
    };
    this.notify("transform-preview");
    return cloneProject(this.transformDrag);
  }

  previewTransform(transform) {
    if (!this.transformDrag) return;
    this.transformDrag.previewTransform = cloneProject(transform);
    this.notify("transform-preview");
  }

  commitTransformDrag() {
    const drag = this.transformDrag;
    if (!drag) return null;
    this.transformDrag = null;
    if (
      JSON.stringify(drag.initialTransform) ===
      JSON.stringify(drag.previewTransform)
    ) {
      this.notify("transform-preview");
      return null;
    }
    return this.session.execute(
      transformCommand(drag.nodeId, drag.previewTransform),
      { label: drag.label },
    );
  }

  cancelTransformDrag() {
    if (!this.transformDrag) return;
    this.transformDrag = null;
    this.notify("transform-preview");
  }

  undo() {
    const result = this.session.undo();
    this.ensureSelectionExists();
    return result;
  }

  redo() {
    const result = this.session.redo();
    this.ensureSelectionExists();
    return result;
  }

  ensureSelectionExists() {
    if (
      this.selectedNodeId &&
      !this.session.project.scene.nodes[this.selectedNodeId]
    ) {
      this.selectedNodeId = null;
      this.notify("selection");
    }
  }

  get canUndo() {
    return this.session.undoStack.length > 0;
  }

  get canRedo() {
    return this.session.redoStack.length > 0;
  }

  get undoLabel() {
    return this.session.undoStack.at(-1)?.label || null;
  }

  get redoLabel() {
    return this.session.redoStack.at(-1)?.label || null;
  }
}

export function bindPsdPartsToProject(parts, project) {
  const nodeQueues = new Map();
  const walk = (nodeId) => {
    const node = project.scene.nodes[nodeId];
    if (node.sourceRef?.sourceKey && node.kind !== "group") {
      const queue = nodeQueues.get(node.sourceRef.sourceKey) || [];
      queue.push(node.id);
      nodeQueues.set(node.sourceRef.sourceKey, queue);
    }
    node.children.forEach(walk);
  };
  walk(project.scene.rootId);

  return parts.map((part) => {
    const queue = nodeQueues.get(part.sourceKey) || [];
    return { ...part, nodeId: queue.shift() || null };
  });
}
