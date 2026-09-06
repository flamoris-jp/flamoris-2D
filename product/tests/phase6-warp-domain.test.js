import test from "node:test";
import assert from "node:assert/strict";

import {
  createRegularWarpControlPoints,
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";

function pointIds(count) {
  return Array.from({ length: count }, (_, index) => `cp_${index + 1}`);
}

for (const size of [2, 3, 4]) {
  test(`creates a deterministic ${size}x${size} WarpDeformer topology`, () => {
    const ids = pointIds(size * size);
    const { deformer, controlPoints } = createWarpDeformer({
      id: "warp",
      displayName: "Head Warp",
      parentNodeId: "root",
      columns: size,
      rows: size,
      bounds: { left: 10, top: 20, right: 110, bottom: 220 },
      controlPointIds: ids,
    });

    assert.deepEqual(deformer.controlPointIds, ids);
    assert.deepEqual(controlPoints.map(({ id, u, v }) => ({ id, u, v })),
      ids.map((id, index) => ({
        id,
        u: (index % size) / (size - 1),
        v: Math.floor(index / size) / (size - 1),
      })));
    assert.deepEqual(defaultWarpKeyformControlPoints(deformer, controlPoints),
      controlPoints.map((point) => ({
        controlPointId: point.id,
        x: 10 + point.u * 100,
        y: 20 + point.v * 200,
      })));
  });
}

test("regular topology identity is explicit rather than inferred from coordinates", () => {
  const first = createRegularWarpControlPoints({
    deformerId: "warp",
    columns: 2,
    rows: 2,
    controlPointIds: ["northwest", "northeast", "southwest", "southeast"],
  });
  const second = createRegularWarpControlPoints({
    deformerId: "warp",
    columns: 2,
    rows: 2,
    controlPointIds: ["a", "b", "c", "d"],
  });

  assert.deepEqual(first.map(({ u, v }) => ({ u, v })), second.map(({ u, v }) => ({ u, v })));
  assert.notDeepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
});

test("regular topology rejects unsupported grid dimensions and missing stable IDs", () => {
  assert.throws(() => createRegularWarpControlPoints({
    deformerId: "warp", columns: 5, rows: 2, controlPointIds: pointIds(10),
  }), /2x2, 3x3, or 4x4/);
  assert.throws(() => createRegularWarpControlPoints({
    deformerId: "warp", columns: 2, rows: 2, controlPointIds: pointIds(3),
  }), /one stable ID per control point/);
});
