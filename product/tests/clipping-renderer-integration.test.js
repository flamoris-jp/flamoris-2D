import test from "node:test";
import assert from "node:assert/strict";

import { ExportFrameRenderer } from "../src/core/export-frame-renderer.js";
import { createClippingRasterPlan } from "../src/core/clipping-raster-plan.js";
import { evaluateTransition } from "../src/core/transition-evaluator.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../src/model/warp-deformer.js";
import { renderEvaluatedTransitionViewport } from "../src/ui/viewport-renderer.js";

function member(nodeId, appearanceId, drawOrder, opacity = 1) {
  return {
    nodeId,
    appearanceId,
    opacity,
    presence: "present",
    drawOrder,
    clipping: { sourceNodeId: null },
  };
}

function fixture(mode = "hold") {
  const project = createProject({
    name: "Clipping renderer integration",
    width: 64,
    height: 64,
    idFactory: createIdFactory("clipping_renderer"),
  });
  const slotNodes = {
    slot_source: ["source_a", "source_b"],
    slot_source_alt: ["source_alt_a", "source_alt_b"],
    slot_target: ["target_a", "target_b"],
  };
  for (const [index, nodeId] of Object.values(slotNodes).flat().entries()) {
    project.scene.nodes[nodeId] = createSceneNode({
      id: nodeId,
      displayName: nodeId,
      parentId: project.scene.rootId,
      bounds: { left: index, top: index, right: index + 16, bottom: index + 16 },
    });
    project.scene.nodes[nodeId].opacity = nodeId.startsWith("source_") ? 0.6 : 0.8;
    project.scene.nodes[nodeId].transform.position = { x: index + 2, y: index + 3 };
    project.scene.nodes[project.scene.rootId].children.push(nodeId);
  }
  const keyArts = ["a", "b"].map((endpoint, endpointIndex) => ({
    id: `keyart_${endpoint}`,
    displayName: endpoint.toUpperCase(),
    rootNodeId: project.scene.rootId,
    members: Object.entries(slotNodes).map(([slotId, nodes], slotIndex) =>
      member(
        nodes[endpointIndex],
        `${slotId}_${endpoint}`,
        slotIndex,
        slotId.startsWith("slot_source") ? 0.6 : 0.8,
      )),
    metadata: {},
  }));
  project.keyArts.push(...keyArts);
  for (const [slotId, nodes] of Object.entries(slotNodes)) {
    project.semanticSlots.push({
      id: slotId,
      displayName: slotId,
      role: null,
      mappings: [
        { keyArtId: "keyart_a", nodeId: nodes[0] },
        { keyArtId: "keyart_b", nodeId: nodes[1] },
      ],
      metadata: {},
    });
    const topologyId = `topology_${slotId}`;
    project.meshTopologies.push({
      id: topologyId,
      vertexIds: [`${slotId}_v1`, `${slotId}_v2`, `${slotId}_v3`],
      indices: [0, 1, 2],
    });
    for (const [endpointIndex, endpoint] of ["a", "b"].entries()) {
      project.meshKeyforms.push({
        id: `keyform_${slotId}_${endpoint}`,
        topologyId,
        keyArtId: `keyart_${endpoint}`,
        semanticSlotId: slotId,
        positions: [endpointIndex * 2, 0, 12 + endpointIndex * 2, 0, endpointIndex * 2, 12],
        uvs: [0, 0, 1, 0, 0, 1],
      });
    }
  }
  project.temporalPrograms.push({
    id: "program_ab",
    durationTicks: 120000,
    tracks: [],
    events: [],
    regions: [],
  });
  project.transitions.push({
    id: "transition_ab",
    displayName: "A to B",
    fromKeyArtId: "keyart_a",
    toKeyArtId: "keyart_b",
    temporalProgramId: "program_ab",
    partTransitions: Object.keys(slotNodes).map((slotId) => ({
      id: `part_${slotId}`,
      semanticSlotId: slotId,
      mode,
      topologyId: mode === "morph" ? `topology_${slotId}` : null,
      fromKeyformId: mode === "morph" ? `keyform_${slotId}_a` : null,
      toKeyformId: mode === "morph" ? `keyform_${slotId}_b` : null,
      configuration: mode === "replace" ? { compositeGroupId: `replace_${slotId}` } : {},
    })),
    diagnosticOverrides: [],
  });
  project.clippingBindings.push(
    { id: "clip_a", targetNodeId: "target_a", sourceNodeId: "source_a", mode: "inside", enabled: true },
    { id: "clip_b", targetNodeId: "target_b", sourceNodeId: "source_b", mode: "inside", enabled: true },
  );
  return project;
}

