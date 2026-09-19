import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { ProductHostService } from '../product-host/session-service.mjs';
import { LIVE_MCP_LIMITS } from '../product-host/live-mcp-transport.mjs';
import { dispositions, DISPOSITION_URI } from '../product-host/live-mcp-facade.mjs';
import { commandSchemas } from '../src/commands/schemas.js';
import { querySchemas } from '../src/mcp/schemas.js';

let next = 0;
const send = async (s, method, payload = {}, overrides = {}) => (await s.handle({ protocolVersion: 1, requestId: `test-${++next}`,
  method, documentToken: s.documentToken, expectedRevision: s.revision, payload, ...overrides })).response;
async function setup(t, permission = 'edit') {
  const service = new ProductHostService();
  const diagnostics = [];
  service.emitDiagnostic = diagnostic => diagnostics.push(diagnostic);
  await send(service, 'session.create');
  t.after(() => service.close());
  const enabled = await send(service, 'mcp.enable', { permission });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const connection = enabled.payload;
  const client = new Client({ name: 'flamoris-live-proof', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }));
  t.after(() => client.close());
  return { service, client, connection, diagnostics };
}
const result = r => r.structuredContent || JSON.parse(r.content[0].text);
async function call(client, name, args = {}) { return result(await client.callTool({ name, arguments: args })); }
const tags = s => ({ documentToken: s.documentToken, expectedRevision: s.revision });
const rename = (s, name) => ({ ...tags(s), payload: { nodeId: s.document.session.project.scene.rootId, displayName: name } });
async function raw(c, options = {}) {
  return fetch(c.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...options.headers }, body: options.body || JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-proof', version: '1' } } }) });
}

test('official current SDK attaches to same session and shares ordinary transaction/Undo/Redo/save', async t => {
  const { service: s, client } = await setup(t);
  const session = s.document.session;
  const events = []; s.onExternalEvents = e => events.push(...e);
  const context = await call(client, 'live.context');
  assert.equal(context.documentToken, s.documentToken);
  assert.equal(context.revision, 0);
  const tree = await call(client, 'query.scene.get_tree', { documentToken: s.documentToken, input: {} });
  assert.equal(tree.result.id, session.project.scene.rootId);
  const changed = await call(client, 'command.scene.rename_node', rename(s, 'MCP name'));
  assert.equal(changed.revision, 1);
  assert.equal(session.project.scene.nodes[tree.result.id].displayName, 'MCP name');
  assert.equal(s.document.session, session);
  assert.equal(events[0].revision, changed.revision);
  await send(s, 'session.undo');
  assert.notEqual(session.project.scene.nodes[tree.result.id].displayName, 'MCP name');
  await send(s, 'session.redo');
  assert.equal(session.project.scene.nodes[tree.result.id].displayName, 'MCP name');
  await send(s, 'session.execute', { command: { type: 'scene.rename_node', payload: { nodeId: tree.result.id, displayName: 'WPF name' } } });
  assert.equal((await call(client, 'query.scene.get_node', { documentToken: s.documentToken, input: { nodeId: tree.result.id } })).result.displayName, 'WPF name');
  const depth = session.undoStack.length;
  const transaction = await call(client, 'live.transaction', { ...tags(s), label: 'Two normal edits', commands: [
    { type: 'scene.rename_node', payload: { nodeId: tree.result.id, displayName: 'Grouped' } },
    { type: 'scene.set_visibility', payload: { nodeId: tree.result.id, visible: false } },
  ] });
  assert.equal(transaction.result.applied, 2);
  assert.equal(session.undoStack.length, depth + 1);
  await send(s, 'session.undo');
  assert.equal(session.project.scene.nodes[tree.result.id].displayName, 'WPF name');
  assert.equal(session.project.scene.nodes[tree.result.id].visible, true);
  await call(client, 'live.redo', tags(s));
  const serialized = await send(s, 'session.serialize');
  await send(s, 'session.open', { document: serialized.payload.document });
  assert.equal(s.document.session.project.scene.nodes[tree.result.id].displayName, 'Grouped');
  assert.equal(s.mcp.status().enabled, false);
});

