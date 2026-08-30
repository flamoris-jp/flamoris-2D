import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../model/project.js";

function layerSourceKey(node, path, occurrence) {
  const nativeId = node.id ?? node.layerId;
  return nativeId == null
    ? "path:" + path.join("/") + "#" + occurrence
    : "layer:" + nativeId;
}

export function createProjectFromPsd(
  psd,
  {
    fileName = "source.psd",
    projectName = fileName,
    idFactory = createIdFactory("psd"),
  } = {},
) {
  const project = createProject({
    name: projectName,
    width: Number(psd.width),
    height: Number(psd.height),
    idFactory,
  });
  const sourceAssetId = idFactory("source");
  const keyArtId = idFactory("keyart");
  project.sourceAssets.push({
    id: sourceAssetId,
    kind: "psd",
    fileName,
  });
  project.keyArts.push({
    id: keyArtId,
    displayName: projectName,
    sourceAssetId,
    rootNodeId: project.scene.rootId,
  });

  function walk(
    children,
    parentId,
    parentPath,
  ) {
    const occurrences = new Map();
    for (const layer of children || []) {
      const displayName = layer.name || "(unnamed)";
      const occurrence = (occurrences.get(displayName) || 0) + 1;
      occurrences.set(displayName, occurrence);
      const path = [...parentPath, displayName];
      const id = idFactory("node");
      const hasChildren = Array.isArray(layer.children);
      const left = Number(layer.left ?? 0);
      const top = Number(layer.top ?? 0);
      const right = Number(
        layer.right ?? left + Number(layer.canvas?.width ?? 0),
      );
      const bottom = Number(
        layer.bottom ?? top + Number(layer.canvas?.height ?? 0),
      );
      const node = createSceneNode({
        id,
        kind: hasChildren ? "group" : "part",
        displayName,
        parentId,
        visible: !Boolean(layer.hidden),
        opacity: Number(layer.opacity ?? 1),
        blendMode: layer.blendMode || "normal",
        sourceRef: {
          sourceAssetId,
          sourceKey: layerSourceKey(layer, path, occurrence),
          path: path.join("/"),
        },
        bounds: hasChildren
          ? null
          : { left, top, right, bottom },
      });
      project.scene.nodes[id] = node;
      project.scene.nodes[parentId].children.push(id);
      if (hasChildren) {
        walk(layer.children, id, path);
      }
    }
  }

  walk(psd.children || [], project.scene.rootId, []);
  return project;
}

export function reconcilePsdProject(project, psd, options = {}) {
  const imported = createProjectFromPsd(psd, options);
  const currentBySource = new Map();
  for (const node of Object.values(project.scene.nodes)) {
    if (node.sourceRef?.sourceKey) {
      currentBySource.set(node.sourceRef.sourceKey, node);
    }
  }
  const matched = [];
  const added = [];
  for (const node of Object.values(imported.scene.nodes)) {
    const current = node.sourceRef &&
      currentBySource.get(node.sourceRef.sourceKey);
    if (!current) {
      if (node.id !== imported.scene.rootId) {
        added.push({
          sourceKey: node.sourceRef?.sourceKey,
          displayName: node.displayName,
        });
      }
      continue;
    }
    matched.push({
      sourceKey: node.sourceRef.sourceKey,
      nodeId: current.id,
      importedNodeId: node.id,
    });
  }
  const matchedKeys = new Set(
    matched.map((entry) => entry.sourceKey),
  );
  const removed = [...currentBySource.entries()]
    .filter(([sourceKey]) => !matchedKeys.has(sourceKey))
    .map(([sourceKey, node]) => ({
      sourceKey,
      nodeId: node.id,
      displayName: node.displayName,
    }));
  return {
    importedProject: imported,
    review: {
      matched,
      added,
      removed,
      canApplyAutomatically: removed.length === 0,
    },
  };
}
