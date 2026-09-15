import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { crc32, decodePngRaster } from '../src/io/png-raster.js';

// Admission policy, not a renderer performance claim. Includes live + candidate + decode workspace.
export const NATIVE_ARTWORK_LIMITS = Object.freeze({ dimension: 16384, pixels: 100000000,
  bytes: 512 * 1024 * 1024, count: 4096, reservationMs: 60000 });
function fail(message) { throw Object.assign(new Error(message), { code: 'document.artwork_invalid' }); }
export function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) fail('Incomplete RGBA raster.');
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length); name.copy(result, 4); Buffer.from(bytes).copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, bytes.length + 8)), bytes.length + 8); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
export function persistedRgbaAssets(records) {
  return records.map(({ rgba, ...record }) => ({ ...record,
    dataUrl: 'data:image/png;base64,' + encodeRgbaPng(record.width, record.height, rgba).toString('base64') }));
}
export async function prepareDocumentArtwork(parsed, assets) {
  const records = parsed.renderAssets || [], seen = new Set(), candidates = [], diagnostics = [];
  const limits = NATIVE_ARTWORK_LIMITS;
  if (records.length > limits.count) fail('Too many embedded artwork records.');
  let total = [...assets.entries.values()].reduce((n, a) => n + a.byteLength, 0);
  for (const record of records) {
    if (!parsed.project.scene.nodes[record?.nodeId]) {
      diagnostics.push({ code: 'artwork.orphan', nodeId: record?.nodeId ?? null }); continue;
    }
    const { width, height } = record;
    if (seen.has(record.nodeId) || ![width,height].every(n => Number.isSafeInteger(n) && n > 0 && n <= limits.dimension) ||
        width * height > limits.pixels || typeof record.dataUrl !== 'string' ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(record.dataUrl)) fail('Invalid/duplicate embedded artwork.');
    if (![record.left ?? 0, record.top ?? 0, record.right ?? width, record.bottom ?? height].every(Number.isFinite))
      fail('Artwork bounds must be finite.');
    seen.add(record.nodeId);
    // Candidate BGRA + decoded RGBA/scanlines/PNG copies; current live rasters remain counted.
    total += width * height * 16;
    if (!Number.isSafeInteger(total) || total > limits.bytes) fail('Live plus candidate artwork exceeds the native decode working-set limit.');
    candidates.push(record);
  }
  const decoded = [];
  for (const record of candidates) {
    const png = Buffer.from(record.dataUrl.slice('data:image/png;base64,'.length), 'base64');
    const raster = await decodePngRaster(png, { expectedWidth: record.width, expectedHeight: record.height, expectedColorType: 6 });
    const bgra = Buffer.alloc(record.width * record.height * 4);
    for (let i = 0; i < record.width * record.height; i++) {
      const at = i * raster.channels;
      if (raster.channels === 1) bgra.set([raster.pixels[at], raster.pixels[at], raster.pixels[at], 255], i * 4);
      else bgra.set([raster.pixels[at + 2], raster.pixels[at + 1], raster.pixels[at],
        raster.channels === 4 ? raster.pixels[at + 3] : 255], i * 4);
    }
    decoded.push({ id: randomUUID(), nodeId: record.nodeId, name: record.name || record.nodeId,
      width: record.width, height: record.height, byteLength: bgra.length, bytes: bgra,
      left: record.left ?? 0, top: record.top ?? 0 });
  }
  for (const node of Object.values(parsed.project.scene.nodes))
    if (node.kind === 'part' && !seen.has(node.id)) diagnostics.push({ code: 'artwork.missing', nodeId: node.id });
  return { decoded, diagnostics };
}
export function attachDocumentArtwork(document, assets, prepared) {
  document.bindings = new Map();
  document.artworkDiagnostics = prepared.diagnostics;
  for (const raster of prepared.decoded) {
    assets.entries.set(raster.id, { ...raster, token: document.token, revision: 0,
      created: Date.now(), attached: true, uploading: false, abort: null });
    document.bindings.set(raster.nodeId, raster.id);
  }
}
