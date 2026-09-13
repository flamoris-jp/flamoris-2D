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
  canSelectMeshPreparationPart = () => false,
}) {
  function selectSceneNode(nodeId) {
    const requestedNode = state.editor.getNode?.(nodeId) || null;
    const nextNodeId = requestedNode?.kind === "deformer" ||
      (requestedNode?.kind === "part" && canSelectMeshPreparationPart())
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
      const expandable = ["group", "deformer", "bone"].includes(node.kind);
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
        (node.kind === "group" ? "G" : node.kind === "deformer" ? "D" :
          node.kind === "bone" ? "B" : "P");
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
      elements.boneControls.hidden = true;
      elements.rotationConstraintControls.hidden = true;
      elements.boneMirrorControls.hidden = true;
      elements.ikControls.hidden = true;
      elements.rigidBindingControls.hidden = true;
      elements.weightAuthoringControls.hidden = true;
      elements.formCorrectionControls.hidden = true;
      return;
    }
    elements.displayNameInput.value = node.displayName;
    elements.visibilityInput.checked = node.visible;
    elements.lockedInput.checked = node.locked;
    elements.nodeTransformControls.hidden = node.kind === "bone";
    const bone = state.editor.boneAuthoring.getState();
    elements.boneControls.hidden = node.kind !== "bone";
    if (node.kind === "bone" && bone.selectedBone) {
      elements.boneModeSelect.value = bone.mode;
      for (const select of [elements.boneActiveKeyArtSelect, elements.boneGhostKeyArtSelect]) {
        const current = select === elements.boneActiveKeyArtSelect
          ? bone.activeKeyArt?.id || "" : bone.ghostKeyArtId || "";
        select.replaceChildren();
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = select === elements.boneActiveKeyArtSelect
          ? "— Select Key Art —" : "— Off —";
        select.append(empty);
        for (const keyArt of bone.keyArts) {
          const option = document.createElement("option");
          option.value = keyArt.id;
          option.textContent = `${keyArt.displayName} (${keyArt.id})`;
          select.append(option);
        }
        select.value = current;
      }
      const value = bone.editableValue;
      elements.boneXInput.value = String(value.x);
      elements.boneYInput.value = String(value.y);
      elements.boneRotationInput.value = String(Number((value.rotation * 180 / Math.PI).toFixed(4)));
      elements.boneLengthInput.value = bone.mode === "edit" ? String(value.length) : "";
      elements.boneLengthLabel.hidden = bone.mode !== "edit";
      elements.resetBonePoseButton.disabled = bone.mode !== "pose" || !bone.keyform;
      elements.boneAuthoringStatus.textContent = bone.mode === "pose"
        ? bone.activeKeyArt
          ? `${bone.activeKeyArt.displayName} · ${bone.keyform ? "authored localDelta" : "identity delta"}`
          : "Pose mode requires an explicit active Key Art."
        : "Rest head / rotation / length";
      elements.boneParentSelect.replaceChildren();
      const appendParent = (entry, depth = 0) => {
        if (["group", "deformer", "bone"].includes(entry.kind) && entry.id !== node.id) {
          const option = document.createElement("option");
          option.value = entry.id;
          option.textContent = `${"  ".repeat(depth)}${entry.displayName} (${entry.kind})`;
          elements.boneParentSelect.append(option);
        }
        entry.children.forEach((child) => appendParent(child, depth + 1));
      };
      appendParent(state.editor.session.query("scene.get_tree", { includeHidden: true }));
      elements.boneParentSelect.value = bone.selectedBone.parentNodeId;
    }
    elements.rotationConstraintControls.hidden = node.kind !== "bone";
    elements.boneMirrorControls.hidden = node.kind !== "bone";
    if (node.kind === "bone") {
      const rotationConstraint = state.editor.session.query(
        "bone.get_rotation_constraint_for_bone", { boneId: node.id });
      elements.rotationConstraintEnabledInput.checked = Boolean(rotationConstraint?.enabled);
      elements.rotationConstraintEnabledInput.disabled = !rotationConstraint;
      elements.rotationConstraintMinInput.value = String(Number((
        (rotationConstraint?.minRotation ?? -Math.PI) * 180 / Math.PI).toFixed(4)));
      elements.rotationConstraintMaxInput.value = String(Number((
        (rotationConstraint?.maxRotation ?? Math.PI) * 180 / Math.PI).toFixed(4)));
      elements.rotationConstraintMinInput.disabled = !rotationConstraint;
      elements.rotationConstraintMaxInput.disabled = !rotationConstraint;
      elements.createRotationConstraintButton.disabled = Boolean(rotationConstraint);
      elements.removeRotationConstraintButton.disabled = !rotationConstraint;

      const mirror = state.editor.boneMirrorAuthoring.getState();
      const bones = state.editor.session.query("bone.list");
      for (const [select, emptyLabel, current] of [
        [elements.mirrorSourceBoneSelect, "Source", mirror.sourceBoneId || node.id],
        [elements.mirrorTargetBoneSelect, "Target", mirror.targetBoneId],
      ]) {
        select.replaceChildren();
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = `— ${emptyLabel} —`;
        select.append(empty);
        for (const candidate of bones) {
          const option = document.createElement("option");
          option.value = candidate.id;
          option.textContent = `${candidate.displayName} (${candidate.id})`;
          select.append(option);
        }
        select.value = current || "";
      }
      elements.mirrorKeyArtSelect.replaceChildren();
      const noKeyArt = document.createElement("option");
      noKeyArt.value = "";
      noKeyArt.textContent = "— Select Key Art —";
      elements.mirrorKeyArtSelect.append(noKeyArt);
      for (const keyArt of state.editor.session.query("keyart.list")) {
        const option = document.createElement("option");
        option.value = keyArt.id;
        option.textContent = `${keyArt.displayName} (${keyArt.id})`;
        elements.mirrorKeyArtSelect.append(option);
      }
      elements.mirrorKeyArtSelect.value = mirror.activeKeyArtId ||
        bone.activeKeyArt?.id || "";
      elements.mirrorAxisXInput.value = String(mirror.axisX);
      const hasPair = Boolean(elements.mirrorSourceBoneSelect.value &&
        elements.mirrorTargetBoneSelect.value &&
        elements.mirrorSourceBoneSelect.value !== elements.mirrorTargetBoneSelect.value);
      elements.mirrorBoneRestButton.disabled = !hasPair;
      elements.mirrorBonePoseButton.disabled = !hasPair || !elements.mirrorKeyArtSelect.value;
    }
    const ik = state.editor.twoBoneIkAuthoring.getState();
    elements.ikControls.hidden = state.editorMode !== "ik";
    if (state.editorMode === "ik") {
      elements.ikConstraintSelect.replaceChildren();
      const noConstraint = document.createElement("option");
      noConstraint.value = "";
      noConstraint.textContent = "— Select IK —";
      elements.ikConstraintSelect.append(noConstraint);
      for (const constraint of ik.constraints) {
        const option = document.createElement("option");
        option.value = constraint.id;
        option.textContent = `${constraint.id}${constraint.enabled ? "" : " (disabled)"}`;
        elements.ikConstraintSelect.append(option);
      }
      elements.ikConstraintSelect.value = ik.activeConstraintId || "";
      elements.ikKeyArtSelect.replaceChildren();
      const noKeyArt = document.createElement("option");
      noKeyArt.value = "";
      noKeyArt.textContent = "— Select Key Art —";
      elements.ikKeyArtSelect.append(noKeyArt);
      for (const keyArt of state.editor.session.query("keyart.list")) {
        const option = document.createElement("option");
        option.value = keyArt.id;
        option.textContent = `${keyArt.displayName} (${keyArt.id})`;
        elements.ikKeyArtSelect.append(option);
      }
      elements.ikKeyArtSelect.value = ik.activeKeyArtId || "";
      const bones = state.editor.session.query("bone.list");
      for (const [select, role] of [
        [elements.ikRootBoneSelect, "Root"],
        [elements.ikMidBoneSelect, "Mid"],
        [elements.ikEndBoneSelect, "End"],
      ]) {
        const current = ik.activeConstraint
          ? ik.activeConstraint[`${role.toLowerCase()}BoneId`] : select.value;
        select.replaceChildren();
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = `— ${role} —`;
        select.append(empty);
        for (const candidate of bones) {
          const option = document.createElement("option");
          option.value = candidate.id;
          option.textContent = `${candidate.displayName} (${candidate.id})`;
          select.append(option);
        }
        select.value = current || "";
      }
      elements.ikBendDirectionSelect.value =
        ik.activeConstraint?.bendDirection || "counterclockwise";
      elements.ikEnabledInput.checked = Boolean(ik.activeConstraint?.enabled);
      elements.ikEnabledInput.disabled = !ik.activeConstraint;
      elements.removeIkConstraintButton.disabled = !ik.activeConstraint;
      elements.createIkConstraintButton.disabled = Boolean(ik.activeConstraint) ||
        !elements.ikRootBoneSelect.value || !elements.ikMidBoneSelect.value ||
        !elements.ikEndBoneSelect.value;
      elements.ikAuthoringStatus.textContent = ik.dragging
        ? "Transient analytic solve · release to bake one history unit"
        : ik.activeConstraint && ik.activeKeyArtId
          ? "Drag the viewport target handle to bake root/mid Bone poses."
          : "Select an IK constraint and explicit Key Art.";
    }
    elements.rigidBindingControls.hidden = node.kind !== "part";
    if (node.kind === "part") {
      const bindings = state.editor.session.query("bone.list_rigid_bindings");
      const binding = bindings.find((entry) => entry.targetNodeId === node.id) || null;
      elements.rigidBindingBoneSelect.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— No attachment —";
      elements.rigidBindingBoneSelect.append(empty);
      for (const candidate of state.editor.session.query("bone.list")) {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = `${candidate.displayName} (${candidate.id})`;
        elements.rigidBindingBoneSelect.append(option);
      }
      elements.rigidBindingBoneSelect.value = binding?.boneId || "";
      elements.rigidBindingEnabledInput.checked = Boolean(binding?.enabled);
      elements.rigidBindingEnabledInput.disabled = !binding;
      elements.removeRigidBindingButton.disabled = !binding;
    }
    const weight = state.editor.weightAuthoring.getState();
    elements.weightAuthoringControls.hidden = state.editorMode !== "weight";
    if (state.editorMode === "weight") {
      const bindings = state.editor.session.query("skin.list_bindings")
        .filter((entry) => entry.targetNodeId === node.id);
      elements.weightBindingSelect.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— Select binding —";
      elements.weightBindingSelect.append(empty);
      for (const binding of bindings) {
        const option = document.createElement("option");
        option.value = binding.id;
        option.textContent = `${binding.id}${binding.enabled ? "" : " (disabled)"}`;
        elements.weightBindingSelect.append(option);
      }
      elements.weightBindingSelect.value = weight.activeBindingId || "";
      elements.createSkinBindingButton.disabled = Boolean(weight.activeBindingId) ||
        !weight.activeBoneId || !state.editor.endpointMesh.getState().selectedTopologyId;
      elements.weightBoneSelect.replaceChildren();
      const noBone = document.createElement("option");
      noBone.value = "";
      noBone.textContent = "— Select Bone —";
      elements.weightBoneSelect.append(noBone);
      for (const boneEntry of state.editor.session.query("bone.list")) {
        const option = document.createElement("option");
        option.value = boneEntry.id;
        option.textContent = `${boneEntry.displayName} (${boneEntry.id})`;
        elements.weightBoneSelect.append(option);
      }
      elements.weightBoneSelect.value = weight.activeBoneId || "";
      elements.weightKeyArtSelect.replaceChildren();
      const noKeyArt = document.createElement("option");
      noKeyArt.value = "";
      noKeyArt.textContent = "— Select Key Art —";
      elements.weightKeyArtSelect.append(noKeyArt);
      for (const keyArt of state.editor.session.query("keyart.list")) {
        const option = document.createElement("option");
        option.value = keyArt.id;
        option.textContent = `${keyArt.displayName} (${keyArt.id})`;
        elements.weightKeyArtSelect.append(option);
      }
      elements.weightKeyArtSelect.value = weight.activeKeyArtId || "";
      elements.weightBrushOperationSelect.value = weight.operation;
      elements.weightBrushStrengthInput.value = String(weight.strength);
      elements.weightSelectedVertexOutput.textContent = weight.selectedVertexId || "—";
      const selectedWeight = weight.activeBindingId && weight.selectedVertexId && weight.activeBoneId
        ? state.editor.session.query("skin.get_vertex_weights", {
          bindingId: weight.activeBindingId, vertexId: weight.selectedVertexId,
        })?.influences.find((entry) => entry.boneId === weight.activeBoneId)?.weight || 0
        : 0;
      elements.weightNumericInput.value = String(selectedWeight);
      const editable = Boolean(weight.activeBindingId && weight.activeBoneId && weight.selectedVertexId);
      elements.setNumericWeightButton.disabled = !editable;
      elements.normalizeWeightButton.disabled = !editable;
      elements.clearWeightInfluenceButton.disabled = !editable || selectedWeight === 0;
      elements.weightAuthoringStatus.textContent = weight.strokeActive
        ? `Transient stroke · ${weight.previewVertexWeights.length} vertices`
        : "Add/Subtract strokes commit on pointer-up as one history unit.";
    }
    const form = state.editor.formCorrectionAuthoring.getState();
    elements.formCorrectionControls.hidden = state.editorMode !== "form-correction";
    if (state.editorMode === "form-correction") {
      const keyArt = state.editor.session.query("keyart.list")
        .find((entry) => entry.id === form.keyArtId);
      elements.formCorrectionKeyArtOutput.textContent = keyArt
        ? `${keyArt.displayName} (${keyArt.id})` : "—";
      elements.formCorrectionVertexOutput.textContent = form.selectedVertexIds.join(", ") || "—";
      elements.resetFormCorrectionButton.disabled = !state.editor.session.query(
        "mesh_form.get_for_context", {
          topologyId: form.topologyId, keyArtId: form.keyArtId,
          semanticSlotId: form.semanticSlotId,
        });
      elements.formCorrectionStatus.textContent = form.gestureActive
        ? "Transient drag preview"
        : "Post-skin correction · one drag is one history unit.";
    }
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
      elements.resetAllDeformerPointsButton.disabled = !deformer.activeKeyArt;
      elements.resetAllDeformerPointsButton.title = deformer.keyform
        ? "Reset all Warp control points"
        : "Create an identity Warp keyform for the active Key Art";
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
