import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_SCHEMA_VERSION,
  commandSchemas,
  importSchemas,
  querySchemas,
} from "../src/mcp/schemas.js";

test("MCP schema module imports with wired query and command schemas", () => {
  assert.equal(MCP_SCHEMA_VERSION, 18);
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
  assert.equal(commandSchemas["bone.create_rigid_binding"]
    .properties.binding.properties.boneId.type, "string");
  assert.equal(querySchemas["bone.get_rigid_binding_for_target"]
    .properties.targetNodeId.type, "string");
  assert.equal(commandSchemas["skin.create_binding"]
    .properties.binding.properties.vertexWeights.items.properties.influences.maxItems, 4);
  assert.equal(commandSchemas["skin.set_vertex_weights"]
    .properties.influences.items.properties.weight.type, "number");
  assert.equal(querySchemas["skin.get_vertex_weights"].properties.vertexId.type, "string");
  assert.equal(querySchemas["skin.evaluate"].properties.positions.items.type, "number");
  assert.equal(commandSchemas["skin.set_weights_bulk"]
    .properties.vertexWeights.items.properties.vertexId.type, "string");
  assert.equal(commandSchemas["mesh_form.create_keyform"]
    .properties.keyform.properties.vertexOffsets.items.properties.vertexId.type, "string");
  assert.equal(querySchemas["mesh_form.get_for_context"].properties.keyArtId.type, "string");
  assert.equal(querySchemas["mesh_form.evaluate"].properties.positions.items.type, "number");
  assert.equal(commandSchemas["bone.create_rotation_constraint"]
    .properties.constraint.properties.minRotation.type, "number");
  assert.equal(querySchemas["bone.get_rotation_constraint_for_bone"]
    .properties.boneId.type, "string");
  assert.deepEqual(commandSchemas["bone.create_two_bone_ik"]
    .properties.constraint.properties.bendDirection.enum,
  ["clockwise", "counterclockwise"]);
  assert.equal(querySchemas["bone.get_two_bone_ik"].properties.constraintId.type, "string");
  assert.equal(querySchemas["bone.solve_two_bone_ik"].properties.target.properties.x.type,
    "number");
  assert.equal(commandSchemas["sequence.add_view_item"].properties.sequenceId.type, "string");
  assert.equal(querySchemas["sequence.evaluate"].properties.timeTicks.type, "integer");
  assert.equal(querySchemas["animation.clip.get"].properties.clipId.type, "string");
  assert.equal(querySchemas["sequence.project_clip_instances"].properties.timeTicks.type,
    "integer");
  assert.equal(commandSchemas["animation.deformation_sample.create"]
    .properties.sample.properties.offsets.items.properties.vertexId.type, "string");
  assert.equal(querySchemas["animation.deformation_sample.get"].properties.sampleId.type,
    "string");
  assert.equal(importSchemas["import.cutwork_flimg"].properties.bytes.items.maximum, 255);
});
