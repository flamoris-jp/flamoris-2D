import {
  mirrorBonePoseDelta,
  mirrorBoneRestTransform,
} from "../core/bone-mirror-helper.js";
import { identityBonePoseDelta } from "../model/bone.js";

/** Explicit-pair, transient mirror authoring state. Names are never inspected. */
export class BoneMirrorAuthoringController {
  constructor(session, { onChange = null } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.sourceBoneId = null;
    this.targetBoneId = null;
    this.activeKeyArtId = null;
    this.axisX = 0;
  }

  notify(reason) { this.onChange?.(reason, this); }

  setPair({ sourceBoneId = null, targetBoneId = null, activeKeyArtId = null, axisX = 0 }) {
    if (sourceBoneId) this.session.query("bone.get", { boneId: sourceBoneId });
    if (targetBoneId) this.session.query("bone.get", { boneId: targetBoneId });
    if (sourceBoneId && sourceBoneId === targetBoneId) {
      throw new Error("Mirror source and target must be different explicit Bone IDs.");
    }
    if (activeKeyArtId && !this.session.query("keyart.list")
      .some((entry) => entry.id === activeKeyArtId)) {
      throw new Error(`Unknown KeyArt ${activeKeyArtId}.`);
    }
    if (!Number.isFinite(axisX)) throw new TypeError("Mirror axis must be finite.");
    this.sourceBoneId = sourceBoneId;
    this.targetBoneId = targetBoneId;
    this.activeKeyArtId = activeKeyArtId;
    this.axisX = axisX;
    this.notify("bone-mirror-pair");
    return this.getState();
  }

  bones() {
    if (!this.sourceBoneId || !this.targetBoneId) {
      throw new Error("Select an explicit source/target Bone pair.");
    }
    return {
      source: this.session.query("bone.get", { boneId: this.sourceBoneId }),
      target: this.session.query("bone.get", { boneId: this.targetBoneId }),
    };
  }

  mirrorRest() {
    const { source, target } = this.bones();
    if (source.parentNodeId !== target.parentNodeId) {
      throw new Error("Rest mirror requires source and target Bones to share a Scene parent.");
    }
    const result = this.session.execute({
      type: "bone.set_rest",
      payload: {
        boneId: target.id,
        restLocalTransform: mirrorBoneRestTransform(source.restLocalTransform, this.axisX),
        length: source.length,
      },
    }, { label: "Mirror Bone rest" });
    this.notify("bone-mirror-rest");
    return result;
  }

  mirrorPose() {
    const { source, target } = this.bones();
    if (!this.activeKeyArtId) throw new Error("Select an active Key Art for pose mirror.");
    const sourceKeyform = this.session.query("bone.get_keyform", {
      boneId: source.id,
      keyArtId: this.activeKeyArtId,
    });
    const result = this.session.execute({
      type: "bone.set_keyform",
      payload: {
        boneId: target.id,
        keyArtId: this.activeKeyArtId,
        localDelta: mirrorBonePoseDelta(
          sourceKeyform?.localDelta || identityBonePoseDelta(),
        ),
      },
    }, { label: "Mirror Bone pose" });
    this.notify("bone-mirror-pose");
    return result;
  }

  projectChanged() {
    const boneIds = new Set(this.session.query("bone.list").map((entry) => entry.id));
    const keyArtIds = new Set(this.session.query("keyart.list").map((entry) => entry.id));
    if (this.sourceBoneId && !boneIds.has(this.sourceBoneId)) this.sourceBoneId = null;
    if (this.targetBoneId && !boneIds.has(this.targetBoneId)) this.targetBoneId = null;
    if (this.activeKeyArtId && !keyArtIds.has(this.activeKeyArtId)) this.activeKeyArtId = null;
  }

  getState() {
    return {
      sourceBoneId: this.sourceBoneId,
      targetBoneId: this.targetBoneId,
      activeKeyArtId: this.activeKeyArtId,
      axisX: this.axisX,
    };
  }
}
