import {
  projectWorkflowPanels,
  WORKFLOW_HINTS,
  WORKFLOW_MODES,
  workflowEditorTools,
} from "./workflow-modes.js";

const RIG_CONTROL_KEYS = Object.freeze([
  "boneControls",
  "rotationConstraintControls",
  "boneMirrorControls",
  "ikControls",
  "rigidBindingControls",
  "weightAuthoringControls",
  "formCorrectionControls",
  "deformerControls",
  "clippingControls",
]);

function show(element, visible) {
  if (element) element.hidden = !visible;
}

function setToolOptions(select, tools, editorMode) {
  const signature = tools.map((tool) => tool.editorMode + ":" + tool.label).join("|");
  if (select.dataset.workflowTools !== signature) {
    select.replaceChildren(...tools.map((tool) => {
      const option = document.createElement("option");
      option.value = tool.editorMode;
      option.textContent = tool.label;
      return option;
    }));
    select.dataset.workflowTools = signature;
  }
  if (tools.some((tool) => tool.editorMode === editorMode)) {
    select.value = editorMode;
    return;
  }
  if ([...select.children].some((option) => option.value === "")) {
    select.value = "";
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "編集対象を選択してください";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.prepend(placeholder);
}

export function createWorkflowView({ state, elements }) {
  function render() {
    const project = state.editor?.session?.project || null;
    const hasProject = state.mode === "png" || Boolean(project && (
      state.psdParts?.length ||
      Object.keys(project.scene?.nodes || {}).length > 1 ||
      project.keyArts?.length ||
      project.transitions?.length ||
      project.animationClips?.length ||
      project.sequences?.length
    ));
    const workflowMode = state.workflowMode || WORKFLOW_MODES.ASSET;
    const projection = projectWorkflowPanels(workflowMode, { hasProject });

    const editorProjectAvailable = Boolean(project);
    const scenePanelVisible = projection.scenePanel;
    const inspectorPanelVisible = projection.inspectorPanel &&
      (editorProjectAvailable || projection.exportControls);
    elements.workspace.dataset.workflow = workflowMode;
    elements.workspace.dataset.layout = projection.empty
      ? "canvas"
      : scenePanelVisible && inspectorPanelVisible
        ? "full"
        : scenePanelVisible
          ? "left-canvas"
          : inspectorPanelVisible
            ? "canvas-right"
            : "canvas";
    elements.workflowHint.textContent = projection.empty
      ? "最初に「素材を開く」から始めます"
      : WORKFLOW_HINTS[workflowMode];
    elements.workflowButtons.forEach((button) => {
      const active = button.dataset.workflowMode === workflowMode;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.title = WORKFLOW_HINTS[button.dataset.workflowMode] || "";
    });

    let tools = workflowEditorTools(workflowMode);
    if (state.mode === "png") {
      tools = tools.filter((tool) => tool.editorMode !== "topology");
    }
    const showToolSelector = hasProject && tools.length > 1;
    show(elements.contextualModeSelector, showToolSelector);
    if (showToolSelector) setToolOptions(elements.editorModeSelect, tools, state.editorMode);

    show(elements.scenePanel, scenePanelVisible);
    show(elements.assetControls, projection.assetControls);
    show(elements.legacyMeshLab, projection.legacyMesh || projection.legacyMotion);
    show(elements.legacyMeshControls, projection.legacyMesh);
    show(elements.legacyMotionControls, projection.legacyMotion);
    show(elements.inspectorPanel, inspectorPanelVisible);
    show(elements.exportWorkflowPanel, projection.exportControls);
    show(elements.transitionAuthoringPanel,
      projection.transitionPanel && editorProjectAvailable);

    if (!projection.selectionInspector) {
      show(elements.inspectorEmpty, false);
      show(elements.inspectorForm, false);
    }
    if (!projection.transformControls) show(elements.nodeTransformControls, false);
    if (!projection.rigControls) {
      for (const key of RIG_CONTROL_KEYS) show(elements[key], false);
    }

    if (projection.transitionPanel) {
      show(elements.transitionAuthoringHeading, true);
      show(elements.activeTransitionField, true);
      show(elements.transitionEndpointCard, projection.motionAuthoring);
      show(elements.keyArtSummary, projection.motionAuthoring);
      show(elements.transitionMappingCard,
        projection.motionAuthoring || projection.meshAuthoring);
      show(elements.partTransitionCard, projection.motionAuthoring);
      show(elements.endpointMeshCard, projection.meshAuthoring);
      show(elements.transitionPreviewCard, projection.previewControls);
      show(elements.transitionTrackEditor, projection.motionAuthoring);
      show(elements.transitionDiagnosticsCard, projection.transitionDiagnostics);
    }

    show(elements.sequenceTimelinePanel, projection.sequenceTimeline);
    if (projection.sequenceTimeline) {
      show(elements.sequenceAuthoringToolbar, projection.sequenceAuthoring);
      show(elements.sequenceAuthoringWorkspace, projection.sequenceAuthoring);
    }
    const transformToolbar = elements.transformTools[0]?.parentElement;
    if (transformToolbar && !projection.transformControls) transformToolbar.hidden = true;
    elements.emptyState.hidden = !projection.empty;
    return projection;
  }

  return Object.freeze({ render });
}
