import { cloneProject } from "../model/project.js";
import { solveCorrespondence } from "../core/correspondence-solver.js";

const ENDPOINTS = Object.freeze(["from", "to"]);

function inputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Owns only the transient pin workspace and solve candidate. Persistent state
 * changes only in apply(), through the existing move-vertices command.
 */
export class CorrespondencePreviewController {
  constructor(session, endpointMesh, {
    solver = solveCorrespondence,
    onChange = null,
  } = {}) {
    this.session = session;
    this.endpointMesh = endpointMesh;
    this.solver = solver;
    this.onChange = onChange;
    this.sourceEndpoint = "from";
    this.targetEndpoint = "to";
    this.pins = new Map();
    this.selectedPinId = null;
    this.pendingVertexId = null;
    this.preset = "normal";
    this.candidatePositions = null;
    this.diagnostics = [];
  }

  notify(reason) { this.onChange?.(reason, this); }

  resolveContext() {
    const endpointState = this.endpointMesh.getState();
    const topologyId = endpointState.selectedTopologyId;
    const keyforms = this.session.query("mesh.list_keyforms");
    return {
      topology: topologyId
        ? this.session.query("mesh.list_topologies").find(({ id }) => id === topologyId) || null
        : null,
      sourceKeyform: keyforms.find(({ id }) =>
        id === endpointState.selectedKeyformIds[this.sourceEndpoint]) || null,
      targetKeyform: keyforms.find(({ id }) =>
        id === endpointState.selectedKeyformIds[this.targetEndpoint]) || null,
    };
  }

  assertVertexId(vertexId) {
    const { topology } = this.resolveContext();
    if (!topology?.vertexIds.includes(vertexId)) throw inputError(
      "CORRESPONDENCE_UNKNOWN_VERTEX_ID",
      `Unknown stable vertex ID ${vertexId || "(missing)"}.`,
    );
    return topology;
  }

  setDirection(sourceEndpoint, targetEndpoint) {
    if (!ENDPOINTS.includes(sourceEndpoint) || !ENDPOINTS.includes(targetEndpoint) ||
      sourceEndpoint === targetEndpoint) {
      throw inputError(
        "CORRESPONDENCE_INVALID_DIRECTION",
        "Correspondence source and target must be different A/B endpoints.",
      );
    }
    if (this.sourceEndpoint === sourceEndpoint && this.targetEndpoint === targetEndpoint) return;
    this.sourceEndpoint = sourceEndpoint;
    this.targetEndpoint = targetEndpoint;
    this.clearWorkspace(false);
    this.notify("correspondence-direction");
  }

  setPreset(preset) {
    if (!["soft", "normal", "firm"].includes(preset)) throw inputError(
      "CORRESPONDENCE_INVALID_SETTINGS", `Unknown solver preset ${preset}.`,
    );
    this.preset = preset;
    this.candidatePositions = null;
    this.diagnostics = [];
    this.notify("correspondence-settings");
  }

  addPin(vertexId, target) {
    this.assertVertexId(vertexId);
    if (this.pins.has(vertexId)) throw inputError(
      "CORRESPONDENCE_DUPLICATE_PIN",
      `Stable vertex ${vertexId} already has a correspondence pin.`,
    );
    if (!finitePoint(target)) throw inputError(
      "CORRESPONDENCE_INVALID_TARGET_ANCHOR",
      "Correspondence target anchor must contain finite mesh-local coordinates.",
    );
    this.pins.set(vertexId, { vertexId, target: { x: target.x, y: target.y } });
    this.selectedPinId = vertexId;
    this.pendingVertexId = null;
    this.candidatePositions = null;
    this.diagnostics = [];
    this.notify("correspondence-pin-added");
    return this.getState();
  }

  movePin(vertexId, target) {
    if (!this.pins.has(vertexId)) throw inputError(
      "CORRESPONDENCE_UNKNOWN_PIN", `Stable vertex ${vertexId} has no correspondence pin.`,
    );
    if (!finitePoint(target)) throw inputError(
      "CORRESPONDENCE_INVALID_TARGET_ANCHOR",
      "Correspondence target anchor must contain finite mesh-local coordinates.",
    );
    this.pins.set(vertexId, { vertexId, target: { x: target.x, y: target.y } });
    this.selectedPinId = vertexId;
    this.pendingVertexId = null;
    this.candidatePositions = null;
    this.diagnostics = [];
    this.notify("correspondence-pin-moved");
    return this.getState();
  }

  beginPinPlacement(vertexId) {
    this.assertVertexId(vertexId);
    this.pendingVertexId = vertexId;
    this.selectedPinId = this.pins.has(vertexId) ? vertexId : null;
    this.candidatePositions = null;
    this.diagnostics = [];
    this.endpointMesh.selectEndpoint(this.targetEndpoint);
    this.notify("correspondence-pin-placement");
  }

