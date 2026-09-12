import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync, deflateSync } from "node:zlib";
import { createIdFactory, createProject } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { EditorSession } from "../src/commands/editor.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";
import { parseProjectDocument, serializeProject } from "../src/io/project-json.js";
import { serializePsdRenderAssets } from "../src/ui/psd-render-assets.js";
import { createCutworkRenderAssets } from "../src/ui/cutwork-render-assets.js";
import { createEvaluatedRenderPlan } from "../src/core/evaluated-render.js";
import { crc32 } from "../src/io/png-raster.js";
import {
  CUTWORK_FLIMG_LIMITS,
  CutworkFlimgError,
  readCutworkFlimg,
} from "../src/io/cutwork-flimg-reader.js";
import {
  createProjectFromCutworkFlimg,
  importCutworkFlimg,
} from "../src/io/cutwork-flimg-project.js";

const DOCUMENT_ID = "10000000-0000-0000-0000-000000000001";
const PART_A = "20000000-0000-0000-0000-000000000001";
const PART_B = "20000000-0000-0000-0000-000000000002";
const BASE = "30000000-0000-0000-0000-000000000001";
const PATCH = "40000000-0000-0000-0000-000000000001";
const REPAIR = "50000000-0000-0000-0000-000000000001";

function uint32be(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function join(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  return join([uint32be(data.length), typeBytes, data, uint32be(crc32(join([typeBytes, data])))]);
}

function png(width, height, pixels, colorType) {
  const channels = colorType === 6 ? 4 : 1;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([8, colorType, 0, 0, 0], 8);
  const rows = new Uint8Array((width * channels + 1) * height);
  for (let row = 0; row < height; row += 1) {
    rows.set(pixels.subarray(row * width * channels, (row + 1) * width * channels),
      row * (width * channels + 1) + 1);
  }
  return join([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(rows))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function zip(entries, { deflated = true } = {}) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(content);
    const stored = deflated ? new Uint8Array(deflateRawSync(content)) : content;
    const method = deflated ? 8 : 0;
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, nameBytes.length, true);
    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    const localRecord = join([localHeader, nameBytes, stored]);
    local.push(localRecord);
    central.push(join([centralHeader, nameBytes]));
    offset += localRecord.length;
  }
  const directory = join(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, offset, true);
  return join([...local, directory, end]);
}

const rgba = (values) => Uint8Array.from(values);
const gray = (values) => Uint8Array.from(values);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function baseLayer(overrides = {}) {
  return {
    id: BASE, kind: "base", name: "", semanticName: null, visible: true,
    bounds: { x: 0, y: 0, width: 3, height: 2 }, ...overrides,
  };
}

function assetLayer(kind, id, bounds, assetBytes, overrides = {}) {
  const file = kind === "part" ? "mask.png" : "pixels.png";
  return {
    id, kind, name: kind, semanticName: null, visible: true, bounds,
    asset: `layers/${id.replaceAll("-", "")}/${file}`,
    sha256: hash(assetBytes),
    ...(kind === "patch" ? {
      transform: {
        centerX: bounds.x + bounds.width / 2,
        centerY: bounds.y + bounds.height / 2,
        scale: 1,
        rotationDegrees: 0,
      },
      sourcePolygon: [],
    } : {}),
    ...overrides,
  };
}

function fixture({ layers = null, manifest: manifestOverrides = {}, extraEntries = [] } = {}) {
  const originalPixels = rgba([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
    100, 110, 120, 255, 130, 140, 150, 128, 160, 170, 180, 255,
  ]);
  const original = png(3, 2, originalPixels, 6);
  const effectiveLayers = layers || [baseLayer()];
  const manifest = {
    format: "flamoris-cutwork",
    schemaVersion: 1,
    documentId: DOCUMENT_ID,
    canvas: { width: 3, height: 2, colorSpace: "srgb8", pixelFormat: "straight-bgra32" },
    original: { asset: "assets/original.png", sha256: hash(original), sourceName: "Akino.png" },
    layers: effectiveLayers,
    ...manifestOverrides,
  };
  const assets = new Map([["assets/original.png", original]]);
  for (const layer of effectiveLayers) {
    if (layer.asset && layer._bytes) assets.set(layer.asset, layer._bytes);
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, (key, value) =>
    key === "_bytes" ? undefined : value));
  return {
    archive: zip([["manifest.json", manifestBytes], ...assets, ...extraEntries]),
    manifest,
    originalPixels,
  };
}

