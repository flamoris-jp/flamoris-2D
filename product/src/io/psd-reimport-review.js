import { cloneProject } from "../model/project.js";
import { reconcilePsdProject } from "./psd-project.js";

export const PSD_REIMPORT_STATUSES = Object.freeze([
  "matched",
  "changed",
  "added",
  "missing",
  "ambiguous",
  "unmatched",
]);

function comparableSourceState(node) {
  return {
    displayName: node.displayName,
    visible: node.visible,
    opacity: node.opacity,
    blendMode: node.blendMode,
    bounds: node.bounds || null,
  };
}

function sourceStateChanged(current, imported) {
  return JSON.stringify(comparableSourceState(current)) !==
    JSON.stringify(comparableSourceState(imported));
}

function explanation(node, ambiguousReasons = []) {
  if (ambiguousReasons.includes("order-dependent-fallback")) {
    return "Fallback source identity; order-dependent; manual confirmation required";
  }
  if (ambiguousReasons.includes("duplicate-source-key")) {
    return "Duplicate source identity; manual confirmation required";
  }
  return node?.sourceRef?.identityKind === "native"
    ? "Native PSD layer ID: exact match"
    : "Fallback source identity";
}

function removeSubtree(project, nodeId) {
  const node = project.scene.nodes[nodeId];
  if (!node || nodeId === project.scene.rootId) return;
  for (const childId of [...node.children]) removeSubtree(project, childId);
  const parent = project.scene.nodes[node.parentId];
  if (parent) parent.children = parent.children.filter((id) => id !== nodeId);
  delete project.scene.nodes[nodeId];
}

function depth(project, nodeId) {
  let result = 0;
  let current = project.scene.nodes[nodeId];
  while (current?.parentId) {
    result += 1;
    current = project.scene.nodes[current.parentId];
  }
  return result;
}

export class PsdReimportReview {
  constructor(project, psd, options = {}) {
    this.currentProject = cloneProject(project);
    const reconciliation = reconcilePsdProject(project, psd, options);
    this.importedProject = reconciliation.importedProject;
    this.rows = [];
    this.nextRow = 0;
    const addRow = (row) => {
      const value = {
        id: `reimport-row-${++this.nextRow}`,
        manual: false,
        ...row,
      };
      value.auto = cloneProject(value);
      delete value.auto.auto;
      this.rows.push(value);
    };
    for (const match of reconciliation.review.matched) {
      const current = project.scene.nodes[match.nodeId];
      const imported = this.importedProject.scene.nodes[match.importedNodeId];
      const changed = sourceStateChanged(current, imported);
      addRow({
        status: changed ? "changed" : "matched",
        currentNodeId: current.id,
        importedNodeId: imported.id,
        candidateImportedNodeIds: [imported.id],
        matchSource: "auto",
        explanation: explanation(imported),
        action: changed ? "update" : "keep",
      });
    }
    for (const added of reconciliation.review.added) {
      const imported = this.importedProject.scene.nodes[added.importedNodeId];
      addRow({
        status: "added",
        currentNodeId: null,
        importedNodeId: imported.id,
        candidateImportedNodeIds: [imported.id],
        matchSource: "new",
        explanation: "New PSD layer",
        action: "add",
      });
    }
    for (const missing of reconciliation.review.removed) {
      addRow({
        status: "missing",
        currentNodeId: missing.nodeId,
        importedNodeId: null,
        candidateImportedNodeIds: [],
        matchSource: "missing",
        explanation: "No corresponding PSD layer was found",
        action: "keep",
      });
    }
    for (const ambiguous of reconciliation.review.ambiguous) {
      const currentIds = ambiguous.currentNodeIds.length
        ? ambiguous.currentNodeIds
        : [null];
      for (const currentNodeId of currentIds) {
        addRow({
          status: "ambiguous",
          currentNodeId,
          importedNodeId: null,
          candidateImportedNodeIds: [...ambiguous.importedNodeIds],
          matchSource: "uncertain",
          explanation: explanation(null, ambiguous.reasons),
          action: "unresolved",
        });
      }
    }
  }

  row(rowId) {
    const row = this.rows.find((entry) => entry.id === rowId);
    if (!row) throw new Error(`Unknown re-import review row ${rowId}.`);
    return row;
  }

  setMatch(rowId, importedNodeId) {
    const row = this.row(rowId);
    if (!this.importedProject.scene.nodes[importedNodeId] ||
      importedNodeId === this.importedProject.scene.rootId) {
      throw new Error("The selected PSD part does not exist.");
    }
    const duplicate = this.rows.find((entry) =>
      entry.id !== rowId &&
      entry.importedNodeId === importedNodeId &&
      ["update", "keep", "add"].includes(entry.action));
    if (duplicate) throw new Error("A PSD part can only be matched once.");
    row.importedNodeId = importedNodeId;
    row.action = row.currentNodeId ? "update" : "add";
    row.matchSource = "manual";
    row.manual = true;
    return row;
  }

