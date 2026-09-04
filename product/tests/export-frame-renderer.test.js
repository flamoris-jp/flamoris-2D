import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession } from "../src/commands/editor.js";
import { ExportFrameRenderer } from "../src/core/export-frame-renderer.js";
import { createExportOffscreenRenderer } from "../src/core/export-offscreen-renderer.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";

function member(nodeId, appearanceId, drawOrder, overrides = {}) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder,
    clipping: { sourceNodeId: null },
    ...overrides,
  };
}

function fixture({ mode = "morph", mapping = "both", composite = false } = {}) {
  const project = createProject({
    name: "Export render",
    width: 100,
    height: 100,
    idFactory: createIdFactory("export_render"),
  });
  const fromNodeId = "node_eye_from";
  const toNodeId = "node_eye_to";
  project.scene.nodes[fromNodeId] = createSceneNode({
    id: fromNodeId,
    displayName: "Eye A",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[toNodeId] = createSceneNode({
    id: toNodeId,
    displayName: "Eye B",
    parentId: project.scene.rootId,
  });
  project.scene.nodes[project.scene.rootId].children.push(fromNodeId, toNodeId);
  const fromMembers = mapping === "to" ? [] : [
    member(fromNodeId, "appearance_eye_a", 2, { opacity: 0.8 }),
  ];
  const toMembers = mapping === "from" ? [] : [
    member(toNodeId, "appearance_eye_b", composite ? 2 : 7, { opacity: 0.6 }),
  ];
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: fromMembers, metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: toMembers, metadata: {} },
  );
  const mappings = [];
  if (mapping !== "to") mappings.push({ keyArtId: "keyart_a", nodeId: fromNodeId });
  if (mapping !== "from") mappings.push({ keyArtId: "keyart_b", nodeId: toNodeId });
  project.semanticSlots.push({
    id: "semantic.eye.left",
    displayName: "Left eye",
    role: "eye",
    mappings,
    metadata: {},
  });
  project.meshTopologies.push({
    id: "topology_eye",
    vertexIds: ["vertex_1", "vertex_2", "vertex_3"],
    indices: [0, 1, 2],
  });
  if (mapping !== "to") {
    project.meshKeyforms.push({
      id: "keyform_eye_a",
      topologyId: "topology_eye",
      keyArtId: "keyart_a",
      semanticSlotId: "semantic.eye.left",
      positions: [0, 0, 20, 0, 0, 20],
      uvs: [0, 0, 1, 0, 0, 1],
    });
  }
  if (mapping !== "from") {
    project.meshKeyforms.push({
      id: "keyform_eye_b",
      topologyId: "topology_eye",
      keyArtId: "keyart_b",
      semanticSlotId: "semantic.eye.left",
      positions: [10, 10, 30, 10, 10, 30],
      uvs: [0.1, 0.2, 0.9, 0.2, 0.1, 0.8],
    });
  }
  project.temporalPrograms.push({
    id: "program_eye",
    durationTicks: 120000,
    tracks: [],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition_eye",
    displayName: "A to B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program_eye",
    partTransitions: [{
      id: "part_transition_eye",
      semanticSlotId: "semantic.eye.left",
      mode,
      topologyId: mode === "morph" ? "topology_eye" : null,
      fromKeyformId: mapping === "to" ? null : "keyform_eye_a",
      toKeyformId: mapping === "from" ? null : "keyform_eye_b",
      configuration: composite ? { compositeGroupId: "composite_eye" } : {},
    }],
    diagnosticOverrides: [],
  });
  return { project, fromNodeId, toNodeId };
}

function assets(fromNodeId, toNodeId) {
  return [
    { nodeId: fromNodeId, canvas: { assetId: "art_a" } },
    { nodeId: toNodeId, canvas: { assetId: "art_b" } },
  ];
}