function part(id, values, overrides = {}) {
  const bytes = png(2, 1, gray(values), 0);
  return assetLayer("part", id, { x: 0, y: 0, width: 2, height: 1 }, bytes,
    { _bytes: bytes, ...overrides });
}

test("imports minimal Original + Base as ordinary valid Key Art", async () => {
  const { archive, originalPixels } = fixture();
  const imported = await importCutworkFlimg(archive, {
    fileName: "portrait.flimg",
    idFactory: createIdFactory("cutwork-test"),
  });
  assert.equal(validateProject(imported.project).filter((issue) => issue.severity === "error").length, 0);
  assert.equal(imported.project.sourceAssets[0].kind, "cutwork-flimg");
  assert.equal(imported.project.sourceAssets[0].metadata.documentId, DOCUMENT_ID);
  assert.equal(imported.project.keyArts.length, 1);
  assert.deepEqual(imported.renderAssets[0].rgba, originalPixels);
  assert.equal(imported.result.projectId, imported.project.id);
  assert.equal(imported.result.keyArtId, imported.project.keyArts[0].id);
});

test("materializes soft-alpha Parts and Base union independent of Part visibility", async () => {
  const layers = [
    part(PART_A, [64, 128], { name: "left eye", semanticName: "eye_left", visible: false }),
    part(PART_B, [192, 32], { name: "front hair" }),
    baseLayer(),
  ];
  const imported = await importCutworkFlimg(fixture({ layers }).archive, {
    idFactory: createIdFactory("parts"),
  });
  const partAsset = imported.renderAssets.find((asset) => asset.cutworkLayerId === PART_A);
  const baseAsset = imported.renderAssets.find((asset) => asset.cutworkLayerKind === "base");
  assert.deepEqual([...partAsset.rgba.filter((_value, index) => index % 4 === 3)], [64, 128]);
  assert.deepEqual([...baseAsset.rgba.filter((_value, index) => index % 4 === 3)],
    [63, 127, 255, 255, 128, 255]);
  assert.equal(partAsset.hidden, true);
  const partNode = Object.values(imported.project.scene.nodes)
    .find((node) => node.sourceRef?.sourceKey === `layer:${PART_A}`);
  assert.equal(partNode.sourceRef.cutwork.semanticName, "eye_left");
  assert.equal(imported.project.semanticSlots[0].role, "eye_left");
  assert.equal(imported.project.semanticSlots[0].mappings[0].nodeId, partNode.id);
});

test("preserves top-to-bottom stack through deterministic draw order", async () => {
  const layers = [part(PART_A, [255, 0], { name: "Top" }), part(PART_B, [0, 255], { name: "Middle" }), baseLayer()];
  const { project, renderAssets } = await importCutworkFlimg(fixture({ layers }).archive,
    { idFactory: createIdFactory("order") });
  const members = new Map(project.keyArts[0].members.map((member) =>
    [project.scene.nodes[member.nodeId].displayName, member.drawOrder]));
  assert.deepEqual(Object.fromEntries(members), { Top: 2, Middle: 1, Base: 0 });
  assert.deepEqual(renderAssets.map((asset) => asset.name), ["Base", "Middle", "Top"]);
  assert.deepEqual(project.scene.nodes[project.scene.rootId].children.map((id) =>
    project.scene.nodes[id].displayName), ["Top", "Middle", "Base"]);
});