  markAsNew(rowId) {
    const row = this.row(rowId);
    if (!row.importedNodeId && row.candidateImportedNodeIds.length === 1) {
      row.importedNodeId = row.candidateImportedNodeIds[0];
    }
    if (!row.importedNodeId) throw new Error("Select a PSD part first.");
    row.action = "add";
    row.matchSource = "manual";
    row.manual = true;
  }

  keepExisting(rowId) {
    const row = this.row(rowId);
    if (!row.currentNodeId) throw new Error("There is no existing part to keep.");
    row.action = "keep";
    row.importedNodeId = null;
    row.matchSource = "manual";
    row.manual = true;
  }

  removeExisting(rowId) {
    const row = this.row(rowId);
    if (!row.currentNodeId) throw new Error("There is no existing part to remove.");
    row.action = "remove";
    row.importedNodeId = null;
    row.matchSource = "manual";
    row.manual = true;
  }

  ignore(rowId) {
    const row = this.row(rowId);
    row.action = "ignore";
    row.manual = true;
  }

  resetToAuto(rowId) {
    const row = this.row(rowId);
    Object.assign(row, cloneProject(row.auto), { auto: row.auto });
    return row;
  }

  get summary() {
    const result = { update: 0, add: 0, keep: 0, remove: 0, unresolved: 0 };
    for (const row of this.rows) {
      if (Object.hasOwn(result, row.action)) result[row.action] += 1;
      else if (row.action === "ignore") result.keep += 1;
      if (row.action === "add" && row.currentNodeId) result.keep += 1;
    }
    return result;
  }

  get canApply() {
    return this.summary.unresolved === 0;
  }

  buildProject() {
    if (!this.canApply) {
      throw new Error("Resolve every ambiguous PSD mapping before Apply.");
    }
    const next = cloneProject(this.currentProject);
    const imported = this.importedProject;
    const importedToCurrent = new Map([
      [imported.scene.rootId, next.scene.rootId],
    ]);
    for (const row of this.rows) {
      if (row.importedNodeId && row.currentNodeId &&
        ["update", "keep"].includes(row.action)) {
        importedToCurrent.set(row.importedNodeId, row.currentNodeId);
      }
    }
    for (const row of this.rows.filter((entry) => entry.action === "remove")) {
      removeSubtree(next, row.currentNodeId);
    }
    const currentSource = next.sourceAssets.find((source) => source.kind === "psd");
    const importedSource = imported.sourceAssets.find((source) => source.kind === "psd");
    if (currentSource && importedSource) {
      Object.assign(currentSource, cloneProject(importedSource), {
        id: currentSource.id,
      });
    }
    for (const row of this.rows.filter((entry) => entry.action === "update")) {
      const currentNode = next.scene.nodes[row.currentNodeId];
      const importedNode = imported.scene.nodes[row.importedNodeId];
      if (!currentNode || !importedNode) continue;
      currentNode.visible = importedNode.visible;
      currentNode.opacity = importedNode.opacity;
      currentNode.blendMode = importedNode.blendMode;
      currentNode.sourceRef = cloneProject(importedNode.sourceRef);
      if (currentSource && currentNode.sourceRef) {
        currentNode.sourceRef.sourceAssetId = currentSource.id;
      }
      if (importedNode.bounds) currentNode.bounds = cloneProject(importedNode.bounds);
      else delete currentNode.bounds;
    }
    const addRows = this.rows
      .filter((entry) => entry.action === "add" && entry.importedNodeId)
      .sort((a, b) =>
        depth(imported, a.importedNodeId) - depth(imported, b.importedNodeId));
    let sequence = 0;
    for (const row of addRows) {
      const sourceNode = imported.scene.nodes[row.importedNodeId];
      let nodeId = sourceNode.id;
      while (next.scene.nodes[nodeId]) {
        nodeId = `node_reimport_${String(++sequence).padStart(4, "0")}`;
      }
      const parentId = importedToCurrent.get(sourceNode.parentId) || next.scene.rootId;
      const node = cloneProject(sourceNode);
      node.id = nodeId;
      node.parentId = parentId;
      node.children = [];
      if (currentSource && node.sourceRef) node.sourceRef.sourceAssetId = currentSource.id;
      next.scene.nodes[nodeId] = node;
      next.scene.nodes[parentId].children.push(nodeId);
      importedToCurrent.set(sourceNode.id, nodeId);
    }
    next.canvas = cloneProject(imported.canvas);
    return next;
  }

  apply(session) {
    const project = this.buildProject();
    return session.execute({
      type: "source.apply_psd_reimport",
      payload: { project },
    }, { label: "PSD Re-import" });
  }
}

export function createPsdReimportReview(project, psd, options) {
  return new PsdReimportReview(project, psd, options);
}
