import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { solveTwoBoneIk } from "../src/core/two-bone-ik-solver.js";

function solve(overrides = {}) {
  return solveTwoBoneIk({ root: { x: 0, y: 0 }, target: { x: 10, y: 0 },
    firstLength: 10, secondLength: 10, bendDirection: "counterclockwise", ...overrides });
}

function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test("analytic IK reaches target with exact chain lengths", () => {
  const result = solve();
  assert.deepEqual(result.diagnostics, []);
  close(Math.hypot(result.solution.elbow.x, result.solution.elbow.y), 10);
  close(Math.hypot(result.solution.end.x - result.solution.elbow.x,
    result.solution.end.y - result.solution.elbow.y), 10);
  close(result.solution.end.x, 10);
  close(result.solution.end.y, 0);
  assert.equal(result.solution.reach, "reachable");
});

test("clockwise and counterclockwise choose opposite deterministic elbow sides", () => {
  const counterclockwise = solve().solution;
  const clockwise = solve({ bendDirection: "clockwise" }).solution;
  assert.ok(counterclockwise.elbow.y > 0);
  assert.ok(clockwise.elbow.y < 0);
  close(counterclockwise.end.x, clockwise.end.x);
  close(counterclockwise.end.y, clockwise.end.y);
});

test("too-far target returns deterministic fully extended solution", () => {
  const result = solve({ target: { x: 40, y: 0 } }).solution;
  assert.equal(result.reach, "extended");
  close(result.end.x, 20);
  close(result.end.y, 0);
  close(result.rootRotation, 0);
  close(result.midRotation, 0);
});

test("too-near target returns deterministic minimum-distance fold", () => {
  const result = solve({ target: { x: 1, y: 0 }, firstLength: 10, secondLength: 4 }).solution;
  assert.equal(result.reach, "folded");
  close(result.solvedDistance, 6);
  close(result.end.x, 6);
  close(result.end.y, 0);
});

test("zero-length chain diagnoses without an invented solution", () => {
  const result = solve({ firstLength: 0 });
  assert.equal(result.solution, null);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code),
    ["TWO_BONE_IK_DEGENERATE_CHAIN"]);
});

test("singular and near-singular inputs remain finite and repeatable", () => {
  for (const target of [{ x: 0, y: 0 }, { x: 19.999999999999, y: 1e-13 }]) {
    const first = solve({ target });
    const second = solve({ target });
    assert.deepEqual(first, second);
    assert.ok(Object.values(first.solution).filter((value) => typeof value === "number")
      .every(Number.isFinite));
  }
});

test("optional rotation limits clamp the analytic result deterministically", () => {
  const result = solve({ rotationLimits: {
    root: { minRotation: -0.1, maxRotation: 0.1 },
    mid: { minRotation: -0.2, maxRotation: 0.2 },
  } }).solution;
  assert.equal(result.limited, true);
  close(result.rootRotation, 0.1);
  close(result.midRotation, -0.2);
});

test("two-bone IK solver is DOM-independent and non-iterative", async () => {
  const source = await readFile(new URL("../src/core/two-bone-ik-solver.js", import.meta.url),
    "utf8");
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|maxIterations|\bwhile\s*\(/);
  assert.match(source, /Math\.acos/);
});
