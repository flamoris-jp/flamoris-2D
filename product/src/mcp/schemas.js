export { commandSchemas } from "../commands/schemas.js";

export const MCP_SCHEMA_VERSION = 15;

const nodeId = {
  type: "string",
  minLength: 1,
};

const programId = { ...nodeId };
const transitionId = { ...nodeId };
const sequenceId = { ...nodeId };
const keyArtId = { ...nodeId };
const semanticSlotId = { ...nodeId };

export const querySchemas = {
  "bone.list_two_bone_ik": emptyQuery(),
  "bone.get_two_bone_ik": idQuery("constraintId", nodeId),
  "bone.validate_two_bone_ik": emptyQuery(),
  "bone.get_two_bone_ik_pose": {
    type: "object",
    required: ["constraintId", "keyArtId"],
    properties: { constraintId: nodeId, keyArtId },
    additionalProperties: false,
  },
  "bone.solve_two_bone_ik": {
    type: "object",
    required: ["constraintId", "keyArtId", "target"],
    properties: {
      constraintId: nodeId,
      keyArtId,
      target: { type: "object", required: ["x", "y"],
        properties: { x: { type: "number" }, y: { type: "number" } },
        additionalProperties: false },
    },
    additionalProperties: false,
  },
  "bone.list_rotation_constraints": emptyQuery(),
  "bone.get_rotation_constraint": idQuery("constraintId", nodeId),
  "bone.get_rotation_constraint_for_bone": idQuery("boneId", nodeId),
  "bone.validate_rotation_constraints": emptyQuery(),
  "mesh_form.list_keyforms": {
    type: "object",
    properties: { topologyId: nodeId, keyArtId, semanticSlotId },
    additionalProperties: false,
  },
  "mesh_form.get_keyform": idQuery("keyformId", nodeId),
  "mesh_form.get_for_context": {
    type: "object",
    required: ["topologyId", "keyArtId", "semanticSlotId"],
    properties: { topologyId: nodeId, keyArtId, semanticSlotId },
    additionalProperties: false,
  },
  "mesh_form.validate": emptyQuery(),
  "mesh_form.evaluate": {
    type: "object",
    required: ["topologyId", "positions"],
    properties: {
      topologyId: nodeId,
      keyformId: nodeId,
      positions: { type: "array", items: { type: "number" } },
    },
    additionalProperties: false,
  },
  "skin.list_bindings": emptyQuery(),
  "skin.get_binding": idQuery("bindingId", nodeId),
  "skin.get_binding_for_target": idQuery("targetNodeId", nodeId),
  "skin.get_vertex_weights": {
    type: "object",
    required: ["bindingId", "vertexId"],
    properties: { bindingId: nodeId, vertexId: nodeId },
    additionalProperties: false,
  },
  "skin.validate": emptyQuery(),
  "skin.evaluate": {
    type: "object",
    required: ["bindingId", "keyArtId", "positions"],
    properties: {
      bindingId: nodeId,
      keyArtId,
      positions: { type: "array", items: { type: "number" } },
    },
    additionalProperties: false,
  },
  "bone.list": emptyQuery(),
  "bone.get": idQuery("boneId", nodeId),
  "bone.get_keyform": {
    type: "object",
    required: ["boneId", "keyArtId"],
    properties: { boneId: nodeId, keyArtId },
    additionalProperties: false,
  },
  "bone.get_evaluated_pose": {
    type: "object",
    required: ["boneId", "keyArtId"],
    properties: { boneId: nodeId, keyArtId },
    additionalProperties: false,
  },
  "bone.validate": emptyQuery(),
  "bone.list_rigid_bindings": emptyQuery(),
  "bone.get_rigid_binding": idQuery("bindingId", nodeId),
  "bone.get_rigid_binding_for_target": idQuery("targetNodeId", nodeId),
  "bone.validate_rigid_bindings": emptyQuery(),
  "deformer.list": emptyQuery(),
  "deformer.get": idQuery("deformerId", nodeId),
  "deformer.get_keyform": {
    type: "object",
    required: ["deformerId", "keyArtId"],
    properties: { deformerId: nodeId, keyArtId },
    additionalProperties: false,
  },
  "deformer.validate": emptyQuery(),
  "clipping.get_for_node": idQuery("nodeId", nodeId),
  "clipping.list": emptyQuery(),
  "clipping.validate": emptyQuery(),
  "keyart.get": idQuery("keyArtId", keyArtId),
  "keyart.list": emptyQuery(),
  "semantic_slot.get": idQuery("semanticSlotId", semanticSlotId),
  "semantic_slot.list": emptyQuery(),
  "semantic_slot.get_mapping": {
    type: "object",
    required: ["semanticSlotId", "keyArtId"],
    properties: { semanticSlotId, keyArtId },
    additionalProperties: false,
  },
  "mesh.get_topology": idQuery("topologyId", nodeId),
  "mesh.get_vertex": {
    type: "object",
    required: ["topologyId", "vertexId"],
    properties: { topologyId: nodeId, vertexId: nodeId },
    additionalProperties: false,
  },
  "mesh.list_topologies": emptyQuery(),
  "mesh.get_keyform": idQuery("keyformId", nodeId),
  "mesh.list_keyforms": {
    type: "object",
    properties: {
      topologyId: nodeId,
      keyArtId,
      semanticSlotId,
    },
    additionalProperties: false,
  },
  "transition.get": idQuery("transitionId", transitionId),
  "transition.list": emptyQuery(),
  "transition.get_authoring": idQuery("transitionId", transitionId),
  "transition.evaluate": {
    type: "object",
    required: ["transitionId", "timeTicks"],
    properties: {
      transitionId,
      timeTicks: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  "transition.get_diagnostics": idQuery("transitionId", transitionId),
  "sequence.get": idQuery("sequenceId", sequenceId),
  "sequence.list": emptyQuery(),
  "sequence.get_diagnostics": idQuery("sequenceId", sequenceId),
  "sequence.evaluate": {
    type: "object",
    required: ["sequenceId", "timeTicks"],
    properties: { sequenceId, timeTicks: { type: "integer", minimum: 0 } },
    additionalProperties: false,
  },
  "animation.get_program": {
    type: "object",
    required: ["programId"],
    properties: { programId },
    additionalProperties: false,
  },
  "animation.list_tracks": {
    type: "object",
    required: ["programId"],
    properties: { programId },
    additionalProperties: false,
  },
  "animation.sample_program": {
    type: "object",
    required: ["programId", "timeTicks"],
    properties: {
      programId,
      timeTicks: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  "project.get_summary": {
    type: "object",
    additionalProperties: false,
  },
  "project.validate": {
    type: "object",
    additionalProperties: false,
  },
  "scene.get_tree": {
    type: "object",
    properties: { includeHidden: { type: "boolean" } },
    additionalProperties: false,
  },
  "scene.get_node": {
    type: "object",
    required: ["nodeId"],
    properties: { nodeId },
    additionalProperties: false,
  },
  "scene.search": {
    type: "object",
    properties: {
      text: { type: "string" },
      includeHidden: { type: "boolean" },
    },
    additionalProperties: false,
  },
};

function emptyQuery() {
  return { type: "object", additionalProperties: false };
}

function idQuery(name, schema) {
  return {
    type: "object",
    required: [name],
    properties: { [name]: schema },
    additionalProperties: false,
  };
}
