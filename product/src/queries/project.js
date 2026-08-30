import { cloneProject } from "../model/project.js";
import { validationResult } from "../model/validation.js";
import { worldTransformMatrix } from "../core/transforms.js";

function treeNode(project, nodeId, includeHidden) {
  const node = project.scene.nodes[nodeId];
  if (!node || (!includeHidden && !node.visible)) return null;
  return {
    id: node.id,
    kind: node.kind,
    displayName: node.displayName,
    visible: node.visible,
    locked: node.locked,
    children: node.children
      .map((id) => treeNode(project, id, includeHidden))
      .filter(Boolean),
  };
}

export const projectQueries = {
  "project.get_summary": (project) => ({
    id: project.id,
    schemaVersion: project.schemaVersion,
    displayName: project.displayName,
    canvas: { ...project.canvas },
    counts: {
      nodes: Object.keys(project.scene.nodes).length,
      sources: project.sourceAssets.length,
      keyArts: project.keyArts.length,
      meshes: project.meshes.length,
      transitions: project.transitions.length,
      clips: project.animation.clips.length,
    },
  }),
  "project.validate": (project) => validationResult(project),
  "scene.get_tree": (project, input = {}) =>
    treeNode(project, project.scene.rootId, input.includeHidden !== false),
  "scene.get_node": (project, input) => {
    const node = project.scene.nodes[input.nodeId];
    if (!node) throw new Error("Unknown node " + input.nodeId + ".");
    return {
      ...cloneProject(node),
      worldTransform: worldTransformMatrix(project, input.nodeId),
    };
  },
  "scene.search": (project, input = {}) => {
    const needle = String(input.text || "").toLocaleLowerCase();
    return Object.values(project.scene.nodes)
      .filter((node) =>
        (input.includeHidden !== false || node.visible) &&
        node.displayName.toLocaleLowerCase().includes(needle))
      .map((node) => ({
        id: node.id,
        displayName: node.displayName,
        kind: node.kind,
        visible: node.visible,
        locked: node.locked,
      }));
  },
};

export function queryProject(project, name, input = {}) {
  const query = projectQueries[name];
  if (!query) throw new Error("Unknown query " + name + ".");
  return query(project, input);
}