function projectPlan(plan, target) {
  return {
    target: { ...target },
    batches: plan.batches.map((batch) => ({
      kind: batch.kind,
      drawOrder: batch.drawOrder,
      compositeGroupId: batch.compositeGroupId || null,
      instances: batch.renderInstances.map((instance) => ({
        id: instance.renderInstanceId,
        transform: [...instance.transform],
        positions: [...instance.mesh.positions],
        indices: [...instance.mesh.indices],
        opacity: instance.opacity,
        appearanceWeights: instance.appearanceSamples.map((sample) => sample.weight),
        compositeWeight: instance.compositeWeight ?? null,
      })),
    })),
  };
}

function renderer({ fail = false, calls = [] } = {}) {
  return new ExportFrameRenderer({
    createOffscreenRenderer: (target) => ({
      renderEvaluated(plan, receivedTarget) {
        if (fail) throw new Error("offscreen backend failed");
        const output = projectPlan(plan, receivedTarget);
        calls.push({ target, output });
        return output;
      },
    }),
  });
}

function renderInput(project, renderAssets, overrides = {}) {
  return {
    project,
    transitionId: "transition_eye",
    frameRate: { numerator: 24, denominator: 1 },
    frameIndex: 12,
    outputWidth: 200,
    outputHeight: 200,
    renderAssets,
    ...overrides,
  };
}

function createHeadlessWebGl2() {
  const constants = new Set([
    "VERTEX_SHADER", "FRAGMENT_SHADER", "COMPILE_STATUS", "LINK_STATUS",
    "ARRAY_BUFFER", "ELEMENT_ARRAY_BUFFER", "FLOAT", "STATIC_DRAW", "DYNAMIC_DRAW",
    "TEXTURE_2D", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER", "TEXTURE_WRAP_S",
    "TEXTURE_WRAP_T", "LINEAR", "CLAMP_TO_EDGE", "BLEND", "ONE", "ONE_MINUS_SRC_ALPHA",
    "TEXTURE0", "UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL", "RGBA",
    "UNSIGNED_BYTE", "FRAMEBUFFER", "COLOR_ATTACHMENT0", "FRAMEBUFFER_COMPLETE",
    "COLOR_BUFFER_BIT", "TRIANGLES", "UNSIGNED_INT",
  ]);
  const api = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    checkFramebufferStatus: () => 1,
    readPixels(_x, _y, width, height, _format, _type, pixels) {
      for (let row = 0; row < height; row += 1) {
        pixels.fill(row + 1, row * width * 4, (row + 1) * width * 4);
      }
    },
  };
  return new Proxy(api, {
    get(target, property) {
      if (property in target) return target[property];
      if (constants.has(property)) return 1;
      return () => ({});
    },
  });
}

class HeadlessOffscreenCanvas {
  static surfaces = [];

  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.gl = createHeadlessWebGl2();
    HeadlessOffscreenCanvas.surfaces.push(this);
  }

  getContext(kind) {
    return kind === "webgl2" ? this.gl : null;
  }
}

test("same frame produces an identical offscreen projection from the canonical evaluation", () => {
  const { project, fromNodeId, toNodeId } = fixture();
  const input = renderInput(project, assets(fromNodeId, toNodeId));
  const first = renderer().render(input);
  const second = renderer().render(input);

  assert.equal(first.ok, true);
  assert.deepEqual(first.offscreenResult, second.offscreenResult);
  assert.deepEqual(
    first.evaluatedTransition,
    evaluateTransition(project, "transition_eye", first.frame.timeTicks),
  );
});

test("production offscreen adapter allocates the requested surface and returns RGBA8 pixels", () => {
  HeadlessOffscreenCanvas.surfaces = [];
  const { project, fromNodeId, toNodeId } = fixture();
  const production = new ExportFrameRenderer({
    createOffscreenRenderer: (target) => createExportOffscreenRenderer(target, {
      OffscreenCanvasCtor: HeadlessOffscreenCanvas,
    }),
  });
  const result = production.render(renderInput(project, assets(fromNodeId, toNodeId)));

  assert.equal(result.ok, true);
  assert.equal(HeadlessOffscreenCanvas.surfaces.length, 1);
  assert.deepEqual(
    [HeadlessOffscreenCanvas.surfaces[0].width, HeadlessOffscreenCanvas.surfaces[0].height],
    [200, 200],
  );
  assert.equal(result.offscreenResult.kind, "rgba8");
  assert.equal(result.offscreenResult.rowOrder, "top-to-bottom");
  assert.equal(result.offscreenResult.data.length, 200 * 200 * 4);
  // The headless WebGL readback writes bottom-to-top rows 1..N. The real
  // MeshRenderer path is exercised and ExportFrameRenderer receives normalized pixels.
  assert.equal(result.offscreenResult.data[0], 200);
  assert.equal(result.offscreenResult.data.at(-1), 1);
});

