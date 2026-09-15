import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writePsd, initializeCanvas } from 'ag-psd';
import { ProductHostService } from '../product-host/session-service.mjs';
import { encodeRgbaPng } from '../product-host/document-artwork.mjs';
import { crc32 } from '../src/io/png-raster.js';
let seq = 0;
async function send(h, method, payload = {}) {
  const r = (await h.handle({ protocolVersion: 1, requestId: 'source-' + ++seq,
    documentToken: h.documentToken, expectedRevision: h.revision, method, payload })).response;
  assert.equal(r.ok, true, JSON.stringify(r.error)); return r.payload;
}
function storedZip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20,4);
    l.writeUInt32LE(crc,14); l.writeUInt32LE(data.length,18); l.writeUInt32LE(data.length,22); l.writeUInt16LE(nameBytes.length,26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6);
    c.writeUInt32LE(crc,16); c.writeUInt32LE(data.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(nameBytes.length,28); c.writeUInt32LE(offset,42);
    local.push(l,nameBytes,data); central.push(c,nameBytes); offset += l.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
function cutwork() {
  const png = encodeRgbaPng(2,2,new Uint8Array(16).fill(255));
  const manifest = { format: 'flamoris-cutwork', schemaVersion: 1, documentId: '10000000-0000-0000-0000-000000000001',
    canvas: { width: 2, height: 2, colorSpace: 'srgb8', pixelFormat: 'straight-bgra32' },
    original: { asset: 'assets/original.png', sha256: createHash('sha256').update(png).digest('hex'), sourceName: 'Akino.png' },
    layers: [{ id: '30000000-0000-0000-0000-000000000001', kind: 'base', name: 'Base', visible: true, semanticName: null, bounds: { x:0, y:0, width:2, height:2 } }] };
  return storedZip([['manifest.json',JSON.stringify(manifest)],['assets/original.png',png]]);
}
function psd() {
  initializeCanvas(() => { throw new Error('Unexpected canvas'); }, (width,height) => ({ width,height,data:new Uint8ClampedArray(width*height*4) }));
  return new Uint8Array(writePsd({ width:32,height:32,children:[{name:'eye',id:12,left:7,top:11,
    imageData:{width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,255,255,255,255,0])}}] }));
}
for (const [kind, fixture] of [['psd',psd],['flimg',cutwork]]) {
  test(`native ${kind} worker imports ordinary Product Key Art, retains raster, saves/reopens and preserves exact mesh Undo`, async () => {
    const h = new ProductHostService(); await send(h,'session.create'); const bytes = fixture();
    const reserve = await send(h,'document.reserve',{byteLength:bytes.length}); h.transfers.entries.get(reserve.id).bytes=Buffer.from(bytes);
    await send(h,'source.import',{id:reserve.id,kind,fileName:`art.${kind}`,jobId:`test-${kind}`});
    assert.equal(h.document.session.isDirty,true); assert.equal(h.document.renderAssets.length,1);
    const nodeId=[...h.document.bindings.keys()][0]; const original=structuredClone(h.document.session.project);
    const preview=await send(h,'mesh.generatePreview',{nodeId,previewId:`grid-${kind}`,kind:'grid',columns:2,rows:2});
    await send(h,'mesh.tool',{nodeId,context:'structure',tool:'topology.automesh',input:{candidate:preview.candidate}});
    const edited=structuredClone(h.document.session.project); await send(h,'session.undo'); assert.deepEqual(h.document.session.project,original);
    await send(h,'session.redo'); assert.deepEqual(h.document.session.project,edited);
    const saved=await send(h,'session.serialize'); const assets=structuredClone(h.document.renderAssets);
    await send(h,'session.open',{document:saved.document}); assert.deepEqual(h.document.renderAssets,assets);
    assert.deepEqual(h.document.session.project,edited); assert.equal(h.assets.entries.size,1);
  });
}
