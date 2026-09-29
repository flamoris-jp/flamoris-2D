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

const subset = new Set([
  "project.invalid", "project.unsupported_schema", "ANIMATION_INVALID_TIMEBASE", "project.missing_id",
  "canvas.invalid_width", "canvas.invalid_height", "ANIMATION_INVALID_FRAME_RATE", "scene.missing_nodes",
  "scene.missing_root", "scene.root_parent_not_null", "scene.root_not_group", "identity.missing",
  "identity.duplicate", "scene.key_id_mismatch", "scene.invalid_kind", "scene.invalid_opacity",
  "scene.invalid_children", "scene.orphan", "scene.missing_parent", "scene.missing_child",
  "scene.parent_child_mismatch", "transform.non_finite", "transform.zero_scale", "collection.invalid",
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
