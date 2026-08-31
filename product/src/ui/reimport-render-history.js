function orderedParts(project, partsByNodeId) {
  const result = [];
  const walk = (nodeId) => {
    const part = partsByNodeId.get(nodeId);
    if (part) result.push(part);
    for (const childId of project.scene.nodes[nodeId]?.children || []) walk(childId);
  };
  walk(project.scene.rootId);
  return result;
}

export function buildReviewedRenderParts(
  currentParts,
  importedParts,
  review,
  buildResult,
) {
  const { project, importedNodeAssignments } = buildResult;
  const partsByNodeId = new Map(
    currentParts
      .filter((part) => project.scene.nodes[part.nodeId])
      .map((part) => [part.nodeId, part]),
  );
  const importedByNodeId = new Map(
    importedParts.map((part) => [part.nodeId, part]),
  );
  for (const row of review.rows) {
    if (row.action === "update" && row.currentNodeId) {
      partsByNodeId.delete(row.currentNodeId);
      const importedPart = importedByNodeId.get(row.importedNodeId);
      if (importedPart && project.scene.nodes[row.currentNodeId]) {
        partsByNodeId.set(row.currentNodeId, {
          ...importedPart,
          nodeId: row.currentNodeId,
        });
      }
    }
    if (row.action === "add" && row.importedNodeId) {
      const importedPart = importedByNodeId.get(row.importedNodeId);
      const nodeId = importedNodeAssignments.get(row.importedNodeId);
      if (importedPart && nodeId && project.scene.nodes[nodeId]) {
        partsByNodeId.set(nodeId, { ...importedPart, nodeId });
      }
    }
  }
  return orderedParts(project, partsByNodeId);
}

export class ReimportRenderHistory {
  constructor(editor, { getParts, setParts }) {
    this.editor = editor;
    this.getParts = getParts;
    this.setParts = setParts;
    this.transitions = new WeakMap();
  }

  prepareSelection(project) {
    const selectedNodeId = this.editor.selectedNodeId;
    if (selectedNodeId && !project.scene.nodes[selectedNodeId]) {
      this.editor.selectedNodeId = null;
      this.editor.transformDrag = null;
    }
  }

  apply(review, importedParts) {
    const session = this.editor.session;
    review.assertSessionCurrent(session);
    const buildResult = review.buildResult();
    const beforeParts = [...this.getParts()];
    const afterParts = buildReviewedRenderParts(
      beforeParts,
      importedParts,
      review,
      buildResult,
    );
    const beforeNodeIds = new Set(Object.keys(session.project.scene.nodes));
    const afterNodeIds = new Set(Object.keys(buildResult.project.scene.nodes));
    this.setParts(afterParts);
    this.prepareSelection(buildResult.project);
    const revision = session.currentRevision;
    let result;
    try {
      result = review.apply(session, buildResult);
    } catch (error) {
      this.setParts(session.currentRevision === revision ? beforeParts : afterParts);
      throw error;
    }
    const entry = session.undoStack.at(-1);
    this.transitions.set(entry, {
      beforeParts,
      afterParts,
      beforeNodeIds,
      afterNodeIds,
    });
    return result;
  }

  undo() {
    const entry = this.editor.session.undoStack.at(-1);
    const transition = entry && this.transitions.get(entry);
    if (transition) {
      this.setParts(transition.beforeParts);
      if (this.editor.selectedNodeId &&
        !transition.beforeNodeIds.has(this.editor.selectedNodeId)) {
        this.editor.selectedNodeId = null;
        this.editor.transformDrag = null;
      }
    }
    const revision = this.editor.session.currentRevision;
    try {
      return this.editor.undo();
    } catch (error) {
      if (transition && this.editor.session.currentRevision === revision) {
        this.setParts(transition.afterParts);
      }
      throw error;
    }
  }

  redo() {
    const entry = this.editor.session.redoStack.at(-1);
    const transition = entry && this.transitions.get(entry);
    if (transition) {
      this.setParts(transition.afterParts);
      if (this.editor.selectedNodeId &&
        !transition.afterNodeIds.has(this.editor.selectedNodeId)) {
        this.editor.selectedNodeId = null;
        this.editor.transformDrag = null;
      }
    }
    const revision = this.editor.session.currentRevision;
    try {
      return this.editor.redo();
    } catch (error) {
      if (transition && this.editor.session.currentRevision === revision) {
        this.setParts(transition.beforeParts);
      }
      throw error;
    }
  }
}
