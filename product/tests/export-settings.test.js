import test from "node:test";
import assert from "node:assert/strict";

import {
  exportFrameRatePresets,
  exportResolutionPresets,
  requiredTransitionRenderNodeIds,
  transitionRenderAssetStatus,
} from "../src/core/export-settings.js";

function fixtureProject({ width = 1280, height = 720 } = {}) {
  return {
    canvas: { width, height },
    renderSettings: { frameRate: { numerator: 30000, denominator: 1001 } },
    scene: {
      nodes: {
        root: { id: "root", children: ["a", "b"] },
        a: { id: "a", children: [] },
        b: { id: "b", children: [] },
      },
    },
    keyArts: [
      { id: "ka-a", rootNodeId: "root", members: [{ nodeId: "a", presence: "present" }] },
      { id: "ka-b", rootNodeId: "root", members: [{ nodeId: "b", presence: "present" }] },
    ],
    semanticSlots: [{
      id: "slot",
      mappings: [
        { keyArtId: "ka-a", nodeId: "a" },
        { keyArtId: "ka-b", nodeId: "b" },
      ],
    }],
    transitions: [{
      id: "transition",
      fromKeyArtId: "ka-a",
      toKeyArtId: "ka-b",
      temporalProgramId: "program",
      partTransitions: [{ id: "part", semanticSlotId: "slot", mode: "replace", configuration: {} }],
    }],
  };
}

test("resolution presets expose project size and 1080p only for exact 16:9 projects", () => {
  assert.deepEqual(exportResolutionPresets(fixtureProject()).map((entry) => entry.id), [
    "project",
    "hd-1080",
    "custom",
  ]);
  assert.deepEqual(exportResolutionPresets(fixtureProject({ width: 1000, height: 1000 })).map((entry) => entry.id), [
    "project",
    "custom",
  ]);
  assert.deepEqual(exportResolutionPresets(fixtureProject({ width: 1920, height: 1080 })).map((entry) => entry.id), [
    "project",
    "custom",
  ]);
});

test("FPS presets keep 24/30/60 and preserve a project rational FPS exactly", () => {
  const presets = exportFrameRatePresets(fixtureProject());
  assert.equal(presets[0].id, "project");
  assert.deepEqual(presets[0].frameRate, { numerator: 30000, denominator: 1001 });
  assert.deepEqual(presets.filter((entry) => ["24", "30", "60"].includes(entry.id))
    .map((entry) => entry.frameRate), [
    { numerator: 24, denominator: 1 },
    { numerator: 30, denominator: 1 },
    { numerator: 60, denominator: 1 },
  ]);
  assert.equal(presets.at(-1).id, "custom");
});

test("render-asset preflight derives both mapped Transition endpoint node IDs", () => {
  const project = fixtureProject();
  assert.deepEqual(requiredTransitionRenderNodeIds(project, "transition"), ["a", "b"]);

  const missing = transitionRenderAssetStatus(project, "transition", [
    { nodeId: "a", canvas: {} },
  ]);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingNodeIds, ["b"]);

  const ready = transitionRenderAssetStatus(project, "transition", [
    { nodeId: "a", canvas: {} },
    { nodeId: "b", canvas: {} },
  ]);
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.missingNodeIds, []);
});

test("decode-failed and empty render asset records keep Export disabled", () => {
  const project = fixtureProject();
  const status = transitionRenderAssetStatus(project, "transition", [
    { nodeId: "a", canvas: {} },
    { nodeId: "b", status: "decode-failed", decodeFailed: true },
  ]);
  assert.equal(status.ok, false);
  assert.deepEqual(status.missingNodeIds, ["b"]);
});
