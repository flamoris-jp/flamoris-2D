import { cloneProject } from "../model/project.js";
import { validationResult } from "../model/validation.js";
import { worldTransformMatrix } from "../core/transforms.js";
import { sampleTemporalProgram, sortTemporalProgram } from "../core/temporal.js";
import {
  evaluateTransition,
  getTransitionDiagnostics,
} from "../core/transition-evaluator.js";

function temporalProgram(project, programId) {
  const program = project.temporalPrograms.find((entry) => entry.id === programId);
  if (!program) throw new Error("Unknown TemporalProgram " + programId + ".");
  return program;
}

function treeNode(
  project,
  nodeId,
  includeHidden,
  parentEffectiveVisibility = true,
) {
  const node = project.scene.nodes[nodeId];
  if (!node) return null;
  const effectiveVisible = parentEffectiveVisibility && node.visible;
  if (!includeHidden && !effectiveVisible) return null;
  return {
    id: node.id,
    kind: node.kind,
    displayName: node.displayName,
    visible: node.visible,
    effectiveVisible,
    locked: node.locked,
    children: node.children
      .map((id) =>
        treeNode(project, id, includeHidden, effectiveVisible))
      .filter(Boolean),
  };
}

export function isEffectivelyVisible(project, nodeId) {
  let current = project.scene.nodes[nodeId];
  if (!current) throw new Error("Unknown node " + nodeId + ".");
  const visited = new Set();
  while (current) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (!current.visible) return false;
    current = current.parentId
      ? project.scene.nodes[current.parentId]
      : null;
  }
  return true;
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
      semanticSlots: project.semanticSlots.length,
      meshes: project.meshes.length,
      meshTopologies: project.meshTopologies.length,
      meshKeyforms: project.meshKeyforms.length,
      transitions: project.transitions.length,
      clips: project.animation.clips.length,
      temporalPrograms: project.temporalPrograms.length,
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
      effectiveVisible: isEffectivelyVisible(project, input.nodeId),
      worldTransform: worldTransformMatrix(project, input.nodeId),
    };
  },
  "scene.search": (project, input = {}) => {
    const needle = String(input.text || "").toLocaleLowerCase();
    return Object.values(project.scene.nodes)
      .filter((node) =>
        (
          input.includeHidden !== false ||
          isEffectivelyVisible(project, node.id)
        ) &&
        node.displayName.toLocaleLowerCase().includes(needle))
      .map((node) => ({
        id: node.id,
        displayName: node.displayName,
        kind: node.kind,
        visible: node.visible,
        effectiveVisible: isEffectivelyVisible(project, node.id),
        locked: node.locked,
      }));
  },
  "animation.get_program": (project, input) =>
    sortTemporalProgram(temporalProgram(project, input.programId)),
  "animation.list_tracks": (project, input) =>
    sortTemporalProgram(temporalProgram(project, input.programId)).tracks,
  "animation.sample_program": (project, input) =>
    sampleTemporalProgram(temporalProgram(project, input.programId), input.timeTicks),
  "keyart.get": (project, input) => {
    const keyArt = project.keyArts.find((entry) => entry.id === input.keyArtId);
    if (!keyArt) throw new Error("Unknown KeyArt " + input.keyArtId + ".");
    return cloneProject(keyArt);
  },
  "keyart.list": (project) => [...project.keyArts]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(cloneProject),
  "semantic_slot.get": (project, input) => {
    const slot = project.semanticSlots.find((entry) => entry.id === input.semanticSlotId);
    if (!slot) throw new Error("Unknown SemanticSlot " + input.semanticSlotId + ".");
    return cloneProject(slot);
  },
  "semantic_slot.list": (project) => [...project.semanticSlots]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(cloneProject),
  "semantic_slot.get_mapping": (project, input) => {
    const slot = project.semanticSlots.find((entry) => entry.id === input.semanticSlotId);
    if (!slot) throw new Error("Unknown SemanticSlot " + input.semanticSlotId + ".");
    return cloneProject((slot.mappings || []).find((entry) => entry.keyArtId === input.keyArtId) || null);
  },
  "mesh.get_topology": (project, input) => {
    const topology = project.meshTopologies.find((entry) => entry.id === input.topologyId);
    if (!topology) throw new Error("Unknown MeshTopology " + input.topologyId + ".");
    return cloneProject(topology);
  },
  "mesh.get_keyform": (project, input) => {
    const keyform = project.meshKeyforms.find((entry) => entry.id === input.keyformId);
    if (!keyform) throw new Error("Unknown MeshKeyform " + input.keyformId + ".");
    return cloneProject(keyform);
  },
  "transition.get": (project, input) => {
    const transition = project.transitions.find((entry) => entry.id === input.transitionId);
    if (!transition) throw new Error("Unknown Transition " + input.transitionId + ".");
    const program = temporalProgram(project, transition.temporalProgramId);
    return { ...cloneProject(transition), durationTicks: program.durationTicks };
  },
  "transition.list": (project) => [...project.transitions]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((transition) => ({
      ...cloneProject(transition),
      durationTicks: temporalProgram(project, transition.temporalProgramId).durationTicks,
    })),
  "transition.evaluate": (project, input) =>
    evaluateTransition(project, input.transitionId, input.timeTicks),
  "transition.get_diagnostics": (project, input) =>
    getTransitionDiagnostics(project, input.transitionId),
};

export function queryProject(project, name, input = {}) {
  const query = projectQueries[name];
  if (!query) throw new Error("Unknown query " + name + ".");
  return query(project, input);
}
