import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_SCHEMA_VERSION,
  commandSchemas,
  querySchemas,
} from "../src/mcp/schemas.js";

test("MCP schema module imports with wired query and command schemas", () => {
  assert.equal(MCP_SCHEMA_VERSION, 1);
  assert.equal(
    querySchemas["scene.get_node"].properties.nodeId.type,
    "string",
  );
  assert.equal(
    commandSchemas["scene.set_transform"]
      .properties.coordinateSpace.const,
    "node-local",
  );
});
