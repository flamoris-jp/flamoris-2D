export { commandSchemas } from "../commands/schemas.js";

export const MCP_SCHEMA_VERSION = 1;

export const querySchemas = {
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
