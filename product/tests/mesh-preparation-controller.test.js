import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession } from "../src/commands/editor.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { MeshPreparationController } from "../src/ui/mesh-preparation-controller.js";
import { MeshToolController, MESH_AUTHORING_MODES } from "../src/ui/mesh-tool-controller.js";

function fixture() {
  const project = createProject({
    name: "Mesh preparation", width: 100, height: 80,
    idFactory: createIdFactory("mesh-preparation"),
  });
  const node = createSceneNode({
    id: "eye_right", displayName: "右目", parentId: project.scene.rootId,
    bounds: { left: 20, top: 10, right: 60, bottom: 30 },
  });
  project.scene.nodes[node.id] = node;
  project.scene.nodes[project.scene.rootId].children.push(node.id);
  project.keyArts.push({
    id: "keyart_psd", displayName: "PSD", rootNodeId: project.scene.rootId,
    members: [{
      nodeId: node.id, appearanceId: "source:eye", opacity: 1,
      presence: "present", drawOrder: 0, clipping: { sourceNodeId: null },
    }],
    metadata: {},
  });
  const ids = ["slot", "topology", "keyform"];
  const session = new EditorSession(project);
  const preparation = new MeshPreparationController(session, {
    idFactory: () => ids.shift(),
  });
  preparation.selectPart(node.id);
  const tools = new MeshToolController(session, preparation);
  tools.setMode(MESH_AUTHORING_MODES.TOPOLOGY);
  return { session, preparation, tools };
}

const candidate = {
  positions: [20, 10, 60, 10, 60, 30, 20, 30],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  indices: [0, 1, 2, 0, 2, 3],
};

test("grid/AutoMesh preparation creates one production mesh transaction", () => {
  const { session, preparation, tools } = fixture();
  tools.execute("topology.automesh", { candidate });
  assert.deepEqual(session.history.at(-1).commandTypes, [
    "semantic_slot.create",
    "semantic_slot.map_node",
    "mesh_topology.create",
    "mesh_keyform.create",
  ]);
  assert.equal(session.project.semanticSlots.length, 1);
  assert.equal(session.project.meshTopologies.length, 1);
  assert.equal(session.project.meshKeyforms.length, 1);
  assert.equal(preparation.activeKeyform().id, "keyform");
  assert.deepEqual(preparation.activeKeyform().positions, candidate.positions);
});

test("prepared topology and keyform Undo/Redo and Save/Open preserve exact identity", () => {
  const { session, preparation, tools } = fixture();
  const result = tools.execute("topology.automesh", { candidate });
  const createdProject = structuredClone(session.project);
  assert.equal(result.vertexIds.length, 4);
  session.undo();
  preparation.projectChanged();
  assert.equal(session.project.meshTopologies.length, 0);
  assert.equal(session.project.meshKeyforms.length, 0);
  session.redo();
  preparation.projectChanged();
  assert.deepEqual(session.project, createdProject);
  assert.deepEqual(deserializeProject(serializeProject(session.project)), createdProject);
});

test("mesh preparation selection and active context remain transient", () => {
  const { session, preparation } = fixture();
  const before = serializeProject(session.project);
  preparation.selectPart(null);
  preparation.selectPart("eye_right");
  assert.equal(serializeProject(session.project), before);
  assert.doesNotMatch(before, /selectedNodeId|selectedTopologyId|selectedKeyformId/);
});

test("MeshToolController can switch between preparation and endpoint contexts", () => {
  const { session, preparation, tools } = fixture();
  const endpoint = {
    getState: () => ({ selectedTopologyId: null }),
    activeKeyform: () => null,
    createSharedTopologyAndKeyforms: () => null,
  };
  tools.selectVertexByIndex(0);
  tools.setContextController(endpoint);
  assert.equal(tools.getState().selectedVertexIds.length, 0);
  tools.setContextController(preparation);
  assert.equal(tools.activeTopology(), null);
  assert.equal(session.history.length, 0);
});
