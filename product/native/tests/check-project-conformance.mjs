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
]);
const fixtures = cases.map(([name, project]) => ({ name, project,
  expected: validateProject(project).filter(issue => subset.has(issue.code))
    .map(({ code, path, entityId }) => ({ code, path, entityId: entityId ?? "" }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en")),
}));
const serialized = JSON.stringify(fixtures, null, 2) + "\n";
if (process.argv.includes("--write")) await writeFile(fixturePath, serialized);
else assert.equal((await readFile(fixturePath, "utf8")).replaceAll("\r\n", "\n"), serialized,
  "Project fixtures differ from current Product JS; regenerate deliberately with --write");
