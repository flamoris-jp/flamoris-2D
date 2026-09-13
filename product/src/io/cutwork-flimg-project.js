import {
  createIdFactory,
  createProject,
  createSceneNode,
  identityTransform,
} from "../model/project.js";
import { validationResult } from "../model/validation.js";
import { readCutworkFlimg } from "./cutwork-flimg-reader.js";

function multiplyAlpha(alpha, mask) {
  return Math.floor((alpha * mask + 127) / 255);
}

export function materializeCutworkRasters(document) {
  const { width, height } = document.canvas;
  const original = document.original.pixels;
  const union = new Uint8Array(width * height);
  for (const layer of document.layers) {
    if (layer.kind !== "part") continue;
    const { x, y, width: layerWidth, height: layerHeight } = layer.bounds;
    for (let row = 0; row < layerHeight; row += 1) {
      const destination = (y + row) * width + x;
      const source = row * layerWidth;
      for (let column = 0; column < layerWidth; column += 1) {
        union[destination + column] = Math.max(
          union[destination + column],
          layer.pixels[source + column],
        );
      }
    }
  }
  return document.layers.map((layer) => {
    const { x, y, width: layerWidth, height: layerHeight } = layer.bounds;
    let rgba;
    if (layer.kind === "base") {
      rgba = original.slice();
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        rgba[pixel * 4 + 3] = multiplyAlpha(original[pixel * 4 + 3], 255 - union[pixel]);
      }
    } else if (layer.kind === "part") {
      rgba = new Uint8Array(layerWidth * layerHeight * 4);
      for (let row = 0; row < layerHeight; row += 1) {
        for (let column = 0; column < layerWidth; column += 1) {
          const documentPixel = ((y + row) * width + x + column) * 4;
          const localPixel = (row * layerWidth + column) * 4;
          rgba[localPixel] = original[documentPixel];
          rgba[localPixel + 1] = original[documentPixel + 1];
          rgba[localPixel + 2] = original[documentPixel + 2];
          rgba[localPixel + 3] = multiplyAlpha(
            original[documentPixel + 3],
            layer.pixels[row * layerWidth + column],
          );
        }
      }
    } else rgba = layer.pixels.slice();
    return {
      layerId: layer.id,
      kind: layer.kind,
      bounds: layer.kind === "base"
        ? { x: 0, y: 0, width, height }
        : { ...layer.bounds },
      rgba,
    };
  });
}

function displayName(layer) {
  if (layer.name.trim()) return layer.name;
  return layer.kind[0].toUpperCase() + layer.kind.slice(1);
}

function nodeTransform(layer) {
  if (layer.kind !== "patch") return identityTransform();
  const { width, height } = layer.bounds;
  return {
    position: {
      x: layer.transform.centerX - width / 2,
      y: layer.transform.centerY - height / 2,
    },
    rotation: layer.transform.rotationDegrees * Math.PI / 180,
    scale: { x: layer.transform.scale, y: layer.transform.scale },
    pivot: { x: width / 2, y: height / 2 },
  };
}

