import { cloneProject } from "../model/project.js";
import { defaultWarpKeyformControlPoints } from "../model/warp-deformer.js";

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function normalizedRect(from, to) {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    right: Math.max(from.x, to.x),
    bottom: Math.max(from.y, to.y),
  };
}

/**
 * Owns transient Warp authoring workspace state. Persistent keyforms and
 * topology changes always return through EditorSession commands.
 */
export class DeformerAuthoringController {
  constructor(session, endpointMesh, { onChange = null, idFactory = null } = {}) {
    this.session = session;
    this.endpointMesh = endpointMesh;
    this.onChange = onChange;
    this.idFactory = idFactory || defaultIdFactory();
    this.deformerId = null;
    this.selectedControlPointIds = new Set();
    this.hoverControlPointId = null;
    this.boxSelection = null;
    this.drag = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  activeKeyArt() {
    const state = this.endpointMesh?.getState();
    if (!state?.editingEnabled || !state.activeTransition) return null;
    const endpoint = state.activeEndpoint;
    const keyArt = state.endpoints?.[endpoint]?.keyArt || null;
    return keyArt ? { endpoint, id: keyArt.id, displayName: keyArt.displayName } : null;
  }

  selectDeformer(deformerId) {
    if (deformerId !== null) this.session.query("deformer.get", { deformerId });
    if (this.deformerId === deformerId) return;
    this.deformerId = deformerId;
    this.clearWorkspace(false);
    this.notify("deformer-selection");
  }

  clearWorkspace(notify = true) {
    this.selectedControlPointIds.clear();
    this.hoverControlPointId = null;
    this.boxSelection = null;
    this.drag = null;
    if (notify) this.notify("deformer-workspace-clear");
  }

  deformer() {
    return this.deformerId
      ? this.session.query("deformer.get", { deformerId: this.deformerId })
      : null;
  }

  defaultPositions(deformer) {
    return defaultWarpKeyformControlPoints(deformer, deformer.controlPoints);
  }

  persistentKeyform(deformer = this.deformer(), keyArt = this.activeKeyArt()) {
    return deformer && keyArt
      ? this.session.query("deformer.get_keyform", {
        deformerId: deformer.id,
        keyArtId: keyArt.id,
      })
      : null;
  }

  currentPositions() {
    const deformer = this.deformer();
    if (!deformer) return [];
    if (this.drag) return cloneProject(this.drag.previewControlPoints);
    return cloneProject(this.persistentKeyform(deformer)?.controlPoints ||
      this.defaultPositions(deformer));
  }

  selectControlPoint(controlPointId, { additive = false, toggle = false } = {}) {
    const deformer = this.deformer();
    if (!deformer?.controlPointIds.includes(controlPointId)) {
      throw new Error(`Unknown WarpControlPoint ${controlPointId}.`);
    }
    if (!additive) this.selectedControlPointIds.clear();
    if (toggle && this.selectedControlPointIds.has(controlPointId)) {
      this.selectedControlPointIds.delete(controlPointId);
    } else this.selectedControlPointIds.add(controlPointId);
    this.notify("deformer-point-selection");
  }

  clearSelection() {
    if (!this.selectedControlPointIds.size) return;
    this.selectedControlPointIds.clear();
    this.notify("deformer-point-selection");
  }

  setHover(controlPointId) {
    if (this.hoverControlPointId === controlPointId) return;
    this.hoverControlPointId = controlPointId;
    this.notify("deformer-point-hover");
  }

  beginBoxSelection(point, coordinateSpace = "deformer-local") {
    this.boxSelection = {
      from: cloneProject(point),
      to: cloneProject(point),
      coordinateSpace,
    };
    this.notify("deformer-box-preview");
  }

  previewBoxSelection(point) {
    if (!this.boxSelection) return;
    this.boxSelection.to = cloneProject(point);
    this.notify("deformer-box-preview");
  }

  commitBoxSelection({ additive = false, points = null } = {}) {
    if (!this.boxSelection) return [];
    const rect = normalizedRect(this.boxSelection.from, this.boxSelection.to);
    const selected = (points || this.currentPositions())
      .filter((point) => point.x >= rect.left && point.x <= rect.right &&
        point.y >= rect.top && point.y <= rect.bottom)
      .map((point) => point.controlPointId);
    this.boxSelection = null;
    if (!additive) this.selectedControlPointIds.clear();
    selected.forEach((id) => this.selectedControlPointIds.add(id));
    this.notify("deformer-point-selection");
    return selected;
  }

  beginDrag() {
    const keyArt = this.activeKeyArt();
    const deformer = this.deformer();
    if (!keyArt) throw new Error("Select Key State A or B before editing Warp control points.");
    if (!deformer || !this.selectedControlPointIds.size) return null;
    const initialControlPoints = this.currentPositions();
    this.drag = {
      keyArtId: keyArt.id,
      initialControlPoints,
      previewControlPoints: cloneProject(initialControlPoints),
    };
    this.notify("deformer-drag-preview");
    return this.getState();
  }

  previewDrag(delta) {
    if (!this.drag || !Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) return;
    this.drag.previewControlPoints = this.drag.initialControlPoints.map((point) =>
      this.selectedControlPointIds.has(point.controlPointId)
        ? { ...point, x: point.x + delta.x, y: point.y + delta.y }
        : cloneProject(point));
    this.notify("deformer-drag-preview");
  }

  commitDrag() {
    const drag = this.drag;
    if (!drag) return null;
    this.drag = null;
    const deformer = this.deformer();
    const previous = this.session.query("deformer.get_keyform", {
      deformerId: deformer.id,
      keyArtId: drag.keyArtId,
    });
    if (JSON.stringify(drag.initialControlPoints) === JSON.stringify(drag.previewControlPoints)) {
      this.notify("deformer-drag-preview");
      return null;
    }
    const result = previous
      ? this.session.execute({
        type: "deformer.move_control_points",
        payload: {
          deformerId: deformer.id,
          keyArtId: drag.keyArtId,
          controlPoints: drag.previewControlPoints.filter((point) =>
            this.selectedControlPointIds.has(point.controlPointId)),
        },
      }, { label: "Move Warp control points" })
      : this.session.execute({
        type: "deformer.set_keyform",
        payload: {
          deformerId: deformer.id,
          keyArtId: drag.keyArtId,
          controlPoints: drag.previewControlPoints,
        },
      }, { label: "Create and edit Warp keyform" });
    this.notify("deformer-drag-commit");
    return result;
  }

  cancelDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.notify("deformer-drag-preview");
  }

