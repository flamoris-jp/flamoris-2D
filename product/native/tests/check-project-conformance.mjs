import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createProject, createSceneNode, cloneProject } from "../../src/model/project.js";
import { validateProject } from "../../src/model/validation.js";

const fixturePath = fileURLToPath(new URL("./project-conformance.json", import.meta.url));
const minimal = createProject({ id: "project_あ", name: "夜明け", width: 1920, height: 1080,
  idFactory: (() => { let n = 0; return () => `node_${++n}`; })() });
const hierarchy = cloneProject(minimal);
const root = hierarchy.scene.nodes[hierarchy.scene.rootId];
const part = createSceneNode({ id: "part_1", displayName: "前髪", parentId: root.id });
root.children.push(part.id);
hierarchy.scene.nodes[part.id] = part;
const cases = [["minimal", minimal], ["hierarchy", hierarchy]];
function variant(name, base, change) {
  const project = cloneProject(base);
  change(project);
  cases.push([name, project]);
}
variant("schema", minimal, p => { p.schemaVersion = 14; });
variant("timebase", minimal, p => { p.timebaseTicksPerSecond = 1000; });
variant("frame_rate", minimal, p => { p.renderSettings.frameRate = { numerator: 60, denominator: 2 }; });
variant("duplicate", hierarchy, p => { p.scene.nodes.part_1.id = p.id; });
variant("hierarchy_link", hierarchy, p => { p.scene.nodes.part_1.parentId = "missing"; });
variant("transform", hierarchy, p => { p.scene.nodes.part_1.transform.scale.x = 0; delete p.scene.nodes.part_1.transform.position.y; });
variant("root", minimal, p => { p.scene.nodes[p.scene.rootId].kind = "part"; p.scene.nodes[p.scene.rootId].parentId = "ghost"; });
variant("root_missing_parent", minimal, p => { delete p.scene.nodes[p.scene.rootId].parentId; });
variant("opacity", hierarchy, p => { p.scene.nodes.part_1.opacity = 2; });
variant("collection_id", minimal, p => { p.keyArts.push({ id: p.id }); });
variant("node_state", hierarchy, p => {
  const node = p.scene.nodes.part_1;
  node.transform = { position: { x: 12.5, y: -3 }, rotation: 0.75,
    scale: { x: 1.25, y: -2 }, pivot: { x: 4, y: 6.5 } };
  node.visible = false;
  node.opacity = 0.375;
});
variant("key_id_mismatch", hierarchy, p => { p.scene.nodes.part_1.id = "actual_part_id"; });
variant("duration_authority", minimal, p => { p.renderSettings.durationTicks = 120000; });
variant("animation_shape", minimal, p => { p.animation.extra = []; });
variant("unicode_blank_name", hierarchy, p => { p.scene.nodes.part_1.displayName = "\u3000\u00a0"; });
variant("cycle", minimal, p => { p.scene.nodes[p.scene.rootId].children.push(p.scene.rootId); });
variant("unreachable", hierarchy, p => { p.scene.nodes[p.scene.rootId].children = []; });
variant("clip_sequence_duplicate", minimal, p => {
  p.animation.clips.push({ id: "shared" });
  p.sequences.push({ id: "shared" });
});
variant("node_key_art_duplicate", hierarchy, p => { p.keyArts.push({ id: "part_1" }); });
variant("deformation_sample_references", minimal, p => {
  p.animation.deformationSamples.push({ id: "sample_1", meshId: "missing", topologyId: "missing", offsets: [] });
});
variant("deformation_sample_offsets", minimal, p => {
  p.meshes.push({ id: "mesh_1" });
  p.meshTopologies.push({ id: "topo_1", vertexIds: ["a", "b"] });
  p.animation.deformationSamples.push({ id: "sample_1", meshId: "mesh_1", topologyId: "topo_1",
    offsets: [{ vertexId: "b", dx: 1, dy: 0 }, { vertexId: "a", dx: 0, dy: 0 },
      { vertexId: "b", dx: 0.2, dy: 0 }, { vertexId: "ghost", dx: 1, dy: 2 }] });
});
variant("animation_clip", minimal, p => {
  p.animation.clips.push({ id: "clip_1", displayName: "\u3000", temporalProgramId: "missing",
    defaultLoopMode: "invalid", metadata: null, durationTicks: 2 });
});
variant("rotation_constraints", minimal, p => {
  p.rig.boneRotationConstraints.push(
    { id: "rotation_1", boneId: "missing", enabled: true, minRotation: 2, maxRotation: 1 },
    { id: "rotation_2", boneId: "missing", enabled: true, minRotation: -1, maxRotation: 1 });
});
variant("ik_constraints", minimal, p => {
  p.rig.twoBoneIkConstraints.push(
    { id: "ik_1", rootBoneId: "r", midBoneId: "r", endBoneId: "e", enabled: true, bendDirection: "none" },
    { id: "ik_2", rootBoneId: "r", midBoneId: "m", endBoneId: "e", enabled: true, bendDirection: "clockwise" });
});
variant("rigid_bindings", hierarchy, p => {
  p.rig.rigidBoneBindings.push(
    { id: "part_1", targetNodeId: "part_1", boneId: "missing", enabled: true },
    { id: "rigid_2", targetNodeId: "part_1", boneId: "missing", enabled: true });
  p.rig.skinBindings.push({ id: "skin_1", targetNodeId: "part_1", enabled: true });
});
variant("mesh_form_corrections", minimal, p => {
  p.meshFormCorrectionKeyforms.push(
    { id: "form_1", topologyId: "missing", keyArtId: "missing", semanticSlotId: "missing",
      vertexOffsets: [{ vertexId: "v2", x: 0, y: 0 }, { vertexId: "v1", x: 1, y: 0 },
        { vertexId: "v2", x: 1, y: 1 }] },
    { id: "form_2", topologyId: "missing", keyArtId: "missing", semanticSlotId: "missing",
      vertexOffsets: [] });
});
variant("bone_and_pose", minimal, p => {
  p.rig.bones.push({ id: "bone_1", parentNodeId: "missing", restLocalTransform: {
    x: 0, y: 0, rotation: 0 }, length: -2, enabled: "yes" });
  p.rig.bonePoseKeyforms.push({ boneId: "bone_1", keyArtId: "missing",
    localDelta: { x: 0, y: 0, rotation: null } });
});
variant("warp_deformer", minimal, p => {
  p.rig.deformers.push({ id: "warp_1", parentNodeId: "missing", type: "wrong",
    displayName: "\u3000", columns: 2, rows: 2, bounds: { left: 1, top: 1, right: 0, bottom: 0 },
    controlPointIds: ["point_1", "point_1"] });
  p.rig.warpControlPoints.push({ id: "point_1", deformerId: "warp_1", u: 2, v: 0 });
  p.rig.warpDeformerKeyforms.push({ deformerId: "warp_1", keyArtId: "missing",
    controlPoints: [{ controlPointId: "point_1", x: null, y: 0 }] });
});
variant("skin_binding", hierarchy, p => {
  p.meshTopologies.push({ id: "topology_1", vertexIds: ["a", "b"] });
  p.rig.skinBindings.push({ id: "skin_1", targetNodeId: "part_1", topologyId: "topology_1", enabled: true,
    vertexWeights: [{ vertexId: "b", influences: [
      { boneId: "missing", weight: 0.3 }, { boneId: "missing", weight: 0.3 }] },
    { vertexId: "b", influences: [{ boneId: "missing", weight: 1 }] }] });
});
variant("temporal_program_shape", minimal, p => {
  p.temporalPrograms.push({ id: "program_1", durationTicks: 0, tracks: [], events: [], regions: [], extra: true });
});
variant("temporal_ownership", minimal, p => {
  p.temporalPrograms.push({ id: "program_1", durationTicks: 120000, tracks: [], events: [], regions: [] });
  p.animation.clips.push({ id: "clip_1", displayName: "Clip", temporalProgramId: "program_1",
    defaultLoopMode: "once", metadata: {} });
  p.sequences.push({ id: "sequence_1", displayName: "Sequence", temporalProgramId: "program_1",
    viewLaneItems: [], clipInstances: [], metadata: {} });
});
variant("temporal_track_owner", minimal, p => {
  p.temporalPrograms.push({ id: "program_1", durationTicks: 120000,
    tracks: [{ trackId: "track_1", version: 1, kind: "CameraTrack", target: { cameraId: "main" }, channels: {} }],
    events: [], regions: [] });
});
variant("clipping_shape_references", hierarchy, p => {
  p.clippingBindings.push({ id: "binding_1", targetNodeId: "part_1", sourceNodeId: "missing",
    mode: "outside", enabled: "yes", extra: 1 });
  p.clippingBindings.push({ id: "binding_2", targetNodeId: "part_1", sourceNodeId: "part_1",
    mode: "inside", enabled: true });
});
variant("clipping_cycle", hierarchy, p => {
  const rootId = p.scene.rootId;
  const other = createSceneNode({ id: "part_2", displayName: "後髪", parentId: rootId });
  p.scene.nodes[rootId].children.push(other.id);
  p.scene.nodes[other.id] = other;
  p.clippingBindings.push({ id: "binding_1", targetNodeId: "part_1", sourceNodeId: "part_2", mode: "inside", enabled: true });
  p.clippingBindings.push({ id: "binding_2", targetNodeId: "part_2", sourceNodeId: "part_1", mode: "inside", enabled: true });
});
variant("loop_endpoint_warning", hierarchy, p => {
  p.temporalPrograms.push({ id: "program_loop", durationTicks: 120000, events: [], regions: [],
    tracks: [{ trackId: "track_opacity", version: 1, kind: "OpacityTrack",
      target: { nodeId: "part_1" }, channels: { opacity: { keyframes: [
        { id: "key_start", timeTicks: 0, value: 0.2, interpolationToNext: { kind: "linear" } },
        { id: "key_end", timeTicks: 120000, value: 0.8, interpolationToNext: { kind: "step" } },
      ] } } }] });
  p.animation.clips.push({ id: "clip_loop", displayName: "Loop", temporalProgramId: "program_loop",
    defaultLoopMode: "loop", metadata: {} });
});
variant("sequence_items", hierarchy, p => {
  p.temporalPrograms.push({ id: "program_sequence", durationTicks: 120000, tracks: [], events: [], regions: [] });
  p.sequences.push({ id: "sequence_1", displayName: "Sequence", temporalProgramId: "program_sequence",
    clipInstances: [], metadata: {}, viewLaneItems: [
      { id: "hold_1", kind: "KeyArtHold", keyArtId: "missing", startTicks: 1000, endTicks: 30000 },
      { id: "hold_2", kind: "KeyArtHold", keyArtId: "also_missing", startTicks: 25000, endTicks: 90000 },
    ] });
});
variant("clip_instance_invalid", minimal, p => {
  p.temporalPrograms.push({ id: "program_sequence", durationTicks: 120000, tracks: [], events: [], regions: [] });
  p.sequences.push({ id: "sequence_1", displayName: "Sequence", temporalProgramId: "program_sequence",
    viewLaneItems: [], metadata: {}, clipInstances: [
      { id: "instance_1", clipId: "missing", startTicks: 10, endTicks: 9, sourceOffsetTicks: -1,
        playbackRate: { numerator: 4, denominator: 2 }, loopMode: "invalid", weight: 2,
        layer: 0.5, enabled: "yes" },
    ] });
});
variant("temporal_keys_events_regions", hierarchy, p => {
  p.temporalPrograms.push({ id: "program_1", durationTicks: 120000,
    tracks: [{ trackId: "track_1", version: 2, kind: "OpacityTrack", target: { nodeId: "part_1" },
      channels: { opacity: { keyframes: [
        { id: "key_1", timeTicks: 130000, value: 2, interpolationToNext: { kind: "wrong" } },
        { id: "key_2", timeTicks: 130000, value: -1, interpolationToNext: { kind: "step" } },
      ] } } }],
    events: [{ id: "event_1", timeTicks: 130000, type: "wrong", participants: ["ghost"], payload: null }],
    regions: [{ id: "region_1", startTicks: 130000, endTicks: 10, type: "wrong", metadata: null }],
  });
});

