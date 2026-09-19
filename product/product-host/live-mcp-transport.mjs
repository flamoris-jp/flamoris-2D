import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createLiveMcpServer } from './live-mcp-facade.mjs';

export const LIVE_MCP_LIMITS = Object.freeze({ bodyBytes: 1024 * 1024, concurrent: 8, connections: 16, timeoutMs: 15000, depth: 64 });
function fail(code) { throw Object.assign(new Error(code), { code }); }
function boundedJson(bytes) {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const pending = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (depth > LIVE_MCP_LIMITS.depth) fail('mcp.depth');
    if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return value;
}

export class LiveMcpEndpoint {
  constructor(service, emitDiagnostic = null) {
    this.service = service; this.emitDiagnostic = emitDiagnostic;
    this.attachment = null; this.closing = Promise.resolve();
  }
  diagnose(level, category, message, properties = {}) {
    try { this.emitDiagnostic?.({ level, category, message, properties }); } catch { }
  }
  status() {
    const a = this.attachment;
    return a ? { enabled: true, permission: a.permission, endpoint: a.endpoint, requests: a.requests, active: a.active,
      lastActivity: a.lastActivity, protocol: '2026-07-28', sdk: '2.0.0' } : { enabled: false };
  }
  async enable(permission = 'read-only', { host = '127.0.0.1' } = {}) {
    if (!['read-only', 'edit'].includes(permission)) fail('mcp.permission_invalid');
    if (host !== '127.0.0.1') fail('mcp.loopback_required');
    if (!this.service.documentToken || this.service.shutdownRequested) fail('mcp.no_authority');
    this.revoke(); await this.closing;
    this.diagnose('debug', 'mcp.transport', 'Starting live MCP endpoint', { permission });
    const a = { permission, documentToken: this.service.documentToken, secret: randomBytes(32).toString('hex'),
      requests: 0, active: 0, lastActivity: null, scopes: new Set(), endpoint: null, revoked: false };
    this.attachment = a;
    a.server = createServer({ maxHeaderSize: 8192 }, (req, res) => { void this.serve(a, req, res); });
    a.server.maxConnections = LIVE_MCP_LIMITS.connections;
    a.server.requestTimeout = LIVE_MCP_LIMITS.timeoutMs;
    a.server.headersTimeout = 5000;
    a.server.keepAliveTimeout = 1000;
    try {
      await new Promise((resolve, reject) => { a.server.once('error', reject); a.server.listen(0, host, resolve); });
      if (a.revoked) fail('mcp.revoked');
      a.endpoint = `http://127.0.0.1:${a.server.address().port}/mcp`;
      this.diagnose('info', 'mcp.session', 'Live MCP access attached', { permission, protocol: '2026-07-28' });
      this.diagnose('info', 'mcp.transport', 'Live MCP server started', { transport: 'streamable-http', loopback: true });
      // Only the internal Native enable response carries the capability.
      return { ...this.status(), token: a.secret };
    } catch (error) {
      this.diagnose('error', 'mcp.transport', 'Live MCP server failed to start',
        { code: error?.code || 'mcp.start_failed' });
      this.revoke(); throw error;
    }
  }
  revoke() {
    const a = this.attachment;
    this.attachment = null;
    if (!a) return;
    this.diagnose('info', 'mcp.session', 'Live MCP access detached',
      { permission: a.permission, requests: a.requests, active: a.active });
    a.revoked = true; a.secret = '';
    for (const scope of a.scopes) scope.abort.abort();
    a.server?.closeAllConnections();
    const stopped = a.server ? new Promise(resolve => a.server.close(resolve)) : Promise.resolve();
    this.closing = Promise.allSettled([this.closing, stopped]).then(() => {});
  }
  async close() { this.revoke(); await this.closing; }
  async serve(a, req, res) {
    let scope, timer, handler;
    const reject = (code, category = 'mcp.protocol', message = 'MCP request rejected') => {
      this.diagnose(code >= 500 ? 'error' : 'warn', category, message, { statusCode: code });
      if (!res.headersSent && !res.destroyed) res.writeHead(code, { 'Cache-Control': 'no-store', Connection: 'close' }).end();
      req.resume();
    };
    try {
      if (a.revoked || a !== this.attachment || this.service.shutdownRequested) return reject(403, 'mcp.session', 'Revoked MCP access rejected');
      if (Object.hasOwn(req.headers, 'origin') || req.headers.host !== new URL(a.endpoint).host) return reject(403, 'mcp.auth', 'MCP origin or host rejected');
      // Reject duplicate security headers rather than accepting Node's first-value normalization.
      const names = req.rawHeaders.filter((_, i) => i % 2 === 0).map(n => n.toLowerCase());
      if (['host', 'authorization', 'origin'].some(n => names.filter(x => x === n).length > 1)) return reject(403, 'mcp.auth', 'Duplicate MCP security header rejected');
      const got = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${a.secret}`);
      if (got.length !== expected.length || !timingSafeEqual(got, expected))
        return reject(401, 'mcp.auth', 'MCP authentication failed');
      this.diagnose('debug', 'mcp.auth', 'MCP authentication succeeded', { transport: 'streamable-http' });
      if (req.url !== '/mcp') return reject(404);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reject(405); }
      if (a.active >= LIVE_MCP_LIMITS.concurrent) return reject(429);
      if (Number(req.headers['content-length'] || 0) > LIVE_MCP_LIMITS.bodyBytes) return reject(413);
      a.active++; a.requests++; a.lastActivity = new Date().toISOString();
      const abort = new AbortController(), deadline = performance.now() + LIVE_MCP_LIMITS.timeoutMs;
      scope = { abort, guard: () => {
        if (abort.signal.aborted) fail('mcp.cancelled');
        if (performance.now() >= deadline) fail('mcp.timeout');
        if (a.revoked || a !== this.attachment || a.documentToken !== this.service.documentToken || this.service.shutdownRequested) fail('mcp.revoked');
      } };
      a.scopes.add(scope);
      res.once('close', () => { if (!res.writableFinished) abort.abort(); });
      req.once('aborted', () => abort.abort());
      timer = setTimeout(() => { abort.abort(); reject(408, 'mcp.transport', 'MCP request timed out'); req.destroy(); }, LIVE_MCP_LIMITS.timeoutMs);
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        scope.guard(); size += chunk.length;
        if (size > LIVE_MCP_LIMITS.bodyBytes) return reject(413);
        chunks.push(chunk);
      }
      let body;
      try { body = boundedJson(Buffer.concat(chunks)); } catch { return reject(400); }
      scope.guard();
      // Per HTTP exchange, disposable SDK protocol machinery; facade still closes over SAME service.
      handler = createMcpHandler(() => createLiveMcpServer(this.service, a, scope), { legacy: 'stateless', responseMode: 'auto', maxSubscriptions: 0, onerror: () => {} });
      res.setHeader('Cache-Control', 'no-store');
      await toNodeHandler(handler, { onerror: () => {} })(req, res, body);
    } catch (error) {
      this.diagnose(error?.code === 'mcp.timeout' ? 'warn' : 'debug', 'mcp.protocol',
        'MCP request failed', { code: error?.code || 'mcp.request_failed' });
      reject(400);
    }
    finally {
      clearTimeout(timer);
      if (scope) {
        a.active--; a.scopes.delete(scope);
        this.diagnose('debug', 'mcp.transport', 'MCP request disconnected',
          { active: a.active, requests: a.requests });
      }
      await handler?.close().catch(() => {});
    }
  }
}
