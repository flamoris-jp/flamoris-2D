import { validateProject } from "../model/validation.js";

const nonEmptyString = {
  type: "string",
  minLength: 1,
  nonBlank: true,
};

const nodeId = { ...nonEmptyString };
const finiteNumber = { type: "number" };
const nonNegativeInteger = { type: "integer", minimum: 0 };
const positiveInteger = { type: "integer", minimum: 1 };
const temporalObject = { type: "object" };
const domainObject = { type: "object" };
const numberArray = { type: "array", items: finiteNumber };
const vertexIdArray = { type: "array", items: nonEmptyString };
const warpBounds = {
  type: "object",
  required: ["left", "top", "right", "bottom"],
  properties: {
    left: finiteNumber, top: finiteNumber, right: finiteNumber, bottom: finiteNumber,
  },
  additionalProperties: false,
};
const warpControlPointPosition = {
  type: "object",
  required: ["controlPointId", "x", "y"],
  properties: { controlPointId: nonEmptyString, x: finiteNumber, y: finiteNumber },
  additionalProperties: false,
};
const warpControlPointPositions = { type: "array", items: warpControlPointPosition };
const boneLocalTransform = {
  type: "object",
  required: ["x", "y", "rotation"],
  properties: { x: finiteNumber, y: finiteNumber, rotation: finiteNumber },
  additionalProperties: false,
};
const skinInfluence = {
  type: "object",
  required: ["boneId", "weight"],
  properties: {
    boneId: nodeId,
    weight: { type: "number", minimum: Number.MIN_VALUE },
  },
  additionalProperties: false,
};
const skinInfluences = {
  type: "array",
  minItems: 1,
  maxItems: 4,
  items: skinInfluence,
};
const skinVertexWeight = {
  type: "object",
  required: ["vertexId", "influences"],
  properties: { vertexId: nonEmptyString, influences: skinInfluences },
  additionalProperties: false,
};
const skinBinding = {
  type: "object",
  required: ["id", "targetNodeId", "topologyId", "enabled", "vertexWeights"],
  properties: {
    id: nonEmptyString,
    targetNodeId: nodeId,
    topologyId: nonEmptyString,
    enabled: { type: "boolean" },
    vertexWeights: { type: "array", items: skinVertexWeight },
  },
  additionalProperties: false,
};
const meshFormVertexOffset = {
  type: "object",
  required: ["vertexId", "x", "y"],
  properties: { vertexId: nonEmptyString, x: finiteNumber, y: finiteNumber },
  additionalProperties: false,
};
const meshFormVertexOffsets = { type: "array", items: meshFormVertexOffset };
const meshFormCorrectionKeyform = {
  type: "object",
  required: ["id", "topologyId", "keyArtId", "semanticSlotId", "vertexOffsets"],
  properties: {
    id: nonEmptyString,
    topologyId: nonEmptyString,
    keyArtId: nonEmptyString,
    semanticSlotId: nonEmptyString,
    vertexOffsets: meshFormVertexOffsets,
  },
  additionalProperties: false,
};

const clippingBinding = {
  type: "object",
  required: ["id", "targetNodeId", "sourceNodeId", "mode", "enabled"],
  properties: {
    id: nonEmptyString,
    targetNodeId: nodeId,
    sourceNodeId: nodeId,
    mode: { type: "string", const: "inside" },
    enabled: { type: "boolean" },
  },
  additionalProperties: false,
};

const point = {
  type: "object",
  required: ["x", "y"],
  properties: {
    x: finiteNumber,
    y: finiteNumber,
  },
  additionalProperties: false,
};

const transform = {
  type: "object",
  description: "Complete node-local transform replacement.",
  required: ["position", "rotation", "scale", "pivot"],
  properties: {
    position: point,
    rotation: finiteNumber,
    scale: point,
    pivot: point,
  },
  additionalProperties: false,
};

