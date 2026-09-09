import test from "node:test";
import assert from "node:assert/strict";

import {
  hitTwoBoneIkTarget,
  projectTwoBoneIkOverlay,
} from "../src/ui/two-bone-ik-viewport-overlay.js";

test("IK overlay projects current chain and explicit transient target", () => {
  const overlay = projectTwoBoneIkOverlay({
    authoring: {
      activeConstraint: { id: "ik" },
      target: { x: 8, y: 9 },
      preview: null,
    },
    chain: {
      root: { head: { x: 0, y: 0 } },
      mid: { head: { x: 10, y: 0 } },
      end: { head: { x: 20, y: 0 } },
    },
    view: { originX: 5, originY: 7, scale: 2 },
  });
  assert.deepEqual(overlay.joints.map((entry) => entry.screen), [
    { x: 5, y: 7 }, { x: 25, y: 7 }, { x: 45, y: 7 },
  ]);
  assert.deepEqual(overlay.target.screen, { x: 21, y: 25 });
  assert.equal(hitTwoBoneIkTarget(overlay, { x: 20, y: 24 }), true);
  assert.equal(hitTwoBoneIkTarget(overlay, { x: 50, y: 50 }), false);
});

test("IK overlay uses solved FK joints during transient preview", () => {
  const overlay = projectTwoBoneIkOverlay({
    authoring: { activeConstraint: { id: "ik" }, target: { x: 3, y: 4 },
      preview: { diagnostics: [], solution: { joints: {
        root: { x: 0, y: 0 }, mid: { x: 0, y: 10 }, end: { x: 3, y: 4 },
      } } } },
    chain: { root: {}, mid: {}, end: {} },
    view: { originX: 0, originY: 0, scale: 1 },
  });
  assert.deepEqual(overlay.joints.map((entry) => entry.document), [
    { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 3, y: 4 },
  ]);
});
