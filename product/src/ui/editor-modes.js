import { moveVertices } from "../mesh.js";

export const EDITOR_MODES = Object.freeze({
  OBJECT: "object",
  DEFORM: "deform",
  TOPOLOGY: "topology",
  WEIGHT: "weight",
  FORM_CORRECTION: "form-correction",
  IK: "ik",
  // Compatibility alias for callers from the Phase 1/2 Edit Mode surface.
  EDIT: "deform",
});

export function isMeshAuthoringMode(editorMode) {
  return [EDITOR_MODES.DEFORM, EDITOR_MODES.TOPOLOGY, EDITOR_MODES.WEIGHT,
    EDITOR_MODES.FORM_CORRECTION, "edit"].includes(editorMode);
}

export function canvasInteractionRoute({
  input = "pointerdown",
  contentMode,
  editorMode,
  button = 0,
  panRequested = false,
} = {}) {
  if (input === "wheel") return "zoom";
  if (input !== "pointerdown") return "none";
  if (button === 1 || (button === 0 && panRequested)) return "pan";
  if (button !== 0) return "none";
  if (contentMode === "png") return "mesh";
  if (contentMode !== "psd") return "none";
  return isMeshAuthoringMode(editorMode) ? "mesh" : "object";
}

export function editModeAvailability({
  contentMode,
  selectedNodeId,
  selectedPart,
  selectedNode,
  mesh,
} = {}) {
  if (contentMode !== "psd") {
    return { allowed: false, reason: "Mesh authoring modeはPSD render partで使用できます" };
  }
  if (!selectedNodeId || !selectedNode) {
    return { allowed: false, reason: "Mesh authoring modeへ入るにはPSD partを選択してください" };
  }
  if (selectedNode.kind === "group") {
    return { allowed: false, reason: "Groupはmesh編集できません。render partを選択してください" };
  }
  if (selectedNode.locked) {
    return { allowed: false, reason: "ロック中のpartはmesh編集できません" };
  }
  if (selectedNode.effectiveVisible === false) {
    return { allowed: false, reason: "非表示のpartはmesh編集できません" };
  }
  if (!selectedPart?.canvas || selectedPart.nodeId !== selectedNodeId) {
    return { allowed: false, reason: "選択partに編集可能なrender assetがありません" };
  }
  if (!mesh) {
    return { allowed: false, reason: "選択partのmesh edit pathを利用できません" };
  }
  return { allowed: true, reason: "" };
}

export function objectSelectionForMode(editorMode, currentNodeId, pickedNodeId) {
  return isMeshAuthoringMode(editorMode) ? currentNodeId : pickedNodeId;
}

export function updateVertexSelection(currentSelection, vertexIndex, shiftKey) {
  const next = new Set(currentSelection);
  if (vertexIndex < 0) {
    if (!shiftKey) next.clear();
    return next;
  }
  if (shiftKey) {
    if (next.has(vertexIndex)) next.delete(vertexIndex);
    else next.add(vertexIndex);
  } else if (!next.has(vertexIndex)) {
    next.clear();
    next.add(vertexIndex);
  }
  return next;
}

export function dragSelectedVertices(mesh, selectedVertices, from, to) {
  if (!mesh || !selectedVertices?.size) return false;
  moveVertices(mesh, selectedVertices, to.x - from.x, to.y - from.y);
  return true;
}
