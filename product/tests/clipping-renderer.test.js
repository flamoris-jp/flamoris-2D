import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createClippingRasterPlan } from "../src/core/clipping-raster-plan.js";

function instance(id, sourceId = null, overrides = {}) {
  return {
    renderInstanceId: id,
    clipping: sourceId ? { sourceRenderInstanceId: sourceId, mode: "inside" } : null,
    ...overrides,
  };
}

function plan(instances) {
  return {
    batches: instances.map((entry, drawOrder) => ({
      kind: "instance",
      drawOrder,
      renderInstances: [entry],
    })),
  };
}

test("clipping raster dependencies are independent of ordinary draw iteration", () => {
  const target = instance("target", "source");
  const source = instance("source");
  const before = createClippingRasterPlan(plan([target, source]));
  const after = createClippingRasterPlan(plan([source, target]));

  assert.deepEqual(before.maskSourceIds, ["source"]);
  assert.deepEqual(after.maskSourceIds, ["source"]);
  assert.equal(before.instancesById.get("source"), source);
});

test("nested clipping renders dependency alpha surfaces first", () => {
  const raster = createClippingRasterPlan(plan([
    instance("target", "middle"),
    instance("middle", "source"),
    instance("source"),
  ]));
  assert.deepEqual(raster.maskSourceIds, ["source", "middle"]);
});

test("weighted source alpha uses its final normalized composite contribution", () => {
  const source = instance("source", null, { compositeWeight: 1 });
  const sibling = instance("sibling", null, { compositeWeight: 3 });
  const target = instance("target", "source");
  const raster = createClippingRasterPlan({ batches: [
    { kind: "weighted-premultiplied", renderInstances: [source, sibling] },
    { kind: "instance", renderInstances: [target] },
  ] });
  assert.equal(raster.contributionById.get("source"), 0.25);
});

test("malformed evaluated clipping fails deterministically", () => {
  assert.throws(
    () => createClippingRasterPlan(plan([instance("target", "missing")])),
    /Evaluated clipping source missing is unavailable/,
  );
  assert.throws(
    () => createClippingRasterPlan(plan([instance("a", "b"), instance("b", "a")])),
    /Evaluated clipping dependency cycle includes a, b/,
  );
  assert.throws(
    () => createClippingRasterPlan(plan([instance("target", "source", {
      clipping: { sourceRenderInstanceId: "source", mode: "outside" },
    }), instance("source")])),
    /mode outside is unsupported/,
  );
});

test("WebGL backend multiplies premultiplied target output by source alpha only", async () => {
  const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(source, /outColor = mixed \* u_opacity \* u_contribution \* clippingAlpha/);
  assert.match(source, /gl_FragCoord\.xy \/ u_clippingMaskSize/);
  assert.doesNotMatch(source, /ClippingBinding|SemanticSlot|sourceNodeId.*clipping/);
});
