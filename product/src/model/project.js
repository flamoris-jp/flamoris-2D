export const PROJECT_SCHEMA_VERSION = 1;

export function identityTransform() {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
  };
}

export function createIdFactory(namespace = "project") {
  let sequence = 0;
  return (kind = "id") => kind + "_" + namespace + "_" + String(++sequence).padStart(4, "0");
}

export function cloneProject(project) {
  return typeof structuredClone === "function"
    ? structuredClone(project)
    : JSON.parse(JSON.stringify(project));
}

export function createProject({ id, name = "Untitled", width, height, idFactory = createIdFactory() }) {
  const projectId = id || idFactory("project");
  const rootId = idFactory("node");
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: projectId,
    displayName: name,
    canvas: { width, height },
    sourceAssets: [],
    semanticSlots: [],
    keyArts: [],
    scene: {
      rootId,
      nodes: {
        [rootId]: {
          id: rootId,
          kind: "group",
          displayName: name,
          sourceRef: null,
          parentId: null,
          children: [],
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          transform: identityTransform(),
        },
      },
    },
    meshes: [],
    rig: { deformers: [], bones: [], constraints: [] },
    transitions: [],
    animation: { clips: [], tracks: [], keyframes: [] },
    sequence: [],
    renderSettings: { fps: 30, duration: 8, alpha: true },
  };
}

export function createSceneNode({
  id,
  kind = "part",
  displayName,
  sourceRef = null,
  parentId,
  visible = true,
  locked = false,
  opacity = 1,
  blendMode = "normal",
  transform = identityTransform(),
  bounds = null,
}) {
  return {
    id,
    kind,
    displayName,
    sourceRef,
    parentId,
    children: [],
    visible,
    locked,
    opacity,
    blendMode,
    transform,
    ...(bounds ? { bounds } : {}),
  };
}