test('MCP diagnostics are structured and never contain credentials or payloads', async t => {
  const { service: s, client, connection, diagnostics } = await setup(t, 'edit');
  const stale = rename(s, 'Secret payload must not log');
  await call(client, 'command.scene.rename_node', stale);
  const conflict = await call(client, 'command.scene.rename_node', stale);
  assert.equal(conflict.error.code, 'revision.conflict');
  const badAuth = await raw({ ...connection, token: 'not-the-token' });
  assert.equal(badAuth.status, 401); await badAuth.arrayBuffer();
  await send(s, 'mcp.disable');
  assert.ok(diagnostics.some(d => d.category === 'mcp.session' && d.level === 'info'));
  assert.ok(diagnostics.some(d => d.category === 'mcp.transport' && d.level === 'debug'));
  assert.ok(diagnostics.some(d => d.category === 'mcp.command' &&
    d.properties.code === 'revision.conflict' && d.level === 'warn'));
  assert.ok(diagnostics.some(d => d.category === 'mcp.auth' && d.message === 'MCP authentication failed'));
  const serialized = JSON.stringify(diagnostics);
  assert.ok(!serialized.includes(connection.token));
  assert.ok(!serialized.includes('Secret payload must not log'));
});

test('SDK discovery is deterministic, complete and typed; Native lifecycle and internal restore excluded', async t => {
  const { client } = await setup(t);
  const first = await client.listTools();
  assert.ok(first.tools.every(t => t.inputSchema.additionalProperties === false));
  assert.ok(first.tools.length > 32); // SDK transparently walks server pagination.
  const names = []; let cursor;
  do { const page = await client.listTools(cursor ? { cursor } : undefined); names.push(...page.tools.map(t => t.name)); cursor = page.nextCursor; } while (cursor);
  assert.ok(names.includes('command.mesh_keyform.move_vertices'));
  assert.ok(names.includes('query.project.validate'));
  assert.ok(!names.includes('command.source.apply_psd_reimport'));
  assert.ok(!names.some(n => /restore_internal|import\.|save|eval\b|process|filesystem/.test(n)));
  const d = dispositions();
  assert.equal(d.commands.length, Object.keys(commandSchemas).length);
  assert.equal(d.commands.filter(d => d.disposition === 'edit').length, Object.keys(commandSchemas).length - 2);
  assert.equal(d.queries.filter(d => d.disposition === 'read').length, Object.keys(querySchemas).length);
  assert.deepEqual(JSON.parse((await client.readResource({ uri: DISPOSITION_URI })).contents[0].text), JSON.parse(JSON.stringify(d)));
});

test('legacy initialize supported without sessions; browser/auth/Host/body/protocol attacks reject', async t => {
  const { connection: c, service: s } = await setup(t);
  const legacy = await raw(c); assert.equal(legacy.status, 200);
  const legacyText = await legacy.text();
  const legacyResult = JSON.parse(legacyText.startsWith('event:') ? legacyText.split('\n').find(l => l.startsWith('data:')).slice(5) : legacyText);
  assert.equal(legacyResult.result.protocolVersion, '2025-11-25');
  assert.equal(legacy.headers.get('mcp-session-id'), null);
  for (const [headers, status] of [[{ Authorization: '' }, 401], [{ Authorization: 'Bearer wrong' }, 401], [{ Origin: 'https://evil.example' }, 403], [{ Origin: '' }, 403]]) {
    const response = await raw(c, { headers }); assert.equal(response.status, status, JSON.stringify(headers)); await response.arrayBuffer();
  }
  const hostAttack = await new Promise(resolve => {
    const req = httpRequest(c.endpoint, { method: 'POST', headers: { Host: 'evil.example', Authorization: `Bearer ${c.token}` } }, res => { res.resume(); resolve(res.statusCode); }); req.end('{}');
  });
  assert.equal(hostAttack, 403);
  const oversized = await raw(c, { body: ' '.repeat(LIVE_MCP_LIMITS.bodyBytes + 1) }); assert.equal(oversized.status, 413); await oversized.arrayBuffer();
  const get = await fetch(c.endpoint, { headers: { Authorization: `Bearer ${c.token}` } }); assert.equal(get.status, 405);
  await assert.rejects(s.mcp.enable('edit', { host: '0.0.0.0' }), /loopback/);
  const bad = await raw(c, { body: '{bad' }); assert.equal(bad.status, 400);
  assert.equal(s.revision, 0);
});

