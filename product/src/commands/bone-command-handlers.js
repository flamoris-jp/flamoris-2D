import {
  cloneProject,
  createSceneNode,
} from "../model/project.js";
import {
  boneSceneTransform,
  createBone,
  createBonePoseKeyform,
} from "../model/bone.js";
import { CommandError } from "./errors.js";

function collection(project, name) {
  const value = project.rig?.[name];
  if (!Array.isArray(value)) {
    throw new CommandError(`Missing rig.${name} collection.`, "collection.invalid");
  }
  return value;
}

function boneFor(project, boneId) {
  const bone = collection(project, "bones").find((entry) => entry.id === boneId);
  if (!bone) {
    throw new CommandError("Bone does not exist.", "bone.not_found", { boneId });
  }
  return bone;
}

function poseKeyformIndex(project, boneId, keyArtId) {
  return collection(project, "bonePoseKeyforms").findIndex((entry) =>
    entry.boneId === boneId && entry.keyArtId === keyArtId);
}

function assertBoneParent(project, parentNodeId) {
  const parent = project.scene.nodes[parentNodeId];
  if (!parent) {
    throw new CommandError("Bone parent node does not exist.", "BONE_PARENT_INVALID", {
      parentNodeId,
    });
  }
  if (!["group", "deformer", "bone"].includes(parent.kind)) {
    throw new CommandError(
      "Bone parent must be a GroupNode, DeformerNode, or BoneNode.",
      "BONE_PARENT_INVALID",
      { parentNodeId },
    );
  }
  if (parent.kind === "bone" &&
    !collection(project, "bones").some((entry) => entry.id === parent.id)) {
    throw new CommandError(
      "Bone parent node has no matching rig Bone.",
      "BONE_PARENT_INVALID",
      { parentNodeId },
    );
  }
  return parent;
}

function descendantBoneIds(project, boneId) {
  const result = [];
  const visit = (nodeId) => {
    for (const childId of project.scene.nodes[nodeId]?.children || []) {
      if (project.scene.nodes[childId]?.kind !== "bone") continue;
      result.push(childId);
      visit(childId);
    }
  };
  visit(boneId);
  return result;
}

function assertNoDependents(project, boneIds) {
  const locked = collection(project, "bonePoseKeyforms")
    .find((entry) => boneIds.includes(entry.boneId));
  if (locked) {
    throw new CommandError(
      "Remove authored Bone pose keyforms before changing rest hierarchy.",
      "bone.rest_locked_by_keyforms",
      { boneId: locked.boneId, keyArtId: locked.keyArtId },
    );
  }
  const binding = collection(project, "rigidBoneBindings")
    .find((entry) => boneIds.includes(entry.boneId));
  if (binding) {
    throw new CommandError(
      "Remove dependent rigid bindings before changing Bone rest hierarchy.",
      "bone.rest_locked_by_bindings",
      { boneId: binding.boneId, bindingId: binding.id, targetNodeId: binding.targetNodeId },
    );
  }
}

function removeBone(project, boneId) {
  const bone = boneFor(project, boneId);
  const node = project.scene.nodes[bone.id];
  if (!node || node.kind !== "bone") {
    throw new CommandError("BoneNode does not exist.", "BONE_NODE_MISSING", { boneId });
  }
  if (node.children.length) {
    throw new CommandError(
      "Only a leaf Bone can be removed.",
      "bone.not_leaf",
      { boneId, childBoneIds: [...node.children] },
    );
  }
  assertNoDependents(project, [bone.id]);
  const parent = project.scene.nodes[node.parentId];
  const nodeIndex = parent.children.indexOf(node.id);
  const boneIndex = collection(project, "bones").indexOf(bone);
  const keyforms = collection(project, "bonePoseKeyforms")
    .map((keyform, index) => ({ keyform, index }))
    .filter(({ keyform }) => keyform.boneId === bone.id);
  const snapshot = {
    node: cloneProject(node),
    nodeIndex,
    bone: cloneProject(bone),
    boneIndex,
    keyforms: cloneProject(keyforms),
  };
  parent.children.splice(nodeIndex, 1);
  delete project.scene.nodes[node.id];
  project.rig.bones.splice(boneIndex, 1);
  project.rig.bonePoseKeyforms = project.rig.bonePoseKeyforms
    .filter((keyform) => keyform.boneId !== bone.id);
  return {
    inverse: { type: "bone.restore", payload: { snapshot } },
    affectedIds: [parent.id, bone.id, ...keyforms.map(({ keyform }) => keyform.keyArtId)],
  };
}

