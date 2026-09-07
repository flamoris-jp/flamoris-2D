import assert from "node:assert/strict";
import test from "node:test";

import { MeshRenderer } from "../src/renderer.js";
import { createIdFactory } from "../src/model/project.js";
import { createProjectFromPsd } from "../src/io/psd-project.js";
import { createPsdReimportReview } from "../src/io/psd-reimport-review.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { collectPsdParts } from "../src/psd.js";
import { bindPsdPartsToProject } from "../src/ui/editor-adapter.js";
import {
  hydratePsdRenderAssets,
  serializePsdRenderAssets,
} from "../src/ui/psd-render-assets.js";
import { buildReviewedRenderParts } from "../src/ui/reimport-render-history.js";
import {
  createViewportRenderer,
} from "../src/ui/viewport-renderer.js";

function recordingContext() {
  const calls = [];
  return new Proxy({
    calls,
    setTransform(...args) { calls.push(["setTransform", ...args]); },
    clearRect(...args) { calls.push(["clearRect", ...args]); },
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    beginPath() { calls.push(["beginPath"]); },
    rect(...args) { calls.push(["rect", ...args]); },
    clip() { calls.push(["clip"]); },
    transform(...args) { calls.push(["transform", ...args]); },
    drawImage(...args) { calls.push(["drawImage", ...args]); },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function layerCanvas(context, width = 1000, height = 1000) {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => context,
  };
}

function viewportFixture(parts) {
  const below = recordingContext();
  const above = recordingContext();
  const overlay = recordingContext();
  const renderCalls = [];
  const state = {
    mode: "psd",
    view: { scale: 0.5, originX: 100, originY: 50 },
    documentWidth: 1000,
    documentHeight: 1000,
    psdParts: parts,
    mesh: null,
    editorMode: "object",
    selected: new Set(),
    editor: {
      selectedNodeId: null,
      getNode: () => ({ effectiveVisible: true }),
      worldTransform: () => [1, 0, 0, 1, 0, 0],
    },
  };
  const elements = {
    backgroundBelowCanvas: layerCanvas(below),
    glCanvas: layerCanvas(recordingContext()),
    foregroundCanvas: layerCanvas(above),
    overlayCanvas: layerCanvas(overlay),
  };
  const renderer = {
    render(...args) { renderCalls.push(args); },
  };
  const viewport = createViewportRenderer({
    state,
    elements,
    renderer,
    duration: () => 1,
    selectedPart: () => null,
    selectedPartIndex: () => -1,
    selectedNodeDocumentBounds: () => null,
  });
  return { above, below, renderCalls, viewport };
}

test("PSD viewport clips oversized negative-offset rasters to the document rectangle", () => {
  globalThis.window = { devicePixelRatio: 1 };
  const raster = { width: 1400, height: 1200 };
  const part = {
    nodeId: "oversized",
    canvas: raster,
    left: -200,
    top: -100,
    right: 1200,
    bottom: 1100,
    opacity: 1,
    blendMode: "normal",
  };
  const { below, renderCalls, viewport } = viewportFixture([part]);

  viewport.render();

  assert.ok(below.calls.some((call) =>
    call[0] === "rect" && call.slice(1).every((value, index) =>
      value === [100, 50, 500, 500][index])));
  assert.ok(below.calls.some((call) => call[0] === "clip"));
  assert.ok(below.calls.some((call) =>
    call[0] === "drawImage" && call[1] === raster && call[2] === -200 && call[3] === -100));
  assert.equal(part.canvas, raster);
  assert.deepEqual({ left: part.left, top: part.top, right: part.right, bottom: part.bottom }, {
    left: -200,
    top: -100,
    right: 1200,
    bottom: 1100,
  });
  assert.deepEqual(renderCalls[0][1].clipRect, {
    x: 100,
    y: 50,
    width: 500,
    height: 500,
  });
});

test("valid positive PSD left/top placement survives document clipping unchanged", () => {
  globalThis.window = { devicePixelRatio: 1 };
  const raster = { width: 100, height: 100 };
  const part = {
    nodeId: "cropped",
    canvas: raster,
    left: 200,
    top: 300,
    right: 300,
    bottom: 400,
    opacity: 1,
    blendMode: "normal",
  };
  const { below, viewport } = viewportFixture([part]);

  viewport.render();

  assert.ok(below.calls.some((call) =>
    call[0] === "drawImage" && call[1] === raster && call[2] === 200 && call[3] === 300));
  assert.equal(raster.width, 100);
  assert.equal(raster.height, 100);
});

test("save, reopen, and reviewed re-import preserve off-canvas raster placement", async () => {
  const raster = {
    width: 1400,
    height: 1200,
    flamorisRasterFingerprint: "fixture:oversized:v1",
    toDataURL: () => "data:image/png;base64,AA==",
  };
  const psd = {
    width: 1000,
    height: 1000,
    children: [{
      id: 57,
      name: "oversized background",
      left: -200,
      top: -100,
      right: 1200,
      bottom: 1100,
      canvas: raster,
    }],
  };
  const project = createProjectFromPsd(psd, {
    idFactory: createIdFactory("document-clip-save"),
  });
  const currentParts = bindPsdPartsToProject(collectPsdParts(psd.children), project);
  const [part] = currentParts;
  const [record] = serializePsdRenderAssets(currentParts);
  const reopenedProject = deserializeProject(serializeProject(project));
  const reopenedRaster = { width: 1400, height: 1200 };
  const hydration = await hydratePsdRenderAssets([record], reopenedProject, {
    loadImage: async () => reopenedRaster,
  });

  assert.deepEqual(
    { left: record.left, top: record.top, right: record.right, bottom: record.bottom },
    { left: -200, top: -100, right: 1200, bottom: 1100 },
  );
  assert.equal(hydration.parts[0].canvas, reopenedRaster);
  assert.deepEqual(
    reopenedProject.scene.nodes[part.nodeId].bounds,
    { left: -200, top: -100, right: 1200, bottom: 1100 },
  );

  const replacementRaster = {
    ...raster,
    flamorisRasterFingerprint: "fixture:oversized:v2",
  };
  const nextPsd = {
    ...psd,
    children: [{ ...psd.children[0], canvas: replacementRaster }],
  };
  const review = createPsdReimportReview(project, nextPsd, {
    idFactory: createIdFactory("document-clip-reimport"),
  });
  assert.equal(review.rows[0].action, "update");
  const importedParts = bindPsdPartsToProject(
    collectPsdParts(nextPsd.children),
    review.importedProject,
  );
  const result = buildReviewedRenderParts(
    currentParts,
    importedParts,
    review,
    review.buildResult(),
  );
  assert.equal(result[0].canvas, replacementRaster);
  assert.deepEqual(
    {
      left: result[0].left,
      top: result[0].top,
      right: result[0].right,
      bottom: result[0].bottom,
    },
    { left: -200, top: -100, right: 1200, bottom: 1100 },
  );
});

function instrumentedWebGlCanvas() {
  const operations = [];
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
    enable(value) { operations.push(["enable", value]); },
    disable(value) { operations.push(["disable", value]); },
    scissor(...args) { operations.push(["scissor", ...args]); },
    drawElements() { operations.push(["drawElements"]); },
  };
  const gl = new Proxy(api, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property === "string" && property === property.toUpperCase()) {
        return property;
      }
      return () => {};
    },
  });
  return {
    width: 2000,
    height: 1200,
    clientWidth: 1000,
    clientHeight: 600,
    getContext: () => gl,
    operations,
  };
}

