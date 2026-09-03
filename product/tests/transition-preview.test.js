import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { createEvaluatedRenderPlan } from "../src/core/evaluated-render.js";
import { serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { TransitionAuthoringController } from "../src/ui/transition-authoring-controller.js";
import { TransitionDiagnosticsController } from "../src/ui/transition-diagnostics-controller.js";
import { TransitionPreviewController } from "../src/ui/transition-preview-controller.js";
import { EndpointMeshController } from "../src/ui/endpoint-mesh-controller.js";
import { renderEvaluatedTransitionViewport } from "../src/ui/viewport-renderer.js";

function member(nodeId, appearanceId, drawOrder) {
  return {
    nodeId, appearanceId, opacity: 1, presence: "present", drawOrder,
    clipping: { sourceNodeId: null },
  };
}

function fixture() {
  const project = createProject({
    name: "Preview", width: 100, height: 100,
    idFactory: createIdFactory("preview"),
  });
  for (const [id, left] of [["node_a", 0], ["node_b", 10]]) {
    project.scene.nodes[id] = createSceneNode({
      id, displayName: id, parentId: project.scene.rootId,
      bounds: { left, top: 0, right: left + 10, bottom: 10 },
    });
    project.scene.nodes[project.scene.rootId].children.push(id);
  }
  project.keyArts.push(
    { id: "keyart_a", displayName: "A", rootNodeId: project.scene.rootId, members: [member("node_a", "appearance_a", 1)], metadata: {} },
    { id: "keyart_b", displayName: "B", rootNodeId: project.scene.rootId, members: [member("node_b", "appearance_b", 1)], metadata: {} },
  );
  project.semanticSlots.push({
    id: "semantic_eye", displayName: "Eye", role: "eye", metadata: {},
    mappings: [
      { keyArtId: "keyart_a", nodeId: "node_a" },
      { keyArtId: "keyart_b", nodeId: "node_b" },
    ],
  });
  project.meshTopologies.push({ id: "topology_eye", vertexIds: ["v1", "v2", "v3"], indices: [0, 1, 2] });
  project.meshKeyforms.push(
    { id: "keyform_a", topologyId: "topology_eye", keyArtId: "keyart_a", semanticSlotId: "semantic_eye", positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
    { id: "keyform_b", topologyId: "topology_eye", keyArtId: "keyart_b", semanticSlotId: "semantic_eye", positions: [5, 5, 15, 5, 5, 15], uvs: [0.1, 0.2, 0.9, 0.2, 0.1, 0.8] },
  );
  project.temporalPrograms.push({ id: "program_ab", durationTicks: 120000, tracks: [], events: [], regions: [] });
  project.transitions.push({
    id: "transition_ab", displayName: "A → B", fromKeyArtId: "keyart_a", toKeyArtId: "keyart_b",
    temporalProgramId: "program_ab", diagnosticOverrides: [],
    partTransitions: [{
      id: "part_eye", semanticSlotId: "semantic_eye", mode: "morph",
      topologyId: "topology_eye", fromKeyformId: "keyform_a", toKeyformId: "keyform_b", configuration: {},
    }],
  });
  const session = new EditorSession(project);
  const authoring = new TransitionAuthoringController(session);
  authoring.selectTransition("transition_ab");
  authoring.selectSemanticSlot("semantic_eye");
  let sequence = 0;
  const preview = new TransitionPreviewController(session, authoring, {
    idFactory: (kind) => `${kind}_preview_${++sequence}`,
  });
  return { session, authoring, preview };
}

test("preview view/tick state is transient, clamps to the program, and never enters Undo history", () => {
  const { session, preview } = fixture();
  const before = JSON.stringify(session.project);
  const historyLength = session.history.length;
  preview.selectViewMode("preview");
  preview.setTick(37001);
  preview.jumpToStart();
  preview.jumpToEnd();
  assert.equal(preview.getState().currentTick, 120000);
  assert.equal(preview.getState().normalizedProgress, 1);
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, historyLength);
  assert.doesNotMatch(serializeProject(session.project), /currentTick|viewMode|selectedTrack/);
});

test("start, end, and arbitrary ticks all use transition.evaluate and remain deterministic", () => {
  const { session, preview } = fixture();
  const originalQuery = session.query.bind(session);
  const calls = [];
  session.query = (name, input) => {
    if (name === "transition.evaluate") calls.push({ ...input });
    return originalQuery(name, input);
  };
  const first = preview.setTick(41321);
  const second = preview.setTick(41321);
  preview.jumpToStart();
  preview.jumpToEnd();
  assert.deepEqual(first, second);
  assert.deepEqual(calls.map((entry) => entry.timeTicks), [41321, 41321, 0, 120000]);
  assert.equal(calls.every((entry) => entry.transitionId === "transition_ab"), true);
});

test("focused tracks distinguish default/override and keyframe edits use normal commands", () => {
  const { session, preview } = fixture();
  preview.addTrack({ kind: "OpacityTrack", target: { transitionDefault: true }, trackId: "track_default" });
  preview.addTrack({ kind: "OpacityTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "track_eye" });
  assert.deepEqual(preview.getState().tracks.map((track) => track.targetKind), ["default", "semantic-override"]);

  preview.addKeyframe("track_eye", "opacity", {
    id: "key_eye", timeTicks: 0, value: 0.25, interpolationToNext: { kind: "linear" },
  });
  preview.updateKeyframe("track_eye", "opacity", "key_eye", {
    timeTicks: 60000, value: 0.75, interpolationToNext: { kind: "bezier", x1: 0.2, y1: 0, x2: 0.8, y2: 1 },
  });
  assert.equal(session.query("animation.get_program", { programId: "program_ab" })
    .tracks.find((track) => track.trackId === "track_eye").channels.opacity.keyframes[0].timeTicks, 60000);
  preview.removeKeyframe("track_eye", "opacity", "key_eye");
  assert.deepEqual(session.history.at(-1).commandTypes, ["animation.temporal.remove_keyframe"]);
  session.undo();
  assert.equal(session.query("animation.get_program", { programId: "program_ab" })
    .tracks.find((track) => track.trackId === "track_eye").channels.opacity.keyframes.length, 1);
  session.redo();
  assert.equal(session.query("animation.get_program", { programId: "program_ab" })
    .tracks.find((track) => track.trackId === "track_eye").channels.opacity.keyframes.length, 0);
});

test("invalid interpolation and duplicate/conflicting typed state are rejected without repair", () => {
  const { session, preview } = fixture();
  preview.addTrack({ kind: "PresenceTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "track_presence" });
  const before = JSON.stringify(session.project);
  assert.throws(() => preview.addKeyframe("track_presence", "presence", {
    id: "invalid_presence", timeTicks: 0, value: "present", interpolationToNext: { kind: "linear" },
  }), TransactionError);
  assert.equal(JSON.stringify(session.project), before);
  assert.throws(() => preview.addTrack({
    kind: "TransformTrack", target: { transitionDefault: true }, trackId: "not_focused",
  }), /outside the focused/);
});

test("preview controller is DOM-free and never writes session.project directly", async () => {
  const [source, viewSource] = await Promise.all([
    readFile(new URL("../src/ui/transition-preview-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/transition-preview-view.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b/);
  assert.doesNotMatch(source, /session\.project/);
  assert.doesNotMatch(viewSource, /session\.project/);
  assert.match(source, /session\.query\("transition\.evaluate"/);
  assert.match(source, /animation\.temporal\.add_keyframe/);
  assert.match(source, /animation\.temporal\.update_keyframe/);
  assert.match(source, /animation\.temporal\.remove_keyframe/);
});

test("renderer plan consumes evaluator instances, Morph weights, dual artwork, and per-Key-Art UVs unchanged", () => {
  const { preview } = fixture();
  preview.addTrack({ kind: "GeometryBlendTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "geometry" });
  preview.addKeyframe("geometry", "geometryWeight", {
    id: "geometry_mid", timeTicks: 0, value: 0.25, interpolationToNext: { kind: "linear" },
  });
  preview.addTrack({ kind: "AppearanceTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "appearance" });
  preview.addKeyframe("appearance", "appearance", {
    id: "appearance_mid", timeTicks: 0,
    value: { appearance_a: 0.8, appearance_b: 0.2 }, interpolationToNext: { kind: "linear" },
  });
  const evaluation = preview.setTick(60000);
  const source = evaluation.evaluatedParts[0].renderInstances[0];
  const requestedArtwork = [];
  const plan = createEvaluatedRenderPlan(evaluation, {
    resolveArtwork: (nodeId) => {
      requestedArtwork.push(nodeId);
      return { nodeId };
    },
  });
  assert.equal(plan.batches[0].renderInstances[0], source);
  assert.deepEqual(source.mesh.positions, [1.25, 1.25, 11.25, 1.25, 1.25, 11.25]);
  assert.deepEqual(source.appearanceSamples.map((sample) => sample.weight), [0.8, 0.2]);
  assert.deepEqual(source.appearanceSamples.map((sample) => sample.uvs), [
    [0, 0, 1, 0, 0, 1],
    [0.1, 0.2, 0.9, 0.2, 0.1, 0.8],
  ]);
  assert.deepEqual(requestedArtwork.sort(), ["node_a", "node_b"]);
  assert.deepEqual(plan.unsupportedReasons, []);
});

test("Replace keeps both simultaneous evaluator instances in one weighted-premultiplied batch", () => {
  const { session, preview } = fixture();
  session.execute({
    type: "transition.set_part_mode",
    payload: {
      transitionId: "transition_ab", partTransitionId: "part_eye", semanticSlotId: "semantic_eye",
      mode: "replace", configuration: { compositeGroupId: "eye_handoff" },
    },
  });
  const evaluation = preview.setTick(60000);
  const plan = createEvaluatedRenderPlan(evaluation, { resolveArtwork: () => ({}) });
  assert.equal(evaluation.evaluatedParts[0].renderInstances.length, 2);
  assert.equal(plan.renderInstanceCount, 2);
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.batches[0].kind, "weighted-premultiplied");
  assert.equal(plan.batches[0].compositeGroupId, "eye_handoff");
  assert.deepEqual(plan.batches[0].renderInstances, evaluation.evaluatedParts[0].renderInstances);
  assert.deepEqual(plan.batches[0].renderInstances.map((instance) => instance.opacity), [1, 1]);
  assert.deepEqual(plan.batches[0].renderInstances.map((instance) => instance.compositeWeight), [0.5, 0.5]);
});

test("renderer plan honors presence and explicit draw order without reading PartTransition mode", async () => {
  const presentHigh = {
    renderInstanceId: "high", sourceNodeId: "node_b", transform: [1, 0, 0, 1, 0, 0],
    mesh: { positions: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] },
    appearanceSamples: [{ appearanceId: "b", sourceNodeId: "node_b", uvs: [0, 0, 1, 0, 0, 1], weight: 1 }],
    opacity: 0.35, drawOrder: 10, clipping: { sourceNodeId: null },
  };
  const presentLow = { ...presentHigh, renderInstanceId: "low", sourceNodeId: "node_a", drawOrder: 2, opacity: 0.8,
    appearanceSamples: [{ ...presentHigh.appearanceSamples[0], appearanceId: "a", sourceNodeId: "node_a" }] };
  const hidden = { ...presentHigh, renderInstanceId: "hidden", drawOrder: 0 };
  const evaluation = {
    evaluatedParts: [
      { semanticSlotId: "absent", presence: "absent", renderInstances: [hidden] },
      { semanticSlotId: "occluded", presence: "occluded", renderInstances: [hidden] },
      { semanticSlotId: "visible", presence: "present", renderInstances: [presentHigh, presentLow] },
    ],
  };
  const plan = createEvaluatedRenderPlan(evaluation, { resolveArtwork: () => ({}) });
  assert.deepEqual(plan.batches.map((batch) => batch.renderInstances[0].renderInstanceId), ["low", "high"]);
  assert.deepEqual(plan.batches.map((batch) => batch.renderInstances[0].opacity), [0.8, 0.35]);
  const source = await readFile(new URL("../src/core/evaluated-render.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /PartTransition|part\.mode|transition\.partTransitions/);
});

test("preview authority reports structural and renderer unsupported reasons explicitly", () => {
  const { preview } = fixture();
  preview.setTick(40000);
  let state = preview.getState();
  assert.equal(state.authoritative, false);
  assert.deepEqual(state.authorityReasons, ["Renderer validation pending or unavailable."]);
  preview.setRenderReport({ unsupportedReasons: ["Clipping rasterization is unsupported."] });
  state = preview.getState();
  assert.equal(state.authoritative, false);
  assert.deepEqual(state.authorityReasons, ["Clipping rasterization is unsupported."]);
  preview.setRenderReport({ unsupportedReasons: [] });
  assert.equal(preview.getState().authoritative, true);
  preview.evaluation = { ...preview.evaluation, diagnostics: [{ code: "STRUCTURAL_INVALID", severity: "error" }] };
  state = preview.getState();
  assert.equal(state.authoritative, false);
  assert.deepEqual(state.authorityReasons, ["STRUCTURAL_INVALID"]);
});

test("diagnostic projection preserves severity and shares the preview authority contract", () => {
  const { preview } = fixture();
  preview.setTick(40000);
  preview.evaluation = {
    ...preview.evaluation,
    diagnostics: [{
      key: "warning_eye",
      code: "TRANSITION_TRIANGLE_INVERSION",
      severity: "warning",
      message: "A mesh triangle changes winding between endpoints.",
      transitionId: "transition_ab",
      semanticSlotId: "semantic_eye",
      details: { triangleIndex: 0 },
    }],
  };
  preview.setRenderReport({ unsupportedReasons: [], renderInstanceCount: 1 });
  const state = preview.getState();
  assert.equal(state.authoritative, true);
  assert.equal(state.diagnostics.find((entry) => entry.key === "warning_eye").severity, "warning");
  assert.equal(state.diagnostics.find((entry) => entry.key === "warning_eye").authorityImpact, "advisory");
});

test("diagnostic focus navigates by stable IDs without mutating Project or history", () => {
  const { session, authoring, preview } = fixture();
  const endpointMesh = new EndpointMeshController(session, authoring);
  const diagnostics = new TransitionDiagnosticsController(session, authoring, endpointMesh, preview);
  preview.setTick(40000);
  preview.evaluation = {
    ...preview.evaluation,
    diagnostics: [{
      key: "endpoint_b",
      code: "TRANSITION_MISSING_KEYFORM",
      severity: "error",
      message: "A required endpoint MeshKeyform is missing.",
      transitionId: "transition_ab",
      semanticSlotId: "semantic_eye",
      details: { missingEndpoints: ["to"], toKeyformId: "keyform_b" },
    }],
  };
  const before = JSON.stringify(session.project);
  const historyLength = session.history.length;
  const result = diagnostics.focusDiagnostic("endpoint_b");
  assert.deepEqual(result, { focused: true, missing: false, diagnostic: result.diagnostic });
  assert.equal(authoring.getState().selectedSemanticSlotId, "semantic_eye");
  assert.equal(endpointMesh.getState().activeEndpoint, "to");
  assert.equal(preview.getState().viewMode, "endpoint-b");
  assert.equal(JSON.stringify(session.project), before);
  assert.equal(session.history.length, historyLength);
});

test("diagnostic focus is safe for missing targets and can focus a restored track/keyframe", () => {
  const { session, authoring, preview } = fixture();
  const endpointMesh = new EndpointMeshController(session, authoring);
  const diagnostics = new TransitionDiagnosticsController(session, authoring, endpointMesh, preview);
  preview.addTrack({ kind: "OpacityTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "track_focus" });
  preview.addKeyframe("track_focus", "opacity", {
    id: "key_focus", timeTicks: 0, value: 0.5, interpolationToNext: { kind: "linear" },
  });
  preview.evaluation = {
    transitionId: "transition_ab",
    diagnostics: [{
      key: "track_key",
      code: "ANIMATION_DIAGNOSTIC",
      severity: "warning",
      message: "Track needs attention.",
      transitionId: "transition_ab",
      details: { trackId: "track_focus", channel: "opacity", keyframeId: "key_focus" },
    }],
    evaluatedParts: [],
  };
  assert.equal(diagnostics.focusDiagnostic("track_key").missing, false);
  assert.deepEqual(preview.getState().selectedKeyframe, {
    trackId: "track_focus", channel: "opacity", keyframeId: "key_focus",
  });
  session.undo();
  preview.projectChanged();
  assert.equal(preview.getState().selectedKeyframe, null);
  assert.equal(diagnostics.focusDiagnostic("track_key").missing, true);
  session.redo();
  preview.projectChanged();
  assert.equal(diagnostics.focusDiagnostic("track_key").missing, false);

  preview.evaluation.diagnostics[0] = {
    ...preview.evaluation.diagnostics[0],
    key: "missing_slot",
    semanticSlotId: "slot_removed",
  };
  assert.equal(diagnostics.focusDiagnostic("missing_slot").missing, true);
  assert.equal(diagnostics.getState().selectedDiagnosticMissing, false);
});

test("mixed draw-order composite groups are non-authoritative instead of choosing a hidden z position", () => {
  const instance = (renderInstanceId, drawOrder, compositeGroupId = null) => ({
    renderInstanceId,
    sourceNodeId: "node_a",
    transform: [1, 0, 0, 1, 0, 0],
    mesh: { positions: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] },
    appearanceSamples: [{ appearanceId: "appearance_a", sourceNodeId: "node_a", uvs: [0, 0, 1, 0, 0, 1], weight: 1 }],
    opacity: 1,
    drawOrder,
    clipping: { sourceNodeId: null },
    ...(compositeGroupId ? { compositeGroupId, compositeWeight: 0.5 } : {}),
  });
  const plan = createEvaluatedRenderPlan({
    evaluatedParts: [
      { semanticSlotId: "slot_group", presence: "present", renderInstances: [
        instance("group_a", 1, "handoff"),
        instance("group_b", 3, "handoff"),
      ] },
      { semanticSlotId: "slot_between", presence: "present", renderInstances: [instance("between", 2)] },
    ],
  }, { resolveArtwork: () => ({}) });
  assert.deepEqual(plan.batches.map((batch) => batch.renderInstances.map((entry) => entry.renderInstanceId)), [["between"]]);
  assert.equal(plan.renderInstanceCount, 1);
  assert.match(plan.unsupportedReasons[0], /inconsistent explicit draw order \(1, 3\)/);
});

test("scrubber to evaluator to viewport consumer keeps simultaneous Replace instances", () => {
  const { session, preview } = fixture();
  session.execute({
    type: "transition.set_part_mode",
    payload: {
      transitionId: "transition_ab", partTransitionId: "part_eye", semanticSlotId: "semantic_eye",
      mode: "replace", configuration: { compositeGroupId: "eye_handoff" },
    },
  });
  const consumed = [];
  const evaluation = preview.setTick(60000);
  const report = renderEvaluatedTransitionViewport({
    evaluation,
    view: { scale: 2, originX: 3, originY: 4 },
    resolveArtwork: (nodeId) => ({ nodeId }),
    renderer: {
      renderEvaluated(plan, view, resolveArtwork) {
        consumed.push({ plan, view, artwork: plan.batches[0].renderInstances.map((entry) =>
          resolveArtwork(entry.appearanceSamples[0].sourceNodeId)) });
      },
    },
  });
  preview.setRenderReport(report);
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].plan.batches[0].kind, "weighted-premultiplied");
  assert.equal(consumed[0].plan.batches[0].renderInstances.length, 2);
  assert.deepEqual(consumed[0].artwork, [{ nodeId: "node_a" }, { nodeId: "node_b" }]);
  assert.deepEqual(consumed[0].view, { scale: 2, originX: 3, originY: 4 });
  assert.equal(preview.getState().authoritative, true);
});

test("actual renderer path uses evaluator opacity, appearance and composite weights", async () => {
  const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  assert.match(source, /renderInstance\.opacity/);
  assert.match(source, /sample\.weight/);
  assert.match(source, /renderInstance\.compositeWeight/);
  assert.match(source, /gl\.blendFunc\(gl\.ONE, gl\.ONE\)/);
  assert.doesNotMatch(source, /PartTransition|part\.mode|semanticSlotId/);
});

test("renderer-supported endpoint evaluations are visually equivalent through the preview consumer", () => {
  const { preview } = fixture();
  const captured = [];
  const renderer = { renderEvaluated: (plan) => captured.push(plan) };
  const resolveArtwork = (nodeId) => ({ nodeId });
  for (const evaluation of [preview.jumpToStart(), preview.jumpToEnd()]) {
    const report = renderEvaluatedTransitionViewport({
      evaluation,
      view: { scale: 1, originX: 0, originY: 0 },
      renderer,
      resolveArtwork,
    });
    assert.deepEqual(report.unsupportedReasons, []);
  }
  assert.deepEqual(captured[0].batches[0].renderInstances[0].mesh.positions, [0, 0, 10, 0, 0, 10]);
  assert.deepEqual(captured[1].batches[0].renderInstances[0].mesh.positions, [5, 5, 15, 5, 5, 15]);
  assert.equal(captured[0].batches[0].renderInstances[0].appearanceSamples[0].sourceNodeId, "node_a");
  assert.equal(captured[1].batches[0].renderInstances[0].appearanceSamples[0].sourceNodeId, "node_b");
});

test("renderer-unsupported evaluated clipping marks the controller non-authoritative", () => {
  const { preview } = fixture();
  preview.addTrack({ kind: "ClippingTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "clipping" });
  preview.addKeyframe("clipping", "clipping", {
    id: "clip_key", timeTicks: 0, value: { sourceNodeId: "node_a" }, interpolationToNext: { kind: "step" },
  });
  const evaluation = preview.setTick(60000);
  const report = renderEvaluatedTransitionViewport({
    evaluation,
    view: { scale: 1, originX: 0, originY: 0 },
    renderer: { renderEvaluated() {} },
    resolveArtwork: (nodeId) => ({ nodeId }),
  });
  preview.setRenderReport(report);
  assert.equal(preview.getState().authoritative, false);
  assert.match(preview.getState().authorityReasons[0], /Clipping rasterization is unsupported/);
});

test("transition-default track and SemanticSlot override use the existing evaluator precedence", () => {
  const { preview } = fixture();
  preview.addTrack({ kind: "OpacityTrack", target: { transitionDefault: true }, trackId: "opacity_default" });
  preview.addKeyframe("opacity_default", "opacity", {
    id: "opacity_default_key", timeTicks: 0, value: 0.2, interpolationToNext: { kind: "linear" },
  });
  preview.addTrack({ kind: "OpacityTrack", target: { semanticSlotId: "semantic_eye" }, trackId: "opacity_override" });
  preview.addKeyframe("opacity_override", "opacity", {
    id: "opacity_override_key", timeTicks: 0, value: 0.7, interpolationToNext: { kind: "linear" },
  });
  assert.equal(preview.setTick(60000).evaluatedParts[0].renderInstances[0].opacity, 0.7);
});