test('read only rejects mutation even if caller bypasses discovery; status does not leak token', async t => {
  const { service: s, client, connection } = await setup(t, 'read-only');
  const r = await call(client, 'command.scene.rename_node', rename(s, 'Denied'));
  assert.equal(r.error.code, 'mcp.read_only'); assert.equal(s.revision, 0);
  assert.ok((await client.listTools()).tools.every(t => t.annotations.readOnlyHint));
  assert.ok(!JSON.stringify(s.mcp.status()).includes(connection.token));
});

test('concurrent writes conflict, stale revision rejected, malformed transactions atomic', async t => {
  const { service: s, client } = await setup(t);
  const input = rename(s, 'Concurrent');
  const edits = await Promise.all([call(client, 'command.scene.rename_node', input), call(client, 'command.scene.rename_node', input)]);
  assert.equal(edits.filter(r => r.error?.code === 'revision.conflict').length, 1);
  assert.equal(s.revision, 1);
  const before = JSON.stringify(s.document.session.project);
  const r = await call(client, 'live.transaction', { ...tags(s), label: 'Rollback', commands: [
    { type: 'scene.rename_node', payload: input.payload }, { type: 'scene.rename_node', payload: { nodeId: 'missing', displayName: 'Invalid' } },
  ] });
  assert.ok(r.error); assert.equal(JSON.stringify(s.document.session.project), before);
  assert.equal(s.revision, 1);
});

test('queue cancellation and expired commit guard never pop history or commit late', async t => {
  const { service: s } = await setup(t);
  const args = rename(s, 'Never');
  const r = await s.handle({ protocolVersion: 1, requestId: 'cancelled', method: 'session.execute', ...tags(s), payload: { command: { type: 'scene.rename_node', payload: args.payload } } }, { guard: () => { throw Object.assign(new Error('Cancelled'), { code: 'mcp.cancelled' }); } });
  assert.equal(r.response.error.code, 'mcp.cancelled'); assert.equal(s.revision, 0);
  await send(s, 'session.execute', { command: { type: 'scene.rename_node', payload: args.payload } });
  const project = JSON.stringify(s.document.session.project), depth = s.document.session.undoStack.length;
  let checks = 0;
  const undo = await s.handle({ protocolVersion: 1, requestId: 'deadline', method: 'session.undo', ...tags(s), payload: {} }, { guard: () => { if (++checks > 1) throw Object.assign(new Error('Deadline'), { code: 'mcp.timeout' }); } });
  assert.equal(undo.response.error.code, 'mcp.timeout');
  assert.equal(s.document.session.undoStack.length, depth); assert.equal(JSON.stringify(s.document.session.project), project);
});

test('disable/re-enable, replacement, shutdown and restart revoke old credentials', async t => {
  const { service: s, connection: old } = await setup(t);
  await send(s, 'mcp.disable');
  assert.equal(s.mcp.status().enabled, false);
  const enabled = await send(s, 'mcp.enable', { permission: 'edit' }); const fresh = enabled.payload;
  assert.notEqual(fresh.token, old.token);
  const denied = await raw({ ...fresh, token: old.token }); assert.equal(denied.status, 401);
  const snapshot = await send(s, 'session.serialize');
  await send(s, 'session.open', { document: snapshot.payload.document });
  assert.equal(s.mcp.status().enabled, false);
  await assert.rejects(raw(fresh));
  const last = (await send(s, 'mcp.enable')).payload;
  await send(s, 'host.shutdown'); await s.close();
  await assert.rejects(raw(last));
  const other = new ProductHostService(); t.after(() => other.close()); await send(other, 'session.create');
  const restarted = (await send(other, 'mcp.enable')).payload;
  assert.equal((await raw({ ...restarted, token: last.token })).status, 401);
});

function modern(method, params = {}) {
  return { jsonrpc: '2.0', id: 10, method, params: { ...params, _meta: {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'wire-proof', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {},
  } } };
}
const modernHeaders = (method, name) => ({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}) });
async function until(condition) {
  const end = Date.now() + 3000;
  while (!condition()) { if (Date.now() > end) throw new Error('Timed out waiting for admission.'); await new Promise(r => setTimeout(r, 5)); }
}

