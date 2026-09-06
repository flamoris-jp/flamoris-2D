import {
  cloneProject,
  createSceneNode,
} from "../model/project.js";
import { CommandError } from "./errors.js";

function nodeFor(project, nodeId) {
  const node = project.scene.nodes[nodeId];
  if (!node) {
    throw new CommandError(
      "Unknown node " + nodeId + ".",
      "scene.node_not_found",
      { nodeId },
    );
  }
  return node;
}

export const sceneCommandHandlers = {
  "source.apply_psd_reimport": (project, payload) => {
    const next = cloneProject(payload.project);
    if (next.id !== project.id) {
      throw new CommandError(
        "PSD re-import must preserve the logical Project ID.",
        "project.identity_changed",
      );
    }
    const inverse = {
      type: "source.apply_psd_reimport",
      payload: { project: cloneProject(project) },
    };
    const affectedIds = new Set([
      ...Object.keys(project.scene.nodes),
      ...Object.keys(next.scene.nodes),
    ]);
    for (const key of Object.keys(project)) delete project[key];
    Object.assign(project, next);
    return { inverse, affectedIds: [...affectedIds] };
  },

  "scene.rename_node": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const next = String(payload.displayName ?? "").trim();
    if (!next) {
      throw new CommandError(
        "Display name must not be empty.",
        "scene.empty_display_name",
      );
    }
    const inverse = {
      type: "scene.rename_node",
      payload: { nodeId: node.id, displayName: node.displayName },
    };
    node.displayName = next;
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_transform": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_transform",
      payload: {
        nodeId: node.id,
        coordinateSpace: "node-local",
        transform: cloneProject(node.transform),
      },
    };
    node.transform = cloneProject(payload.transform);
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_visibility": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_visibility",
      payload: { nodeId: node.id, visible: node.visible },
    };
    node.visible = payload.visible;
    return { inverse, affectedIds: [node.id] };
  },

  "scene.set_locked": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const inverse = {
      type: "scene.set_locked",
      payload: { nodeId: node.id, locked: node.locked },
    };
    node.locked = payload.locked;
    return { inverse, affectedIds: [node.id] };
  },

  "scene.create_group": (project, payload) => {
    if (project.scene.nodes[payload.id]) {
      throw new CommandError(
        "Node " + payload.id + " already exists.",
        "identity.duplicate",
      );
    }
    const parent = nodeFor(project, payload.parentId);
    if (parent.kind !== "group") {
      throw new CommandError(
        "Groups can only be created under a group.",
        "scene.invalid_parent_kind",
      );
    }
    const displayName = String(payload.displayName ?? "").trim();
    if (!displayName) {
      throw new CommandError(
        "Display name must not be empty.",
        "scene.empty_display_name",
      );
    }
    const node = createSceneNode({
      id: payload.id,
      kind: "group",
      displayName,
      parentId: parent.id,
    });
    project.scene.nodes[node.id] = node;
    const index = payload.index == null
      ? parent.children.length
      : Math.max(0, Math.min(parent.children.length, payload.index));
    parent.children.splice(index, 0, node.id);
    return {
      inverse: {
        type: "scene.remove_empty_group",
        payload: { nodeId: node.id },
      },
      affectedIds: [parent.id, node.id],
    };
  },

  "scene.remove_empty_group": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    if (
      node.id === project.scene.rootId ||
      node.kind !== "group" ||
      node.children.length
    ) {
      throw new CommandError(
        "Only an empty non-root group can be removed.",
        "scene.group_not_empty",
      );
    }
    const parent = nodeFor(project, node.parentId);
    const index = parent.children.indexOf(node.id);
    parent.children.splice(index, 1);
    delete project.scene.nodes[node.id];
    return {
      inverse: {
        type: "scene.create_group",
        payload: {
          id: node.id,
          parentId: parent.id,
          displayName: node.displayName,
          index,
        },
      },
      affectedIds: [parent.id, node.id],
    };
  },

  "scene.reparent_node": (project, payload) => {
    const node = nodeFor(project, payload.nodeId);
    const nextParent = nodeFor(project, payload.parentId);
    if (node.id === project.scene.rootId) {
      throw new CommandError(
        "The scene root cannot be reparented.",
        "scene.reparent_root",
      );
    }
    if (!["group", "deformer"].includes(nextParent.kind)) {
      throw new CommandError(
        "Parent must be a group.",
        "scene.invalid_parent_kind",
      );
    }
    let ancestor = nextParent;
    while (ancestor) {
      if (ancestor.id === node.id) {
        throw new CommandError(
          "Reparenting would create a cycle.",
          "scene.cycle",
        );
      }
      ancestor = ancestor.parentId
        ? project.scene.nodes[ancestor.parentId]
        : null;
    }
    const previousParent = nodeFor(project, node.parentId);
    const previousIndex = previousParent.children.indexOf(node.id);
    previousParent.children.splice(previousIndex, 1);
    const index = payload.index == null
      ? nextParent.children.length
      : Math.max(0, Math.min(nextParent.children.length, payload.index));
    nextParent.children.splice(index, 0, node.id);
    node.parentId = nextParent.id;
    if (node.kind === "deformer") {
      const deformer = project.rig.deformers.find((entry) => entry.id === node.id);
      if (deformer) deformer.parentNodeId = nextParent.id;
    }
    return {
      inverse: {
        type: "scene.reparent_node",
        payload: {
          nodeId: node.id,
          parentId: previousParent.id,
          index: previousIndex,
        },
      },
      affectedIds: [node.id, previousParent.id, nextParent.id],
    };
  },
};
