import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createIdFactory, createProject, createSceneNode, cloneProject } from "../../src/model/project.js";
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
variant("key_art_semantic_mapping", hierarchy, p => {
  p.keyArts.push({ id: "art_1", displayName: "Art", rootNodeId: "part_1", members: [
    { nodeId: "part_1", appearanceId: "appearance_1", opacity: 2, presence: "wrong",
      drawOrder: 1, clipping: { sourceNodeId: "ghost" } },
    { nodeId: "part_1", appearanceId: "", opacity: 1, presence: "present",
      drawOrder: 1, clipping: { sourceNodeId: null } },
  ] });
  p.semanticSlots.push({ id: "slot_1", displayName: "Slot", mappings: [
    { keyArtId: "art_1", nodeId: "part_1" },
    { keyArtId: "art_1", nodeId: "ghost" },
  ] });
});
variant("transition_parts", minimal, p => {
  p.transitions.push({ id: "transition_1", displayName: "", fromKeyArtId: "missing",
    toKeyArtId: "missing", temporalProgramId: "missing", diagnosticOverrides: [
      { key: "override_1", code: "test", evidenceFingerprint: "f", semanticSlotId: "missing" },
      { key: "override_1", code: "test", evidenceFingerprint: "f" },
    ], partTransitions: [{ id: "part_transition_1", semanticSlotId: "missing", mode: "morph",
      topologyId: "missing", fromKeyformId: "missing", toKeyformId: "missing",
      configuration: { holdEndpoint: "to" } }] });
});
const populated = createProject({ name: "Populated", width: 100, height: 100,
  idFactory: createIdFactory("native_parity") });
for (const [id, name] of [["node_a", "A"], ["node_b", "B"]]) {
  populated.scene.nodes[id] = createSceneNode({ id, displayName: name,
    parentId: populated.scene.rootId, bounds: { left: 0, top: 0, right: 10, bottom: 10 } });
  populated.scene.nodes[populated.scene.rootId].children.push(id);
}
const member = (nodeId, appearanceId) => ({ nodeId, appearanceId, opacity: 1,
  presence: "present", drawOrder: 0, clipping: { sourceNodeId: null } });
populated.keyArts.push(
  { id: "art_a", displayName: "A", rootNodeId: populated.scene.rootId,
    members: [member("node_a", "appearance_a")], metadata: {} },
  { id: "art_b", displayName: "B", rootNodeId: populated.scene.rootId,
    members: [member("node_b", "appearance_b")], metadata: {} },
);
populated.semanticSlots.push({ id: "slot_1", displayName: "Subject", role: "subject",
  mappings: [{ keyArtId: "art_a", nodeId: "node_a" }, { keyArtId: "art_b", nodeId: "node_b" }], metadata: {} });
populated.temporalPrograms.push(
  { id: "program_transition", durationTicks: 100, tracks: [], events: [], regions: [] },
  { id: "program_sequence", durationTicks: 300, tracks: [], events: [], regions: [] },
);
populated.transitions.push({ id: "transition_ab", displayName: "A to B",
  fromKeyArtId: "art_a", toKeyArtId: "art_b", temporalProgramId: "program_transition",
  partTransitions: [{ id: "part_ab", semanticSlotId: "slot_1", mode: "replace", topologyId: null,
    fromKeyformId: null, toKeyformId: null, configuration: { compositeGroupId: "group_1" } }],
  diagnosticOverrides: [] });
populated.sequences.push({ id: "sequence_1", displayName: "Shot", temporalProgramId: "program_sequence",
  viewLaneItems: [
    { id: "hold_b", kind: "KeyArtHold", keyArtId: "art_b", startTicks: 200, endTicks: 300 },
    { id: "instance_ab", kind: "TransitionInstance", transitionId: "transition_ab", startTicks: 100, endTicks: 200 },
    { id: "hold_a", kind: "KeyArtHold", keyArtId: "art_a", startTicks: 0, endTicks: 100 },
  ], clipInstances: [], metadata: {} });
cases.push(["populated_sequence_transition", populated]);
variant("populated_sequence_multi_error", populated, p => {
  p.sequences[0].viewLaneItems.find(item => item.id === "hold_b").startTicks = 190;
  p.transitions[0].partTransitions[0].semanticSlotId = "missing";
  p.keyArts[0].members[0].clipping.sourceNodeId = "missing";
  p.temporalPrograms[0].events.push({ id: "event_1", timeTicks: 200, type: "wrong",
    participants: ["missing"], payload: null });
});
const meshed = cloneProject(populated);
meshed.meshTopologies.push({ id: "topology_1", vertexIds: ["vertex_a", "vertex_b", "vertex_c"],
  indices: [0, 1, 2], nextVertexSequence: 1, vertexMetadata: {} });