test("WebGL mesh composition applies the same viewport document clip in device pixels", () => {
  const canvas = instrumentedWebGlCanvas();
  const renderer = new MeshRenderer(canvas);
  renderer.setMesh({
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  });
  renderer.render(
    new Float32Array([-200, -100, 1200, -100, -200, 1100]),
    {
      scale: 0.5,
      originX: 100,
      originY: 50,
      viewportWidth: 1000,
      viewportHeight: 600,
      clipRect: { x: 100, y: 50, width: 500, height: 500 },
    },
  );

  assert.ok(canvas.operations.some((call) =>
    call[0] === "scissor" && call.slice(1).every((value, index) =>
      value === [200, 100, 1000, 1000][index])));
  const drawIndex = canvas.operations.findIndex((call) => call[0] === "drawElements");
  const scissorIndex = canvas.operations.findIndex((call) => call[0] === "scissor");
  assert.ok(scissorIndex >= 0 && scissorIndex < drawIndex);
});

test("evaluated transition composition uses the same WebGL document clip", () => {
  const canvas = instrumentedWebGlCanvas();
  const renderer = new MeshRenderer(canvas);
  const view = {
    scale: 0.5,
    originX: 100,
    originY: 50,
    viewportWidth: 1000,
    viewportHeight: 600,
    clipRect: { x: 100, y: 50, width: 500, height: 500 },
  };
  const instance = {
    renderInstanceId: "oversized",
    sourceNodeId: "oversized",
    transform: [1, 0, 0, 1, 0, 0],
    mesh: {
      positions: [-200, -100, 1200, -100, -200, 1100],
      indices: [0, 1, 2],
    },
    appearanceSamples: [{
      appearanceId: "oversized-appearance",
      sourceNodeId: "oversized",
      uvs: [0, 0, 1, 0, 0, 1],
      weight: 1,
    }],
    opacity: 1,
    drawOrder: 0,
    clipping: null,
  };

  renderer.renderEvaluated({
    batches: [{ kind: "instance", drawOrder: 0, renderInstances: [instance] }],
  }, view, () => ({ nodeId: "oversized" }));

  const drawIndex = canvas.operations.findIndex((call) => call[0] === "drawElements");
  assert.ok(canvas.operations.slice(0, drawIndex).some((call) =>
    call[0] === "scissor" && call.slice(1).every((value, index) =>
      value === [200, 100, 1000, 1000][index])));
});