export const commandSchemas = {
  "mesh_form.create_keyform": {
    type: "object",
    required: ["keyform"],
    properties: { keyform: meshFormCorrectionKeyform },
    additionalProperties: false,
  },
  "mesh_form.set_vertex_offsets": {
    type: "object",
    required: ["keyformId", "vertexOffsets"],
    properties: { keyformId: nonEmptyString, vertexOffsets: meshFormVertexOffsets },
    additionalProperties: false,
  },
  "mesh_form.reset_keyform": {
    type: "object",
    required: ["keyformId"],
    properties: { keyformId: nonEmptyString },
    additionalProperties: false,
  },
  "skin.create_binding": {
    type: "object",
    required: ["binding"],
    properties: { binding: skinBinding },
    additionalProperties: false,
  },
  "skin.remove_binding": {
    type: "object",
    required: ["bindingId"],
    properties: { bindingId: nonEmptyString },
    additionalProperties: false,
  },
  "skin.set_enabled": {
    type: "object",
    required: ["bindingId", "enabled"],
    properties: { bindingId: nonEmptyString, enabled: { type: "boolean" } },
    additionalProperties: false,
  },
  "skin.set_vertex_weights": {
    type: "object",
    required: ["bindingId", "vertexId", "influences"],
    properties: {
      bindingId: nonEmptyString,
      vertexId: nonEmptyString,
      influences: skinInfluences,
    },
    additionalProperties: false,
  },
  "skin.set_weights_bulk": {
    type: "object",
    required: ["bindingId", "vertexWeights"],
    properties: {
      bindingId: nonEmptyString,
      vertexWeights: { type: "array", minItems: 1, items: skinVertexWeight },
    },
    additionalProperties: false,
  },
  "skin.clear_vertex_weights": {
    type: "object",
    required: ["bindingId", "vertexId"],
    properties: { bindingId: nonEmptyString, vertexId: nonEmptyString },
    additionalProperties: false,
  },
  "bone.create_rigid_binding": {
    type: "object",
    required: ["binding"],
    properties: {
      binding: {
        type: "object",
        required: ["id", "targetNodeId", "boneId", "enabled"],
        properties: {
          id: nonEmptyString,
          targetNodeId: nodeId,
          boneId: nodeId,
          enabled: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  "bone.set_rigid_binding_bone": {
    type: "object",
    required: ["bindingId", "boneId"],
    properties: { bindingId: nonEmptyString, boneId: nodeId },
    additionalProperties: false,
  },
  "bone.set_rigid_binding_enabled": {
    type: "object",
    required: ["bindingId", "enabled"],
    properties: { bindingId: nonEmptyString, enabled: { type: "boolean" } },
    additionalProperties: false,
  },
  "bone.remove_rigid_binding": {
    type: "object",
    required: ["bindingId"],
    properties: { bindingId: nonEmptyString },
    additionalProperties: false,
  },
  "bone.create": {
    type: "object",
    required: ["id", "displayName", "parentNodeId", "restLocalTransform", "length"],
    properties: {
      id: nonEmptyString,
      displayName: nonEmptyString,
      parentNodeId: nodeId,
      restLocalTransform: boneLocalTransform,
      length: { type: "number", minimum: Number.MIN_VALUE },
      enabled: { type: "boolean" },
      index: nonNegativeInteger,
    },
    additionalProperties: false,
  },
  "bone.remove": {
    type: "object",
    required: ["boneId"],
    properties: { boneId: nonEmptyString },
    additionalProperties: false,
  },
  "bone.rename": {
    type: "object",
    required: ["boneId", "displayName"],
    properties: { boneId: nonEmptyString, displayName: nonEmptyString },
    additionalProperties: false,
  },
  "bone.set_rest": {
    type: "object",
    required: ["boneId", "restLocalTransform", "length"],
    properties: {
      boneId: nonEmptyString,
      restLocalTransform: boneLocalTransform,
      length: { type: "number", minimum: Number.MIN_VALUE },
    },
    additionalProperties: false,
  },
  "bone.set_enabled": {
    type: "object",
    required: ["boneId", "enabled"],
    properties: { boneId: nonEmptyString, enabled: { type: "boolean" } },
    additionalProperties: false,
  },
  "bone.reparent": {
    type: "object",
    required: ["boneId", "parentNodeId"],
    properties: {
      boneId: nonEmptyString,
      parentNodeId: nodeId,
      index: nonNegativeInteger,
    },
    additionalProperties: false,
  },
  "bone.set_keyform": {
    type: "object",
    required: ["boneId", "keyArtId", "localDelta"],
    properties: {
      boneId: nonEmptyString,
      keyArtId: nonEmptyString,
      localDelta: boneLocalTransform,
    },
    additionalProperties: false,
  },
  "bone.reset_keyform": {
    type: "object",
    required: ["boneId", "keyArtId"],
    properties: { boneId: nonEmptyString, keyArtId: nonEmptyString },
    additionalProperties: false,
  },
  "deformer.create_warp": {
    type: "object",
    required: ["id", "displayName", "parentNodeId", "columns", "rows", "bounds", "controlPointIds"],
    properties: {
      id: nonEmptyString,
      displayName: nonEmptyString,
      parentNodeId: nodeId,
      columns: { type: "integer", minimum: 2, maximum: 4 },
      rows: { type: "integer", minimum: 2, maximum: 4 },
      bounds: warpBounds,
      controlPointIds: vertexIdArray,
      index: nonNegativeInteger,
    },
    additionalProperties: false,
  },
  "deformer.remove": {
    type: "object",
    required: ["deformerId"],
    properties: { deformerId: nonEmptyString },
    additionalProperties: false,
  },
  "deformer.rename": {
    type: "object",
    required: ["deformerId", "displayName"],
    properties: { deformerId: nonEmptyString, displayName: nonEmptyString },
    additionalProperties: false,
  },
  "deformer.set_grid": {
    type: "object",
    required: ["deformerId", "columns", "rows", "bounds", "controlPointIds"],
    properties: {
      deformerId: nonEmptyString,
      columns: { type: "integer", minimum: 2, maximum: 4 },
      rows: { type: "integer", minimum: 2, maximum: 4 },
      bounds: warpBounds,
      controlPointIds: vertexIdArray,
    },
    additionalProperties: false,
  },
  "deformer.set_keyform": {
    type: "object",
    required: ["deformerId", "keyArtId", "controlPoints"],
    properties: {
      deformerId: nonEmptyString,
      keyArtId: nonEmptyString,
      controlPoints: warpControlPointPositions,
    },
    additionalProperties: false,
  },
  "deformer.move_control_points": {
    type: "object",
    required: ["deformerId", "keyArtId", "controlPoints"],
    properties: {
      deformerId: nonEmptyString,
      keyArtId: nonEmptyString,
      controlPoints: warpControlPointPositions,
    },
    additionalProperties: false,
  },
  "deformer.reset_control_points": {
    type: "object",
    required: ["deformerId", "keyArtId"],
    properties: { deformerId: nonEmptyString, keyArtId: nonEmptyString },
    additionalProperties: false,
  },
  "deformer.reparent_node": {
    type: "object",
    required: ["nodeId", "parentId"],
    properties: { nodeId, parentId: nodeId, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "clipping.create": {
    type: "object",
    required: ["binding"],
    properties: { binding: clippingBinding },
    additionalProperties: false,
  },
  "clipping.set_source": {
    type: "object",
    required: ["bindingId", "sourceNodeId"],
    properties: { bindingId: nonEmptyString, sourceNodeId: nodeId },
    additionalProperties: false,
  },
  "clipping.set_enabled": {
    type: "object",
    required: ["bindingId", "enabled"],
    properties: { bindingId: nonEmptyString, enabled: { type: "boolean" } },
    additionalProperties: false,
  },
  "clipping.remove": {
    type: "object",
    required: ["bindingId"],
    properties: { bindingId: nonEmptyString },
    additionalProperties: false,
  },
  "keyart.create": {
    type: "object",
    required: ["keyArt"],
    properties: { keyArt: domainObject },
    additionalProperties: false,
  },
  "keyart.update": {
    type: "object",
    required: ["keyArtId", "keyArt"],
    properties: { keyArtId: nonEmptyString, keyArt: domainObject },
    additionalProperties: false,
  },
  "keyart.remove": {
    type: "object",
    required: ["keyArtId"],
    properties: { keyArtId: nonEmptyString },
    additionalProperties: false,
  },
  "semantic_slot.create": {
    type: "object",
    required: ["semanticSlot"],
    properties: { semanticSlot: domainObject },
    additionalProperties: false,
  },
  "semantic_slot.update": {
    type: "object",
    required: ["semanticSlotId", "semanticSlot"],
    properties: { semanticSlotId: nonEmptyString, semanticSlot: domainObject },
    additionalProperties: false,
  },
  "semantic_slot.remove": {
    type: "object",
    required: ["semanticSlotId"],
    properties: { semanticSlotId: nonEmptyString },
    additionalProperties: false,
  },
  "semantic_slot.map_node": {
    type: "object",
    required: ["semanticSlotId", "keyArtId", "nodeId"],
    properties: { semanticSlotId: nonEmptyString, keyArtId: nonEmptyString, nodeId },
    additionalProperties: false,
  },
  "semantic_slot.unmap_node": {
    type: "object",
    required: ["semanticSlotId", "keyArtId"],
    properties: { semanticSlotId: nonEmptyString, keyArtId: nonEmptyString },
    additionalProperties: false,
  },
  "mesh_topology.create": {
    type: "object",
    required: ["topology"],
    properties: { topology: domainObject },
    additionalProperties: false,
  },
  "mesh_topology.update": {
    type: "object",
    required: ["topologyId", "topology"],
    properties: { topologyId: nonEmptyString, topology: domainObject },
    additionalProperties: false,
  },
  "mesh_topology.remove": {
    type: "object",
    required: ["topologyId"],
    properties: { topologyId: nonEmptyString },
    additionalProperties: false,
  },
  "mesh_topology.add_vertex": {
    type: "object",
    required: ["topologyId", "vertexId", "position", "uv"],
    properties: {
      topologyId: nonEmptyString,
      vertexId: nonEmptyString,
      position: point,
      uv: point,
      semanticLabel: nonEmptyString,
    },
    additionalProperties: false,
  },
  "mesh_topology.remove_vertex": {
    type: "object",
    required: ["topologyId", "vertexId"],
    properties: { topologyId: nonEmptyString, vertexId: nonEmptyString },
    additionalProperties: false,
  },
  "mesh_topology.create_triangle": {
    type: "object",
    required: ["topologyId", "vertexIds"],
    properties: {
      topologyId: nonEmptyString,
      vertexIds: { ...vertexIdArray, minItems: 3, maxItems: 3 },
    },
    additionalProperties: false,
  },
  "mesh_topology.subdivide_edge": {
    type: "object",
    required: ["topologyId", "vertexIds", "newVertexId"],
    properties: {
      topologyId: nonEmptyString,
      vertexIds: { ...vertexIdArray, minItems: 2, maxItems: 2 },
      newVertexId: nonEmptyString,
    },
    additionalProperties: false,
  },
  "mesh_topology.set_vertex_label": {
    type: "object",
    required: ["topologyId", "vertexId", "semanticLabel"],
    properties: {
      topologyId: nonEmptyString,
      vertexId: nonEmptyString,
      semanticLabel: nonEmptyString,
    },
    additionalProperties: false,
  },
  "mesh_topology.clear_vertex_label": {
    type: "object",
    required: ["topologyId", "vertexId"],
    properties: { topologyId: nonEmptyString, vertexId: nonEmptyString },
    additionalProperties: false,
  },
  "mesh_topology.apply_generated_mesh": {
    type: "object",
    required: ["topologyId", "vertexIds", "indices", "positions", "uvs", "replaceExisting"],
    properties: {
      topologyId: nonEmptyString,
      vertexIds: { ...vertexIdArray, minItems: 3 },
      indices: numberArray,
      positions: numberArray,
      uvs: numberArray,
      replaceExisting: { type: "boolean" },
    },
    additionalProperties: false,
  },
  "mesh_keyform.create": {
    type: "object",
    required: ["keyform"],
    properties: { keyform: domainObject },
    additionalProperties: false,
  },
  "mesh_keyform.update": {
    type: "object",
    required: ["keyformId", "keyform"],
    properties: { keyformId: nonEmptyString, keyform: domainObject },
    additionalProperties: false,
  },
  "mesh_keyform.remove": {
    type: "object",
    required: ["keyformId"],
    properties: { keyformId: nonEmptyString },
    additionalProperties: false,
  },
  "mesh_keyform.move_vertices": {
    type: "object",
    required: ["keyformId", "positions"],
    properties: { keyformId: nonEmptyString, positions: numberArray },
    additionalProperties: false,
  },
  "transition.create": {
    type: "object",
    required: ["transition"],
    properties: { transition: domainObject },
    additionalProperties: false,
  },
  "transition.update": {
    type: "object",
    required: ["transitionId", "transition"],
    properties: { transitionId: nonEmptyString, transition: domainObject },
    additionalProperties: false,
  },
  "transition.remove": {
    type: "object",
    required: ["transitionId"],
    properties: { transitionId: nonEmptyString },
    additionalProperties: false,
  },
  "transition.set_part_mode": {
    type: "object",
    required: ["transitionId", "partTransitionId", "semanticSlotId", "mode"],
    properties: {
      transitionId: nonEmptyString,
      partTransitionId: nonEmptyString,
      semanticSlotId: nonEmptyString,
      mode: { type: "string", enum: ["morph", "hold", "replace", "appear", "disappear", "occlusion"] },
      configuration: domainObject,
    },
    additionalProperties: false,
  },
  "transition.set_part_topology": {
    type: "object",
    required: ["transitionId", "semanticSlotId", "topologyId", "fromKeyformId", "toKeyformId"],
    properties: {
      transitionId: nonEmptyString,
      semanticSlotId: nonEmptyString,
      topologyId: nonEmptyString,
      fromKeyformId: nonEmptyString,
      toKeyformId: nonEmptyString,
    },
    additionalProperties: false,
  },
  "transition.set_diagnostic_override": {
    type: "object",
    required: ["transitionId", "override"],
    properties: { transitionId: nonEmptyString, override: domainObject },
    additionalProperties: false,
  },
  "transition.clear_diagnostic_override": {
    type: "object",
    required: ["transitionId", "key"],
    properties: { transitionId: nonEmptyString, key: nonEmptyString },
    additionalProperties: false,
  },
  "animation.temporal.create_program": {
    type: "object",
    required: ["programId", "durationTicks"],
    properties: { programId: nonEmptyString, durationTicks: positiveInteger },
    additionalProperties: false,
  },
  "animation.temporal.set_duration": {
    type: "object",
    required: ["programId", "durationTicks"],
    properties: { programId: nonEmptyString, durationTicks: positiveInteger },
    additionalProperties: false,
  },
  "animation.temporal.add_track": {
    type: "object",
    required: ["programId", "track"],
    properties: { programId: nonEmptyString, track: temporalObject },
    additionalProperties: false,
  },
  "animation.temporal.add_keyframe": {
    type: "object",
    required: ["programId", "trackId", "channel", "keyframe"],
    properties: {
      programId: nonEmptyString,
      trackId: nonEmptyString,
      channel: nonEmptyString,
      keyframe: temporalObject,
    },
    additionalProperties: false,
  },
  "animation.temporal.update_keyframe": {
    type: "object",
    required: ["programId", "trackId", "channel", "keyframeId", "keyframe"],
    properties: {
      programId: nonEmptyString,
      trackId: nonEmptyString,
      channel: nonEmptyString,
      keyframeId: nonEmptyString,
      keyframe: temporalObject,
    },
    additionalProperties: false,
  },
  "animation.temporal.remove_keyframe": {
    type: "object",
    required: ["programId", "trackId", "channel", "keyframeId"],
    properties: {
      programId: nonEmptyString,
      trackId: nonEmptyString,
      channel: nonEmptyString,
      keyframeId: nonEmptyString,
    },
    additionalProperties: false,
  },
  "animation.temporal.add_event": {
    type: "object",
    required: ["programId", "event"],
    properties: { programId: nonEmptyString, event: temporalObject },
    additionalProperties: false,
  },
  "animation.temporal.add_region": {
    type: "object",
    required: ["programId", "region"],
    properties: { programId: nonEmptyString, region: temporalObject },
    additionalProperties: false,
  },
  "source.apply_psd_reimport": {
    type: "object",
    required: ["project"],
    properties: {
      project: {
        type: "object",
        description: "Complete validated Project produced by reviewed PSD reconciliation.",
        projectSchema: true,
      },
    },
    additionalProperties: false,
  },
  "scene.rename_node": {
    type: "object",
    required: ["nodeId", "displayName"],
    properties: {
      nodeId,
      displayName: nonEmptyString,
    },
    additionalProperties: false,
  },
  "scene.set_transform": {
    type: "object",
    description: "Replaces every transform field in node-local coordinates.",
    required: ["nodeId", "coordinateSpace", "transform"],
    properties: {
      nodeId,
      coordinateSpace: {
        type: "string",
        const: "node-local",
      },
      transform,
    },
    additionalProperties: false,
  },
  "scene.set_visibility": {
    type: "object",
    required: ["nodeId", "visible"],
    properties: {
      nodeId,
      visible: { type: "boolean" },
    },
    additionalProperties: false,
  },
  "scene.set_locked": {
    type: "object",
    required: ["nodeId", "locked"],
    properties: {
      nodeId,
      locked: { type: "boolean" },
    },
    additionalProperties: false,
  },
  "scene.create_group": {
    type: "object",
    required: ["id", "parentId", "displayName"],
    properties: {
      id: nodeId,
      parentId: nodeId,
      displayName: nonEmptyString,
      index: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  "scene.reparent_node": {
    type: "object",
    required: ["nodeId", "parentId"],
    properties: {
      nodeId,
      parentId: nodeId,
      index: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
};

function entityRemovalSchema() {
  return {
    type: "object",
    required: ["id"],
    properties: { id: nonEmptyString },
    additionalProperties: false,
  };
}

function entityRestoreSchema() {
  return {
    type: "object",
    required: ["entity", "index"],
    properties: { entity: domainObject, index: nonNegativeInteger },
    additionalProperties: false,
  };
}

const internalCommandSchemas = {
  "mesh_form.remove_keyform_internal": {
    type: "object",
    required: ["keyformId"],
    properties: { keyformId: nonEmptyString },
    additionalProperties: false,
  },
  "mesh_form.restore_keyform": {
    type: "object",
    required: ["keyform", "index"],
    properties: { keyform: meshFormCorrectionKeyform, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "bone.remove_rigid_binding_internal": {
    type: "object",
    required: ["bindingId"],
    properties: { bindingId: nonEmptyString },
    additionalProperties: false,
  },
  "bone.restore_rigid_binding": {
    type: "object",
    required: ["binding", "index"],
    properties: { binding: domainObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "skin.remove_binding_internal": {
    type: "object",
    required: ["bindingId"],
    properties: { bindingId: nonEmptyString },
    additionalProperties: false,
  },
  "skin.restore_binding": {
    type: "object",
    required: ["binding", "index"],
    properties: { binding: skinBinding, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "bone.remove_internal": {
    type: "object",
    required: ["boneId"],
    properties: { boneId: nonEmptyString },
    additionalProperties: false,
  },
  "bone.remove_keyform_internal": {
    type: "object",
    required: ["boneId", "keyArtId"],
    properties: { boneId: nonEmptyString, keyArtId: nonEmptyString },
    additionalProperties: false,
  },
  "bone.restore": {
    type: "object",
    required: ["snapshot"],
    properties: { snapshot: domainObject },
    additionalProperties: false,
  },
  "deformer.remove_internal": {
    type: "object",
    required: ["deformerId"],
    properties: { deformerId: nonEmptyString },
    additionalProperties: false,
  },
  "deformer.remove_keyform_internal": {
    type: "object",
    required: ["deformerId", "keyArtId"],
    properties: { deformerId: nonEmptyString, keyArtId: nonEmptyString },
    additionalProperties: false,
  },
  "deformer.restore": {
    type: "object",
    required: ["snapshot"],
    properties: { snapshot: domainObject },
    additionalProperties: false,
  },
  "clipping.remove_internal": {
    type: "object",
    required: ["bindingId"],
    properties: { bindingId: nonEmptyString },
    additionalProperties: false,
  },
  "clipping.restore": {
    type: "object",
    required: ["binding", "index"],
    properties: { binding: clippingBinding, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "keyArts.remove_internal": entityRemovalSchema(),
  "keyart.restore": entityRestoreSchema(),
  "semanticSlots.remove_internal": entityRemovalSchema(),
  "semantic_slot.restore": entityRestoreSchema(),
  "semantic_slot.restore_mapping": {
    type: "object",
    required: ["semanticSlotId", "mapping", "index"],
    properties: { semanticSlotId: nonEmptyString, mapping: domainObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "meshTopologies.remove_internal": entityRemovalSchema(),
  "mesh_topology.restore": entityRestoreSchema(),
  "mesh_topology.restore_snapshot": {
    type: "object",
    required: ["snapshot"],
    properties: { snapshot: domainObject },
    additionalProperties: false,
  },
  "meshKeyforms.remove_internal": entityRemovalSchema(),
  "mesh_keyform.restore": entityRestoreSchema(),
  "transitions.remove_internal": entityRemovalSchema(),
  "transition.restore": entityRestoreSchema(),
  "transition.remove_part": {
    type: "object",
    required: ["transitionId", "semanticSlotId"],
    properties: { transitionId: nonEmptyString, semanticSlotId: nonEmptyString },
    additionalProperties: false,
  },
  "transition.restore_part": {
    type: "object",
    required: ["transitionId", "part", "index"],
    properties: { transitionId: nonEmptyString, part: domainObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "animation.temporal.remove_program": {
    type: "object",
    required: ["programId"],
    properties: { programId: nonEmptyString },
    additionalProperties: false,
  },
  "animation.temporal.restore_program": {
    type: "object",
    required: ["program", "index"],
    properties: { program: temporalObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "animation.temporal.remove_track": {
    type: "object",
    required: ["programId", "trackId"],
    properties: { programId: nonEmptyString, trackId: nonEmptyString },
    additionalProperties: false,
  },
  "animation.temporal.restore_track": {
    type: "object",
    required: ["programId", "track", "index"],
    properties: { programId: nonEmptyString, track: temporalObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "animation.temporal.restore_keyframe": {
    type: "object",
    required: ["programId", "trackId", "channel", "keyframe", "index"],
    properties: {
      programId: nonEmptyString,
      trackId: nonEmptyString,
      channel: nonEmptyString,
      keyframe: temporalObject,
      index: nonNegativeInteger,
    },
    additionalProperties: false,
  },
  "animation.temporal.remove_event": {
    type: "object",
    required: ["programId", "eventId"],
    properties: { programId: nonEmptyString, eventId: nonEmptyString },
    additionalProperties: false,
  },
  "animation.temporal.restore_event": {
    type: "object",
    required: ["programId", "event", "index"],
    properties: { programId: nonEmptyString, event: temporalObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "animation.temporal.remove_region": {
    type: "object",
    required: ["programId", "regionId"],
    properties: { programId: nonEmptyString, regionId: nonEmptyString },
    additionalProperties: false,
  },
  "animation.temporal.restore_region": {
    type: "object",
    required: ["programId", "region", "index"],
    properties: { programId: nonEmptyString, region: temporalObject, index: nonNegativeInteger },
    additionalProperties: false,
  },
  "scene.remove_empty_group": {
    type: "object",
    required: ["nodeId"],
    properties: { nodeId },
    additionalProperties: false,
  },
};

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") {
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value);
  }
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === type;
}

function validateValue(value, schema, path, issues) {
  if (!matchesType(value, schema.type)) {
    issues.push({
      code: "command.payload_type",
      path,
      message: "Expected " + schema.type + ", received " + actualType(value) + ".",
    });
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    issues.push({
      code: "command.payload_const",
      path,
      message: "Expected " + JSON.stringify(schema.const) + ".",
    });
  }
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push({
      code: "command.payload_enum",
      path,
      message: "Value is not one of the supported literals.",
    });
  }
  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({
        code: "command.payload_min_length",
        path,
        message: "String is shorter than " + schema.minLength + ".",
      });
    }
    if (schema.nonBlank && !value.trim()) {
      issues.push({
        code: "command.payload_blank",
        path,
        message: "String must not be blank.",
      });
    }
  }
  if (
    (schema.type === "number" || schema.type === "integer") &&
    schema.minimum !== undefined &&
    value < schema.minimum
  ) {
    issues.push({
      code: "command.payload_minimum",
      path,
      message: "Value must be at least " + schema.minimum + ".",
    });
  }
  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({
        code: "command.payload_min_items",
        path,
        message: "Array has fewer than " + schema.minItems + " items.",
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({
        code: "command.payload_max_items",
        path,
        message: "Array has more than " + schema.maxItems + " items.",
      });
    }
    if (schema.items) {
      value.forEach((entry, index) =>
        validateValue(entry, schema.items, path + "." + index, issues));
    }
    return;
  }
  if (schema.type !== "object") return;

  if (schema.projectSchema) {
    for (const entry of validateProject(value)) {
      if (entry.severity !== "error") continue;
      issues.push({
        code: "command.project_invalid",
        path: `${path}.${entry.path}`,
        message: entry.message,
      });
    }
    return;
  }

  const properties = schema.properties || {};
  for (const required of schema.required || []) {
    if (!Object.hasOwn(value, required)) {
      issues.push({
        code: "command.payload_required",
        path: path + "." + required,
        message: "Required field is missing.",
      });
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        issues.push({
          code: "command.payload_unknown_field",
          path: path + "." + key,
          message: "Unknown field.",
        });
      }
    }
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      validateValue(value[key], childSchema, path + "." + key, issues);
    }
  }
}

export function validateCommand(command, { allowInternal = false } = {}) {
  const issues = [];
  if (
    command === null ||
    typeof command !== "object" ||
    Array.isArray(command)
  ) {
    return [{
      code: "command.invalid_envelope",
      path: "$",
      message: "Command must be an object.",
    }];
  }
  for (const key of Object.keys(command)) {
    if (key !== "type" && key !== "payload") {
      issues.push({
        code: "command.unknown_field",
        path: "$." + key,
        message: "Unknown command field.",
      });
    }
  }
  if (typeof command.type !== "string" || !command.type) {
    issues.push({
      code: "command.missing_type",
      path: "$.type",
      message: "Command type is required.",
    });
    return issues;
  }
  const schema = commandSchemas[command.type] ||
    (allowInternal ? internalCommandSchemas[command.type] : null);
  if (!schema) {
    issues.push({
      code: "command.unknown_type",
      path: "$.type",
      message: "Unknown command type " + command.type + ".",
    });
    return issues;
  }
  if (!Object.hasOwn(command, "payload")) {
    issues.push({
      code: "command.missing_payload",
      path: "$.payload",
      message: "Command payload is required.",
    });
    return issues;
  }
  validateValue(command.payload, schema, "$.payload", issues);
  return issues;
}
