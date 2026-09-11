import { EditorSession } from "../../src/commands/editor.js";
import { createBoneRotationConstraint } from "../../src/model/bone-rotation-constraint.js";
import { boneSceneTransform, createBone, createBonePoseKeyform } from "../../src/model/bone.js";
import { createMeshFormCorrectionKeyform } from "../../src/model/mesh-form-correction.js";
import { createIdFactory, createProject, createSceneNode } from "../../src/model/project.js";
import { createRigidBoneBinding } from "../../src/model/rigid-bone-binding.js";
import {
  createWarpDeformer,
  defaultWarpKeyformControlPoints,
} from "../../src/model/warp-deformer.js";
import { SequenceTimelineController } from "../../src/ui/sequence-timeline-controller.js";

export const PROOF_TICKS = Object.freeze({
  start: 0,
  holdA: 50,
  transitionAB: 150,
  holdB: 250,
  transitionBC: 350,
  blinkC: 450,
  terminal: 600,
});

const KEY_ARTS = Object.freeze([
  { id: "key_a", name: "A · open pose", suffix: "a", shift: 0, bone: -0.08 },
  { id: "key_b", name: "B · forward pose", suffix: "b", shift: 2, bone: 0.12 },
  { id: "key_c", name: "C · settled pose", suffix: "c", shift: -1, bone: -0.03 },
]);

const PARTS = Object.freeze([
  { slotId: "slot_body", name: "Body", meshId: "mesh_body", topologyId: "topology_body" },
  { slotId: "slot_eye", name: "Eye", meshId: "mesh_eye", topologyId: "topology_eye" },
  { slotId: "slot_mask", name: "Eye mask", meshId: "mesh_mask", topologyId: "topology_mask" },
  { slotId: "slot_hair", name: "Hair", meshId: "mesh_hair", topologyId: "topology_hair" },
]);

function member(nodeId, appearanceId, drawOrder, clippingSourceNodeId = null) {
  return {
    nodeId,
    appearanceId,
    opacity: 1,
    presence: "present",
    drawOrder,
    clipping: { sourceNodeId: clippingSourceNodeId },
  };
}

function topology(id) {
  return {
    id,
    vertexIds: [`${id}_v1`, `${id}_v2`, `${id}_v3`],
    indices: [0, 1, 2],
    vertexMetadata: {},
    nextVertexSequence: 1,
  };
}

function positions(partIndex, keyIndex, shift) {
  const x = 8 + partIndex * 6 + shift;
  const y = 10 + keyIndex * 2 + partIndex;
  return [x, y, x + 5 + keyIndex, y + keyIndex, x + 1, y + 6 + partIndex];
}

function installWarp(project, id, parentNodeId, children, extent) {
  const controlPointIds = ["tl", "tr", "bl", "br"].map((suffix) => `${id}_${suffix}`);
  const created = createWarpDeformer({
    id,
    displayName: id === "warp_outer" ? "Body sway" : "Hair sway",
    parentNodeId,
    columns: 2,
    rows: 2,
    bounds: { left: 0, top: 0, right: extent, bottom: extent },
    controlPointIds,
  });
  project.scene.nodes[id] = createSceneNode({
    id,
    kind: "deformer",
    displayName: created.deformer.displayName,
    parentId: parentNodeId,
  });
  project.scene.nodes[id].children = [...children];
  project.rig.deformers.push(created.deformer);
  project.rig.warpControlPoints.push(...created.controlPoints);
  for (const [index, keyArt] of KEY_ARTS.entries()) {
    const controlPoints = defaultWarpKeyformControlPoints(created.deformer, created.controlPoints)
      .map((point) => ({ ...point, y: point.y + index * 0.25 }));
    project.rig.warpDeformerKeyforms.push({
      deformerId: id,
      keyArtId: keyArt.id,
      controlPoints,
    });
  }
  return controlPointIds;
}

function transitionPart(slotId, topologyId, fromSuffix, toSuffix) {
  return {
    id: `part_${slotId}_${fromSuffix}_${toSuffix}`,
    semanticSlotId: slotId,
    mode: "morph",
    topologyId,
    fromKeyformId: `keyform_${slotId}_${fromSuffix}`,
    toKeyformId: `keyform_${slotId}_${toSuffix}`,
    configuration: {},
  };
}

