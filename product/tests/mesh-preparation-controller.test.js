import test from "node:test";
import assert from "node:assert/strict";

import { EditorSession } from "../src/commands/editor.js";
import { deserializeProject, serializeProject } from "../src/io/project-json.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";
import { MeshPreparationController } from "../src/ui/mesh-preparation-controller.js";
import { MeshToolController, MESH_AUTHORING_MODES } from "../src/ui/mesh-tool-controller.js";
import { bindViewportInteractions } from "../src/ui/viewport-input-controller.js";

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

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
}

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

test("prepared vertex drag commits before earlier visibility history and supports Undo/Redo", () => {
  const { session, preparation, tools } = fixture();
  tools.execute("topology.automesh", { candidate });
  session.execute({
    type: "scene.set_visibility",
    payload: { nodeId: "eye_right", visible: false },
  });
  tools.setMode(MESH_AUTHORING_MODES.DEFORM);
  const mesh = {
    baseVertices: [...candidate.positions],
    vertexOffsets: new Float32Array(candidate.positions.length),
    uvs: [...candidate.uvs],
    indices: [...candidate.indices],
  };
  const overlayCanvas = eventTarget({
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
  });
  const state = {
    mode: "psd",
    editorMode: "deform",
    editor: {
      worldTransform: () => [1, 0, 0, 1, 0, 0],
      transitionPreview: { getState: () => ({ viewMode: "endpoint-a" }) },
    },
    previewMode: false,
    spacePressed: false,
    view: { scale: 1, originX: 0, originY: 0 },
    mesh,
    selected: new Set(),
    partOffset: { x: 0, y: 0 },
    drag: null,
  };
  bindViewportInteractions({
    state,
    elements: {
      overlayCanvas,
      viewportWrap: eventTarget({ classList: { add() {}, remove() {} } }),
    },
    viewportRenderer: { screenPointForPart: (x, y) => ({ x, y }) },
    returnToEdit() {},
    zoomAtScreenPoint() {},
    panViewBy() {},
    setEditorMode() {},
    undoProject() {},
    redoProject() {},
    render() {},
    setStatus() {},
    selectedPart: () => ({
      nodeId: "eye_right", left: 20, top: 10, width: 40, height: 20,
    }),
    endpointMesh: () => null,
    meshContext: () => preparation,
    meshTools: () => tools,
    loadFile() {},
    windowTarget: eventTarget(),
  });

  overlayCanvas.dispatch("pointerdown", {
    button: 0, pointerId: 1, clientX: 20, clientY: 10, shiftKey: false,
  });
  overlayCanvas.dispatch("pointermove", {
    pointerId: 1, clientX: 24, clientY: 13,
  });
  assert.deepEqual(preparation.activeKeyform().positions, candidate.positions);
  overlayCanvas.dispatch("pointerup", { pointerId: 1 });

  assert.equal(session.history.at(-1).commandTypes[0], "mesh_keyform.move_vertices");
  assert.deepEqual(preparation.activeKeyform().positions.slice(0, 2), [24, 13]);
  assert.equal(session.project.scene.nodes.eye_right.visible, false);
  session.undo();
  assert.deepEqual(preparation.activeKeyform().positions, candidate.positions);
  assert.equal(session.project.scene.nodes.eye_right.visible, false);
  session.redo();
  assert.deepEqual(preparation.activeKeyform().positions.slice(0, 2), [24, 13]);
  assert.equal(session.project.scene.nodes.eye_right.visible, false);
});

test("mesh preparation selection and active context remain transient", () => {
  const { session, preparation } = fixture();
  const before = structuredClone(session.project);
  preparation.selectPart(null);
  preparation.selectPart("eye_right");
  assert.deepEqual(session.project, before);
  assert.doesNotMatch(
    JSON.stringify(session.project),
    /selectedNodeId|selectedTopologyId|selectedKeyformId/,
  );
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
