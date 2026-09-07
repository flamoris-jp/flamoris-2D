import { objectSelectionForMode } from "./editor-modes.js";

export function clippingMaskControlState(binding, showMask, transitionPreview) {
  const previewAvailable = transitionPreview?.viewMode === "preview" &&
    Boolean(transitionPreview.evaluation);
  return {
    checked: Boolean(showMask),
    disabled: !binding || !previewAvailable,
    title: previewAvailable
      ? "Show the evaluated clipping-source geometry in Transition Preview."
      : "Available only while an evaluated Transition Preview is visible.",
  };
}

export function createSceneEditorView({
  state,
  elements,
  desktopApi,
  setStatus,
  updateEditorModeUi,
  updateZoomOutput,
}) {
  function selectSceneNode(nodeId) {
    const requestedNode = state.editor.getNode?.(nodeId) || null;
    const nextNodeId = requestedNode?.kind === "deformer"
      ? nodeId
      : objectSelectionForMode(
        state.editorMode,
        state.editor.selectedNodeId,
        nodeId,
      );
    if (nextNodeId === state.editor.selectedNodeId && nodeId !== nextNodeId) {
      setStatus("Edit Mode中はactive mesh-edit targetを変更できません");
      return;
    }
    state.editor.selectNode(nextNodeId);
  }

  function renderSceneTree() {
    elements.sceneTree.replaceChildren();
    elements.sceneSearchInput.disabled = !state.editor;
    if (!state.editor) {
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.textContent = "PSDを読み込むと階層を表示します";
      elements.sceneTree.append(empty);
      return;
    }
    const list = document.createElement("ul");
    list.className = "tree-children";
    const clippingTargets = state.editor.clippingAuthoring.bindingTargetIds();
    const filtered = Boolean(state.editor.filterText.trim());
    const appendNode = (node, parent, depth) => {
      const item = document.createElement("li");
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-selected", String(node.id === state.editor.selectedNodeId));
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = `${depth * 13}px`;
      row.dataset.nodeId = node.id;
      if (node.id === state.editor.selectedNodeId) row.classList.add("selected");
      if (!node.effectiveVisible) row.classList.add("effectively-hidden");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tree-toggle";
      const expandable = ["group", "deformer"].includes(node.kind);
      toggle.textContent = expandable
        ? (state.editor.expandedNodeIds.has(node.id) ? "▾" : "▸")
        : "·";
      toggle.disabled = !expandable;
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        state.editor.toggleExpanded(node.id);
      });

      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "tree-state";
      visibility.textContent = node.visible ? "◉" : "○";
      visibility.title = node.visible ? "非表示にする" : "表示する";
      visibility.addEventListener("click", (event) => {
        event.stopPropagation();
        state.editor.setVisibility(node.id, !node.visible);
      });

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = node.displayName;
      label.title = `${node.displayName} (${node.id})`;
      const lock = document.createElement("span");
      lock.className = node.locked ? "tree-lock" : "tree-kind";
      lock.textContent = node.locked ? "◆" :
        (node.kind === "group" ? "G" : node.kind === "deformer" ? "D" : "P");
      const clipping = document.createElement("span");
      clipping.className = "tree-clipping";
      clipping.textContent = clippingTargets.has(node.id) ? "⊂" : "";
      clipping.title = clippingTargets.has(node.id) ? "Clipping binding" : "";

      row.append(toggle, visibility, label, clipping, lock);
      row.addEventListener("click", () => {
        selectSceneNode(node.id);
      });
      item.append(row);
      parent.append(item);
      if (
        node.children.length &&
        (filtered || state.editor.expandedNodeIds.has(node.id))
      ) {
        const children = document.createElement("ul");
        children.className = "tree-children";
        node.children.forEach((child) => appendNode(child, children, depth + 1));
        item.append(children);
      }
    };
    appendNode(state.editor.getTree(), list, 0);
    elements.sceneTree.append(list);
    elements.sceneTree.querySelector(".tree-row.selected")
      ?.scrollIntoView({ block: "nearest" });
  }

  function renderInspector() {
    const node = state.editor?.selectedNode();
    elements.inspectorEmpty.hidden = Boolean(node);
    elements.inspectorForm.hidden = !node;
    elements.inspectorKind.textContent = node ? node.kind : "未選択";
    if (!node) {
      elements.inspectorForm.reset();
      elements.nodeIdOutput.textContent = "";
      elements.parentOutput.textContent = "";
      elements.transformInputs.forEach((input) => { input.value = ""; });
      elements.deformerControls.hidden = true;
      return;
    }
    elements.displayNameInput.value = node.displayName;
    elements.visibilityInput.checked = node.visible;
    elements.lockedInput.checked = node.locked;
    const deformer = state.editor.deformerAuthoring.getState();
    elements.deformerControls.hidden = !deformer.available;
    if (deformer.available) {
      elements.deformerGridSelect.value = String(deformer.deformer.columns);
      elements.deformerGridSelect.disabled = deformer.gridLocked;
      elements.deformerGridSelect.title = deformer.gridLockReason;
      elements.deformerGridReason.textContent = deformer.gridLockReason;
      elements.deformerActiveKeyArt.textContent = deformer.activeKeyArt
        ? `${deformer.activeKeyArt.endpoint === "from" ? "A" : "B"} · ${deformer.activeKeyArt.displayName}`
        : "Select Key State A or B";
      elements.deformerSelectionCount.textContent = String(deformer.selectedControlPointIds.length);
      elements.resetSelectedDeformerPointsButton.disabled =
        !deformer.keyform || !deformer.selectedControlPointIds.length;
      elements.resetAllDeformerPointsButton.disabled = !deformer.keyform;
    }
    const clipping = state.editor.clippingAuthoring.getState(node.id);
    elements.clippingControls.hidden = !clipping.available;
    if (clipping.available) {
      elements.clippingEnabledInput.checked = Boolean(clipping.binding?.enabled);
      elements.clippingEnabledInput.disabled = !clipping.binding;
      elements.clippingModeSelect.value = clipping.binding?.mode || "inside";
      elements.removeClippingButton.disabled = !clipping.binding;
      const maskControl = clippingMaskControlState(
        clipping.binding,
        clipping.showMask,
        state.editor.transitionPreview.getState(),
      );
      elements.showClippingMaskInput.checked = maskControl.checked;
      elements.showClippingMaskInput.disabled = maskControl.disabled;
      elements.showClippingMaskInput.title = maskControl.title;
      elements.clippingSourceSelect.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— Select source —";
      elements.clippingSourceSelect.append(empty);
      for (const source of clipping.sourceCandidates) {
        const option = document.createElement("option");
        option.value = source.id;
        option.textContent = `${source.displayName} (${source.id})`;
        elements.clippingSourceSelect.append(option);
      }
      elements.clippingSourceSelect.value = clipping.binding?.sourceNodeId || "";
    }
    elements.nodeIdOutput.textContent = node.id;
    const parent = node.parentId
      ? state.editor.session.query("scene.get_node", { nodeId: node.parentId })
      : null;
    elements.parentOutput.textContent = parent
      ? `${parent.displayName} (${parent.id})`
      : "— root —";
    for (const input of elements.transformInputs) {
      const [section, key] = input.dataset.transformPath.split(".");
      let value = key ? node.transform[section][key] : node.transform[section];
      if (input.dataset.transformUnit === "degrees") value = value * 180 / Math.PI;
      input.value = String(Number(value.toFixed(4)));
    }
  }

  function render() {
    renderSceneTree();
    renderInspector();
    elements.undoButton.disabled = !state.editor?.canUndo;
    elements.redoButton.disabled = !state.editor?.canRedo;
    const undoTitle = state.editor?.undoLabel
      ? `Undo: ${state.editor.undoLabel}`
      : "Undo: No operation";
    const redoTitle = state.editor?.redoLabel
      ? `Redo: ${state.editor.redoLabel}`
      : "Redo: No operation";
    elements.undoButton.title = undoTitle;
    elements.redoButton.title = redoTitle;
    elements.undoButton.setAttribute("aria-label", undoTitle);
    elements.redoButton.setAttribute("aria-label", redoTitle);
    const fileName = state.documentController?.currentFileName ||
      state.editor?.session.project.displayName || "Untitled";
    const extension = fileName.toLocaleLowerCase().endsWith(".fl2d") ? "" : ".fl2d";
    const dirty = state.editor?.session.isDirty ? " *" : "";
    const recovered = state.recoveryRestored ? " · Recovered" : "";
    const title = `${fileName}${extension}${dirty}${recovered}`;
    elements.projectTitle.textContent = title;
    document.title = `${title} — FLAMORIS 2D`;
    desktopApi?.updateWindowState({
      fileName: `${fileName}${extension}`,
      displayName: state.editor?.session.project.displayName || "Untitled",
      dirty: Boolean(state.editor?.session.isDirty),
      recovered: state.recoveryRestored,
    });
    elements.transformTools.forEach((button) => {
      button.disabled = !state.editor?.selectedNodeId || state.editorMode !== "object";
      button.classList.toggle(
        "active",
        button.dataset.transformTool === (state.editor?.activeTool || "translate"),
      );
    });
    updateEditorModeUi();
    updateZoomOutput();
  }

  return { render, renderInspector, renderSceneTree, selectSceneNode };
}
