import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  evaluateInterpolatedMeshFormCorrection,
  evaluateMeshFormCorrection,
} from "../src/core/mesh-form-correction-evaluator.js";

const topology = { id: "topology", vertexIds: ["v1", "v2"] };
const mesh = { positions: [1, 2, 3, 4], indices: [] };
const keyform = (id, keyArtId, vertexOffsets) => ({
  id, topologyId: "topology", keyArtId, semanticSlotId: "slot", vertexOffsets,
});

test("absent and sparse form correction use exact zero offsets", () => {
  assert.deepEqual(evaluateMeshFormCorrection({ mesh, topology, keyform: null }),
    { mesh, diagnostics: [] });
  const result = evaluateMeshFormCorrection({
    mesh, topology, keyform: keyform("a", "key_a", [{ vertexId: "v2", x: 5, y: -2 }]),
  });
  assert.deepEqual(result.mesh.positions, [1, 2, 8, 2]);
});

test("form correction interpolation is exact at A B and midpoint with absent endpoint zero", () => {
  const from = keyform("a", "key_a", [{ vertexId: "v1", x: 4, y: 2 }]);
  const to = keyform("b", "key_b", [{ vertexId: "v1", x: 8, y: -2 },
    { vertexId: "v2", x: 2, y: 4 }]);
  const evaluate = (geometryWeight, fromKeyform = from, toKeyform = to) =>
    evaluateInterpolatedMeshFormCorrection({
      mesh, topology, fromKeyform, toKeyform, geometryWeight,
    }).mesh.positions;
  assert.deepEqual(evaluate(0), [5, 4, 3, 4]);
  assert.deepEqual(evaluate(1), [9, 0, 5, 8]);
  assert.deepEqual(evaluate(0.5), [7, 2, 4, 6]);
  assert.deepEqual(evaluate(0.5, from, null), [3, 3, 3, 4]);
});

test("incompatible topology and missing stable vertices diagnose without mutation", () => {
  const incompatible = keyform("a", "key_a", [{ vertexId: "missing", x: 1, y: 1 }]);
  incompatible.topologyId = "other";
  const result = evaluateMeshFormCorrection({ mesh, topology, keyform: incompatible });
  assert.deepEqual(result.mesh.positions, mesh.positions);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code), [
    "MESH_FORM_CORRECTION_TOPOLOGY_INCOMPATIBLE",
    "MESH_FORM_CORRECTION_VERTEX_MISSING",
  ]);
});

test("form correction evaluator is DOM-independent", () => {
  const source = fs.readFileSync(
    new URL("../src/core/mesh-form-correction-evaluator.js", import.meta.url), "utf8",
  );
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b/);
});