const subset = new Set([
  "project.invalid", "project.unsupported_schema", "ANIMATION_INVALID_TIMEBASE", "project.missing_id",
  "canvas.invalid_width", "canvas.invalid_height", "ANIMATION_INVALID_FRAME_RATE", "scene.missing_nodes",
  "scene.missing_root", "scene.root_parent_not_null", "scene.root_not_group", "identity.missing",
  "identity.duplicate", "scene.key_id_mismatch", "scene.invalid_kind", "scene.invalid_opacity",
  "scene.invalid_children", "scene.orphan", "scene.missing_parent", "scene.missing_child",
  "scene.parent_child_mismatch", "transform.non_finite", "transform.zero_scale", "collection.invalid",
  "ANIMATION_SECOND_DURATION_AUTHORITY", "ANIMATION_SCHEMA_INVALID", "scene.invalid_display_name",
  "scene.cycle", "scene.unreachable",
  "ANIMATION_DEFORMATION_SAMPLE_INVALID", "ANIMATION_DEFORMATION_OFFSET_INVALID",
  "ANIMATION_TRACK_TARGET_INVALID", "ANIMATION_TOPOLOGY_INCOMPATIBLE",
  "ANIMATION_DEFORMATION_VERTEX_DUPLICATE", "ANIMATION_DEFORMATION_VERTEX_ORDER_INVALID",
  "ANIMATION_CLIP_INVALID", "ANIMATION_CLIP_PROGRAM_REFERENCE_INVALID", "ANIMATION_CLIP_LOOP_MODE_INVALID",
  "BONE_ROTATION_CONSTRAINT_INVALID", "BONE_ROTATION_CONSTRAINT_BONE_MISSING",
  "BONE_ROTATION_CONSTRAINT_CONFLICT",
  "TWO_BONE_IK_INVALID", "TWO_BONE_IK_BONES_INVALID", "TWO_BONE_IK_BONE_MISSING",
  "TWO_BONE_IK_HIERARCHY_INVALID", "TWO_BONE_IK_CHAIN_GEOMETRY_INVALID", "TWO_BONE_IK_END_CONFLICT",
  "RIGID_BINDING_TARGET_INVALID", "RIGID_BINDING_CONFLICT", "BONE_NODE_MISSING",
  "MESH_FORM_CORRECTION_INVALID", "MESH_FORM_CORRECTION_TOPOLOGY_MISSING",
  "MESH_FORM_CORRECTION_KEY_ART_MISSING", "MESH_FORM_CORRECTION_SEMANTIC_SLOT_MISSING",
  "MESH_FORM_CORRECTION_CONTEXT_DUPLICATE", "MESH_FORM_CORRECTION_CONTEXT_INCOMPATIBLE",
  "MESH_FORM_CORRECTION_MAPPING_INCOMPATIBLE", "MESH_FORM_CORRECTION_VERTEX_INVALID",
  "MESH_FORM_CORRECTION_VERTEX_MISSING", "MESH_FORM_CORRECTION_VERTEX_DUPLICATE",
  "MESH_FORM_CORRECTION_VERTEX_ORDER_INVALID", "MESH_FORM_CORRECTION_OFFSET_INVALID",
  "MESH_FORM_CORRECTION_ZERO_OFFSET",
  "BONE_REST_INVALID", "BONE_NODE_MISSING", "BONE_SCENE_IDENTITY_MISMATCH",
  "BONE_PARENT_INVALID", "BONE_LENGTH_INVALID", "BONE_HIERARCHY_CYCLE",
  "BONE_POSE_INVALID", "BONE_KEYART_REFERENCE_INVALID",
  "DEFORMER_CHILD_REFERENCE_INVALID", "DEFORMER_PARENT_MISSING", "DEFORMER_TYPE_INVALID",
  "DEFORMER_CONTROL_POINT_INVALID", "DEFORMER_KEYFORM_INCOMPATIBLE", "DEFORMER_CYCLE",
  "SKIN_BINDING_TARGET_INVALID", "SKIN_BINDING_TARGET_MISSING", "SKIN_BINDING_TOPOLOGY_MISSING",
  "SKIN_BINDING_TOPOLOGY_TARGET_MISMATCH", "SKIN_BINDING_TARGET_CONFLICT",
  "SKIN_BINDING_VERTEX_INVALID", "SKIN_BINDING_VERTEX_MISSING", "SKIN_BINDING_VERTEX_DUPLICATE",
  "SKIN_BINDING_VERTEX_ORDER_INVALID", "SKIN_BINDING_INFLUENCE_COUNT_INVALID",
  "SKIN_BINDING_INFLUENCE_INVALID", "SKIN_BINDING_INFLUENCE_DUPLICATE",
  "SKIN_BINDING_INFLUENCE_ORDER_INVALID", "SKIN_BINDING_WEIGHT_INVALID",
  "SKIN_BINDING_WEIGHT_NOT_NORMALIZED", "SKIN_BINDING_WEIGHT_NOT_CANONICAL",
  "SKIN_BINDING_BONE_HIERARCHY_INCOMPATIBLE",
  "ANIMATION_INVALID_PROGRAM", "ANIMATION_INVALID_DURATION", "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT",
  "ANIMATION_TRACK_OWNER_INVALID", "SEQUENCE_CAMERA_TRACK_MULTIPLE",
  "CLIPPING_BINDING_INVALID", "CLIPPING_TARGET_MISSING", "CLIPPING_TARGET_NOT_RENDERABLE",
  "CLIPPING_SOURCE_MISSING", "CLIPPING_SOURCE_NOT_RENDERABLE", "CLIPPING_SELF_REFERENCE",
  "CLIPPING_MODE_UNSUPPORTED", "CLIPPING_TARGET_ALREADY_BOUND", "CLIPPING_CYCLE",
  "ANIMATION_LOOP_ENDPOINT_MISMATCH",
  "SEQUENCE_INVALID", "SEQUENCE_PROGRAM_REFERENCE_INVALID", "SEQUENCE_VIEW_ITEM_INVALID",
  "SEQUENCE_INVALID_TIME", "SEQUENCE_KEYART_REFERENCE_INVALID", "SEQUENCE_TRANSITION_REFERENCE_INVALID",
  "SEQUENCE_VIEW_GAP", "SEQUENCE_VIEW_OVERLAP", "SEQUENCE_VIEW_CONTINUITY_MISMATCH",
  "SEQUENCE_TRANSITION_ENDPOINT_MISMATCH", "ANIMATION_CLIP_INSTANCE_INVALID",
  "ANIMATION_CLIP_REFERENCE_INVALID", "ANIMATION_CLIP_INSTANCE_PLACEMENT_INVALID",
  "ANIMATION_CLIP_SOURCE_OFFSET_INVALID", "ANIMATION_CLIP_PLAYBACK_RATE_INVALID",
  "ANIMATION_CLIP_PLAYBACK_RATE_NONCANONICAL", "ANIMATION_CLIP_LOOP_MODE_INVALID",
  "ANIMATION_CLIP_WEIGHT_INVALID", "ANIMATION_CLIP_LAYER_INVALID",
  "ANIMATION_DISCRETE_WEIGHT_INVALID", "ANIMATION_CLIP_ONCE_OVERRUN",
  "ANIMATION_CLIP_LOOP_OFFSET_INVALID", "ANIMATION_CLIP_LOCAL_TIME_OVERFLOW",
  "ANIMATION_INVALID_TRACK", "ANIMATION_UNKNOWN_TRACK_KIND", "ANIMATION_TRACK_VERSION_UNSUPPORTED",
  "ANIMATION_INVALID_CHANNEL", "ANIMATION_INVALID_KEYFRAME", "ANIMATION_INVALID_TIME",
  "ANIMATION_KEY_OUTSIDE_PROGRAM", "ANIMATION_DUPLICATE_KEY_TIME", "ANIMATION_INVALID_VALUE",
  "ANIMATION_INVALID_DRAW_ORDER", "ANIMATION_INVALID_PRESENCE_VALUE", "ANIMATION_UNKNOWN_TARGET",
  "ANIMATION_INVALID_CURVE", "ANIMATION_INVALID_EVENT", "ANIMATION_INVALID_REGION",
]);
const fixtures = cases.map(([name, project]) => ({ name, project,
  expected: validateProject(project).filter(issue => subset.has(issue.code))
    .map(({ code, path, entityId, severity }) => ({ code, path, entityId: entityId ?? "", severity }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en")),
}));
const serialized = JSON.stringify(fixtures, null, 2) + "\n";
if (process.argv.includes("--write")) await writeFile(fixturePath, serialized);
else assert.equal((await readFile(fixturePath, "utf8")).replaceAll("\r\n", "\n"), serialized,
  "Project fixtures differ from current Product JS; regenerate deliberately with --write");
