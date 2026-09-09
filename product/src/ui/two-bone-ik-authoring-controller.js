function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function finitePoint(point, label = "IK target") {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must be a finite document-space point.`);
  }
  return { x: point.x, y: point.y };
}

/**
 * Owns transient IK selection, handle, and drag preview state. Pointer-up bakes
 * the analytic solve into ordinary Key-Art-specific BonePoseKeyforms atomically.
 */
export class TwoBoneIkAuthoringController {
  constructor(session, { onChange = null, idFactory = null } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.idFactory = idFactory || defaultIdFactory();
    this.activeConstraintId = null;
    this.activeKeyArtId = null;
    this.target = null;
    this.gesture = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  constraints() { return this.session.query("bone.list_two_bone_ik"); }

  activeConstraint() {
    if (!this.activeConstraintId) return null;
    return this.session.query("bone.get_two_bone_ik", {
      constraintId: this.activeConstraintId,
    });
  }

  setContext({ constraintId = null, keyArtId = null } = {}) {
    if (constraintId) this.session.query("bone.get_two_bone_ik", { constraintId });
    if (keyArtId && !this.session.query("keyart.list").some((entry) => entry.id === keyArtId)) {
      throw new Error(`Unknown KeyArt ${keyArtId}.`);
    }
    this.activeConstraintId = constraintId;
    this.activeKeyArtId = keyArtId;
    this.gesture = null;
    this.target = null;
    if (constraintId && keyArtId) {
      const projected = this.session.query("bone.get_two_bone_ik_pose", {
        constraintId,
        keyArtId,
      });
      if (!projected.diagnostics.length) this.target = { ...projected.chain.end.head };
    }
    this.notify("ik-context");
    return this.getState();
  }

  createConstraint({ rootBoneId, midBoneId, endBoneId,
    bendDirection = "counterclockwise", enabled = true }) {
    const id = this.idFactory("two_bone_ik");
    const result = this.session.execute({
      type: "bone.create_two_bone_ik",
      payload: { constraint: {
        id, rootBoneId, midBoneId, endBoneId, bendDirection, enabled,
      } },
    }, { label: "Create two-Bone IK" });
    this.activeConstraintId = id;
    this.gesture = null;
    this.target = null;
    this.notify("ik-create");
    return result;
  }

  removeConstraint() {
    if (!this.activeConstraintId) return null;
    const constraintId = this.activeConstraintId;
    const result = this.session.execute({
      type: "bone.remove_two_bone_ik",
      payload: { constraintId },
    }, { label: "Remove two-Bone IK" });
    this.activeConstraintId = null;
    this.target = null;
    this.gesture = null;
    this.notify("ik-remove");
    return result;
  }

  setEnabled(enabled) {
    if (!this.activeConstraintId) return null;
    const result = this.session.execute({
      type: "bone.set_two_bone_ik_enabled",
      payload: { constraintId: this.activeConstraintId, enabled: Boolean(enabled) },
    }, { label: enabled ? "Enable two-Bone IK" : "Disable two-Bone IK" });
    this.notify("ik-enabled");
    return result;
  }

  setBendDirection(bendDirection) {
    if (!this.activeConstraintId) return null;
    const result = this.session.execute({
      type: "bone.set_two_bone_ik_bend_direction",
      payload: { constraintId: this.activeConstraintId, bendDirection },
    }, { label: "Change IK bend direction" });
    this.notify("ik-bend");
    return result;
  }

  beginTargetDrag(target = this.target) {
    if (!this.activeConstraintId || !this.activeKeyArtId) {
      throw new Error("Select an IK constraint and active Key Art before dragging its target.");
    }
    const initial = finitePoint(target);
    this.gesture = { initial, target: { ...initial }, preview: null };
    this.target = { ...initial };
    this.notify("ik-drag-preview");
    return this.previewTarget(initial);
  }

  previewTarget(target) {
    if (!this.gesture) throw new Error("Begin an IK target gesture first.");
    const next = finitePoint(target);
    const preview = this.session.query("bone.solve_two_bone_ik", {
      constraintId: this.activeConstraintId,
      keyArtId: this.activeKeyArtId,
      target: next,
    });
    this.gesture.target = next;
    this.gesture.preview = preview;
    this.target = { ...next };
    this.notify("ik-drag-preview");
    return structuredClone(preview);
  }

  commitTargetDrag() {
    if (!this.gesture) return null;
    const { preview } = this.gesture;
    this.gesture = null;
    if (!preview?.solution || preview.diagnostics.length) {
      this.notify("ik-drag-cancel");
      return null;
    }
    const commands = preview.solution.poseDeltas.map((entry) => ({
      type: "bone.set_keyform",
      payload: {
        boneId: entry.boneId,
        keyArtId: entry.keyArtId,
        localDelta: structuredClone(entry.localDelta),
      },
    }));
    const result = this.session.executeTransaction(commands, {
      label: "Bake two-Bone IK pose",
    });
    this.notify("ik-drag-commit");
    return result;
  }

  cancelTargetDrag() {
    if (!this.gesture) return;
    this.target = { ...this.gesture.initial };
    this.gesture = null;
    this.notify("ik-drag-cancel");
  }

  projectChanged() {
    const ids = new Set(this.constraints().map((entry) => entry.id));
    const keyArtIds = new Set(this.session.query("keyart.list").map((entry) => entry.id));
    if (this.activeConstraintId && !ids.has(this.activeConstraintId)) {
      this.activeConstraintId = null;
      this.target = null;
      this.gesture = null;
    }
    if (this.activeKeyArtId && !keyArtIds.has(this.activeKeyArtId)) {
      this.activeKeyArtId = null;
      this.target = null;
      this.gesture = null;
    }
  }

  getState() {
    return {
      activeConstraintId: this.activeConstraintId,
      activeKeyArtId: this.activeKeyArtId,
      activeConstraint: structuredClone(this.activeConstraint()),
      constraints: structuredClone(this.constraints()),
      target: this.target ? { ...this.target } : null,
      dragging: Boolean(this.gesture),
      preview: structuredClone(this.gesture?.preview || null),
    };
  }
}
