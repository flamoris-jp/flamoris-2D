// Test-only binary fixtures; the JS importer remains the migration oracle.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync,deflateSync} from 'node:zlib';
import {crc32} from '../../src/io/png-raster.js';
import {importCutworkFlimg} from '../../src/io/cutwork-flimg-project.js';
import {CUTWORK_FLIMG_LIMITS} from '../../src/io/cutwork-flimg-reader.js';
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

function rasterBudgetLimits(maximumRasterWorkingSetBytes) {
  return { ...CUTWORK_FLIMG_LIMITS, maximumRasterWorkingSetBytes };
}

const cases=[];
for(const [name,options] of [['base',{}],['soft parts',{layers:[part(PART_A,[64,128],{visible:false}),part(PART_B,[192,32]),baseLayer()]}],['v2 owner',{layers:[part(PART_A,[255,0],{partOrder:0}),baseLayer(),assetLayer('repair',REPAIR,{x:0,y:0,width:1,height:1},png(1,1,rgba([1,2,3,128]),6),{ownerPartId:PART_A,_bytes:png(1,1,rgba([1,2,3,128]),6)})],manifest:{schemaVersion:2}}]]) {
 const f=fixture(options), imported=await importCutworkFlimg(f.archive);
 cases.push({name,archive:Buffer.from(f.archive).toString('base64'),images:Object.fromEntries(imported.renderAssets.map(a=>[a.cutworkLayerId,{width:a.width,height:a.height,rgba:[...a.rgba]}]))});
}
const output=JSON.stringify(cases)+'\n', path=new URL('./source-codec-conformance.json',import.meta.url);
if(process.argv.includes('--write')) writeFileSync(path,output); else if(readFileSync(path,'utf8').replace(/\r\n/g,'\n')!==output) throw Error('Source codec oracle drift');
console.log(`Source codec conformance: ${cases.length} archives`);