test("viewport and authoring transients cannot affect export rendering", () => {
  const { project, fromNodeId, toNodeId } = fixture();
  const base = renderInput(project, assets(fromNodeId, toNodeId));
  const first = renderer().render({
    ...base,
    viewport: { width: 320, height: 200, zoom: 0.2, panX: -900, panY: 71, dpi: 3 },
    authoringState: { selectedVertexId: "vertex_1", tool: "topology", overlays: true },
  });
  const second = renderer().render({
    ...base,
    viewport: { width: 3840, height: 2160, zoom: 8, panX: 400, panY: -250, dpi: 1 },
    authoringState: { selectedVertexId: null, tool: "object", overlays: false },
  });

  assert.deepEqual(first.offscreenResult, second.offscreenResult);
  assert.equal("viewport" in first.renderTarget, false);
  assert.equal("overlays" in first.renderTarget, false);
});

test("resolution changes only the documented origin-aligned uniform target scale", () => {
  const { project, fromNodeId, toNodeId } = fixture();
  const renderAssets = assets(fromNodeId, toNodeId);
  const small = renderer().render(renderInput(project, renderAssets, {
    outputWidth: 100,
    outputHeight: 100,
  }));
  const large = renderer().render(renderInput(project, renderAssets, {
    outputWidth: 300,
    outputHeight: 300,
  }));

  assert.deepEqual(small.renderTarget, {
    width: 100,
    height: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    originX: 0,
    originY: 0,
    scale: 1,
    mapping: "project-origin-uniform-scale",
  });
  assert.equal(large.renderTarget.scale, 3);
  assert.deepEqual(
    small.offscreenResult.batches,
    large.offscreenResult.batches,
  );
  assert.equal(renderer().render(renderInput(project, renderAssets, {
    outputWidth: 200,
    outputHeight: 100,
  })).diagnostics[0].code, "export.invalid_output_resolution");
});

test("Morph projection retains mesh deformation, dual appearance, opacity, transform, and draw order", () => {
  const { project, fromNodeId, toNodeId } = fixture();
  const result = renderer().render(renderInput(project, assets(fromNodeId, toNodeId)));
  const instance = result.renderPlan.batches[0].renderInstances[0];

  assert.equal(result.ok, true);
  assert.deepEqual(instance.mesh.positions, [5, 5, 25, 5, 5, 25]);
  assert.deepEqual(instance.appearanceSamples.map((sample) => sample.weight), [0.5, 0.5]);
  assert.equal(instance.opacity, 0.7);
  assert.equal(instance.drawOrder, 7);
  assert.deepEqual(instance.transform, [1, 0, 0, 1, 0, 0]);
});

test("Replace preserves independent instances and weighted-premultiplied grouping", () => {
  const independent = fixture({ mode: "replace" });
  const independentResult = renderer().render(renderInput(
    independent.project,
    assets(independent.fromNodeId, independent.toNodeId),
  ));
  assert.equal(independentResult.ok, true);
  assert.deepEqual(independentResult.renderPlan.batches.map((batch) => batch.drawOrder), [2, 7]);
  assert.deepEqual(independentResult.renderPlan.batches.map((batch) =>
    batch.renderInstances[0].opacity), [0.4, 0.3]);

  const composite = fixture({ mode: "replace", composite: true });
  const compositeResult = renderer().render(renderInput(
    composite.project,
    assets(composite.fromNodeId, composite.toNodeId),
  ));
  assert.equal(compositeResult.ok, true);
  assert.equal(compositeResult.renderPlan.batches[0].kind, "weighted-premultiplied");
  assert.deepEqual(compositeResult.renderPlan.batches[0].renderInstances.map((instance) =>
    instance.compositeWeight), [0.5, 0.5]);
});

