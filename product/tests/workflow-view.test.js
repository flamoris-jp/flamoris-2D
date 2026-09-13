import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflowView } from "../src/ui/workflow-view.js";
import { WORKFLOW_MODES } from "../src/ui/workflow-modes.js";

function element() {
  return {
    hidden: false,
    value: "",
    textContent: "",
    title: "",
    dataset: {},
    children: [],
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
    },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    replaceChildren(...children) { this.children = children; },
    prepend(child) { this.children.unshift(child); },
  };
}

function fixture(workflowMode, { content = true } = {}) {
  const elements = {};
  for (const key of [
    "workspace", "workflowHint", "contextualModeSelector", "editorModeSelect",
    "scenePanel", "assetControls", "assetOpenLabel", "legacyMeshLab", "legacyMeshControls", "resetButton",
    "legacyMotionControls", "inspectorPanel", "exportWorkflowPanel",
    "transitionAuthoringPanel", "inspectorEmpty", "inspectorForm",
    "nodeTransformControls", "transitionAuthoringHeading", "activeTransitionField",
    "meshAuthoringHeading",
    "transitionEndpointCard", "keyArtSummary", "transitionMappingCard",
    "partTransitionCard", "endpointMeshCard", "transitionPreviewCard",
    "transitionDiagnosticsCard", "sequenceTimelinePanel", "sequenceAuthoringToolbar",
    "sequenceAuthoringWorkspace", "emptyState",
    "boneControls", "rotationConstraintControls", "boneMirrorControls", "ikControls",
    "rigidBindingControls", "weightAuthoringControls", "formCorrectionControls",
    "deformerControls", "clippingControls",
  ]) elements[key] = element();
  elements.workflowButtons = ["asset", "mesh", "rig", "motion", "preview", "export"]
    .map((mode) => {
      const button = element();
      button.dataset.workflowMode = mode;
      return button;
    });
  const transformToolbar = element();
  const transformTool = element();
  transformTool.parentElement = transformToolbar;
  elements.transformTools = [transformTool];
  const project = {
    scene: { nodes: content ? { root: {}, part: {} } : { root: {} } },
    keyArts: [],
    transitions: [],
    animationClips: [],
    sequences: [],
  };
  const state = {
    mode: "psd",
    workflowMode,
    editorMode: "object",
    psdParts: content ? [{}] : [],
    editor: { session: { project } },
  };
  return { state, elements, transformToolbar };
}

test("workflow view applies contextual visibility after feature views render", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => element() };
  try {
    const mesh = fixture(WORKFLOW_MODES.MESH);
    createWorkflowView(mesh).render();
    assert.equal(mesh.elements.scenePanel.hidden, false);
    assert.equal(mesh.elements.legacyMeshLab.hidden, false);
    assert.equal(mesh.elements.legacyMeshControls.hidden, false);
    assert.equal(mesh.elements.transitionAuthoringPanel.hidden, false);
    assert.equal(mesh.elements.transitionAuthoringHeading.hidden, true);
    assert.equal(mesh.elements.activeTransitionField.hidden, true);
    assert.equal(mesh.elements.meshAuthoringHeading.hidden, false);
    assert.equal(mesh.elements.endpointMeshCard.hidden, false);
    assert.equal(mesh.elements.transitionPreviewCard.hidden, true);
    assert.equal(mesh.elements.sequenceTimelinePanel.hidden, true);

    const rig = fixture(WORKFLOW_MODES.RIG);
    createWorkflowView(rig).render();
    assert.equal(rig.elements.transitionAuthoringPanel.hidden, true);
    assert.equal(rig.elements.inspectorForm.hidden, false);
    assert.equal(rig.elements.contextualModeSelector.hidden, false);
    assert.equal(rig.elements.legacyMeshLab.hidden, true);

    const motion = fixture(WORKFLOW_MODES.MOTION);
    createWorkflowView(motion).render();
    assert.equal(motion.elements.transitionAuthoringHeading.hidden, false);
    assert.equal(motion.elements.activeTransitionField.hidden, false);
    assert.equal(motion.elements.meshAuthoringHeading.hidden, true);
    assert.equal(motion.elements.endpointMeshCard.hidden, true);
    assert.equal(motion.elements.transitionPreviewCard.hidden, false);
    assert.equal(motion.elements.sequenceTimelinePanel.hidden, false);
    assert.equal(motion.elements.sequenceAuthoringWorkspace.hidden, false);

    const preview = fixture(WORKFLOW_MODES.PREVIEW);
    createWorkflowView(preview).render();
    assert.equal(preview.elements.transitionPreviewCard.hidden, false);
    assert.equal(preview.elements.sequenceTimelinePanel.hidden, false);
    assert.equal(preview.elements.sequenceAuthoringToolbar.hidden, true);
    assert.equal(preview.elements.sequenceAuthoringWorkspace.hidden, true);

    const exporting = fixture(WORKFLOW_MODES.EXPORT);
    createWorkflowView(exporting).render();
    assert.equal(exporting.elements.exportWorkflowPanel.hidden, false);
    assert.equal(exporting.elements.transitionAuthoringPanel.hidden, true);
    assert.equal(exporting.elements.sequenceTimelinePanel.hidden, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("blank Project remains a compact first-action surface", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => element() };
  try {
    const blank = fixture(WORKFLOW_MODES.RIG, { content: false });
    createWorkflowView(blank).render();
    assert.equal(blank.elements.workspace.dataset.layout, "canvas");
    assert.equal(blank.elements.scenePanel.hidden, true);
    assert.equal(blank.elements.inspectorPanel.hidden, true);
    assert.equal(blank.elements.emptyState.hidden, false);
  } finally {
    globalThis.document = previousDocument;
  }
});