function removePoseKeyform(project, boneId, keyArtId) {
  boneFor(project, boneId);
  const index = poseKeyformIndex(project, boneId, keyArtId);
  if (index < 0) {
    throw new CommandError(
      "Bone pose keyform does not exist.",
      "bone.keyform_not_found",
      { boneId, keyArtId },
    );
  }
  const [keyform] = project.rig.bonePoseKeyforms.splice(index, 1);
  return {
    inverse: { type: "bone.set_keyform", payload: cloneProject(keyform) },
    affectedIds: [boneId, keyArtId],
  };
}

export const boneCommandHandlers = {
  "bone.create": (project, payload) => {
    if (project.scene.nodes[payload.id] ||
      collection(project, "bones").some(({ id }) => id === payload.id)) {
      throw new CommandError("Stable ID already exists.", "identity.duplicate", {
        id: payload.id,
      });
    }
    const parent = assertBoneParent(project, payload.parentNodeId);
    const displayName = payload.displayName.trim();
    const node = createSceneNode({
      id: payload.id,
      kind: "bone",
      displayName,
      parentId: parent.id,
      transform: boneSceneTransform(payload.restLocalTransform),
    });
    const bone = createBone({
      id: payload.id,
      parentNodeId: parent.id,
      restLocalTransform: payload.restLocalTransform,
      length: payload.length,
      enabled: payload.enabled ?? true,
    });
    project.scene.nodes[node.id] = node;
    const index = payload.index == null
      ? parent.children.length
      : Math.max(0, Math.min(parent.children.length, payload.index));
    parent.children.splice(index, 0, node.id);
    project.rig.bones.push(bone);
    return {
      inverse: { type: "bone.remove_internal", payload: { boneId: bone.id } },
      affectedIds: [parent.id, bone.id],
    };
  },

  "bone.remove": (project, payload) => removeBone(project, payload.boneId),
  "bone.remove_internal": (project, payload) => removeBone(project, payload.boneId),

  "bone.restore": (project, payload) => {
    const saved = cloneProject(payload.snapshot);
    const parent = assertBoneParent(project, saved.node.parentId);
    if (project.scene.nodes[saved.node.id] ||
      collection(project, "bones").some(({ id }) => id === saved.bone.id)) {
      throw new CommandError("Stable ID already exists.", "identity.duplicate", {
        id: saved.bone.id,
      });
    }
    const nodeIndex = Math.max(0, Math.min(parent.children.length, saved.nodeIndex));
    parent.children.splice(nodeIndex, 0, saved.node.id);
    project.scene.nodes[saved.node.id] = saved.node;
    project.rig.bones.splice(
      Math.max(0, Math.min(project.rig.bones.length, saved.boneIndex)),
      0,
      saved.bone,
    );
    for (const { keyform, index } of saved.keyforms.sort((left, right) =>
      left.index - right.index)) {
      project.rig.bonePoseKeyforms.splice(
        Math.max(0, Math.min(project.rig.bonePoseKeyforms.length, index)),
        0,
        keyform,
      );
    }
    return {
      inverse: { type: "bone.remove_internal", payload: { boneId: saved.bone.id } },
      affectedIds: [
        parent.id,
        saved.bone.id,
        ...saved.keyforms.map(({ keyform }) => keyform.keyArtId),
      ],
    };
  },

  "bone.rename": (project, payload) => {
    const bone = boneFor(project, payload.boneId);
    const node = project.scene.nodes[bone.id];
    const previous = node.displayName;
    node.displayName = payload.displayName.trim();
    return {
      inverse: {
        type: "bone.rename",
        payload: { boneId: bone.id, displayName: previous },
      },
      affectedIds: [bone.id],
    };
  },

  "bone.set_rest": (project, payload) => {
    const bone = boneFor(project, payload.boneId);
    assertNoDependents(project, [bone.id, ...descendantBoneIds(project, bone.id)]);
    const previous = {
      restLocalTransform: cloneProject(bone.restLocalTransform),
      length: bone.length,
    };
    bone.restLocalTransform = cloneProject(payload.restLocalTransform);
    bone.length = payload.length;
    project.scene.nodes[bone.id].transform = boneSceneTransform(payload.restLocalTransform);
    return {
      inverse: {
        type: "bone.set_rest",
        payload: { boneId: bone.id, ...previous },
      },
      affectedIds: [bone.id],
    };
  },

  "bone.set_enabled": (project, payload) => {
    const bone = boneFor(project, payload.boneId);
    const previous = bone.enabled;
    bone.enabled = payload.enabled;
    return {
      inverse: {
        type: "bone.set_enabled",
        payload: { boneId: bone.id, enabled: previous },
      },
      affectedIds: [bone.id],
    };
  },

  "bone.reparent": (project, payload) => {
    const bone = boneFor(project, payload.boneId);
    const node = project.scene.nodes[bone.id];
    const nextParent = assertBoneParent(project, payload.parentNodeId);
    let ancestor = nextParent;
    while (ancestor) {
      if (ancestor.id === node.id) {
        throw new CommandError(
          "Reparenting would create a Bone hierarchy cycle.",
          "BONE_HIERARCHY_CYCLE",
          { boneId: bone.id, parentNodeId: nextParent.id },
        );
      }
      ancestor = ancestor.parentId ? project.scene.nodes[ancestor.parentId] : null;
    }
    assertNoDependents(project, [bone.id, ...descendantBoneIds(project, bone.id)]);
    const previousParent = project.scene.nodes[node.parentId];
    const previousIndex = previousParent.children.indexOf(node.id);
    previousParent.children.splice(previousIndex, 1);
    const index = payload.index == null
      ? nextParent.children.length
      : Math.max(0, Math.min(nextParent.children.length, payload.index));
    nextParent.children.splice(index, 0, node.id);
    node.parentId = nextParent.id;
    bone.parentNodeId = nextParent.id;
    return {
      inverse: {
        type: "bone.reparent",
        payload: {
          boneId: bone.id,
          parentNodeId: previousParent.id,
          index: previousIndex,
        },
      },
      affectedIds: [bone.id, previousParent.id, nextParent.id],
    };
  },

  "bone.set_keyform": (project, payload) => {
    const bone = boneFor(project, payload.boneId);
    const index = poseKeyformIndex(project, bone.id, payload.keyArtId);
    const previous = index >= 0
      ? cloneProject(project.rig.bonePoseKeyforms[index])
      : null;
    const next = createBonePoseKeyform(payload);
    if (index >= 0) project.rig.bonePoseKeyforms[index] = next;
    else project.rig.bonePoseKeyforms.push(next);
    return {
      inverse: previous
        ? { type: "bone.set_keyform", payload: previous }
        : {
          type: "bone.remove_keyform_internal",
          payload: { boneId: bone.id, keyArtId: payload.keyArtId },
        },
      affectedIds: [bone.id, payload.keyArtId],
    };
  },

  "bone.reset_keyform": (project, payload) =>
    removePoseKeyform(project, payload.boneId, payload.keyArtId),
  "bone.remove_keyform_internal": (project, payload) =>
    removePoseKeyform(project, payload.boneId, payload.keyArtId),
};
