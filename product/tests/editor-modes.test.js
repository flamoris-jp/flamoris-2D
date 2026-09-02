import test from "node:test";
import assert from "node:assert/strict";
import { generateGridMesh, getDeformedVertices } from "../src/mesh.js";
import {
  canvasInteractionRoute,
  dragSelectedVertices,
  EDITOR_MODES,
  editModeAvailability,
  objectSelectionForMode,
  updateVertexSelection,
} from "../src/ui/editor-modes.js";

test("Object Mode routes PSD canvas input to scene interaction", () => {
  assert.equal(canvasInteractionRoute({
    contentMode: "psd",
    editorMode: EDITOR_MODES.OBJECT,
    button: 0,
  }), "object");
});

test("Edit Mode routes PSD canvas input to mesh interaction", () => {
  assert.equal(canvasInteractionRoute({
    contentMode: "psd",
    editorMode: EDITOR_MODES.EDIT,
    button: 0,
  }), "mesh");
});

test("Edit Mode locks active object while Object Mode restores picking", () => {
  assert.equal(
    objectSelectionForMode(EDITOR_MODES.EDIT, "part_a", "part_b"),
    "part_a",
  );
  assert.equal(
    objectSelectionForMode(EDITOR_MODES.OBJECT, "part_a", "part_b"),
    "part_b",
  );
});

test("Shift vertex selection toggles without discarding other vertices", () => {
  const first = updateVertexSelection(new Set(), 1, false);
  const second = updateVertexSelection(first, 3, true);
  assert.deepEqual([...second], [1, 3]);
  assert.deepEqual([...updateVertexSelection(second, 1, true)], [3]);
});

test("dragging selected vertices updates mesh deformation", () => {
  const mesh = generateGridMesh(
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    10,
    10,
    1,
    1,
  );
  assert.equal(dragSelectedVertices(
    mesh,
    new Set([1, 3]),
    { x: 2, y: 4 },
    { x: 7, y: 1 },
  ), true);
  assert.deepEqual(
    [...getDeformedVertices(mesh)],
    [0, 0, 15, -3, 0, 10, 15, 7],
  );
});

test("pan and zoom routing remain mode-independent", () => {
  for (const editorMode of [EDITOR_MODES.OBJECT, EDITOR_MODES.EDIT]) {
    assert.equal(canvasInteractionRoute({
      contentMode: "psd",
      editorMode,
      button: 0,
      panRequested: true,
    }), "pan");
    assert.equal(canvasInteractionRoute({
      input: "wheel",
      contentMode: "psd",
      editorMode,
    }), "zoom");
  }
});

test("single PNG keeps its existing direct mesh editing route", () => {
  assert.equal(canvasInteractionRoute({
    contentMode: "png",
    editorMode: EDITOR_MODES.OBJECT,
    button: 0,
  }), "mesh");
});

test("Edit Mode requires an unlocked selected render part and mesh", () => {
  const valid = {
    contentMode: "psd",
    selectedNodeId: "part_a",
    selectedPart: { nodeId: "part_a", canvas: {} },
    selectedNode: { id: "part_a", kind: "part", locked: false },
    mesh: {},
  };
  assert.equal(editModeAvailability(valid).allowed, true);
  assert.match(editModeAvailability({
    ...valid,
    selectedNode: { ...valid.selectedNode, kind: "group" },
  }).reason, /Group/);
  assert.match(editModeAvailability({
    ...valid,
    selectedNode: { ...valid.selectedNode, effectiveVisible: false },
  }).reason, /非表示/);
  assert.match(editModeAvailability({ ...valid, mesh: null }).reason, /mesh/);
});
