import { cloneProject, createSceneNode } from "../model/project.js";
import {
  createRegularWarpControlPoints,
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../model/warp-deformer.js";
import { CommandError } from "./errors.js";
import { sceneCommandHandlers } from "./scene-command-handlers.js";

function deformerFor(project, deformerId) {
  const deformer = project.rig.deformers.find((entry) => entry.id === deformerId);
  if (!deformer) throw new CommandError("WarpDeformer does not exist.", "deformer.not_found", { deformerId });
  return deformer;
}

function keyformIndex(project, deformerId, keyArtId) {
  return project.rig.warpDeformerKeyforms.findIndex((entry) =>
    entry.deformerId === deformerId && entry.keyArtId === keyArtId);
}

function assertControlPointIds(deformer, controlPoints, { complete = false } = {}) {
  const seen = new Set();
  for (const point of controlPoints) {
    const controlPointId = point.controlPointId;
    if (!deformer.controlPointIds.includes(controlPointId)) {
      throw new CommandError("Warp control point does not belong to this topology.",
        "deformer.control_point_not_found", { deformerId: deformer.id, controlPointId });
    }
    if (seen.has(controlPointId)) {
      throw new CommandError("Warp control point may appear only once per mutation.",
        "deformer.duplicate_control_point", { deformerId: deformer.id, controlPointId });
    }
    seen.add(controlPointId);
  }
  if (complete && seen.size !== deformer.controlPointIds.length) {
    throw new CommandError("Warp keyform must provide every topology control point.",
      "DEFORMER_KEYFORM_INCOMPATIBLE", { deformerId: deformer.id });
  }
}

function orderedKeyform(deformer, keyform) {
  const byId = new Map((keyform.controlPoints || []).map((point) => [point.controlPointId, point]));
  return {
    deformerId: deformer.id,
    keyArtId: keyform.keyArtId,
    controlPoints: deformer.controlPointIds.map((controlPointId) => {
      const point = byId.get(controlPointId);
      return point ? cloneProject(point) : { controlPointId, x: Number.NaN, y: Number.NaN };
    }),
  };
}

function removeDeformer(project, deformerId) {
  const deformer = deformerFor(project, deformerId);
  const node = project.scene.nodes[deformerId];
  if (!node) throw new CommandError("DeformerNode does not exist.", "deformer.node_not_found", { deformerId });
  const parent = project.scene.nodes[node.parentId];
  const nodeIndex = parent.children.indexOf(node.id);
  const deformerIndex = project.rig.deformers.indexOf(deformer);
  const controlPoints = project.rig.warpControlPoints
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.deformerId === deformerId);
  const keyforms = project.rig.warpDeformerKeyforms
    .map((keyform, index) => ({ keyform, index }))
    .filter(({ keyform }) => keyform.deformerId === deformerId);
  const snapshot = {
    node: cloneProject(node), nodeIndex, deformer: cloneProject(deformer), deformerIndex,
    controlPoints: cloneProject(controlPoints), keyforms: cloneProject(keyforms),
  };

  parent.children.splice(nodeIndex, 1, ...node.children);
  for (const childId of node.children) {
    project.scene.nodes[childId].parentId = parent.id;
    const childDeformer = project.rig.deformers.find((entry) => entry.id === childId);
    if (childDeformer) childDeformer.parentNodeId = parent.id;
  }
  delete project.scene.nodes[node.id];
  project.rig.deformers.splice(deformerIndex, 1);
  project.rig.warpControlPoints = project.rig.warpControlPoints
    .filter((point) => point.deformerId !== deformerId);
  project.rig.warpDeformerKeyforms = project.rig.warpDeformerKeyforms
    .filter((keyform) => keyform.deformerId !== deformerId);
  return {
    inverse: { type: "deformer.restore", payload: { snapshot } },
    affectedIds: [parent.id, deformerId, ...node.children, ...deformer.controlPointIds],
  };
}