function assets(project) {
  return Object.keys(project.scene.nodes)
    .filter((nodeId) => nodeId !== project.scene.rootId)
    .map((nodeId) => ({ nodeId, canvas: { nodeId } }));
}

function capableCapture(calls) {
  return {
    compositionCapabilities: { clippingRasterization: true },
    renderEvaluated(plan, target) {
      calls.push({ plan, target });
      return { accepted: true };
    },
  };
}

function attachNestedWarp(project) {
  const existingChildren = [...project.scene.nodes[project.scene.rootId].children];
  const add = (id, parentNodeId) => {
    const created = createWarpDeformer({
      id,
      displayName: id,
      parentNodeId,
      columns: 2,
      rows: 2,
      bounds: { left: 0, top: 0, right: 64, bottom: 64 },
      controlPointIds: [`${id}_tl`, `${id}_tr`, `${id}_bl`, `${id}_br`],
    });
    project.scene.nodes[id] = createSceneNode({
      id, kind: "deformer", displayName: id, parentId: parentNodeId,
    });
    project.rig.deformers.push(created.deformer);
    project.rig.warpControlPoints.push(...created.controlPoints);
    const regular = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints);
    project.rig.warpDeformerKeyforms.push(
      {
        deformerId: id,
        keyArtId: "keyart_a",
        controlPoints: regular.map((point) => ({
          ...point,
          x: point.x + (id === "head_warp" ? 3 : 0),
          y: point.y + (id === "body_warp" ? 2 : 0),
        })),
      },
      {
        deformerId: id,
        keyArtId: "keyart_b",
        controlPoints: regular.map((point) => ({
          ...point,
          x: point.x + (id === "head_warp" ? 7 : 0),
          y: point.y + (id === "body_warp" ? 6 : 0),
        })),
      },
    );
    return created;
  };
  add("body_warp", project.scene.rootId);
  add("head_warp", "body_warp");
  project.scene.nodes[project.scene.rootId].children = ["body_warp"];
  project.scene.nodes.body_warp.children = ["head_warp"];
  project.scene.nodes.head_warp.children = existingChildren;
  for (const nodeId of existingChildren) project.scene.nodes[nodeId].parentId = "head_warp";
}

test("Hold, Morph, and Replace clipping share identical preview and export render plans", () => {
  for (const mode of ["hold", "morph", "replace"]) {
    const project = fixture(mode);
    const evaluation = evaluateTransition(project, "transition_ab", 60000);
    const previewCalls = [];
    const preview = renderEvaluatedTransitionViewport({
      evaluation,
      view: { scale: 1, originX: 0, originY: 0 },
      renderer: capableCapture(previewCalls),
      resolveArtwork: (nodeId) => ({ nodeId }),
    });
    const exportCalls = [];
    const exported = new ExportFrameRenderer({
      createOffscreenRenderer: () => capableCapture(exportCalls),
    }).render({
      project,
      transitionId: "transition_ab",
      frameRate: { numerator: 24, denominator: 1 },
      frameIndex: 12,
      outputWidth: 64,
      outputHeight: 64,
      renderAssets: assets(project),
    });

    assert.deepEqual(preview.unsupportedReasons, [], mode);
    assert.equal(exported.ok, true, mode);
    assert.deepEqual(exportCalls[0].plan, previewCalls[0].plan, mode);
    assert.ok(createClippingRasterPlan(previewCalls[0].plan).maskSourceIds.length > 0, mode);
  }
});

test("resolved source mask keeps final evaluator geometry, transform, opacity, and normal visibility", () => {
  const project = fixture("morph");
  const evaluation = evaluateTransition(project, "transition_ab", 30000);
  const calls = [];
  renderEvaluatedTransitionViewport({
    evaluation,
    view: { scale: 2, originX: 4, originY: 5 },
    renderer: capableCapture(calls),
    resolveArtwork: (nodeId) => ({ nodeId }),
  });
  const plan = calls[0].plan;
  const raster = createClippingRasterPlan(plan);
  const target = [...raster.instancesById.values()].find((entry) => entry.sourceNodeId === "target_a");
  const source = raster.instancesById.get(target.clipping.sourceRenderInstanceId);

  assert.deepEqual(source.mesh.positions, [0.5, 0, 12.5, 0, 0.5, 12]);
  assert.deepEqual(source.transform, [1, 0, 0, 1, 2.25, 3.25]);
  assert.equal(source.opacity, 0.6);
  assert.equal(plan.batches.some((batch) => batch.renderInstances.includes(source)), true);
  assert.deepEqual(raster.maskSourceIds, [source.renderInstanceId]);
});

