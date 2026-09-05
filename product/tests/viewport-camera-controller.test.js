import assert from "node:assert/strict";
import test from "node:test";

import { createViewportCameraController } from "../src/ui/viewport-camera-controller.js";

function canvas() {
  return { width: 0, height: 0, style: {} };
}

function fixture(overrides = {}) {
  let renders = 0;
  const state = {
    mode: "psd",
    view: { scale: 1, originX: 0, originY: 0 },
    cameraMode: "all",
    documentWidth: 400,
    documentHeight: 200,
    psdParts: [],
    editor: null,
    ...overrides,
  };
  const elements = {
    viewportWrap: {
      getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    },
    zoomOutput: { textContent: "" },
    fitPartButton: { disabled: false },
    backgroundBelowCanvas: canvas(),
    glCanvas: canvas(),
    foregroundCanvas: canvas(),
    overlayCanvas: canvas(),
  };
  const controller = createViewportCameraController({
    state,
    elements,
    render: () => { renders += 1; },
    pixelRatio: () => 2,
  });
  return { state, elements, controller, renders: () => renders };
}

test("document fit, anchored zoom, and pan preserve camera behavior", () => {
  const { state, elements, controller, renders } = fixture();
  controller.fitDocumentView();
  assert.deepEqual(state.view, { scale: 1.5, originX: 200, originY: 150 });
  assert.equal(elements.zoomOutput.textContent, "150%");
  assert.equal(state.cameraMode, "all");

  controller.zoomAtScreenPoint(500, 300, 2);
  assert.deepEqual(state.view, { scale: 3, originX: -100, originY: 0 });
  assert.equal(state.cameraMode, "manual");
  controller.panViewBy(25, -10);
  assert.deepEqual(state.view, { scale: 3, originX: -75, originY: -10 });
  assert.equal(renders(), 3);
});

test("selection bounds include descendants, visibility, and world transforms", () => {
  const world = new Map([
    ["visible", [2, 0, 0, 2, 10, -5]],
    ["hidden", [1, 0, 0, 1, 500, 500]],
  ]);
  const { controller, state } = fixture({
    psdParts: [
      { nodeId: "visible", left: 1, top: 2, right: 11, bottom: 7 },
      { nodeId: "hidden", left: 0, top: 0, right: 20, bottom: 20 },
      { nodeId: "unrelated", left: 0, top: 0, right: 100, bottom: 100 },
    ],
    editor: {
      selectedNodeId: "group",
      isDescendantOrSelf: (nodeId) => nodeId !== "unrelated",
      getNode: (nodeId) => ({ effectiveVisible: nodeId !== "hidden" }),
      worldTransform: (nodeId) => world.get(nodeId),
    },
  });

  assert.deepEqual(controller.selectedNodeDocumentBounds(), {
    left: 12,
    top: -1,
    right: 32,
    bottom: 9,
  });
  controller.fitSelectedPartView();
  assert.equal(state.cameraMode, "part");
  assert.equal(state.view.scale, 8);
});

test("resize applies device pixels and preserves manual camera", () => {
  const { state, elements, controller, renders } = fixture({
    view: { scale: 4, originX: 12, originY: 34 },
    cameraMode: "manual",
  });
  controller.resizeCanvases();
  for (const target of [
    elements.backgroundBelowCanvas,
    elements.glCanvas,
    elements.foregroundCanvas,
    elements.overlayCanvas,
  ]) {
    assert.equal(target.width, 2000);
    assert.equal(target.height, 1200);
    assert.equal(target.style.width, "1000px");
    assert.equal(target.style.height, "600px");
  }
  assert.deepEqual(state.view, { scale: 4, originX: 12, originY: 34 });
  assert.equal(renders(), 1);
});