export const warpDeformerCommandHandlers = {
  "deformer.create_warp": (project, payload) => {
    if (project.scene.nodes[payload.id] || project.rig.deformers.some(({ id }) => id === payload.id)) {
      throw new CommandError("Stable ID already exists.", "identity.duplicate", { id: payload.id });
    }
    const parent = project.scene.nodes[payload.parentNodeId];
    if (!parent) throw new CommandError("Parent node does not exist.", "DEFORMER_PARENT_MISSING");
    if (!new Set(["group", "deformer"]).has(parent.kind)) {
      throw new CommandError("WarpDeformer parent must be a GroupNode or DeformerNode.", "scene.invalid_parent_kind");
    }
    const created = createWarpDeformer(payload);
    const node = createSceneNode({
      id: payload.id,
      kind: "deformer",
      displayName: payload.displayName,
      parentId: parent.id,
    });
    project.scene.nodes[node.id] = node;
    const index = payload.index == null ? parent.children.length : Math.min(payload.index, parent.children.length);
    parent.children.splice(index, 0, node.id);
    project.rig.deformers.push(created.deformer);
    project.rig.warpControlPoints.push(...created.controlPoints);
    return {
      inverse: { type: "deformer.remove_internal", payload: { deformerId: node.id } },
      affectedIds: [parent.id, node.id, ...payload.controlPointIds],
    };
  },

  "deformer.remove": (project, payload) => removeDeformer(project, payload.deformerId),
  "deformer.remove_internal": (project, payload) => removeDeformer(project, payload.deformerId),

  "deformer.restore": (project, payload) => {
    const saved = cloneProject(payload.snapshot);
    const parent = project.scene.nodes[saved.node.parentId];
    for (const childId of saved.node.children) {
      const index = parent.children.indexOf(childId);
      if (index >= 0) parent.children.splice(index, 1);
      project.scene.nodes[childId].parentId = saved.node.id;
      const childDeformer = project.rig.deformers.find((entry) => entry.id === childId);
      if (childDeformer) childDeformer.parentNodeId = saved.node.id;
    }
    parent.children.splice(saved.nodeIndex, 0, saved.node.id);
    project.scene.nodes[saved.node.id] = saved.node;
    project.rig.deformers.splice(saved.deformerIndex, 0, saved.deformer);
    for (const { point, index } of saved.controlPoints.sort((a, b) => a.index - b.index)) {
      project.rig.warpControlPoints.splice(index, 0, point);
    }
    for (const { keyform, index } of saved.keyforms.sort((a, b) => a.index - b.index)) {
      project.rig.warpDeformerKeyforms.splice(index, 0, keyform);
    }
    return {
      inverse: { type: "deformer.remove_internal", payload: { deformerId: saved.deformer.id } },
      affectedIds: [parent.id, saved.deformer.id, ...saved.node.children, ...saved.deformer.controlPointIds],
    };
  },

  "deformer.rename": (project, payload) => {
    const deformer = deformerFor(project, payload.deformerId);
    const previous = deformer.displayName;
    deformer.displayName = payload.displayName.trim();
    project.scene.nodes[deformer.id].displayName = deformer.displayName;
    return {
      inverse: { type: "deformer.rename", payload: { deformerId: deformer.id, displayName: previous } },
      affectedIds: [deformer.id],
    };
  },

  "deformer.set_grid": (project, payload) => {
    const deformer = deformerFor(project, payload.deformerId);
    if (project.rig.warpDeformerKeyforms.some((entry) => entry.deformerId === deformer.id)) {
      throw new CommandError("Remove authored keyforms before changing Warp topology.",
        "DEFORMER_KEYFORM_INCOMPATIBLE", { deformerId: deformer.id });
    }
    const previous = {
      columns: deformer.columns, rows: deformer.rows, bounds: cloneProject(deformer.bounds),
      controlPointIds: [...deformer.controlPointIds],
    };
    project.rig.warpControlPoints = project.rig.warpControlPoints
      .filter((point) => point.deformerId !== deformer.id);
    Object.assign(deformer, {
      columns: payload.columns, rows: payload.rows, bounds: cloneProject(payload.bounds),
      controlPointIds: [...payload.controlPointIds],
    });
    project.rig.warpControlPoints.push(...createRegularWarpControlPoints({
      deformerId: deformer.id,
      columns: payload.columns,
      rows: payload.rows,
      controlPointIds: payload.controlPointIds,
    }));
    return {
      inverse: { type: "deformer.set_grid", payload: { deformerId: deformer.id, ...previous } },
      affectedIds: [deformer.id, ...previous.controlPointIds, ...payload.controlPointIds],
    };
  },

  "deformer.set_keyform": (project, payload) => {
    const deformer = deformerFor(project, payload.deformerId);
    assertControlPointIds(deformer, payload.controlPoints, { complete: true });
    const index = keyformIndex(project, deformer.id, payload.keyArtId);
    const previous = index >= 0 ? cloneProject(project.rig.warpDeformerKeyforms[index]) : null;
    const next = orderedKeyform(deformer, {
      keyArtId: payload.keyArtId,
      controlPoints: payload.controlPoints,
    });
    if (index >= 0) project.rig.warpDeformerKeyforms[index] = next;
    else project.rig.warpDeformerKeyforms.push(next);
    return {
      inverse: previous
        ? { type: "deformer.set_keyform", payload: previous }
        : { type: "deformer.remove_keyform_internal", payload: {
          deformerId: deformer.id, keyArtId: payload.keyArtId,
        } },
      affectedIds: [deformer.id, payload.keyArtId, ...deformer.controlPointIds],
    };
  },

  "deformer.remove_keyform_internal": (project, payload) => {
    const index = keyformIndex(project, payload.deformerId, payload.keyArtId);
    if (index < 0) throw new CommandError("Warp keyform does not exist.", "deformer.keyform_not_found");
    const previous = project.rig.warpDeformerKeyforms.splice(index, 1)[0];
    return {
      inverse: { type: "deformer.set_keyform", payload: previous },
      affectedIds: [payload.deformerId, payload.keyArtId],
    };
  },

  "deformer.move_control_points": (project, payload) => {
    const deformer = deformerFor(project, payload.deformerId);
    assertControlPointIds(deformer, payload.controlPoints);
    const index = keyformIndex(project, deformer.id, payload.keyArtId);
    if (index < 0) throw new CommandError("Warp keyform does not exist.", "deformer.keyform_not_found");
    const previous = cloneProject(project.rig.warpDeformerKeyforms[index]);
    const updates = new Map(payload.controlPoints.map((point) => [point.controlPointId, point]));
    const next = previous.controlPoints.map((point) => updates.has(point.controlPointId)
      ? cloneProject(updates.get(point.controlPointId)) : point);
    project.rig.warpDeformerKeyforms[index] = orderedKeyform(deformer, {
      keyArtId: payload.keyArtId, controlPoints: next,
    });
    return {
      inverse: { type: "deformer.set_keyform", payload: previous },
      affectedIds: [deformer.id, payload.keyArtId, ...updates.keys()],
    };
  },

  "deformer.reset_control_points": (project, payload) => {
    const deformer = deformerFor(project, payload.deformerId);
    const points = project.rig.warpControlPoints.filter((point) => point.deformerId === deformer.id);
    return warpDeformerCommandHandlers["deformer.set_keyform"](project, {
      deformerId: deformer.id,
      keyArtId: payload.keyArtId,
      controlPoints: defaultWarpKeyformControlPoints(deformer, points),
    });
  },

  "deformer.reparent_node": (project, payload) =>
    sceneCommandHandlers["scene.reparent_node"](project, payload),
};
