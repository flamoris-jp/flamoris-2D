import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createClippingRasterPlan } from "../src/core/clipping-raster-plan.js";
import { MeshRenderer } from "../src/renderer.js";

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

function instrumentedCanvas() {
  const draws = [];
  let framebuffer = null;
  let image = null;
  const uniforms = {};
  let resourceId = 0;
  const api = {
    FRAMEBUFFER_COMPLETE: 1,
    createTexture: () => ({ kind: "texture", id: ++resourceId }),
    createFramebuffer: () => ({ kind: "framebuffer", id: ++resourceId }),
    createShader: () => ({ kind: "shader", id: ++resourceId }),
    createProgram: () => ({ kind: "program", id: ++resourceId }),
    createVertexArray: () => ({ kind: "vao", id: ++resourceId }),
    createBuffer: () => ({ kind: "buffer", id: ++resourceId }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => name,
    checkFramebufferStatus: () => 1,
    bindFramebuffer(_target, value) { framebuffer = value; },
    uniform1f(name, value) { uniforms[name] = value; },
    uniform1i(name, value) { uniforms[name] = value; },
    texImage2D(...args) {
      const candidate = args.at(-1);
      if (candidate?.nodeId) image = candidate.nodeId;
    },
    drawElements() {
      draws.push({ framebuffer, image, uniforms: { ...uniforms } });
    },
  };
  const gl = new Proxy(api, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property === "string" && property === property.toUpperCase()) return 1;
      return () => ({});
    },
  });
  return {
    width: 32,
    height: 32,
    clientWidth: 32,
    clientHeight: 32,
    getContext: () => gl,
    draws,
  };
}

function drawable(id, drawOrder, sourceId = null, opacity = 1) {
  return {
    renderInstanceId: id,
    sourceNodeId: id,
    transform: [1, 0, 0, 1, 0, 0],
    mesh: { positions: [0, 0, 16, 0, 0, 16], indices: [0, 1, 2] },
    appearanceSamples: [{
      appearanceId: `${id}_appearance`,
      sourceNodeId: id,
      uvs: [0, 0, 1, 0, 0, 1],
      weight: 1,
    }],
    opacity,
    drawOrder,
    clipping: sourceId ? { sourceRenderInstanceId: sourceId, mode: "inside" } : null,
  };
}

test("MeshRenderer pre-renders final source alpha and still composites the source normally", () => {
  const canvas = instrumentedCanvas();
  const renderer = new MeshRenderer(canvas);
  const target = drawable("target", 0, "source");
  const source = drawable("source", 1, null, 0.5);
  renderer.renderEvaluated(plan([target, source]), {
    scale: 1,
    originX: 0,
    originY: 0,
  }, (nodeId) => ({ nodeId }));

  assert.equal(canvas.draws.length, 3);
  assert.equal(canvas.draws[0].image, "source");
  assert.notEqual(canvas.draws[0].framebuffer, null);
  assert.equal(canvas.draws[0].uniforms.u_opacity, 0.5);
  assert.equal(canvas.draws[0].uniforms.u_clippingEnabled, 0);
  assert.equal(canvas.draws[1].image, "target");
  assert.equal(canvas.draws[1].framebuffer, null);
  assert.equal(canvas.draws[1].uniforms.u_clippingEnabled, 1);
  assert.equal(canvas.draws[2].image, "source");
  assert.equal(canvas.draws[2].framebuffer, null);
  assert.equal(canvas.draws[2].uniforms.u_clippingEnabled, 0);
});
