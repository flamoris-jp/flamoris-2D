import { objectSelectionForMode } from "./editor-modes.js";

export function createSceneEditorView({
  state,
  elements,
  desktopApi,
  setStatus,
  updateEditorModeUi,
  updateZoomOutput,
}) {
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
      toggle.textContent = node.kind === "group"
        ? (state.editor.expandedNodeIds.has(node.id) ? "▾" : "▸")
        : "·";
      toggle.disabled = node.kind !== "group";
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
      lock.textContent = node.locked ? "◆" : (node.kind === "group" ? "G" : "P");

      row.append(toggle, visibility, label, lock);
      row.addEventListener("click", () => {
        const nextNodeId = objectSelectionForMode(
          state.editorMode,
          state.editor.selectedNodeId,
          node.id,
        );
        if (nextNodeId === state.editor.selectedNodeId && node.id !== nextNodeId) {
          setStatus("Edit Mode中はactive mesh-edit targetを変更できません");
          return;
        }
        state.editor.selectNode(nextNodeId);
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
      return;
    }
    elements.displayNameInput.value = node.displayName;
    elements.visibilityInput.checked = node.visible;
    elements.lockedInput.checked = node.locked;
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

  return { render, renderInspector, renderSceneTree };
}
