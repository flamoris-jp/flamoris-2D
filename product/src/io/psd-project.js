import {
  createIdFactory,
  createProject,
  createSceneNode,
} from "../model/project.js";
import { rasterFingerprint } from "./raster-fingerprint.js";

function nativeLayerId(node) {
  return node.id ?? node.layerId;
}

export function psdIdentitySegment(node, displayName, occurrence) {
  const nativeId = nativeLayerId(node);
  return nativeId == null
    ? "name:" + encodeURIComponent(displayName) + "[" + occurrence + "]"
    : "id:" + encodeURIComponent(String(nativeId));
}

export function psdLayerSourceKey(node, identityPath) {
  const nativeId = nativeLayerId(node);
  return nativeId == null
    ? "path:" + identityPath.join("/")
    : "layer:" + nativeId;
}

export function createProjectFromPsd(
  psd,
  {
    fileName = "source.psd",
    projectName = fileName,
    idFactory = createIdFactory("psd"),
    importedAt = new Date().toISOString(),
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
    displayLabel: fileName,
    importedAt,
  });
  const keyArt = {
    id: keyArtId,
    displayName: projectName,
    sourceAssetId,
    rootNodeId: project.scene.rootId,
    members: [],
    metadata: {},
  };
  project.keyArts.push(keyArt);
  let nextDrawOrder = 0;

  function walk(
    children,
    parentId,
    parentPath,
    parentIdentityPath,
    parentOrderDependent = false,
  ) {
    const occurrences = new Map();
    const siblingNameCounts = new Map();
    for (const layer of children || []) {
      const name = layer.name || "(unnamed)";
      siblingNameCounts.set(
        name,
        (siblingNameCounts.get(name) || 0) + 1,
      );
    }
    for (const layer of children || []) {
      const displayName = layer.name || "(unnamed)";
      const occurrence = (occurrences.get(displayName) || 0) + 1;
      occurrences.set(displayName, occurrence);
      const path = [...parentPath, displayName];
      const identityPath = [
        ...parentIdentityPath,
        psdIdentitySegment(layer, displayName, occurrence),
      ];
      const hasNativeIdentity = nativeLayerId(layer) != null;
      const orderDependent =
        !hasNativeIdentity &&
        (
          parentOrderDependent ||
          siblingNameCounts.get(displayName) > 1
        );
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
          sourceKey: psdLayerSourceKey(layer, identityPath),
          path: path.join("/"),
          identityPath: identityPath.join("/"),
          identityKind: hasNativeIdentity ? "native" : "fallback",
          orderDependent,
          rasterFingerprint: hasChildren
            ? null
            : rasterFingerprint(layer.canvas),
        },
        bounds: hasChildren
          ? null
          : { left, top, right, bottom },
      });
      project.scene.nodes[id] = node;
      project.scene.nodes[parentId].children.push(id);
      if (!hasChildren) {
        keyArt.members.push({
          nodeId: node.id,
          appearanceId: sourceAssetId + ":" + node.sourceRef.sourceKey,
          opacity: node.opacity,
          presence: node.visible ? "present" : "absent",
          drawOrder: nextDrawOrder++,
          clipping: { sourceNodeId: null },
        });
      }
      if (hasChildren) {
        walk(
          layer.children,
          id,
          path,
          identityPath,
          orderDependent,
        );
      }
    }
  }

  walk(psd.children || [], project.scene.rootId, [], []);
  return project;
}

export function reconcilePsdProject(project, psd, options = {}) {
  return reconcileImportedPsdProject(project, createProjectFromPsd(psd, options));
}

// A native decode worker can supply the same validated import without retaining
// a second PSD/canvas graph in the editor process.
export function reconcileImportedPsdProject(project, imported) {
  const indexBySource = (sourceProject) => {
    const index = new Map();
    for (const node of Object.values(sourceProject.scene.nodes)) {
      const sourceKey = node.sourceRef?.sourceKey;
      if (!sourceKey) continue;
      if (!index.has(sourceKey)) index.set(sourceKey, []);
      index.get(sourceKey).push(node);
    }
    return index;
  };
  const currentBySource = indexBySource(project);
  const importedBySource = indexBySource(imported);
  const matched = [];
  const added = [];
  const removed = [];
  const ambiguous = [];
  const sourceKeys = new Set([
    ...currentBySource.keys(),
    ...importedBySource.keys(),
  ]);
  for (const sourceKey of sourceKeys) {
    const current = currentBySource.get(sourceKey) || [];
    const next = importedBySource.get(sourceKey) || [];
    const reasons = [];
    if (current.length > 1 || next.length > 1) {
      reasons.push("duplicate-source-key");
    }
    if (
      [...current, ...next].some(
        (node) => node.sourceRef?.orderDependent,
      )
    ) {
      reasons.push("order-dependent-fallback");
    }
    if (reasons.length) {
      ambiguous.push({
        sourceKey,
        reasons,
        currentNodeIds: current.map((node) => node.id),
        importedNodeIds: next.map((node) => node.id),
      });
      continue;
    }
    if (current.length === 1 && next.length === 1) {
      matched.push({
        sourceKey,
        nodeId: current[0].id,
        importedNodeId: next[0].id,
      });
    } else if (next.length === 1) {
      added.push({
        sourceKey,
        importedNodeId: next[0].id,
        displayName: next[0].displayName,
      });
    } else if (current.length === 1) {
      removed.push({
        sourceKey,
        nodeId: current[0].id,
        displayName: current[0].displayName,
      });
    }
  }
  return {
    importedProject: imported,
    review: {
      matched,
      added,
      removed,
      ambiguous,
      canApplyAutomatically:
        removed.length === 0 &&
        ambiguous.length === 0,
    },
  };
}