test("maps Patch raster/transform and Repair document bounds without baking", async () => {
  const patchBytes = png(1, 1, rgba([200, 100, 50, 128]), 6);
  const repairBytes = png(1, 1, rgba([1, 2, 3, 255]), 6);
  const patch = assetLayer("patch", PATCH, { x: 0, y: 0, width: 1, height: 1 }, patchBytes, {
    _bytes: patchBytes,
    name: "Cheek patch",
    transform: { centerX: 1.5, centerY: 1, scale: 1, rotationDegrees: 30 },
    sourcePolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  });
  const repair = assetLayer("repair", REPAIR, { x: 2, y: 1, width: 1, height: 1 }, repairBytes,
    { _bytes: repairBytes, name: "Repair" });
  const { project, renderAssets } = await importCutworkFlimg(
    fixture({ layers: [baseLayer(), patch, repair] }).archive,
    { idFactory: createIdFactory("derived") },
  );
  const patchNode = Object.values(project.scene.nodes)
    .find((node) => node.sourceRef?.sourceKey === `layer:${PATCH}`);
  assert.deepEqual(patchNode.bounds, { left: 0, top: 0, right: 1, bottom: 1 });
  assert.deepEqual(patchNode.transform.position, { x: 1, y: 0.5 });
  assert.deepEqual(patchNode.transform.scale, { x: 1, y: 1 });
  assert.ok(Math.abs(patchNode.transform.rotation - Math.PI / 6) < 1e-12);
  assert.deepEqual(patchNode.sourceRef.cutwork.sourcePolygon, patch.sourcePolygon);
  const repairAsset = renderAssets.find((asset) => asset.cutworkLayerId === REPAIR);
  assert.deepEqual([repairAsset.left, repairAsset.top, repairAsset.right, repairAsset.bottom], [2, 1, 3, 2]);
  assert.deepEqual(repairAsset.rgba, repairBytes && rgba([1, 2, 3, 255]));
});

async function rejects(code, options) {
  await assert.rejects(() => readCutworkFlimg(options.archive, options.readerOptions),
    (failure) => failure instanceof CutworkFlimgError && failure.code === code);
}

test("rejects wrong format, unsupported schema, and malformed manifest", async () => {
  await rejects("flimg.format_invalid", fixture({ manifest: { format: "other" } }));
  await rejects("flimg.schema_unsupported", fixture({ manifest: { schemaVersion: 2 } }));
  const valid = fixture();
  const original = [...zip([["manifest.json", new TextEncoder().encode('{"format":"flamoris-cutwork",')]])];
  await rejects("flimg.manifest_malformed", { archive: Uint8Array.from(original) });
  const duplicateJson = new TextEncoder().encode(`{"format":"flamoris-cutwork","schemaVersion":1,"schemaVersion":1}`);
  await rejects("flimg.manifest_malformed", { archive: zip([["manifest.json", duplicateJson]]) });
});

test("rejects duplicate IDs, missing/extra Base, and invalid stack bands", async () => {
  await rejects("flimg.identity_duplicate", fixture({ layers: [part(PART_A, [1, 2]), baseLayer({ id: PART_A })] }));
  await rejects("flimg.identity_invalid", fixture({ layers: [baseLayer({ id: "BASE" })] }));
  await rejects("flimg.layer_order_invalid", fixture({ layers: [part(PART_A, [1, 2])] }));
  await rejects("flimg.base_invalid", fixture({ layers: [baseLayer(), baseLayer({ id: "30000000-0000-0000-0000-000000000002" })] }));
  await rejects("flimg.layer_order_invalid", fixture({ layers: [baseLayer(), part(PART_A, [1, 2])] }));
});

test("rejects checksum, missing/unexpected asset, and invalid PNG format/dimensions", async () => {
  const validPart = part(PART_A, [255, 0]);
  await rejects("flimg.checksum_mismatch", fixture({
    layers: [{ ...validPart, sha256: "0".repeat(64) }],
  }));
  await rejects("flimg.asset_missing", fixture({
    layers: [{ ...validPart, _bytes: undefined }],
  }));
  await rejects("flimg.asset_unexpected", fixture({
    extraEntries: [["layers/unexpected.png", Uint8Array.of(1)]],
  }));
  const invalidPng = Uint8Array.of(1, 2, 3, 4);
  await rejects("flimg.png_invalid", fixture({
    layers: [assetLayer("repair", REPAIR, { x: 0, y: 0, width: 1, height: 1 }, invalidPng,
      { _bytes: invalidPng }), baseLayer()],
  }));
  const rgbaPart = png(2, 1, rgba([1, 2, 3, 4, 5, 6, 7, 8]), 6);
  await rejects("flimg.png_invalid", fixture({
    layers: [assetLayer("part", PART_A, { x: 0, y: 0, width: 2, height: 1 }, rgbaPart, { _bytes: rgbaPart }), baseLayer()],
  }));
  const wrongSize = png(1, 1, gray([255]), 0);
  await rejects("flimg.png_invalid", fixture({
    layers: [assetLayer("part", PART_A, { x: 0, y: 0, width: 2, height: 1 }, wrongSize, { _bytes: wrongSize }), baseLayer()],
  }));
});