meshed.meshKeyforms.push(
  { id: "keyform_a", topologyId: "topology_1", keyArtId: "art_a", semanticSlotId: "slot_1",
    positions: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1] },
  { id: "keyform_b", topologyId: "topology_1", keyArtId: "art_b", semanticSlotId: "slot_1",
    positions: [1, 1, 11, 1, 1, 11], uvs: [0, 0, 1, 0, 0, 1] },
);
meshed.transitions[0].partTransitions[0] = { id: "part_ab", semanticSlotId: "slot_1", mode: "morph",
  topologyId: "topology_1", fromKeyformId: "keyform_a", toKeyformId: "keyform_b", configuration: {} };
cases.push(["populated_mesh_transition", meshed]);
variant("mesh_multi_error", meshed, p => {
  p.meshTopologies[0].vertexIds.push("vertex_a");
  p.meshTopologies[0].indices = [0, 0, 5];
  p.meshKeyforms[0].positions = [0, 0];
  p.meshKeyforms[1].uvs = [0, null, 1, 0, 0, 1];
});
variant("mesh_triangle_warnings", meshed, p => {
  p.meshKeyforms[0].positions = [0, 0, 1, 0, 2, 0];
  p.meshKeyforms[1].positions = [0, 0, 0.01, 0, 0, 0.01];
});
variant("authored_clipping_references", populated, p => {
  p.keyArts[0].members[0].clipping.sourceNodeId = "node_a";
  p.temporalPrograms[0].tracks.push({ trackId: "clipping_track", version: 1,
    kind: "ClippingTrack", target: { nodeId: p.scene.rootId }, channels: { clipping: { keyframes: [
      { id: "clip_key", timeTicks: 0, value: { sourceNodeId: p.scene.rootId },
        interpolationToNext: { kind: "step" } },
    ] } } });
});
variant("temporal_track_conflicts", populated, p => {
  p.temporalPrograms[0].tracks.push(
    { trackId: "draw_1", version: 1, kind: "DrawOrderTrack", target: { semanticSlotId: "slot_1" },
      channels: { drawOrder: { keyframes: [
        { id: "draw_key_1", timeTicks: 0, value: 0, interpolationToNext: { kind: "step" } },
      ] } } },
    { trackId: "draw_2", version: 1, kind: "DrawOrderTrack", target: { transitionDefault: true },
      channels: { drawOrder: { keyframes: [
        { id: "draw_key_2", timeTicks: 0, value: 0, interpolationToNext: { kind: "step" } },
      ] } } },
    { trackId: "draw_3", version: 1, kind: "DrawOrderTrack", target: { semanticSlotId: "slot_1" },
      channels: { drawOrder: { keyframes: [] } } },
  );
});
variant("cross_domain_sequence_clipping_id", populated, p => {
  p.clippingBindings.push({ id: "hold_a", targetNodeId: "node_a", sourceNodeId: "missing",
    mode: "inside", enabled: true });
});
variant("cross_domain_vertex_transition_id", meshed, p => {
  p.transitions[0].partTransitions[0].id = "vertex_a";
});
variant("topology_metadata_sequence", meshed, p => {
  p.meshTopologies[0].vertexIds = ["vtx_1", "vtx_2", "vtx_3"];
  p.meshTopologies[0].nextVertexSequence = 2;
  p.meshTopologies[0].vertexMetadata = {
    vtx_1: { semanticLabel: "left" }, vtx_2: { semanticLabel: "left" },
    ghost: { semanticLabel: "missing" },
  };
});
variant("sequence_ambiguous_keyform", meshed, p => {
  p.meshKeyforms.push({ ...structuredClone(p.meshKeyforms[0]), id: "keyform_a2" });
  p.sequences[0].viewLaneItems = [{ id: "hold_a", kind: "KeyArtHold", keyArtId: "art_a",
    startTicks: 0, endTicks: 300 }];
});

const fixtures = cases.map(([name, project]) => ({ name, project,
  expected: validateProject(project)
    .map(({ code, path, entityId, severity }) => ({ code, path, entityId: entityId ?? "", severity }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en")),
}));
const serialized = JSON.stringify(fixtures, null, 2) + "\n";
if (process.argv.includes("--write")) await writeFile(fixturePath, serialized);
else assert.equal((await readFile(fixturePath, "utf8")).replaceAll("\r\n", "\n"), serialized,
  "Project fixtures differ from current Product JS; regenerate deliberately with --write");