test("present, occluded, and absent states keep the canonical batch inclusion semantics", () => {
  const present = fixture();
  const presentResult = renderer().render(renderInput(
    present.project,
    assets(present.fromNodeId, present.toNodeId),
  ));
  assert.equal(presentResult.evaluatedTransition.evaluatedParts[0].presence, "present");
  assert.equal(presentResult.renderPlan.renderInstanceCount, 1);

  const occluded = fixture({ mode: "occlusion" });
  const occludedResult = renderer().render(renderInput(
    occluded.project,
    assets(occluded.fromNodeId, occluded.toNodeId),
    { frameIndex: 18 },
  ));
  assert.equal(occludedResult.evaluatedTransition.evaluatedParts[0].presence, "occluded");
  assert.equal(occludedResult.renderPlan.renderInstanceCount, 0);

  const absent = fixture({ mode: "appear", mapping: "to" });
  const absentResult = renderer().render(renderInput(
    absent.project,
    assets(absent.fromNodeId, absent.toNodeId),
    { frameIndex: 0 },
  ));
  assert.equal(absentResult.evaluatedTransition.evaluatedParts[0].presence, "absent");
  assert.equal(absentResult.renderPlan.renderInstanceCount, 0);
});

test("export rendering never mutates Project or EditorSession history", () => {
  const source = fixture();
  const session = new EditorSession(source.project);
  const beforeProject = structuredClone(session.project);
  const beforeHistory = {
    undo: session.undoStack.length,
    redo: session.redoStack.length,
    history: session.history.length,
    revision: session.currentRevision,
  };

  const result = renderer().render(renderInput(
    session.project,
    assets(source.fromNodeId, source.toNodeId),
  ));

  assert.equal(result.ok, true);
  assert.deepEqual(session.project, beforeProject);
  assert.deepEqual({
    undo: session.undoStack.length,
    redo: session.redoStack.length,
    history: session.history.length,
    revision: session.currentRevision,
  }, beforeHistory);
});

test("reason-specific diagnostics abort instead of silently skipping frames", () => {
  const source = fixture();
  const validAssets = assets(source.fromNodeId, source.toNodeId);
  const missingTransition = renderer().render(renderInput(source.project, validAssets, {
    transitionId: "missing",
  }));
  assert.equal(missingTransition.diagnostics[0].code, "export.missing_transition");

  const missingProgramProject = fixture().project;
  missingProgramProject.temporalPrograms = [];
  assert.equal(renderer().render(renderInput(missingProgramProject, validAssets))
    .diagnostics[0].code, "export.missing_temporal_program");
  assert.ok(renderer().render(renderInput(source.project, []))
    .diagnostics.some((entry) => entry.code === "export.missing_render_asset"));
  assert.ok(renderer().render(renderInput(source.project, [
    { nodeId: source.fromNodeId, status: "decode-failed" },
    { nodeId: source.toNodeId, status: "decode-failed" },
  ])).diagnostics.some((entry) => entry.code === "export.decode_failed_asset"));

  const invalidTransform = fixture();
  invalidTransform.project.scene.nodes[invalidTransform.fromNodeId].transform.position.x = Infinity;
  assert.ok(renderer().render(renderInput(
    invalidTransform.project,
    assets(invalidTransform.fromNodeId, invalidTransform.toNodeId),
  )).diagnostics.some((entry) => entry.code === "export.invalid_transform"));
  assert.equal(renderer({ fail: true }).render(renderInput(source.project, validAssets))
    .diagnostics[0].code, "export.render_failure");
});

test("export renderer core has no DOM, viewport, or authoring overlay dependency", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/core/shared-composition-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/composition-render-target.js", import.meta.url), "utf8"),
    readFile(new URL("../src/core/export-frame-renderer.js", import.meta.url), "utf8"),
  ]);
  const combined = sources.join("\n");

  assert.doesNotMatch(combined, /\b(?:document|window|HTMLElement|OffscreenCanvas)\b/);
  assert.doesNotMatch(combined, /zoom|pan|selectedVertex|meshTool|overlay|playhead/);
});