function createBaseProject() {
  const project = createProject({
    name: "Phase 8 production proof",
    width: 64,
    height: 64,
    idFactory: createIdFactory("phase8_proof"),
  });
  project.renderSettings.frameRate = { numerator: 1200, denominator: 1 };
  const rootId = project.scene.rootId;
  project.scene.nodes.background = createSceneNode({
    id: "background",
    displayName: "Background",
    sourceRef: "mesh_background",
    parentId: rootId,
    bounds: { left: 0, top: 0, right: 64, bottom: 64 },
  });
  project.meshes.push({ id: "mesh_background" });
  project.meshTopologies.push(topology("topology_background"));
  project.semanticSlots.push({
    id: "slot_background",
    displayName: "Background",
    role: "background",
    mappings: KEY_ARTS.map(({ id }) => ({ keyArtId: id, nodeId: "background" })),
    metadata: {},
  });

  const characterNodes = [];
  for (const [partIndex, part] of PARTS.entries()) {
    project.meshes.push({ id: part.meshId });
    project.meshTopologies.push(topology(part.topologyId));
    const mappings = [];
    for (const [keyIndex, keyArt] of KEY_ARTS.entries()) {
      const nodeId = `${part.slotId}_${keyArt.suffix}`;
      characterNodes.push(nodeId);
      mappings.push({ keyArtId: keyArt.id, nodeId });
      project.scene.nodes[nodeId] = createSceneNode({
        id: nodeId,
        displayName: `${part.name} ${keyArt.suffix.toUpperCase()}`,
        sourceRef: part.meshId,
        parentId: "warp_inner",
        bounds: { left: 4, top: 4, right: 28, bottom: 34 },
      });
      project.meshKeyforms.push({
        id: `keyform_${part.slotId}_${keyArt.suffix}`,
        topologyId: part.topologyId,
        keyArtId: keyArt.id,
        semanticSlotId: part.slotId,
        positions: positions(partIndex, keyIndex, keyArt.shift),
        uvs: [0, 0, 1, 0, 0, 1],
      });
    }
    project.semanticSlots.push({
      id: part.slotId,
      displayName: part.name,
      role: part.slotId.slice("slot_".length),
      mappings,
      metadata: {},
    });
  }

  project.scene.nodes.chest_bone = createSceneNode({
    id: "chest_bone",
    kind: "bone",
    displayName: "Chest Bone",
    parentId: "warp_inner",
    transform: boneSceneTransform({ x: 12, y: 24, rotation: 0 }),
  });
  project.rig.bones.push(createBone({
    id: "chest_bone",
    parentNodeId: "warp_inner",
    restLocalTransform: { x: 12, y: 24, rotation: 0 },
    length: 12,
  }));
  for (const keyArt of KEY_ARTS) {
    project.rig.bonePoseKeyforms.push(createBonePoseKeyform({
      boneId: "chest_bone",
      keyArtId: keyArt.id,
      localDelta: { x: 0, y: 0, rotation: keyArt.bone },
    }));
  }
  project.rig.boneRotationConstraints.push(createBoneRotationConstraint({
    id: "chest_limit",
    boneId: "chest_bone",
    minRotation: -0.2,
    maxRotation: 0.2,
  }));
  for (const keyArt of KEY_ARTS) {
    project.rig.rigidBoneBindings.push(createRigidBoneBinding({
      id: `rigid_body_${keyArt.suffix}`,
      targetNodeId: `slot_body_${keyArt.suffix}`,
      boneId: "chest_bone",
    }));
  }

  const innerChildren = ["chest_bone", ...characterNodes];
  const outerPoints = installWarp(project, "warp_outer", rootId, ["warp_inner"], 64);
  const innerPoints = installWarp(project, "warp_inner", "warp_outer", innerChildren, 48);
  project.scene.nodes[rootId].children.push("background", "warp_outer");

  for (const keyArt of KEY_ARTS) {
    const suffix = keyArt.suffix;
    project.keyArts.push({
      id: keyArt.id,
      displayName: keyArt.name,
      rootNodeId: rootId,
      members: [
        member("background", `background_${suffix}`, -10),
        member(`slot_body_${suffix}`, `body_${suffix}`, 0),
        member(`slot_mask_${suffix}`, `mask_${suffix}`, 1),
        member(`slot_eye_${suffix}`, `eye_${suffix}`, 2, `slot_mask_${suffix}`),
        member(`slot_hair_${suffix}`, `hair_${suffix}`, 3),
      ],
      metadata: {},
    });
    project.meshKeyforms.push({
      id: `keyform_slot_background_${suffix}`,
      topologyId: "topology_background",
      keyArtId: keyArt.id,
      semanticSlotId: "slot_background",
      positions: [0, 0, 64, 0, 0, 64],
      uvs: [0, 0, 1, 0, 0, 1],
    });
    project.meshFormCorrectionKeyforms.push(createMeshFormCorrectionKeyform({
      id: `form_body_${suffix}`,
      topologyId: "topology_body",
      keyArtId: keyArt.id,
      semanticSlotId: "slot_body",
      vertexOffsets: [{ vertexId: "topology_body_v1", x: keyArt.shift * 0.2, y: 0.5 }],
    }));
  }
  project.animation.deformationSamples.push({
    id: "body_detail_sample",
    meshId: "mesh_body",
    topologyId: "topology_body",
    offsets: [{ vertexId: "topology_body_v1", dx: 1.5, dy: -0.5 }],
  });
  return { project, outerPoints, innerPoints };
}

