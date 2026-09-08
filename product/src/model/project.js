import { TIMEBASE_TICKS_PER_SECOND } from "../core/temporal.js";

export const PROJECT_SCHEMA_VERSION = 8;

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
    timebaseTicksPerSecond: TIMEBASE_TICKS_PER_SECOND,
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
    meshTopologies: [],
    meshKeyforms: [],
    clippingBindings: [],
    rig: {
      deformers: [],
      warpControlPoints: [],
      warpDeformerKeyforms: [],
      bones: [],
      bonePoseKeyforms: [],
      rigidBoneBindings: [],
      constraints: [],
    },
    transitions: [],
    temporalPrograms: [],
    animation: { clips: [], tracks: [], keyframes: [] },
    sequence: [],
    renderSettings: {
      frameRate: { numerator: 30, denominator: 1 },
      durationTicks: 8 * TIMEBASE_TICKS_PER_SECOND,
      alpha: true,
    },
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
