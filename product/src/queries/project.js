import { cloneProject } from "../model/project.js";
import { validationResult } from "../model/validation.js";
import { worldTransformMatrix } from "../core/transforms.js";
import { sampleTemporalProgram, sortTemporalProgram } from "../core/temporal.js";
import {
  evaluateTransition,
  getTransitionDiagnostics,
} from "../core/transition-evaluator.js";
import {
  evaluateTransitionExportFrame,
  planTransitionExportFrames,
} from "../core/export-frame-evaluator.js";
import {
  clippingBindingForTarget,
  clippingValidationResult,
} from "../model/clipping-validation.js";
import { warpDeformerValidationResult } from "../model/warp-deformer-validation.js";
import { boneValidationResult } from "../model/bone-validation.js";
import { evaluateBoneFk } from "../core/bone-fk-evaluator.js";
import {
  rigidBoneBindingForTarget,
  rigidBoneBindingValidationResult,
} from "../model/rigid-bone-binding-validation.js";
import {
  skinBindingForTarget,
  skinBindingValidationResult,
} from "../model/skin-binding-validation.js";

function temporalProgram(project, programId) {
  const program = project.temporalPrograms.find((entry) => entry.id === programId);
  if (!program) throw new Error("Unknown TemporalProgram " + programId + ".");
  return program;
}

function keyArtEndpoint(project, keyArtId) {
  const keyArt = project.keyArts.find((entry) => entry.id === keyArtId) || null;
  return {
    id: keyArtId,
    keyArt: keyArt ? {
      ...cloneProject(keyArt),
      members: keyArt.members.map((member) => {
        const node = project.scene.nodes[member.nodeId] || null;
        return {
          ...cloneProject(member),
          node: node ? {
            id: node.id,
            displayName: node.displayName,
            kind: node.kind,
          } : null,
        };
      }),
    } : null,
    missing: !keyArt,
  };
}

function mappingProjection(project, endpoint, mapping) {
  if (!mapping) return { mapping: null, node: null, valid: false, missing: false };
  const node = project.scene.nodes[mapping.nodeId] || null;
  const isMember = Boolean(endpoint.keyArt?.members.some((member) =>
    member.nodeId === mapping.nodeId));
  return {
    mapping: cloneProject(mapping),
    node: node ? {
      id: node.id,
      displayName: node.displayName,
      kind: node.kind,
    } : null,
    valid: Boolean(endpoint.keyArt && node && isMember),
    missing: !endpoint.keyArt || !node || !isMember,
  };
}

function mappingFor(slot, keyArtId) {
  return (slot.mappings || []).find((mapping) =>
    mapping.keyArtId === keyArtId) || null;
}

function mappingStatus(from, to) {
  if (from.missing || to.missing) return "missing-invalid";
  if (from.valid && to.valid) return "mapped";
  if (from.valid) return "a-only";
  if (to.valid) return "b-only";
  return "unmapped";
}

