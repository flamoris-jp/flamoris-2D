import { cloneProject } from "../model/project.js";
import { identityBonePoseDelta } from "../model/bone.js";

const MODES = new Set(["edit", "pose"]);

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Owns only transient Bone authoring state. Rest edits, pose edits, hierarchy,
 * and rigid attachments always cross the existing EditorSession Command API.
 */
export class BoneAuthoringController {
  constructor(session, { onChange = null, idFactory = null } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.idFactory = idFactory || defaultIdFactory();
    this.mode = "edit";
    this.activeKeyArtId = null;
    this.selectedBoneId = null;
    this.hoverBoneId = null;
    this.ghostKeyArtId = null;
    this.gesture = null;
  }

  notify(reason) { this.onChange?.(reason, this); }

  setMode(mode) {
    if (!MODES.has(mode)) throw new Error(`Unknown Bone authoring mode ${mode}.`);
    if (this.mode === mode) return;
    this.cancelGesture(false);
    this.mode = mode;
    this.notify("bone-mode");
  }

  setActiveKeyArt(keyArtId) {
    if (keyArtId !== null && !this.session.query("keyart.list")
      .some((entry) => entry.id === keyArtId)) {
      throw new Error(`Unknown KeyArt ${keyArtId}.`);
    }
    if (this.activeKeyArtId === keyArtId) return;
    this.cancelGesture(false);
    this.activeKeyArtId = keyArtId;
    this.notify("bone-keyart");
  }

  setGhostKeyArt(keyArtId) {
    if (keyArtId !== null && !this.session.query("keyart.list")
      .some((entry) => entry.id === keyArtId)) {
      throw new Error(`Unknown KeyArt ${keyArtId}.`);
    }
    this.ghostKeyArtId = keyArtId;
    this.notify("bone-ghost");
  }

  selectBone(boneId) {
    if (boneId !== null) this.session.query("bone.get", { boneId });
    if (this.selectedBoneId === boneId) return;
    this.cancelGesture(false);
    this.selectedBoneId = boneId;
    this.notify("bone-selection");
  }

  setHover(boneId) {
    if (this.hoverBoneId === boneId) return;
    this.hoverBoneId = boneId;
    this.notify("bone-hover");
  }

  selectedBone() {
    return this.selectedBoneId
      ? this.session.query("bone.get", { boneId: this.selectedBoneId })
      : null;
  }

  persistentPose(boneId = this.selectedBoneId, keyArtId = this.activeKeyArtId) {
    return boneId && keyArtId
      ? this.session.query("bone.get_keyform", { boneId, keyArtId })
      : null;
  }

  editableValue() {
    const bone = this.selectedBone();
    if (!bone) return null;
    if (this.gesture) return cloneProject(this.gesture.preview);
    if (this.mode === "edit") return {
      ...cloneProject(bone.restLocalTransform),
      length: bone.length,
    };
    return cloneProject(this.persistentPose()?.localDelta || identityBonePoseDelta());
  }

  beginGesture() {
    const bone = this.selectedBone();
    if (!bone) return null;
    if (this.mode === "pose" && !this.activeKeyArtId) {
      throw new Error("Select an active Key Art before posing a Bone.");
    }
    const initial = this.editableValue();
    this.gesture = {
      boneId: bone.id,
      mode: this.mode,
      keyArtId: this.mode === "pose" ? this.activeKeyArtId : null,
      initial,
      preview: cloneProject(initial),
    };
    this.notify("bone-gesture-preview");
    return this.getState();
  }

  previewGesture(changes) {
    if (!this.gesture || !changes || typeof changes !== "object") return;
    const allowed = this.gesture.mode === "edit"
      ? ["x", "y", "rotation", "length"] : ["x", "y", "rotation"];
    for (const key of allowed) {
      if (!Object.hasOwn(changes, key)) continue;
      if (!Number.isFinite(changes[key]) || key === "length" && !(changes[key] > 0)) {
        throw new Error(`Bone ${key} must be finite${key === "length" ? " and positive" : ""}.`);
      }
      this.gesture.preview[key] = changes[key];
    }
    this.notify("bone-gesture-preview");
  }

