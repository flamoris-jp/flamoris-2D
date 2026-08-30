import test from "node:test";
import assert from "node:assert/strict";
import { captureOffsets, clampDuration, lerpOffsets, sampleLoop } from "../src/animation.js";

test("captureOffsets creates an independent keyframe snapshot", () => {
  const source = new Float32Array([1, 2, 3, 4]);
  const snapshot = captureOffsets(source);
  source[0] = 99;
  assert.deepEqual([...snapshot], [1, 2, 3, 4]);
});

test("lerpOffsets interpolates and clamps", () => {
  const from = new Float32Array([0, 10]);
  const to = new Float32Array([10, 30]);
  assert.deepEqual([...lerpOffsets(from, to, 0.25)], [2.5, 15]);
  assert.deepEqual([...lerpOffsets(from, to, 2)], [10, 30]);
});

test("sampleLoop travels A to B to A", () => {
  const a = new Float32Array([0]);
  const b = new Float32Array([10]);
  assert.deepEqual([...sampleLoop(a, b, 0, 4)], [0]);
  assert.deepEqual([...sampleLoop(a, b, 1, 4)], [5]);
  assert.deepEqual([...sampleLoop(a, b, 2, 4)], [10]);
  assert.deepEqual([...sampleLoop(a, b, 3, 4)], [5]);
  assert.deepEqual([...sampleLoop(a, b, 4, 4)], [0]);
});

test("clampDuration keeps clips in the supported range", () => {
  assert.equal(clampDuration(0.1), 0.5);
  assert.equal(clampDuration(8), 8);
  assert.equal(clampDuration(99), 30);
});