function createTransition(session, { id, programId, fromKeyArtId, toKeyArtId, fromSuffix, toSuffix }) {
  session.executeTransaction([
    {
      type: "animation.temporal.create_program",
      payload: { programId, durationTicks: 100 },
    },
    {
      type: "transition.create",
      payload: { transition: {
        id,
        displayName: `${fromSuffix.toUpperCase()}/${toSuffix.toUpperCase()}`,
        fromKeyArtId,
        toKeyArtId,
        temporalProgramId: programId,
        partTransitions: [
          ...PARTS.map((part) => transitionPart(
            part.slotId, part.topologyId, fromSuffix, toSuffix)),
          transitionPart("slot_background", "topology_background", fromSuffix, toSuffix),
        ],
        diagnosticOverrides: [],
      } },
    },
  ], { label: `Create ${id}` });
}

function addScalarKeys(timeline, trackId, channel, entries) {
  for (const [id, timeTicks, value, interpolationKind = "linear"] of entries) {
    timeline.addKeyframe(trackId, channel, { keyframeId: id, timeTicks, value, interpolationKind });
  }
}

function authorBlink(timeline) {
  timeline.createClip({ displayName: "Blink", durationTicks: 40,
    defaultLoopMode: "once", clipId: "clip_blink", programId: "program_blink" });
  timeline.addTrack("TransformTrack",
    { semanticSlotId: "slot_eye", coordinateSpace: "node-local" },
    { trackId: "blink_eye_transform" });
  addScalarKeys(timeline, "blink_eye_transform", "scaleY", [
    ["blink_open_start", 0, 1],
    ["blink_closed", 20, 0.08],
    ["blink_open_end", 40, 1],
  ]);
  timeline.applyEasePreset("blink_eye_transform", "scaleY", "blink_open_start", "ease-in");
  timeline.applyEasePreset("blink_eye_transform", "scaleY", "blink_closed", "ease-out");
}

function authorBreath(timeline) {
  timeline.createClip({ displayName: "Breath", durationTicks: 120,
    defaultLoopMode: "loop", clipId: "clip_breath", programId: "program_breath" });
  timeline.addTrack("TransformTrack",
    { semanticSlotId: "slot_body", coordinateSpace: "node-local" },
    { trackId: "breath_body_transform" });
  addScalarKeys(timeline, "breath_body_transform", "positionY", [
    ["breath_y_start", 0, 0], ["breath_y_peak", 60, -1.5], ["breath_y_end", 120, 0],
  ]);
  timeline.addTrack("BoneTrack", { boneId: "chest_bone" }, { trackId: "breath_bone" });
  addScalarKeys(timeline, "breath_bone", "rotation", [
    ["breath_bone_start", 0, 0], ["breath_bone_peak", 60, 0.16],
    ["breath_bone_end", 120, 0],
  ]);
  timeline.addTrack("MeshDeformationTrack", { meshId: "mesh_body" },
    { trackId: "breath_form_detail" });
  for (const [id, timeTicks, weight] of [
    ["detail_start", 0, 0], ["detail_peak", 60, 1], ["detail_end", 120, 0],
  ]) {
    timeline.addKeyframe("breath_form_detail", "deformation", {
      keyframeId: id,
      timeTicks,
      value: { deformationSampleId: "body_detail_sample", weight },
      interpolationKind: "linear",
    });
  }
}