  commitGesture() {
    const gesture = this.gesture;
    if (!gesture) return null;
    this.gesture = null;
    if (sameValue(gesture.initial, gesture.preview)) {
      this.notify("bone-gesture-preview");
      return null;
    }
    const result = gesture.mode === "edit"
      ? this.session.execute({
        type: "bone.set_rest",
        payload: {
          boneId: gesture.boneId,
          restLocalTransform: {
            x: gesture.preview.x,
            y: gesture.preview.y,
            rotation: gesture.preview.rotation,
          },
          length: gesture.preview.length,
        },
      }, { label: "Edit Bone rest" })
      : this.session.execute({
        type: "bone.set_keyform",
        payload: {
          boneId: gesture.boneId,
          keyArtId: gesture.keyArtId,
          localDelta: cloneProject(gesture.preview),
        },
      }, { label: this.persistentPose(gesture.boneId, gesture.keyArtId)
        ? "Edit Bone pose" : "Create and edit Bone pose" });
    this.notify("bone-gesture-commit");
    return result;
  }

  cancelGesture(notify = true) {
    if (!this.gesture) return;
    this.gesture = null;
    if (notify) this.notify("bone-gesture-preview");
  }

  setRest({ x, y, rotation, length }) {
    if (!this.selectedBoneId) return null;
    return this.session.execute({
      type: "bone.set_rest",
      payload: {
        boneId: this.selectedBoneId,
        restLocalTransform: { x, y, rotation },
        length,
      },
    }, { label: "Edit Bone rest" });
  }

  setPose(localDelta) {
    if (!this.selectedBoneId || !this.activeKeyArtId) return null;
    const exists = this.persistentPose();
    return this.session.execute({
      type: "bone.set_keyform",
      payload: {
        boneId: this.selectedBoneId,
        keyArtId: this.activeKeyArtId,
        localDelta: cloneProject(localDelta),
      },
    }, { label: exists ? "Edit Bone pose" : "Create Bone pose" });
  }

  resetPose() {
    const pose = this.persistentPose();
    if (!pose) return null;
    return this.session.execute({
      type: "bone.reset_keyform",
      payload: { boneId: pose.boneId, keyArtId: pose.keyArtId },
    }, { label: "Reset Bone pose" });
  }

  createChild({ displayName = "Bone", length = 100 } = {}) {
    const parent = this.selectedBone();
    const root = this.session.query("scene.get_tree", { includeHidden: true });
    const id = this.idFactory("bone");
    const result = this.session.execute({
      type: "bone.create",
      payload: {
        id,
        displayName,
        parentNodeId: parent?.id || root.id,
        restLocalTransform: { x: parent?.length || 0, y: 0, rotation: 0 },
        length,
      },
    }, { label: parent ? "Create child Bone" : "Create Bone" });
    this.selectedBoneId = id;
    this.notify("bone-create");
    return result;
  }

  rename(displayName) {
    if (!this.selectedBoneId) return null;
    return this.session.execute({
      type: "bone.rename",
      payload: { boneId: this.selectedBoneId, displayName },
    }, { label: "Rename Bone" });
  }

  reparent(parentNodeId, index = null) {
    if (!this.selectedBoneId) return null;
    return this.session.execute({
      type: "bone.reparent",
      payload: {
        boneId: this.selectedBoneId,
        parentNodeId,
        ...(index === null ? {} : { index }),
      },
    }, { label: "Reparent Bone" });
  }

  remove() {
    if (!this.selectedBoneId) return null;
    const boneId = this.selectedBoneId;
    const result = this.session.execute({
      type: "bone.remove",
      payload: { boneId },
    }, { label: "Remove Bone" });
    this.selectedBoneId = null;
    this.notify("bone-remove");
    return result;
  }

  bindTarget(targetNodeId, boneId = this.selectedBoneId) {
    if (!boneId) throw new Error("Select a Bone before creating a rigid attachment.");
    const existing = this.session.query("bone.get_rigid_binding_for_target", { targetNodeId });
    if (existing) return this.session.execute({
      type: "bone.set_rigid_binding_bone",
      payload: { bindingId: existing.id, boneId },
    }, { label: "Change rigid Bone attachment" });
    return this.session.execute({
      type: "bone.create_rigid_binding",
      payload: { binding: {
        id: this.idFactory("rigid_binding"),
        targetNodeId,
        boneId,
        enabled: true,
      } },
    }, { label: "Create rigid Bone attachment" });
  }

  getState() {
    const bone = this.selectedBone();
    const keyArts = this.session.query("keyart.list");
    const activeKeyArt = keyArts.find((entry) => entry.id === this.activeKeyArtId) || null;
    return {
      mode: this.mode,
      activeKeyArt: cloneProject(activeKeyArt),
      keyArts: cloneProject(keyArts),
      selectedBone: cloneProject(bone),
      selectedBoneId: this.selectedBoneId,
      hoverBoneId: this.hoverBoneId,
      ghostKeyArtId: this.ghostKeyArtId,
      keyform: cloneProject(this.persistentPose()),
      editableValue: cloneProject(this.editableValue()),
      dragging: Boolean(this.gesture),
    };
  }
}
