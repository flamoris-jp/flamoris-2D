import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductHostService } from '../product-host/session-service.mjs';
import { DocumentTransfers } from '../product-host/document-transfer.mjs';
import { createProject } from '../src/model/project.js';
import { serializeProject, parseProjectDocument } from '../src/io/project-json.js';
let seq = 0;
async function send(host, method, payload = {}, overrides = {}) {
  return (await host.handle({ protocolVersion: 1, requestId: `document-${++seq}`,
    documentToken: host.documentToken, expectedRevision: host.revision, method, payload, ...overrides })).response;
}
async function setup() { const host = new ProductHostService(); await send(host, 'session.create'); return host; }
async function rename(host, name) {
  const result = await send(host, 'session.execute', { command: { type: 'scene.rename_node',
    payload: { nodeId: host.document.session.project.scene.rootId, displayName: name } } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
}
async function prepare(host, operation = 'save') {
  const r = await send(host, 'document.prepareSave', { operation });
  assert.equal(r.ok, true, JSON.stringify(r.error)); return r.payload;
}

test('open/serialize preserves complete embedded artwork records and timestamps', async () => {
  const host = await setup();
  const assets = [{ nodeId: 'external', sourceKey: 'layer:3', width: 1, height: 1,
    bounds: { x: 14, y: 9 }, dataUrl: 'data:image/png;base64,AAAA', name: 'eye' }];
  const text = serializeProject(createProject({ width: 32, height: 32 }), 0, { renderAssets: assets,
    createdAt: '2024-01-01T00:00:00.000Z', modifiedAt: '2025-01-01T00:00:00.000Z' });
  assert.equal((await send(host, 'session.open', { document: text })).ok, true);
  const result = await send(host, 'session.serialize');
  const parsed = parseProjectDocument(result.payload.document);
  assert.deepEqual(parsed.renderAssets, assets);
  assert.equal(parsed.metadata.createdAt, '2024-01-01T00:00:00.000Z');
  assert.equal(parsed.metadata.modifiedAt, '2025-01-01T00:00:00.000Z');
});

test('save acknowledges captured EditorSession identity while newer edits stay dirty; undo/redo matches save point', async () => {
  const host = await setup(); await rename(host, 'saved');
  const saved = await prepare(host); await rename(host, 'newer');
  assert.equal((await send(host, 'document.acknowledgeSave', { receiptId: saved.receiptId })).ok, true);
  assert.equal(host.document.session.isDirty, true);
  await send(host, 'session.undo'); assert.equal(host.document.session.isDirty, false);
  await send(host, 'session.redo'); assert.equal(host.document.session.isDirty, true);
  assert.equal((await send(host, 'document.acknowledgeSave', { receiptId: saved.receiptId })).ok, false);
});

test('save copy/recovery/cancel/stale receipt never mark another document clean', async () => {
  const host = await setup(); await rename(host, 'dirty');
  const lineage = host.document.lineageId;
  for (const kind of ['copy', 'recovery']) {
    const copy = await prepare(host, kind); assert.equal(copy.receiptId, null);
    assert.equal(host.document.session.isDirty, true);
    await send(host, 'document.release', { id: copy.id, revision: copy.identity.revision });
  }
  const aborted = await prepare(host);
  await send(host, 'document.release', { id: aborted.id, revision: aborted.identity.revision });
  assert.equal((await send(host, 'document.acknowledgeSave', { receiptId: aborted.receiptId })).ok, false);
  assert.equal(host.document.session.isDirty, true);
  const stale = await prepare(host); await send(host, 'session.create');
  assert.notEqual(host.document.lineageId, lineage);
  await rename(host, 'other');
  assert.equal((await send(host, 'document.acknowledgeSave', { receiptId: stale.receiptId })).ok, false);
  assert.equal(host.document.session.isDirty, true);
});

test('recovery restores validated candidate with fresh token, retained lineage, dirty state and exact cleanup origin', async () => {
  const host = await setup(); const oldToken = host.documentToken;
  const r = await prepare(host, 'recovery');
  const bytes = host.transfers.entries.get(r.id).bytes;
  host.transfers.release(r.id);
  const input = await send(host, 'document.reserve', { byteLength: bytes.length });
  host.transfers.entries.get(input.payload.id).bytes = bytes;
  const opened = await send(host, 'document.open', { id: input.payload.id,
    recovery: { lineageId: r.identity.lineageId, snapshotId: r.identity.snapshotId } });
  assert.equal(opened.ok, true, JSON.stringify(opened.error));
  assert.notEqual(host.documentToken, oldToken);
  assert.equal(host.document.lineageId, r.identity.lineageId);
  assert.equal(host.document.session.isDirty, true);
  const save = await prepare(host);
  const ack = await send(host, 'document.acknowledgeSave', { receiptId: save.receiptId });
  assert.equal(ack.payload.cleanup.restoredSnapshotId, r.identity.snapshotId);
  assert.equal(ack.payload.cleanup.documentToken, host.documentToken);
});

test('invalid/future document and stale upload preserve live state and existing resources', async () => {
  const host = await setup(); await rename(host, 'keep');
  const token = host.documentToken, project = structuredClone(host.document.session.project);
  const bytes = Buffer.from('{"format":"flamoris-2d-project","formatVersion":999}');
  const r = await send(host, 'document.reserve', { byteLength: bytes.length });
  host.transfers.entries.get(r.payload.id).bytes = bytes;
  assert.equal((await send(host, 'document.open', { id: r.payload.id })).ok, false);
  assert.equal(host.documentToken, token); assert.deepEqual(host.document.session.project, project);
  await rename(host, 'new');
  assert.equal((await send(host, 'document.open', { id: r.payload.id })).ok, false);
});

test('binary document endpoint keeps large bytes out of control JSON and rejects unauthorized/stale writes', async t => {
  const host = await setup(); const endpoint = await host.assets.start(); t.after(() => host.assets.close());
  const bytes = Buffer.alloc(9 * 1024 * 1024, 32);
  const r = await send(host, 'document.reserve', { byteLength: bytes.length });
  const url = `${endpoint.url}/document/${r.payload.id}`;
  const headers = { Authorization: `Bearer ${endpoint.secret}`, 'X-Document-Token': host.documentToken, 'X-Revision': '0' };
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://example.test' } })).status, 403);
  assert.equal((await fetch(url, { method: 'PUT', headers, body: bytes })).status, 204);
  assert.equal(host.transfers.uploaded(r.payload.id, host.documentToken, 0).length, bytes.length);
  assert.equal((await fetch(url, { method: 'PUT', headers, body: bytes })).status, 400);
  assert.equal((await fetch(url, { method: 'GET', headers })).status, 400);
  await rename(host, 'after');
  assert.equal((await fetch(url, { headers })).status, 409);
});

test('immutable save download tolerates edits but expires and never crosses document tokens', async t => {
  const host = await setup(); const endpoint = await host.assets.start(); t.after(() => host.assets.close());
  const saved = await prepare(host); const token = host.documentToken;
  await rename(host, 'while writing');
  const headers = { Authorization: `Bearer ${endpoint.secret}`, 'X-Document-Token': token, 'X-Revision': '0' };
  const response = await fetch(`${endpoint.url}/document/${saved.id}`, { headers });
  assert.equal(response.status, 200); parseProjectDocument(await response.text());
  host.transfers.entries.get(saved.id).expires = 0; host.transfers.sweep();
  assert.equal((await send(host, 'document.acknowledgeSave', { receiptId: saved.receiptId })).ok, false);
  const small = new DocumentTransfers(() => ({ token, revision: 0 }), { bytes: 4, aggregateBytes: 4, count: 1, lifetimeMs: 1000 });
  assert.throws(() => small.reserve(5, 'upload', token, 0), /limit/);
  small.reserve(4, 'upload', token, 0); assert.throws(() => small.reserve(1, 'upload', token, 0), /budget/);
});

test('real embedded RGBA artwork decodes, preserves cropped bounds, generates in document coordinates and survives save/reopen', async () => {
  const { createProjectFromPsd } = await import('../src/io/psd-project.js');
  const { encodeRgbaPng } = await import('../product-host/document-artwork.mjs');
  const host = await setup();
  const project = createProjectFromPsd({ width: 64, height: 64, children: [
    { id: 1, name: 'eye', left: 11, top: 19, right: 13, bottom: 21 } ] });
  const node = Object.values(project.scene.nodes).find(n => n.kind === 'part');
  const png = encodeRgbaPng(2, 2, new Uint8Array([255,0,0,255, 0,255,0,128, 0,0,255,255, 255,255,255,0]));
  const record = { nodeId: node.id, sourceKey: node.sourceRef.sourceKey, name: 'eye',
    width: 2, height: 2, left: 11, top: 19, right: 13, bottom: 21, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
  const text = serializeProject(project, 0, { renderAssets: [record] });
  const opened = await send(host, 'session.open', { document: text });
  assert.equal(opened.ok, true, JSON.stringify(opened.error));
  const p = await send(host, 'mesh.projection', { nodeId: node.id });
  assert.equal(p.payload.proofOnly, false); assert.equal(p.payload.artwork[0].left, 11);
  assert.deepEqual([...host.assets.entries.values()][0].bytes.subarray(0, 4), Buffer.from([0,0,255,255]));
  const preview = await send(host, 'mesh.generatePreview', { nodeId: node.id, previewId: 'cropped-grid', kind: 'grid', columns: 2, rows: 2 });
  assert.equal(preview.ok, true, JSON.stringify(preview.error));
  assert.ok(preview.payload.candidate.positions.every((n, i) => n >= (i % 2 ? 19 : 11)));
  const original = structuredClone(host.document.session.project);
  const malformed = JSON.parse(text); malformed.renderAssets[0].width = 4096;
  const token = host.documentToken;
  assert.equal((await send(host, 'session.open', { document: JSON.stringify(malformed) })).ok, false);
  assert.equal(host.documentToken, token); assert.deepEqual(host.document.session.project, original);
  const serialized = await send(host, 'session.serialize');
  assert.equal((await send(host, 'session.open', { document: serialized.payload.document })).ok, true);
  assert.deepEqual(host.document.renderAssets, [record]);
});


test('native New requires the reviewed token/revision and preserves edits on a stale replacement', async () => {
  const host = await setup(); const document = host.document;
  const approved = { documentToken: host.documentToken, expectedRevision: host.revision };
  await rename(host, 'edited while choosing a file');
  const rejected = await send(host, 'document.new', {}, approved);
  assert.equal(rejected.error.code, 'revision.conflict'); assert.equal(host.document, document);
  assert.equal(host.document.session.isDirty, true);
  const accepted = await send(host, 'document.new'); assert.equal(accepted.ok, true);
  assert.notEqual(host.documentToken, approved.documentToken);
  assert.equal((await send(host, 'document.new', {}, approved)).error.code, 'document.token_stale');
});