test("ClippingTrack source identity stays step-switched and disabled binding creates no mask", () => {
  const project = fixture("hold");
  project.temporalPrograms[0].tracks.push({
    trackId: "track_clipping",
    version: 1,
    kind: "ClippingTrack",
    target: { semanticSlotId: "slot_target" },
    channels: {
      clipping: {
        keyframes: [
          { id: "clip_key_a", timeTicks: 0, value: { sourceNodeId: "source_a" }, interpolationToNext: { kind: "step" } },
          { id: "clip_key_b", timeTicks: 60000, value: { sourceNodeId: "source_alt_a" }, interpolationToNext: { kind: "step" } },
        ],
      },
    },
  });
  const sourceId = (tick) => evaluateTransition(project, "transition_ab", tick)
    .evaluatedParts.find((part) => part.semanticSlotId === "slot_target")
    .renderInstances[0].clipping.sourceRenderInstanceId;
  assert.equal(sourceId(59999), "transition_ab:slot_source:hold");
  assert.equal(sourceId(60000), "transition_ab:slot_source_alt:hold");

  project.clippingBindings[0].enabled = false;
  project.clippingBindings[1].enabled = false;
  const disabled = evaluateTransition(project, "transition_ab", 60000);
  const calls = [];
  renderEvaluatedTransitionViewport({
    evaluation: disabled,
    view: { scale: 1, originX: 0, originY: 0 },
    renderer: capableCapture(calls),
    resolveArtwork: (nodeId) => ({ nodeId }),
  });
  assert.deepEqual(createClippingRasterPlan(calls[0].plan).maskSourceIds, []);
});

test("invalid resolved source fails safely in the shared preview renderer", () => {
  const project = fixture("hold");
  const evaluation = evaluateTransition(project, "transition_ab", 0);
  const target = evaluation.evaluatedParts
    .find((part) => part.semanticSlotId === "slot_target").renderInstances[0];
  target.clipping.sourceRenderInstanceId = "missing_evaluated_source";
  const report = renderEvaluatedTransitionViewport({
    evaluation,
    view: { scale: 1, originX: 0, originY: 0 },
    renderer: {
      compositionCapabilities: { clippingRasterization: true },
      renderEvaluated(plan) { createClippingRasterPlan(plan); },
    },
    resolveArtwork: (nodeId) => ({ nodeId }),
  });
  assert.match(report.unsupportedReasons[0], /missing_evaluated_source is unavailable/);
});

test("nested Warp deforms clipping source and target before the shared preview/export boundary", () => {
  const project = fixture("morph");
  attachNestedWarp(project);
  const evaluation = evaluateTransition(project, "transition_ab", 60000);
  const target = evaluation.evaluatedParts.find((part) => part.semanticSlotId === "slot_target")
    .renderInstances[0];
  const source = evaluation.evaluatedParts.flatMap((part) => part.renderInstances)
    .find((instance) => instance.renderInstanceId === target.clipping.sourceRenderInstanceId);
  assert.deepEqual(source.mesh.positions, [6, 4, 18, 4, 6, 16]);
  assert.deepEqual(target.mesh.positions, [6, 4, 18, 4, 6, 16]);
  assert.equal(source.opacity, 0.6);

  const previewCalls = [];
  renderEvaluatedTransitionViewport({
    evaluation,
    view: { scale: 1, originX: 0, originY: 0 },
    renderer: capableCapture(previewCalls),
    resolveArtwork: (nodeId) => ({ nodeId }),
  });
  const exportCalls = [];
  const exported = new ExportFrameRenderer({
    createOffscreenRenderer: () => capableCapture(exportCalls),
  }).render({
    project,
    transitionId: "transition_ab",
    frameRate: { numerator: 24, denominator: 1 },
    frameIndex: 12,
    outputWidth: 64,
    outputHeight: 64,
    renderAssets: assets(project),
  });
  assert.equal(exported.ok, true);
  assert.deepEqual(exportCalls[0].plan, previewCalls[0].plan);
  assert.equal(createClippingRasterPlan(exportCalls[0].plan).maskSourceIds.length, 1);
});
