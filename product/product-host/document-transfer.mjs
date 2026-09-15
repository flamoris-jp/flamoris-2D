import { randomUUID } from 'node:crypto';

export const DOCUMENT_LIMITS = Object.freeze({ bytes: 128 * 1024 * 1024,
  aggregateBytes: 256 * 1024 * 1024, count: 2, lifetimeMs: 10 * 60 * 1000 });
const fail = (message, code = 'document.transfer_invalid') => { throw Object.assign(new Error(message), { code }); };

// Auth is shared with RasterAssets. Only opaque document handles; never paths or URLs.
export class DocumentTransfers {
  constructor(current, limits = DOCUMENT_LIMITS) { this.current = current; this.limits = limits; this.entries = new Map(); }
  sweep() { for (const [id, e] of this.entries) if (Date.now() >= e.expires) this.release(id); }
  reserve(byteLength, direction, token, revision, bytes = null) {
    this.sweep();
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > this.limits.bytes)
      fail('Document exceeds the native encoded document limit.', 'document.budget');
    const used = [...this.entries.values()].reduce((n, e) => n + e.byteLength, 0);
    if (this.entries.size >= this.limits.count || used + byteLength > this.limits.aggregateBytes)
      fail('Document transfer budget is occupied. Finish or cancel the previous transfer.', 'document.budget');
    const id = randomUUID();
    const entry = { id, byteLength, direction, token, revision, bytes, expires: Date.now() + this.limits.lifetimeMs };
    this.entries.set(id, entry);
    return { id, byteLength, expiresAt: new Date(entry.expires).toISOString() };
  }
  get(id, token, revision) {
    this.sweep();
    const e = this.entries.get(id), current = this.current();
    if (!e || e.token !== token || e.revision !== revision || current.token !== token ||
        (e.direction === 'upload' && current.revision !== revision))
      fail('Document transfer belongs to an expired or replaced state.', 'document.transfer_stale');
    return e;
  }
  uploaded(id, token, revision) {
    const e = this.get(id, token, revision);
    if (e.direction !== 'upload' || !e.bytes) fail('Document upload is incomplete.');
    return e.bytes;
  }
  release(id) { const e = this.entries.get(id); this.entries.delete(id); e?.abort?.(); }
  clear() { for (const id of [...this.entries.keys()]) this.release(id); }
  async serve(req, res) {
    const match = /^\/document\/([a-f0-9-]{36})$/.exec(req.url);
    if (!match) return false;
    let uploading;
    try {
      const token = req.headers['x-document-token'], revision = Number(req.headers['x-revision']);
      const e = this.get(match[1], token, revision);
      if (req.method === 'DELETE') { this.release(e.id); res.writeHead(204).end(); return true; }
      if (req.method === 'GET' && e.direction === 'download') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': e.byteLength,
          'Cache-Control': 'no-store', 'X-Document-Token': token, 'X-Revision': String(revision) });
        res.end(e.bytes); return true;
      }
      if (req.method !== 'PUT' || e.direction !== 'upload' || e.bytes || e.uploading ||
          req.headers['transfer-encoding'] || Number(req.headers['content-length']) !== e.byteLength)
        fail('Document upload requires its exact reserved length and is single-use.');
      uploading = e; e.uploading = true; e.abort = () => req.destroy();
      const bytes = Buffer.alloc(e.byteLength); let offset = 0;
      for await (const chunk of req) {
        if (offset + chunk.length > bytes.length) fail('Document exceeds reservation.');
        chunk.copy(bytes, offset); offset += chunk.length;
      }
      this.get(e.id, token, revision);
      if (offset !== bytes.length) fail('Truncated document.');
      e.bytes = bytes; e.uploading = false; e.abort = null; uploading = null;
      res.writeHead(204).end();
    } catch (error) {
      if (uploading) this.release(uploading.id);
      if (!res.headersSent) res.writeHead(error.code === 'document.transfer_stale' ? 409 : 400);
      res.end(); req.resume();
    }
    return true;
  }
}