test("rejects traversal, absolute, backslash, dot-segment, control, and canonical collisions", async () => {
  for (const path of ["../evil", "/absolute", "C:drive", "layers\\evil", "layers/./evil", "layers/evil\u0001"]) {
    await rejects("flimg.archive_path_invalid", fixture({ extraEntries: [[path, Uint8Array.of(1)]] }));
  }
  await rejects("flimg.archive_entry_duplicate", fixture({
    extraEntries: [["EXTRA", Uint8Array.of(1)], ["extra", Uint8Array.of(2)]],
  }));
});

test("enforces ZIP entry count and uncompressed size limits", async () => {
  const entryLimited = fixture();
  entryLimited.readerOptions = { limits: { ...CUTWORK_FLIMG_LIMITS, maximumEntries: 1 } };
  await rejects("flimg.size_limit_exceeded", entryLimited);
  const sizeLimited = fixture();
  sizeLimited.readerOptions = { limits: { ...CUTWORK_FLIMG_LIMITS, maximumEntryBytes: 10 } };
  await rejects("flimg.size_limit_exceeded", sizeLimited);
  const manifestLimited = fixture();
  manifestLimited.readerOptions = {
    limits: { ...CUTWORK_FLIMG_LIMITS, maximumManifestBytes: 10 },
  };
  await rejects("flimg.size_limit_exceeded", manifestLimited);
});

test("bounds decompression by the ZIP entry's declared physical length", async () => {
  const archive = fixture().archive.slice();
  const endOffset = archive.length - 22;
  const directoryOffset = new DataView(archive.buffer, archive.byteOffset + endOffset + 16, 4)
    .getUint32(0, true);
  const firstLocalOffset = new DataView(archive.buffer, archive.byteOffset + directoryOffset + 42, 4)
    .getUint32(0, true);
  new DataView(archive.buffer, archive.byteOffset + directoryOffset + 24, 4).setUint32(0, 1, true);
  new DataView(archive.buffer, archive.byteOffset + firstLocalOffset + 22, 4).setUint32(0, 1, true);
  await rejects("flimg.archive_malformed", { archive });
});

test("rejects out-of-canvas layer bounds and unknown v1 properties", async () => {
  await rejects("flimg.layer_bounds_invalid", fixture({
    layers: [baseLayer(), assetLayer("repair", REPAIR,
      { x: 3, y: 0, width: 1, height: 1 }, png(1, 1, rgba([1, 2, 3, 4]), 6),
      { _bytes: png(1, 1, rgba([1, 2, 3, 4]), 6) })],
  }));
  await rejects("flimg.manifest_malformed", fixture({
    layers: [{ ...baseLayer(), futureField: true }],
  }));
});

test("rejects non-finite-equivalent and out-of-range Patch transforms", async () => {
  const bytes = png(1, 1, rgba([1, 2, 3, 4]), 6);
  for (const transform of [
    { centerX: 0.5, centerY: 0.5, scale: 0.001, rotationDegrees: 0 },
    { centerX: 0.5, centerY: 0.5, scale: 1, rotationDegrees: 181 },
    { centerX: 50, centerY: 0.5, scale: 1, rotationDegrees: 0 },
  ]) {
    const patch = assetLayer("patch", PATCH, { x: 0, y: 0, width: 1, height: 1 }, bytes,
      { _bytes: bytes, transform, sourcePolygon: [] });
    await rejects("flimg.patch_transform_invalid", fixture({ layers: [baseLayer(), patch] }));
  }
});

test("normalized model can be converted independently from archive parsing", async () => {
  const document = await readCutworkFlimg(fixture().archive);
  const imported = createProjectFromCutworkFlimg(document, {
    idFactory: createIdFactory("normalized"),
  });
  assert.equal(imported.project.keyArts[0].members.length, 1);
  assert.deepEqual(imported.result.sceneNodeIds,
    imported.project.keyArts[0].members.map((member) => member.nodeId));
});