  placePendingPin(target) {
    if (!this.pendingVertexId) throw inputError(
      "CORRESPONDENCE_NO_PENDING_PIN", "Choose a source stable vertex before placing an anchor.",
    );
    return this.pins.has(this.pendingVertexId)
      ? this.movePin(this.pendingVertexId, target)
      : this.addPin(this.pendingVertexId, target);
  }

  selectPin(vertexId) {
    if (vertexId !== null && !this.pins.has(vertexId)) throw inputError(
      "CORRESPONDENCE_UNKNOWN_PIN", `Stable vertex ${vertexId} has no correspondence pin.`,
    );
    this.selectedPinId = vertexId;
    this.notify("correspondence-pin-selection");
  }

  removePin(vertexId = this.selectedPinId) {
    if (!vertexId || !this.pins.has(vertexId)) return false;
    this.pins.delete(vertexId);
    if (this.selectedPinId === vertexId) this.selectedPinId = null;
    if (this.pendingVertexId === vertexId) this.pendingVertexId = null;
    this.candidatePositions = null;
    this.diagnostics = [];
    this.notify("correspondence-pin-removed");
    return true;
  }

  clearWorkspace(notify = true) {
    this.pins.clear();
    this.selectedPinId = null;
    this.pendingVertexId = null;
    this.candidatePositions = null;
    this.diagnostics = [];
    if (notify) this.notify("correspondence-cleared");
  }

  clearPreview() {
    this.pendingVertexId = null;
    this.candidatePositions = null;
    this.diagnostics = [];
    this.notify("correspondence-preview-cleared");
  }

  projectChanged() {
    // A changed topology/keyform can invalidate stable-ID resolution. Keep no
    // stale candidate or pin projection across persistent project edits.
    this.clearWorkspace(false);
  }

  solve() {
    const context = this.resolveContext();
    const result = this.solver({
      ...context,
      pins: [...this.pins.values()].map(cloneProject),
      settings: { preset: this.preset },
    });
    this.candidatePositions = result.candidatePositions
      ? [...result.candidatePositions]
      : null;
    this.diagnostics = cloneProject(result.diagnostics);
    this.pendingVertexId = null;
    if (this.candidatePositions) {
      this.endpointMesh.selectEndpoint(this.targetEndpoint);
      this.endpointMesh.exitEditing();
    }
    this.notify("correspondence-preview");
    return this.getState();
  }

  apply(meshTools) {
    const candidate = this.candidatePositions ? [...this.candidatePositions] : null;
    const { targetKeyform } = this.resolveContext();
    if (!candidate || this.diagnostics.length) throw inputError(
      "CORRESPONDENCE_NO_CANDIDATE", "Create a valid correspondence preview before Apply.",
    );
    if (!targetKeyform || candidate.length !== targetKeyform.positions.length) throw inputError(
      "CORRESPONDENCE_CANDIDATE_COUNT_MISMATCH",
      "Candidate positions no longer match the target MeshKeyform.",
    );
    const result = this.session.execute({
      type: "mesh_keyform.move_vertices",
      payload: { keyformId: targetKeyform.id, positions: candidate },
    }, { label: "Apply correspondence solve" });
    this.candidatePositions = null;
    this.diagnostics = [];
    this.pendingVertexId = null;
    this.endpointMesh.selectEndpoint(this.targetEndpoint);
    meshTools?.setMode("deform");
    this.notify("correspondence-applied");
    return result;
  }

  getState() {
    const { topology, sourceKeyform, targetKeyform } = this.resolveContext();
    const vertexIndex = new Map((topology?.vertexIds || [])
      .map((vertexId, index) => [vertexId, index]));
    return {
      sourceEndpoint: this.sourceEndpoint,
      targetEndpoint: this.targetEndpoint,
      sourceKeyformId: sourceKeyform?.id || null,
      targetKeyformId: targetKeyform?.id || null,
      topologyId: topology?.id || null,
      pins: [...this.pins.values()].map((pin) => {
        const index = vertexIndex.get(pin.vertexId);
        return {
          ...cloneProject(pin),
          source: Number.isSafeInteger(index) && sourceKeyform
            ? {
              x: sourceKeyform.positions[index * 2],
              y: sourceKeyform.positions[index * 2 + 1],
            }
            : null,
          semanticLabel: topology?.vertexMetadata?.[pin.vertexId]?.semanticLabel || null,
        };
      }),
      selectedPinId: this.selectedPinId,
      pendingVertexId: this.pendingVertexId,
      preset: this.preset,
      candidatePositions: this.candidatePositions ? [...this.candidatePositions] : null,
      diagnostics: cloneProject(this.diagnostics),
      previewActive: Boolean(this.candidatePositions),
      pinCount: this.pins.size,
    };
  }
}