function authorHairSway(timeline, outerPoints, innerPoints) {
  timeline.createClip({ displayName: "HairSway", durationTicks: 100,
    defaultLoopMode: "loop", clipId: "clip_hair_sway", programId: "program_hair_sway" });
  for (const [trackId, deformerId, controlPointId, amplitude] of [
    ["hair_outer", "warp_outer", outerPoints[1], 1.25],
    ["hair_inner", "warp_inner", innerPoints[1], -2],
  ]) {
    timeline.addTrack("DeformerTrack", { deformerId, controlPointId }, { trackId });
    addScalarKeys(timeline, trackId, "deltaX", [
      [`${trackId}_start`, 0, 0], [`${trackId}_peak`, 50, amplitude],
      [`${trackId}_end`, 100, 0],
    ]);
  }
}

function authorNodeMotion(timeline) {
  timeline.createClip({ displayName: "Shot Accent", durationTicks: 200,
    defaultLoopMode: "once", clipId: "clip_node_motion", programId: "program_node_motion" });
  timeline.addTrack("TransformTrack",
    { nodeId: "background", coordinateSpace: "node-local" },
    { trackId: "background_pan" });
  addScalarKeys(timeline, "background_pan", "positionX", [
    ["pan_start", 0, 0], ["pan_peak", 100, 2], ["pan_end", 200, 0],
  ]);
}

export function buildPhase8ProductionProof() {
  const { project, outerPoints, innerPoints } = createBaseProject();
  const session = new EditorSession(project);
  createTransition(session, { id: "transition_ab", programId: "program_transition_ab",
    fromKeyArtId: "key_a", toKeyArtId: "key_b", fromSuffix: "a", toSuffix: "b" });
  createTransition(session, { id: "transition_bc", programId: "program_transition_bc",
    fromKeyArtId: "key_b", toKeyArtId: "key_c", fromSuffix: "b", toSuffix: "c" });

  let sequenceId = 0;
  const timeline = new SequenceTimelineController(session, {
    idFactory: (kind) => `${kind}_proof_${++sequenceId}`,
  });
  timeline.createSequence({ displayName: "A → B → C Production Shot", durationTicks: 600,
    keyArtId: "key_a", sequenceId: "sequence_proof", programId: "program_sequence_proof",
    viewItemId: "hold_a" });
  timeline.insertTransition({ transitionId: "transition_ab", startTicks: 100, endTicks: 200,
    itemId: "view_transition_ab" });
  timeline.insertTransition({ transitionId: "transition_bc", startTicks: 300, endTicks: 400,
    itemId: "view_transition_bc" });

  authorBlink(timeline);
  authorBreath(timeline);
  authorHairSway(timeline, outerPoints, innerPoints);
  authorNodeMotion(timeline);

  timeline.selectSequence("sequence_proof");
  timeline.addClipInstance({ clipId: "clip_blink", clipInstanceId: "blink_cross_boundary",
    startTicks: 80, endTicks: 220, loopMode: "loop", layer: 3 });
  timeline.addClipInstance({ clipId: "clip_blink", clipInstanceId: "blink_hold_c",
    startTicks: 420, endTicks: 460, loopMode: "once", layer: 3 });
  timeline.addClipInstance({ clipId: "clip_breath", clipInstanceId: "breath_loop",
    startTicks: 0, endTicks: 600, loopMode: "loop", layer: 1 });
  timeline.addClipInstance({ clipId: "clip_hair_sway", clipInstanceId: "hair_sway_loop",
    startTicks: 0, endTicks: 600, loopMode: "loop", layer: 2 });
  timeline.addClipInstance({ clipId: "clip_node_motion", clipInstanceId: "background_accent",
    startTicks: 200, endTicks: 400, loopMode: "once", layer: 0 });
  return { project: session.project, session, timeline };
}

export function semanticSnapshot(evaluation) {
  return {
    timeTicks: evaluation.timeTicks,
    authoritative: evaluation.authoritative,
    activeView: evaluation.activeViewLaneItem,
    activeClips: evaluation.activeClipInstances.map((entry) => ({
      clipInstanceId: entry.clipInstanceId,
      clipId: entry.clipId,
      localTick: entry.localTick,
      rawLocalTick: entry.rawLocalTick,
    })),
    camera: evaluation.camera,
    parts: evaluation.evaluatedParts.map((part) => ({
      semanticSlotId: part.semanticSlotId,
      presence: part.presence,
      instances: part.renderInstances.map((instance) => ({
        nodeId: instance.nodeId,
        opacity: instance.opacity,
        drawOrder: instance.drawOrder,
        transform: instance.transform,
        mesh: instance.mesh,
        clipping: instance.clipping,
      })),
    })),
    diagnostics: evaluation.diagnostics,
  };
}
