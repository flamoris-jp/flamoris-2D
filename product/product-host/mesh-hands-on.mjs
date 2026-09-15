import { randomUUID } from "node:crypto";
import { createProject, createSceneNode } from "../src/model/project.js";
import { MeshPreparationController } from "../src/ui/mesh-preparation-controller.js";
import { MeshToolController, MESH_AUTHORING_MODES } from "../src/ui/mesh-tool-controller.js";
import { generateGridMesh, findAlphaBounds } from "../src/mesh.js";
import { generateContourAutoMesh } from "../src/core/contour-automesh.js";

export function createHandsOnProject(assets) {
  if (!assets.length) throw new Error("Select at least one PNG artwork.");
  const idFactory = kind => `${kind}_${randomUUID()}`;
  const project = createProject({ name: "Mesh体験 — 保存されません", idFactory,
    width: Math.max(...assets.map(a => a.width)), height: Math.max(...assets.map(a => a.height)) });
  const keyArt = { id: idFactory("keyart"), displayName: "読み込んだ素材",
    rootNodeId: project.scene.rootId, members: [], metadata: {} };
  project.keyArts.push(keyArt);
  const bindings = new Map();
  for (const [order, asset] of assets.entries()) {
    const node = createSceneNode({ id: idFactory("node"), displayName: asset.name,
      parentId: project.scene.rootId,
      bounds: { left: 0, top: 0, right: asset.width, bottom: asset.height } });
    project.scene.nodes[node.id] = node;
    project.scene.nodes[project.scene.rootId].children.push(node.id);
    keyArt.members.push({ nodeId: node.id, appearanceId: `raster:${asset.id}`, opacity: 1,
      presence: "present", drawOrder: order, clipping: { sourceNodeId: null } });
    bindings.set(node.id, asset.id);
  }
  return { project, bindings };
}

export function meshContext(session, input, strict = true) {
  const preparation = new MeshPreparationController(session);
  preparation.selectPart(input.nodeId);
  if (input.keyformId && (strict || preparation.getState().keyforms.some(k => k.id === input.keyformId)))
    preparation.selectKeyform(input.keyformId);
  const tools = new MeshToolController(session, preparation);
  tools.setMode(input.context === "layout" ? MESH_AUTHORING_MODES.DEFORM : MESH_AUTHORING_MODES.TOPOLOGY);
  return { preparation, tools };
}

export function executeMeshTool(session, input) {
  const { preparation, tools } = meshContext(session, input);
  const node = session.query("scene.get_node", { nodeId: input.nodeId });
  if (node.locked || !node.effectiveVisible) throw new Error("非表示・ロック中のパーツは編集できません。");
  const structure = new Set(["topology.add", "topology.remove", "topology.connect",
    "topology.subdivide", "topology.set-label", "topology.clear-label", "topology.automesh"]);
  if (!(input.context === "structure" && structure.has(input.tool)) &&
      !(input.context === "layout" && input.tool === "deform.move"))
    throw new Error("Tool is unavailable in this editing context.");
  if (input.tool === "deform.move") {
    const current = preparation.activeKeyform();
    if (current && JSON.stringify(current.positions) === JSON.stringify(input.input?.positions)) return null;
  }
  return tools.execute(input.tool, input.input || {});
}

export function generateMeshPreview(asset, input) {
  // BGRA and RGBA share the same alpha lane; the existing helpers read alpha only.
  const image = { width: asset.width, height: asset.height, data: asset.bytes };
  if (input.kind === "contour") return generateContourAutoMesh(image, input.settings);
  if (input.kind !== "grid") throw new Error("Unknown mesh generator.");
  const mesh = generateGridMesh(findAlphaBounds(image), image.width, image.height,
    input.columns, input.rows);
  return { candidate: { positions: [...mesh.baseVertices], uvs: [...mesh.uvs], indices: [...mesh.indices] },
    diagnostics: [] };
}
