import test from "node:test";
import assert from "node:assert/strict";
import {
  createViewTransform,
  findAlphaBounds,
  generateGridMesh,
  getDeformedVertices,
  imageToScreen,
  moveVertices,
  resetDeformation,
  screenToImage,
} from "../src/mesh.js";

test("findAlphaBounds returns the visible pixel rectangle", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  data[(1 * 4 + 1) * 4 + 3] = 255;
  data[(2 * 4 + 3) * 4 + 3] = 128;
  assert.deepEqual(findAlphaBounds({ data, width: 4, height: 4 }), { minX: 1, minY: 1, maxX: 4, maxY: 3 });
});

test("findAlphaBounds returns null for a transparent image", () => {
  assert.equal(findAlphaBounds({ data: new Uint8ClampedArray(16), width: 2, height: 2 }), null);
});

test("generateGridMesh creates shared indexed vertices", () => {
  const mesh = generateGridMesh({ minX: 10, minY: 20, maxX: 110, maxY: 70 }, 200, 100, 2, 1);
  assert.equal(mesh.baseVertices.length / 2, 6);
  assert.equal(mesh.indices.length, 12);
  assert.deepEqual([...mesh.indices], [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  assert.deepEqual([...mesh.baseVertices], [10, 20, 60, 20, 110, 20, 10, 70, 60, 70, 110, 70]);
});

test("deformation preserves immutable base vertices", () => {
  const mesh = generateGridMesh({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10, 10, 1, 1);
  const baseBefore = [...mesh.baseVertices];
  moveVertices(mesh, new Set([1, 3]), 4, -2);
  const deformed = getDeformedVertices(mesh);
  assert.deepEqual([...mesh.baseVertices], baseBefore);
  assert.deepEqual([...deformed], [0, 0, 14, -2, 0, 10, 14, 8]);
  resetDeformation(mesh);
  assert.deepEqual([...getDeformedVertices(mesh)], baseBefore);
});

test("screen and image coordinate transforms round-trip", () => {
  const view = createViewTransform(800, 600, 400, 200);
  const screen = imageToScreen(123, 78, view);
  const image = screenToImage(screen.x, screen.y, view);
  assert.ok(Math.abs(image.x - 123) < 1e-9);
  assert.ok(Math.abs(image.y - 78) < 1e-9);
});