test('2026-07-28 metadata/version and header-body agreement are enforced by official SDK', async t => {
  const { connection: c, service: s } = await setup(t);
  const discovery = await raw(c, { headers: modernHeaders('server/discover'), body: JSON.stringify(modern('server/discover')) });
  assert.equal(discovery.status, 200); await discovery.arrayBuffer();
  const name = 'command.scene.rename_node';
  const body = JSON.stringify(modern('tools/call', { name, arguments: rename(s, 'Rejected') }));
  for (const headers of [
    { ...modernHeaders('tools/call', name), 'Mcp-Method': 'tools/list' },
    { ...modernHeaders('tools/call', name), 'Mcp-Name': 'query.scene.get_tree' },
    { ...modernHeaders('tools/call', name), 'MCP-Protocol-Version': '2025-11-25' },
    { ...modernHeaders('tools/call', name), 'MCP-Protocol-Version': '2099-01-01' },
  ]) {
    const response = await raw(c, { headers, body }); assert.equal(response.status, 400); await response.arrayBuffer();
  }
  assert.equal(s.revision, 0);
  const malformed = await raw(c, { headers: modernHeaders('tools/call', name), body: JSON.stringify(modern('tools/call', { name, arguments: { ...rename(s, 'Bad'), payload: { nodeId: 123, displayName: '' } } })) });
  assert.ok([200, 400].includes(malformed.status)); await malformed.arrayBuffer(); assert.equal(s.revision, 0);
});

test('real HTTP disconnect and disable invalidate queued writes before commit', async t => {
  const { connection: c, service: s } = await setup(t);
  const name = 'command.scene.rename_node';
  let release;
  const barrier = new Promise(r => { release = r; }); s.queue = barrier;
  const rescue = setTimeout(() => release(), 1500);
  const abort = new AbortController();
  const pending = fetch(c.endpoint, { method: 'POST', signal: abort.signal,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...modernHeaders('tools/call', name) },
    body: JSON.stringify(modern('tools/call', { name, arguments: rename(s, 'Cancelled over HTTP') })) }).catch(e => e);
  await until(() => s.queue !== barrier);
  const scope = [...s.mcp.attachment.scopes].at(-1);
  abort.abort();
  await until(() => scope.abort.signal.aborted);
  release(); clearTimeout(rescue); await pending; await s.queue;
  assert.equal(s.revision, 0);

  let resume; const stopped = new Promise(r => { resume = r; }); s.queue = stopped;
  const rescue2 = setTimeout(() => resume(), 1500);
  const queued = raw(c, { headers: modernHeaders('tools/call', name), body: JSON.stringify(modern('tools/call', { name, arguments: rename(s, 'Revoked') })) }).catch(e => e);
  await until(() => s.queue !== stopped);
  const disable = send(s, 'mcp.disable'); assert.equal(s.mcp.status().enabled, false);
  resume(); clearTimeout(rescue2); await disable; await queued;
  assert.equal(s.revision, 0);
});

test('disable supersedes an enable waiting behind a Native operation', async t => {
  const { service: s } = await setup(t);
  let resume; s.queue = new Promise(r => { resume = r; });
  const enable = send(s, 'mcp.enable', { permission: 'edit' });
  const disable = send(s, 'mcp.disable');
  resume(); assert.equal((await enable).error.code, 'mcp.revoked'); await disable;
  assert.equal(s.mcp.status().enabled, false);
});

test('request admission bounds slow bodies, chunked oversize and nesting without mutation', async t => {
  const { service: s, connection: c } = await setup(t);
  const sockets = [];
  t.after(() => { for (const req of sockets) req.destroy(); });
  for (let i = 0; i < LIVE_MCP_LIMITS.concurrent; i++) {
    const req = httpRequest(c.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Content-Length': 200 } });
    req.on('error', () => {}); req.write('{'); sockets.push(req);
  }
  await until(() => s.mcp.status().active === LIVE_MCP_LIMITS.concurrent);
  const limited = await raw(c); assert.equal(limited.status, 429); await limited.arrayBuffer();
  for (const req of sockets) req.destroy();
  await until(() => s.mcp.status().active === 0);
  const huge = await new Promise((resolve, reject) => {
    const req = httpRequest(c.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write(' '.repeat(LIVE_MCP_LIMITS.bodyBytes)); req.end('more');
  });
  assert.equal(huge, 413);
  const nested = await raw(c, { body: '['.repeat(70) + '0' + ']'.repeat(70) }); assert.equal(nested.status, 400);
  assert.equal(s.revision, 0);
});
