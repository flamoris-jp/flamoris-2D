import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductHostService } from '../product-host/session-service.mjs';
import { liveTools, dispositions } from '../product-host/live-mcp-facade.mjs';
import { commandSchemas } from '../src/commands/schemas.js';
import { control as send, callLiveTool } from './support/live-mcp-control.js';

async function setup(t, permission = 'edit') {
  const s = new ProductHostService(); t.after(() => s.close());
  await send(s, 'session.create');
  const { leaseId } = (await send(s, 'mcp.enable', { permission })).payload;
  const call = (name, input = {}, tags = {}) => callLiveTool(s, leaseId, name, input, tags);
  return { s, leaseId, call, root: s.document.session.project.scene.rootId };
}
test('typed tools share Product session, ordinary transaction and history', async t => {
  const { s, call, root } = await setup(t); const session = s.document.session;
  await call('command.scene.rename_node', { payload: { nodeId: root, displayName: 'MCP' } });
  assert.equal((await send(s, 'session.workspace')).payload.tree.displayName, 'MCP');
  await send(s, 'session.undo'); await call('live.redo');
  assert.equal(session.project.scene.nodes[root].displayName, 'MCP');
  const depth = session.undoStack.length;
  await call('live.transaction', { label: 'one unit', commands: [
    { type: 'scene.rename_node', payload: { nodeId: root, displayName: 'Group' } },
    { type: 'scene.set_visibility', payload: { nodeId: root, visible: false } },
  ] });
  assert.equal(session.undoStack.length, depth + 1); await send(s, 'session.undo');
  assert.equal(session.project.scene.nodes[root].displayName, 'MCP');
  assert.equal(s.document.session, session);
});
test('registry is schema-derived and excludes file/process/lifecycle/internal commands', async () => {
  const d = dispositions(); assert.equal(d.commands.length, Object.keys(commandSchemas).length);
  for (const entry of d.commands) assert.equal(liveTools.some(t => t.name === `command.${entry.name}`), entry.disposition === 'edit');
  assert.ok(liveTools.some(t => t.name === 'command.mesh_keyform.move_vertices'));
  for (const name of ['source.apply_psd_reimport', 'animation.mesh_target.restore_internal', 'eval', 'save', 'open'])
    assert.ok(!liveTools.some(t => t.name === `command.${name}`));
});
test('reserved lane serializes WPF work; runtime/revision/schema guards reject before mutation', async t => {
  const { s, leaseId, root } = await setup(t);
  const reserved = await send(s, 'mcp.reserve', { leaseId, reservationId: 'hold' });
  let wpfFinished = false;
  const wpf = send(s, 'session.execute', { command: { type: 'scene.rename_node', payload: { nodeId: root, displayName: 'WPF' } } }).then(r => { wpfFinished = true; return r; });
  await new Promise(r => setImmediate(r)); assert.equal(wpfFinished, false);
  const { runtimeId, documentToken, revision } = reserved.payload;
  const r = await send(s, 'mcp.invoke', { reservationId: 'hold', runtimeId, documentToken, expectedRevision: revision + 1,
    name: 'command.scene.rename_node', input: { payload: { nodeId: root, displayName: 'bad' } } });
  assert.equal(r.error.code, 'stale_revision'); assert.equal(s.revision, 0);
  await send(s, 'mcp.release', { reservationId: 'hold' }); assert.equal((await wpf).ok, true);
  const call = (input, tags = {}) => callLiveTool(s, leaseId, 'command.scene.rename_node', input, tags);
  await assert.rejects(call({ payload: { nodeId: root, displayName: 'bad' } }, { runtimeId: 'old' }), /stale_session/);
  await assert.rejects(call({ payload: { nodeId: root, displayName: 'bad' } }, { documentToken: 'old' }), /stale_document/);
  await assert.rejects(call({ payload: { nodeId: 123, displayName: '' } }), /invalid_request/);
  assert.equal(s.revision, 1);
});
test('read-only and transaction validation are authoritative in Product Host', async t => {
  const { s, leaseId, root, call } = await setup(t, 'read-only');
  await assert.rejects(call('command.scene.rename_node', { payload: { nodeId: root, displayName: 'no' } }), /forbidden/);
  const edit = (await send(s, 'mcp.enable', { permission: 'edit' })).payload;
  assert.notEqual(edit.leaseId, leaseId);
  await assert.rejects(call('live.context'), /unauthorized/);
  await assert.rejects(callLiveTool(s, edit.leaseId, 'live.transaction', { label: 'bad', commands: [
    { type: 'scene.rename_node', payload: { nodeId: root, displayName: 'first' } },
    { type: 'source.apply_psd_reimport', payload: {} },
  ] }), /invalid_request/);
  assert.equal(s.revision, 0);
});
test('cancellation, disable, replacement and close invalidate pending reservations', async t => {
  const { s, leaseId } = await setup(t);
  let release; s.queue = new Promise(r => { release = r; });
  const reserve = send(s, 'mcp.reserve', { leaseId, reservationId: 'pending' });
  await send(s, 'mcp.cancel', { reservationId: 'pending' }); release();
  assert.equal((await reserve).error.code, 'cancelled');
  await send(s, 'mcp.reserve', { leaseId, reservationId: 'active' });
  await send(s, 'mcp.disable');
  assert.equal(s.mcp.status().enabled, false);
  assert.equal((await send(s, 'mcp.invoke', { reservationId: 'active' })).ok, false);
  const fresh = (await send(s, 'mcp.enable', { permission: 'edit' })).payload;
  await send(s, 'document.new');
  assert.equal((await send(s, 'mcp.reserve', { leaseId: fresh.leaseId, reservationId: 'old' })).ok, false);
  assert.equal(s.mcp.pending.size, 0);
});
test('final beforeCommit guard rejects revocation without changing project or history', async t => {
  const { s, call, root } = await setup(t);
  const before = structuredClone(s.document.session.project);
  const normal = s.document.session.beforeCommit;
  s.document.session.beforeCommit = () => { s.mcp.revoke(); normal(); };
  await assert.rejects(call('command.scene.rename_node', { payload: { nodeId: root, displayName: 'late' } }), /cancelled/);
  assert.deepEqual(s.document.session.project, before); assert.equal(s.document.session.undoStack.length, 0);
});
test('disable supersedes queued enable', async t => {
  const { s } = await setup(t); let release; s.queue = new Promise(r => { release = r; });
  const enable = send(s, 'mcp.enable', { permission: 'edit' }); const disable = send(s, 'mcp.disable');
  release(); assert.equal((await enable).error.code, 'mcp.revoked'); await disable;
  assert.equal(s.mcp.status().enabled, false);
});

