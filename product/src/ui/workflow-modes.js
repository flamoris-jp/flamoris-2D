import { EDITOR_MODES } from "./editor-modes.js";

export const WORKFLOW_MODES = Object.freeze({
  ASSET: "asset",
  MESH: "mesh",
  RIG: "rig",
  MOTION: "motion",
  PREVIEW: "preview",
  EXPORT: "export",
});

export const WORKFLOW_ORDER = Object.freeze([
  WORKFLOW_MODES.ASSET,
  WORKFLOW_MODES.MESH,
  WORKFLOW_MODES.RIG,
  WORKFLOW_MODES.MOTION,
  WORKFLOW_MODES.PREVIEW,
  WORKFLOW_MODES.EXPORT,
]);

export const WORKFLOW_LABELS = Object.freeze({
  [WORKFLOW_MODES.ASSET]: "素材",
  [WORKFLOW_MODES.MESH]: "メッシュ",
  [WORKFLOW_MODES.RIG]: "リグ",
  [WORKFLOW_MODES.MOTION]: "動き",
  [WORKFLOW_MODES.PREVIEW]: "プレビュー",
  [WORKFLOW_MODES.EXPORT]: "書き出し",
});

export const WORKFLOW_HINTS = Object.freeze({
  [WORKFLOW_MODES.ASSET]: "素材を開き、パーツと配置を確認します",
  [WORKFLOW_MODES.MESH]: "頂点・辺・トポロジーとキーフォームを編集します",
  [WORKFLOW_MODES.RIG]: "ワープ、ボーン、ウェイト、補正、IKを設定します",
  [WORKFLOW_MODES.MOTION]: "キーアート、トランジション、クリップ、シーケンスを編集します",
  [WORKFLOW_MODES.PREVIEW]: "再生とスクラブで動きを確認します",
  [WORKFLOW_MODES.EXPORT]: "既存の決定的な書き出し設定を開きます",
});

const WORKFLOW_EDITOR_TOOLS = Object.freeze({
  [WORKFLOW_MODES.ASSET]: Object.freeze([
    Object.freeze({ editorMode: EDITOR_MODES.OBJECT, label: "パーツ配置" }),
  ]),
  [WORKFLOW_MODES.MESH]: Object.freeze([
    Object.freeze({ editorMode: EDITOR_MODES.TOPOLOGY, label: "トポロジー" }),
    Object.freeze({ editorMode: EDITOR_MODES.DEFORM, label: "頂点位置" }),
  ]),
  [WORKFLOW_MODES.RIG]: Object.freeze([
    Object.freeze({ editorMode: EDITOR_MODES.OBJECT, label: "ワープ・ボーン" }),
    Object.freeze({ editorMode: EDITOR_MODES.WEIGHT, label: "ウェイト" }),
    Object.freeze({ editorMode: EDITOR_MODES.FORM_CORRECTION, label: "フォーム補正" }),
    Object.freeze({ editorMode: EDITOR_MODES.IK, label: "IK" }),
  ]),
  [WORKFLOW_MODES.MOTION]: Object.freeze([]),
  [WORKFLOW_MODES.PREVIEW]: Object.freeze([]),
  [WORKFLOW_MODES.EXPORT]: Object.freeze([]),
});

export function workflowEditorTools(workflowMode) {
  return WORKFLOW_EDITOR_TOOLS[workflowMode] || Object.freeze([]);
}

export function workflowForEditorMode(editorMode, fallback = WORKFLOW_MODES.ASSET) {
  if ([EDITOR_MODES.TOPOLOGY, EDITOR_MODES.DEFORM, "edit"].includes(editorMode)) {
    return WORKFLOW_MODES.MESH;
  }
  if ([EDITOR_MODES.WEIGHT, EDITOR_MODES.FORM_CORRECTION, EDITOR_MODES.IK]
    .includes(editorMode)) return WORKFLOW_MODES.RIG;
  return fallback;
}

export function defaultEditorModeForWorkflow(workflowMode, { contentMode = "psd" } = {}) {
  if (workflowMode === WORKFLOW_MODES.MESH) {
    return contentMode === "png" ? EDITOR_MODES.DEFORM : EDITOR_MODES.TOPOLOGY;
  }
  return EDITOR_MODES.OBJECT;
}

export function workflowOwnsEditorMode(workflowMode, editorMode) {
  return workflowEditorTools(workflowMode)
    .some((tool) => tool.editorMode === editorMode ||
      (tool.editorMode === EDITOR_MODES.DEFORM && editorMode === "edit"));
}

export function projectWorkflowPanels(workflowMode, { hasProject = false } = {}) {
  const empty = !hasProject;
  return Object.freeze({
    empty,
    scenePanel: !empty && [WORKFLOW_MODES.ASSET, WORKFLOW_MODES.MESH,
      WORKFLOW_MODES.RIG].includes(workflowMode),
    inspectorPanel: !empty,
    assetControls: !empty && workflowMode === WORKFLOW_MODES.ASSET,
    sceneTree: !empty && [WORKFLOW_MODES.ASSET, WORKFLOW_MODES.MESH,
      WORKFLOW_MODES.RIG].includes(workflowMode),
    legacyMesh: !empty && workflowMode === WORKFLOW_MODES.MESH,
    legacyMotion: !empty && workflowMode === WORKFLOW_MODES.MOTION,
    selectionInspector: !empty && [WORKFLOW_MODES.ASSET, WORKFLOW_MODES.RIG]
      .includes(workflowMode),
    transformControls: !empty && workflowMode === WORKFLOW_MODES.ASSET,
    rigControls: !empty && workflowMode === WORKFLOW_MODES.RIG,
    transitionPanel: !empty && [WORKFLOW_MODES.MOTION,
      WORKFLOW_MODES.PREVIEW].includes(workflowMode),
    meshContext: !empty && workflowMode === WORKFLOW_MODES.MESH,
    motionAuthoring: !empty && workflowMode === WORKFLOW_MODES.MOTION,
    meshAuthoring: !empty && workflowMode === WORKFLOW_MODES.MESH,
    previewControls: !empty && [WORKFLOW_MODES.MOTION, WORKFLOW_MODES.PREVIEW]
      .includes(workflowMode),
    transitionDiagnostics: !empty && workflowMode === WORKFLOW_MODES.MOTION,
    sequenceTimeline: !empty && [WORKFLOW_MODES.MOTION, WORKFLOW_MODES.PREVIEW]
      .includes(workflowMode),
    sequenceAuthoring: !empty && workflowMode === WORKFLOW_MODES.MOTION,
    exportControls: !empty && workflowMode === WORKFLOW_MODES.EXPORT,
  });
}