export function createProjectFromCutworkFlimg(document, {
  fileName = document.original.sourceName || "source.flimg",
  projectName = fileName,
  importedAt = new Date().toISOString(),
  idFactory = createIdFactory("cutwork"),
} = {}) {
  const project = createProject({
    name: projectName,
    width: document.canvas.width,
    height: document.canvas.height,
    idFactory,
  });
  const sourceAssetId = idFactory("source");
  const keyArtId = idFactory("keyart");
  project.sourceAssets.push({
    id: sourceAssetId,
    kind: "cutwork-flimg",
    fileName,
    displayLabel: fileName,
    importedAt,
    metadata: {
      format: document.format,
      schemaVersion: document.schemaVersion,
      documentId: document.documentId,
      original: {
        sourceName: document.original.sourceName,
        asset: document.original.asset,
        sha256: document.original.sha256,
        colorSpace: document.canvas.colorSpace,
        pixelFormat: document.canvas.pixelFormat,
      },
    },
  });
  const keyArt = {
    id: keyArtId,
    displayName: projectName,
    sourceAssetId,
    rootNodeId: project.scene.rootId,
    members: [],
    metadata: {
      importedFrom: "cutwork-flimg",
      cutworkDocumentId: document.documentId,
      cutworkSchemaVersion: document.schemaVersion,
    },
  };
  project.keyArts.push(keyArt);
  const rasterByLayerId = new Map(materializeCutworkRasters(document)
    .map((raster) => [raster.layerId, raster]));
  const renderAssetsByLayerId = new Map();
  const nodeIds = [];
  const layerCount = document.layers.length;

  document.layers.forEach((layer, manifestIndex) => {
    const nodeId = idFactory("node");
    const sourceKey = `layer:${layer.id}`;
    const localBounds = layer.kind === "patch"
      ? { left: 0, top: 0, right: layer.bounds.width, bottom: layer.bounds.height }
      : {
        left: layer.bounds.x,
        top: layer.bounds.y,
        right: layer.bounds.x + layer.bounds.width,
        bottom: layer.bounds.y + layer.bounds.height,
      };
    const node = createSceneNode({
      id: nodeId,
      kind: "part",
      displayName: displayName(layer),
      parentId: project.scene.rootId,
      visible: layer.visible,
      transform: nodeTransform(layer),
      bounds: localBounds,
      sourceRef: {
        sourceAssetId,
        sourceKey,
        identityKind: "native",
        orderDependent: false,
        path: displayName(layer),
        cutwork: {
          documentId: document.documentId,
          layerId: layer.id,
          layerKind: layer.kind,
          semanticName: layer.semanticName,
          manifestIndex,
          authoredBounds: { ...layer.bounds },
          ...(layer.asset ? { asset: layer.asset, sha256: layer.sha256 } : {}),
          ...(layer.transform ? { transform: { ...layer.transform } } : {}),
          ...(layer.sourcePolygon ? { sourcePolygon: layer.sourcePolygon.map((point) => ({ ...point })) } : {}),
        },
      },
    });
    project.scene.nodes[nodeId] = node;
    project.scene.nodes[project.scene.rootId].children.push(nodeId);
    nodeIds.push(nodeId);
    keyArt.members.push({
      nodeId,
      appearanceId: `${sourceAssetId}:${sourceKey}`,
      opacity: 1,
      presence: layer.visible ? "present" : "absent",
      drawOrder: layerCount - manifestIndex - 1,
      clipping: { sourceNodeId: null },
    });
    if (layer.semanticName) {
      project.semanticSlots.push({
        id: idFactory("semantic"),
        displayName: displayName(layer),
        role: layer.semanticName,
        mappings: [{ keyArtId, nodeId }],
        metadata: {
          importedFrom: "cutwork-flimg",
          cutworkDocumentId: document.documentId,
          cutworkLayerId: layer.id,
        },
      });
    }
    const raster = rasterByLayerId.get(layer.id);
    renderAssetsByLayerId.set(layer.id, {
      nodeId,
      sourceKey,
      name: displayName(layer),
      path: displayName(layer),
      hidden: !layer.visible,
      opacity: 1,
      blendMode: "normal",
      left: localBounds.left,
      top: localBounds.top,
      right: localBounds.right,
      bottom: localBounds.bottom,
      width: raster.bounds.width,
      height: raster.bounds.height,
      rgba: raster.rgba,
      cutworkLayerId: layer.id,
      cutworkLayerKind: layer.kind,
      semanticName: layer.semanticName,
    });
  });

  const validation = validationResult(project);
  if (!validation.valid) {
    const failure = new Error("The imported Cutwork project cannot form a valid FLAMORIS 2D Project.");
    failure.code = "flimg.project_invalid";
    failure.details = { issues: validation.issues };
    throw failure;
  }
  return {
    project,
    renderAssets: [...document.layers].reverse()
      .map((layer) => renderAssetsByLayerId.get(layer.id)),
    result: {
      projectId: project.id,
      keyArtId,
      sceneNodeIds: nodeIds,
      diagnostics: [],
    },
  };
}

export async function importCutworkFlimg(input, options = {}) {
  const document = await readCutworkFlimg(input, options);
  return createProjectFromCutworkFlimg(document, options);
}