function nextStableVertexId(project, activeTopology) {
  let maximum = 0;
  const used = new Set();
  for (const topology of project.meshTopologies || []) {
    for (const vertexId of topology.vertexIds || []) {
      used.add(vertexId);
      const match = /^vtx_(\d+)$/.exec(vertexId);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
  }
  let sequence = Math.max(
    maximum + 1,
    Number.isSafeInteger(activeTopology?.nextVertexSequence)
      ? activeTopology.nextVertexSequence
      : 1,
  );
  let candidate;
  do {
    candidate = `vtx_${String(sequence++).padStart(4, "0")}`;
  } while (used.has(candidate));
  return candidate;
}

function topologyProjection(project, topology) {
  const vertexMetadata = cloneProject(topology.vertexMetadata || {});
  return {
    ...cloneProject(topology),
    vertexMetadata,
    vertices: topology.vertexIds.map((id, index) => ({
      id,
      index,
      semanticLabel: vertexMetadata[id]?.semanticLabel || null,
    })),
    nextVertexId: nextStableVertexId(project, topology),
  };
}

function explicitMorphReferences(project, transition, slot, part) {
  if (!part?.topologyId || !part.fromKeyformId || !part.toKeyformId) return null;
  const topology = project.meshTopologies.find((entry) => entry.id === part.topologyId);
  const from = project.meshKeyforms.find((entry) => entry.id === part.fromKeyformId);
  const to = project.meshKeyforms.find((entry) => entry.id === part.toKeyformId);
  const valid = topology && from && to &&
    from.topologyId === topology.id && to.topologyId === topology.id &&
    from.keyArtId === transition.fromKeyArtId &&
    to.keyArtId === transition.toKeyArtId &&
    from.semanticSlotId === slot.id && to.semanticSlotId === slot.id;
  return valid ? {
    topologyId: topology.id,
    fromKeyformId: from.id,
    toKeyformId: to.id,
  } : null;
}

function modeAvailability(status, morphReferences) {
  return {
    morph: status === "mapped" && Boolean(morphReferences),
    hold: ["mapped", "a-only", "b-only"].includes(status),
    replace: status === "mapped",
    appear: status === "b-only",
    disappear: status === "a-only",
    occlusion: status === "mapped",
  };
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
      clippingBindings: project.clippingBindings.length,
      deformers: project.rig.deformers.length,
      warpDeformerKeyforms: project.rig.warpDeformerKeyforms.length,
      bones: project.rig.bones.length,
      bonePoseKeyforms: project.rig.bonePoseKeyforms.length,
      rigidBoneBindings: project.rig.rigidBoneBindings.length,
      transitions: project.transitions.length,
      clips: project.animation.clips.length,
      temporalPrograms: project.temporalPrograms.length,
    },
  }),
  "project.validate": (project) => validationResult(project),
  "clipping.get_for_node": (project, input) =>
    cloneProject(clippingBindingForTarget(project, input.nodeId)),
  "clipping.list": (project) => [...project.clippingBindings]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(cloneProject),
  "clipping.validate": (project) => clippingValidationResult(project),
  "deformer.list": (project) => [...project.rig.deformers]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(cloneProject),
  "deformer.get": (project, input) => {
    const deformer = project.rig.deformers.find((entry) => entry.id === input.deformerId);
    if (!deformer) throw new Error(`Unknown WarpDeformer ${input.deformerId}.`);
    return {
      ...cloneProject(deformer),
      controlPoints: deformer.controlPointIds.map((id) => cloneProject(
        project.rig.warpControlPoints.find((entry) => entry.id === id),
      )),
      childNodeIds: [...(project.scene.nodes[deformer.id]?.children || [])],
    };
  },
  "deformer.get_keyform": (project, input) => cloneProject(
    project.rig.warpDeformerKeyforms.find((entry) =>
      entry.deformerId === input.deformerId && entry.keyArtId === input.keyArtId) || null,
  ),
  "deformer.validate": (project) => warpDeformerValidationResult(project),
  "bone.list": (project) => [...project.rig.bones]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((bone) => ({
      ...cloneProject(bone),
      displayName: project.scene.nodes[bone.id]?.displayName || null,
      childBoneIds: (project.scene.nodes[bone.id]?.children || [])
        .filter((id) => project.scene.nodes[id]?.kind === "bone"),
    })),
  "bone.get": (project, input) => {
    const bone = project.rig.bones.find((entry) => entry.id === input.boneId);
    if (!bone) throw new Error(`Unknown Bone ${input.boneId}.`);
    return {
      ...cloneProject(bone),
      displayName: project.scene.nodes[bone.id]?.displayName || null,
      childBoneIds: (project.scene.nodes[bone.id]?.children || [])
        .filter((id) => project.scene.nodes[id]?.kind === "bone"),
    };
  },
  "bone.get_keyform": (project, input) => cloneProject(
    project.rig.bonePoseKeyforms.find((entry) =>
      entry.boneId === input.boneId && entry.keyArtId === input.keyArtId) || null,
  ),
  "bone.get_evaluated_pose": (project, input) => {
    if (!project.rig.bones.some((entry) => entry.id === input.boneId)) {
      throw new Error(`Unknown Bone ${input.boneId}.`);
    }
    if (!project.keyArts.some((entry) => entry.id === input.keyArtId)) {
      throw new Error(`Unknown KeyArt ${input.keyArtId}.`);
    }
    const result = evaluateBoneFk(project, input.keyArtId);
    return {
      pose: cloneProject(
        result.poses.find((entry) => entry.boneId === input.boneId) || null,
      ),
      diagnostics: cloneProject(
        result.diagnostics.filter((entry) => entry.boneId === input.boneId),
      ),
    };
  },
  "bone.validate": (project) => boneValidationResult(project),
  "bone.list_rigid_bindings": (project) => cloneProject(
    [...project.rig.rigidBoneBindings]
      .sort((left, right) => left.id.localeCompare(right.id)),
  ),
  "bone.get_rigid_binding": (project, input) => {
    const binding = project.rig.rigidBoneBindings.find((entry) =>
      entry.id === input.bindingId);
    if (!binding) throw new Error(`Unknown RigidBoneBinding ${input.bindingId}.`);
    return cloneProject(binding);
  },
  "bone.get_rigid_binding_for_target": (project, input) => cloneProject(
    rigidBoneBindingForTarget(project, input.targetNodeId),
  ),
  "bone.validate_rigid_bindings": (project) =>
    rigidBoneBindingValidationResult(project),
  "skin.list_bindings": (project) => cloneProject(
    [...project.rig.skinBindings]
      .sort((left, right) => left.id.localeCompare(right.id)),
  ),
  "skin.get_binding": (project, input) => {
    const binding = project.rig.skinBindings.find((entry) =>
      entry.id === input.bindingId);
    if (!binding) throw new Error(`Unknown SkinBinding ${input.bindingId}.`);
    return cloneProject(binding);
  },
  "skin.get_binding_for_target": (project, input) => cloneProject(
    skinBindingForTarget(project, input.targetNodeId),
  ),
  "skin.get_vertex_weights": (project, input) => {
    const binding = project.rig.skinBindings.find((entry) =>
      entry.id === input.bindingId);
    if (!binding) throw new Error(`Unknown SkinBinding ${input.bindingId}.`);
    return cloneProject(binding.vertexWeights.find((entry) =>
      entry.vertexId === input.vertexId) || null);
  },
  "skin.validate": (project) => skinBindingValidationResult(project),
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
    return topologyProjection(project, topology);
  },
  "mesh.list_topologies": (project) => [...project.meshTopologies]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((topology) => topologyProjection(project, topology)),
  "mesh.get_vertex": (project, input) => {
    const topology = project.meshTopologies.find((entry) => entry.id === input.topologyId);
    if (!topology) throw new Error("Unknown MeshTopology " + input.topologyId + ".");
    const index = topology.vertexIds.indexOf(input.vertexId);
    if (index < 0) throw new Error("Unknown stable vertex " + input.vertexId + ".");
    return topologyProjection(project, topology).vertices[index];
  },
  "mesh.get_keyform": (project, input) => {
    const keyform = project.meshKeyforms.find((entry) => entry.id === input.keyformId);
    if (!keyform) throw new Error("Unknown MeshKeyform " + input.keyformId + ".");
    return cloneProject(keyform);
  },
  "mesh.list_keyforms": (project, input = {}) => project.meshKeyforms
    .filter((entry) => !input.topologyId || entry.topologyId === input.topologyId)
    .filter((entry) => !input.keyArtId || entry.keyArtId === input.keyArtId)
    .filter((entry) => !input.semanticSlotId || entry.semanticSlotId === input.semanticSlotId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(cloneProject),
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
  "transition.get_authoring": (project, input) => {
    const transition = project.transitions.find((entry) => entry.id === input.transitionId);
    if (!transition) throw new Error("Unknown Transition " + input.transitionId + ".");
    const fromEndpoint = keyArtEndpoint(project, transition.fromKeyArtId);
    const toEndpoint = keyArtEndpoint(project, transition.toKeyArtId);
    const semanticSlots = [...project.semanticSlots]
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map((slot) => {
        const from = mappingProjection(
          project,
          fromEndpoint,
          mappingFor(slot, transition.fromKeyArtId),
        );
        const to = mappingProjection(
          project,
          toEndpoint,
          mappingFor(slot, transition.toKeyArtId),
        );
        const status = mappingStatus(from, to);
        const partTransition = transition.partTransitions.find((part) =>
          part.semanticSlotId === slot.id) || null;
        const morphReferences = explicitMorphReferences(
          project,
          transition,
          slot,
          partTransition,
        );
        return {
          ...cloneProject(slot),
          from,
          to,
          status,
          partTransition: cloneProject(partTransition),
          morphReferences,
          availableModes: modeAvailability(status, morphReferences),
        };
      });
    return {
      transition: {
        ...cloneProject(transition),
        durationTicks: temporalProgram(project, transition.temporalProgramId).durationTicks,
      },
      endpoints: { from: fromEndpoint, to: toEndpoint },
      semanticSlots,
    };
  },
  "transition.evaluate": (project, input) =>
    evaluateTransition(project, input.transitionId, input.timeTicks),
  "transition.get_diagnostics": (project, input) =>
    getTransitionDiagnostics(project, input.transitionId),
  "export.get_frame_plan": (project, input) =>
    planTransitionExportFrames(project, input.transitionId, input.frameRate).describe(),
  "export.evaluate_frame": (project, input) =>
    evaluateTransitionExportFrame(project, input),
};

export function queryProject(project, name, input = {}) {
  const query = projectQueries[name];
  if (!query) throw new Error("Unknown query " + name + ".");
  return query(project, input);
}