test("native FLAMORIS 2D save/reopen preserves imported Project and raster bindings", async () => {
  const imported = await importCutworkFlimg(fixture({
    layers: [part(PART_A, [255, 32], { semanticName: "eye_left" }), baseLayer()],
  }).archive, { idFactory: createIdFactory("roundtrip"), importedAt: "2026-09-12T00:00:00.000Z" });
  const canvases = createCutworkRenderAssets(imported.renderAssets, {
    createCanvas: (width, height) => {
      let stored = null;
      return {
        width, height,
        getContext: () => ({
          createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: (image) => { stored = image.data.slice(); },
        }),
        toDataURL: () => `data:image/png;base64,${Buffer.from(stored).toString("base64")}`,
      };
    },
  });
  const renderAssets = serializePsdRenderAssets(canvases);
  const serialized = serializeProject(imported.project, 2, {
    renderAssets,
    now: () => new Date("2026-09-12T00:00:00.000Z"),
  });
  const reopened = parseProjectDocument(serialized);
  assert.deepEqual(reopened.project, imported.project);
  assert.deepEqual(reopened.renderAssets, renderAssets);
  assert.equal(reopened.project.sourceAssets[0].kind, "cutwork-flimg");
});

test("imported artwork resolves through the existing shared renderer plan", async () => {
  const imported = await importCutworkFlimg(fixture().archive,
    { idFactory: createIdFactory("renderer") });
  const assets = createCutworkRenderAssets(imported.renderAssets, {
    createCanvas: (width, height) => ({
      width, height,
      getContext: () => ({
        createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: () => {},
      }),
    }),
  });
  const member = imported.project.keyArts[0].members[0];
  const node = imported.project.scene.nodes[member.nodeId];
  const plan = createEvaluatedRenderPlan({
    evaluatedParts: [{
      semanticSlotId: "cutwork.base",
      presence: "present",
      renderInstances: [{
        renderInstanceId: "cutwork-base",
        sourceNodeId: node.id,
        drawOrder: member.drawOrder,
        transform: [1, 0, 0, 1, 0, 0],
        opacity: 1,
        mesh: { positions: [0, 0, 3, 0, 0, 2], indices: [0, 1, 2] },
        appearanceSamples: [{
          appearanceId: member.appearanceId,
          sourceNodeId: node.id,
          uvs: [0, 0, 1, 0, 0, 1],
          weight: 1,
        }],
      }],
    }],
  }, {
    resolveArtwork: (nodeId) => assets.find((asset) => asset.nodeId === nodeId)?.canvas || null,
  });
  assert.equal(plan.unsupportedReasons.length, 0);
  assert.equal(plan.renderInstanceCount, 1);
  assert.equal(plan.batches[0].renderInstances[0].sourceNodeId, node.id);
});

test("UI domain path and MCP import operation produce equivalent Project state", async () => {
  const source = fixture({ layers: [part(PART_A, [255, 0], { semanticName: "eye_left" }), baseLayer()] });
  const settings = { fileName: "Akino.flimg", projectName: "Akino.flimg",
    idFactory: createIdFactory("equivalent"), importedAt: "2026-09-12T00:00:00.000Z" };
  const direct = await importCutworkFlimg(source.archive, settings);
  const current = createProject({ name: "Current", width: 1, height: 1,
    idFactory: createIdFactory("current") });
  const adapter = new HeadlessProductAdapter(new EditorSession(current));
  const response = await adapter.import("import.cutwork_flimg", {
    fileName: "Akino.flimg",
    bytes: source.archive,
  }, { idFactory: createIdFactory("equivalent"), importedAt: "2026-09-12T00:00:00.000Z" });
  assert.deepEqual(adapter.session.project, direct.project);
  assert.deepEqual(response, direct.result);
  assert.deepEqual(adapter.renderAssets, direct.renderAssets);
  assert.equal(adapter.session.isDirty, true);
});

test("failed MCP import leaves the current Project and session history unchanged", async () => {
  const current = createProject({ name: "Current", width: 4, height: 4,
    idFactory: createIdFactory("unchanged") });
  const session = new EditorSession(current);
  const adapter = new HeadlessProductAdapter(session);
  const before = structuredClone(session.project);
  await assert.rejects(() => adapter.import("import.cutwork_flimg", {
    fileName: "broken.flimg", bytes: Uint8Array.of(1, 2, 3),
  }), (failure) => failure.code === "flimg.archive_malformed");
  assert.deepEqual(session.project, before);
  assert.equal(session.history.length, 0);
  assert.equal(session.isDirty, false);
});
