function projectNodeLabel(project, nodeId) {
  return nodeId ? project.scene.nodes[nodeId]?.displayName || nodeId : "—";
}

export function applyReimportRowAction(review, row, action) {
  if (action === "add") review.markAsNew(row.id);
  else if (action === "keep") review.keepExisting(row.id);
  else if (action === "remove") review.removeExisting(row.id);
  else if (action === "ignore") review.ignore(row.id);
  else if (action === "reset") review.resetToAuto(row.id);
  else if (action === "update" && row.importedNodeId) {
    review.setMatch(row.id, row.importedNodeId);
  }
}

export function createReimportReviewView({ state, elements, setStatus }) {
  function updatePreview(row) {
    const currentPart = state.psdParts.find((part) => part.nodeId === row.currentNodeId);
    const importedPart = state.reimportParts.find((part) => part.nodeId === row.importedNodeId);
    elements.reimportCurrentPreview.src = currentPart?.canvas?.toDataURL?.() || "";
    elements.reimportNewPreview.src = importedPart?.canvas?.toDataURL?.() || "";
  }

  function render() {
    const review = state.reimportReview;
    elements.reimportTableBody.replaceChildren();
    if (!review) return;
    for (const row of review.rows) {
      const tr = document.createElement("tr");
      if (row.id === state.selectedReimportRowId) tr.classList.add("selected");
      const values = [
        row.status,
        projectNodeLabel(review.currentProject, row.currentNodeId),
      ];
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      const matchCell = document.createElement("td");
      const matchSelect = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = row.importedNodeId ? "Current selection" : "Select…";
      matchSelect.append(empty);
      for (const node of Object.values(review.importedProject.scene.nodes)) {
        if (!review.isCompatibleImportedNode(row, node.id)) continue;
        const option = document.createElement("option");
        option.value = node.id;
        option.textContent = node.displayName;
        option.selected = node.id === row.importedNodeId;
        matchSelect.append(option);
      }
      matchSelect.addEventListener("change", (event) => {
        event.stopPropagation();
        try {
          review.setMatch(row.id, matchSelect.value);
          state.selectedReimportRowId = row.id;
          render();
        } catch (error) {
          setStatus(error.message);
          render();
        }
      });
      matchCell.append(matchSelect);
      tr.append(matchCell);
      const source = document.createElement("td");
      source.textContent = `${row.matchSource} · ${row.explanation}`;
      tr.append(source);
      const actionCell = document.createElement("td");
      const action = document.createElement("select");
      for (const [value, label] of [
        ["update", "Keep / Update"], ["add", "Mark as New"],
        ["keep", "Keep Existing"], ["remove", "Remove Existing"],
        ["ignore", "Ignore"], ["reset", "Reset to Auto"],
        ["unresolved", "Resolve…"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === row.action;
        action.append(option);
      }
      action.addEventListener("change", (event) => {
        event.stopPropagation();
        try {
          applyReimportRowAction(review, row, action.value);
        } catch (error) {
          setStatus(error.message);
        }
        render();
      });
      actionCell.append(action);
      tr.append(actionCell);
      tr.addEventListener("click", () => {
        state.selectedReimportRowId = row.id;
        updatePreview(row);
        render();
      });
      elements.reimportTableBody.append(tr);
    }
    const summary = review.summary;
    elements.reimportSummary.textContent =
      `Update ${summary.update} · Add ${summary.add} · Keep ${summary.keep} · ` +
      `Remove ${summary.remove} · Unresolved ${summary.unresolved}`;
    elements.applyReimportButton.disabled = !review.canApply;
    const selected = review.rows.find((row) => row.id === state.selectedReimportRowId);
    if (selected) updatePreview(selected);
  }

  return { render };
}
