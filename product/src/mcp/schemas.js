export { commandSchemas } from "../commands/schemas.js";

export const MCP_SCHEMA_VERSION = 2;

const nodeId = {
  type: "string",
  minLength: 1,
};

const programId = { ...nodeId };

export const querySchemas = {
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
