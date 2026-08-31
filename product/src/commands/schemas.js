import { validateProject } from "../model/validation.js";

const nonEmptyString = {
  type: "string",
  minLength: 1,
  nonBlank: true,
};

const nodeId = { ...nonEmptyString };
const finiteNumber = { type: "number" };

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

const internalCommandSchemas = {
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
