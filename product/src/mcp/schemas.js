const nodeId = { type: "string", minLength: 1 };

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

export const commandSchemas = {
  "scene.rename_node": {
    required: ["nodeId", "displayName"],
    properties: {
      nodeId,
      displayName: { type: "string", minLength: 1 },
    },
  },
  "scene.set_transform": {
    required: ["nodeId", "transform"],
    properties: {
      nodeId,
      transform: { type: "object" },
    },
  },
  "scene.set_visibility": {
    required: ["nodeId", "visible"],
    properties: {
      nodeId,
      visible: { type: "boolean" },
    },
  },
  "scene.set_locked": {
    required: ["nodeId", "locked"],
    properties: {
      nodeId,
      locked: { type: "boolean" },
    },
  },
  "scene.create_group": {
    required: ["id", "parentId", "displayName"],
    properties: {
      id: nodeId,
      parentId: nodeId,
      displayName: { type: "string", minLength: 1 },
      index: { type: "integer", minimum: 0 },
    },
  },
  "scene.reparent_node": {
    required: ["nodeId", "parentId"],
    properties: {
      nodeId,
      parentId: nodeId,
      index: { type: "integer", minimum: 0 },
    },
  },
};

for (const schema of Object.values(commandSchemas)) {
  schema.type = "object";
  schema.additionalProperties = false;
}