test('prepared mutations have no side effects; cancellation prevents commit and releases WPF lane', async t => {
  const { s, leaseId, root } = await setup(t);
  const reserved = await send(s, 'mcp.reserve', { leaseId, reservationId: 'prepare-cancel' });
  const snapshot = reserved.payload;
  const prepared = await send(s, 'mcp.prepare', { reservationId: 'prepare-cancel', runtimeId: snapshot.runtimeId,
    documentToken: snapshot.documentToken, expectedRevision: snapshot.revision,
    name: 'command.scene.rename_node', input: { payload: { nodeId: root, displayName: 'never' } } });
  assert.equal(prepared.ok, true); assert.equal(s.revision, 0); assert.equal(s.document.session.undoStack.length, 0);
  await send(s, 'mcp.cancel', { reservationId: 'prepare-cancel' });
  assert.equal((await send(s, 'mcp.commit', { reservationId: 'prepare-cancel' })).ok, false);
  assert.notEqual(s.document.session.project.scene.nodes[root].displayName, 'never');
  assert.equal((await send(s, 'session.workspace')).ok, true);
});
test('ordinary prepared history is one-shot and rejects replacement/ABA state', async t => {
  const { s, root } = await setup(t); const session = s.document.session;
  const command = name => ({ type: 'scene.rename_node', payload: { nodeId: root, displayName: name } });
  const prepared = session.prepareTransactionCommit([command('prepared')]);
  session.execute(command('other')); session.undo();
  assert.throws(prepared, /stale/);
  const commit = session.prepareTransactionCommit([command('once')]); commit();
  assert.throws(commit, /stale/);
});

test('monotonic deadline rejects a prepared late commit even before expiry timer runs', async t => {
  const { s, leaseId, root } = await setup(t);
  const { performance } = await import('node:perf_hooks');
  const now = performance.now.bind(performance); let elapsed = 0;
  t.mock.method(performance, 'now', () => now() + elapsed);
  const { payload: snap } = await send(s, 'mcp.reserve', { leaseId, reservationId: 'deadline' });
  assert.equal((await send(s, 'mcp.prepare', { reservationId: 'deadline', runtimeId: snap.runtimeId,
    documentToken: snap.documentToken, expectedRevision: snap.revision, name: 'command.scene.rename_node',
    input: { payload: { nodeId: root, displayName: 'late' } } })).ok, true);
  elapsed = 6000;
  assert.equal((await send(s, 'mcp.commit', { reservationId: 'deadline' })).error.code, 'timeout');
  assert.equal(s.revision, 0); assert.equal(s.document.session.undoStack.length, 0);
});