  resetSelected() {
    const deformer = this.deformer();
    const keyArt = this.activeKeyArt();
    const keyform = this.persistentKeyform(deformer, keyArt);
    if (!deformer || !keyArt || !keyform || !this.selectedControlPointIds.size) return null;
    const defaults = this.defaultPositions(deformer).filter((point) =>
      this.selectedControlPointIds.has(point.controlPointId));
    return this.session.execute({
      type: "deformer.move_control_points",
      payload: { deformerId: deformer.id, keyArtId: keyArt.id, controlPoints: defaults },
    }, { label: "Reset selected Warp control points" });
  }

  resetAll() {
    const deformer = this.deformer();
    const keyArt = this.activeKeyArt();
    if (!deformer || !keyArt || !this.persistentKeyform(deformer, keyArt)) return null;
    return this.session.execute({
      type: "deformer.reset_control_points",
      payload: { deformerId: deformer.id, keyArtId: keyArt.id },
    }, { label: "Reset Warp control points" });
  }

  rename(displayName) {
    if (!this.deformerId) return null;
    return this.session.execute({
      type: "deformer.rename",
      payload: { deformerId: this.deformerId, displayName },
    }, { label: "Rename Warp deformer" });
  }

  setGrid(size) {
    const deformer = this.deformer();
    if (!deformer) return null;
    const keyformCount = this.session.query("keyart.list")
      .filter((keyArt) => this.session.query("deformer.get_keyform", {
        deformerId: deformer.id,
        keyArtId: keyArt.id,
      })).length;
    if (keyformCount) throw new Error("Authored Warp keyforms must be removed before changing grid topology.");
    const controlPointIds = Array.from(
      { length: size * size },
      () => this.idFactory("warp_control_point"),
    );
    return this.session.execute({
      type: "deformer.set_grid",
      payload: {
        deformerId: deformer.id,
        columns: size,
        rows: size,
        bounds: cloneProject(deformer.bounds),
        controlPointIds,
      },
    }, { label: `Set Warp grid ${size}x${size}` });
  }

  getState() {
    const deformer = this.deformer();
    const activeKeyArt = this.activeKeyArt();
    if (!deformer) return { available: false };
    const keyform = this.persistentKeyform(deformer, activeKeyArt);
    const hasAuthoredKeyforms = this.session.query("keyart.list").some((keyArt) =>
      Boolean(this.session.query("deformer.get_keyform", {
        deformerId: deformer.id,
        keyArtId: keyArt.id,
      })));
    return {
      available: true,
      deformer: cloneProject(deformer),
      activeKeyArt: cloneProject(activeKeyArt),
      keyform: cloneProject(keyform),
      controlPoints: this.currentPositions(),
      selectedControlPointIds: [...this.selectedControlPointIds].sort(),
      hoverControlPointId: this.hoverControlPointId,
      boxSelection: cloneProject(this.boxSelection),
      dragging: Boolean(this.drag),
      gridLocked: hasAuthoredKeyforms,
      gridLockReason: hasAuthoredKeyforms
        ? "Authored Warp keyforms exist. Remove them before changing topology."
        : "",
    };
  }
}
