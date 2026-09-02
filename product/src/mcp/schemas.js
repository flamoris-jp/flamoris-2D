export { commandSchemas } from "../commands/schemas.js";

export const MCP_SCHEMA_VERSION = 3;

const nodeId = {
  type: "string",
  minLength: 1,
};

const programId = { ...nodeId };
const transitionId = { ...nodeId };
const keyArtId = { ...nodeId };
const semanticSlotId = { ...nodeId };

export const querySchemas = {
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
  "mesh.get_keyform": idQuery("keyformId", nodeId),
  "transition.get": idQuery("transitionId", transitionId),
  "transition.list": emptyQuery(),
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
