import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_MODES } from "../src/ui/editor-modes.js";
import {
  defaultEditorModeForWorkflow,
  projectWorkflowPanels,
  WORKFLOW_LABELS,
  WORKFLOW_MODES,
  WORKFLOW_ORDER,
  workflowEditorTools,
  workflowForEditorMode,
  workflowOwnsEditorMode,
} from "../src/ui/workflow-modes.js";

test("workflow navigation projects the Japanese production order", () => {
  assert.deepEqual(WORKFLOW_ORDER.map((mode) => WORKFLOW_LABELS[mode]), [
    "素材", "メッシュ", "リグ", "動き", "プレビュー", "書き出し",
  ]);
});

test("workflow maps to existing low-level editor modes without duplicating them", () => {
  assert.equal(defaultEditorModeForWorkflow(WORKFLOW_MODES.ASSET), EDITOR_MODES.OBJECT);
  assert.equal(defaultEditorModeForWorkflow(WORKFLOW_MODES.MESH), EDITOR_MODES.TOPOLOGY);
  assert.equal(defaultEditorModeForWorkflow(WORKFLOW_MODES.MESH, { contentMode: "png" }),
    EDITOR_MODES.DEFORM);
  assert.equal(workflowForEditorMode(EDITOR_MODES.WEIGHT), WORKFLOW_MODES.RIG);
  assert.equal(workflowForEditorMode(EDITOR_MODES.FORM_CORRECTION), WORKFLOW_MODES.RIG);
  assert.equal(workflowForEditorMode(EDITOR_MODES.IK), WORKFLOW_MODES.RIG);
  assert.equal(workflowForEditorMode(EDITOR_MODES.TOPOLOGY), WORKFLOW_MODES.MESH);
});

test("all low-level authoring capabilities remain reachable contextually", () => {
  const tools = [...workflowEditorTools(WORKFLOW_MODES.ASSET),
    ...workflowEditorTools(WORKFLOW_MODES.MESH),
    ...workflowEditorTools(WORKFLOW_MODES.RIG)].map((entry) => entry.editorMode);
  for (const mode of [EDITOR_MODES.OBJECT, EDITOR_MODES.DEFORM, EDITOR_MODES.TOPOLOGY,
    EDITOR_MODES.WEIGHT, EDITOR_MODES.FORM_CORRECTION, EDITOR_MODES.IK]) {
    assert.ok(tools.includes(mode), mode + " must remain reachable");
  }
  assert.equal(workflowOwnsEditorMode(WORKFLOW_MODES.RIG, EDITOR_MODES.IK), true);
  assert.equal(workflowOwnsEditorMode(WORKFLOW_MODES.MESH, EDITOR_MODES.IK), false);
});

test("panel projection hides unrelated authoring surfaces instead of disabling them", () => {
  const mesh = projectWorkflowPanels(WORKFLOW_MODES.MESH, { hasProject: true });
  assert.equal(mesh.meshAuthoring, true);
  assert.equal(mesh.meshContext, true);
  assert.equal(mesh.transitionPanel, false);
  assert.equal(mesh.motionAuthoring, false);
  assert.equal(mesh.sequenceTimeline, false);
  assert.equal(mesh.exportControls, false);

  const rig = projectWorkflowPanels(WORKFLOW_MODES.RIG, { hasProject: true });
  assert.equal(rig.rigControls, true);
  assert.equal(rig.transitionPanel, false);

  const motion = projectWorkflowPanels(WORKFLOW_MODES.MOTION, { hasProject: true });
  assert.equal(motion.motionAuthoring, true);
  assert.equal(motion.sequenceAuthoring, true);
  assert.equal(motion.meshAuthoring, false);

  const preview = projectWorkflowPanels(WORKFLOW_MODES.PREVIEW, { hasProject: true });
  assert.equal(preview.previewControls, true);
  assert.equal(preview.sequenceTimeline, true);
  assert.equal(preview.sequenceAuthoring, false);
});

test("empty project projection leaves only the first-action experience", () => {
  for (const mode of WORKFLOW_ORDER) {
    const projection = projectWorkflowPanels(mode, { hasProject: false });
    assert.equal(projection.empty, true);
    assert.equal(projection.scenePanel, false);
    assert.equal(projection.inspectorPanel, false);
    assert.equal(projection.sequenceTimeline, false);
  }
});
