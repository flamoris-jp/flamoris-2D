import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_SCHEMA_VERSION,
  commandSchemas,
  querySchemas,
} from "../src/mcp/schemas.js";

test("MCP schema module imports with wired query and command schemas", () => {
  assert.equal(MCP_SCHEMA_VERSION, 9);
  assert.equal(
    querySchemas["scene.get_node"].properties.nodeId.type,
    "string",
  );
  assert.equal(
    commandSchemas["scene.set_transform"]
      .properties.coordinateSpace.const,
    "node-local",
  );
  assert.equal(querySchemas["mesh.get_vertex"].properties.vertexId.type, "string");
  assert.equal(
    commandSchemas["mesh_topology.subdivide_edge"]
      .properties.vertexIds.minItems,
    2,
  );
  assert.equal(
    commandSchemas["animation.temporal.set_duration"]
      .properties.durationTicks.minimum,
    1,
  );
  assert.equal(querySchemas["clipping.get_for_node"].properties.nodeId.type, "string");
  assert.equal(commandSchemas["clipping.create"].properties.binding.properties.mode.const, "inside");
  assert.equal(commandSchemas["bone.create"].properties.restLocalTransform.type, "object");
  assert.equal(querySchemas["bone.get_evaluated_pose"].properties.boneId.type, "string");
});
