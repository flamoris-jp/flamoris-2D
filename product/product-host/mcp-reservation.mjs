import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { liveTools, resolveLiveTool, dispositions } from './live-mcp-facade.mjs';

const fault = code => Object.assign(new Error(code), { code });

// Private WPF control-channel coordination, not an external transport or editor.
export class McpReservation {
  constructor(service) {
    this.service = service;
    this.runtimeId = randomUUID();
    this.lease = null;
    this.pending = new Map();
  }
  snapshot() {
    return { productId: 'flamoris.2d', applicationVersion: '0.4.0', runtimeId: this.runtimeId,
      documentToken: this.service.documentToken, revision: this.service.revision,
      available: Boolean(this.service.document), humanEditing: false };
  }
  enable(permission) {
    if (!['read-only', 'edit'].includes(permission)) throw fault('invalid_request');
    this.revoke();
    this.lease = { id: randomUUID(), permission, documentToken: this.service.documentToken };
    return { leaseId: this.lease.id, snapshot: this.snapshot(), tools: liveTools };
  }
  status() { return { enabled: Boolean(this.lease), permission: this.lease?.permission }; }
  revoke() {
    this.lease = null;
    for (const reservation of this.pending.values()) reservation.finish();
  }
  close() { this.revoke(); }
  response(request, payload, error) {
    return { response: { protocolVersion: 1, type: 'response', requestId: request.requestId,
      documentToken: this.service.documentToken, revision: this.service.revision,
      ok: !error, ...(error ? { error: { code: error.code || 'internal_error', message: error.code || 'internal_error', details: {} } } : { payload }) }, events: [] };
  }
  control(request, execute) {
    if (request.protocolVersion !== 1) return Promise.resolve(this.response(request, null, fault('invalid_request')));
    const { method, payload = {} } = request;
    if (method === 'mcp.reserve') return this.reserve(request);
    const reservation = this.pending.get(payload.reservationId);
    if (method === 'mcp.release' || method === 'mcp.cancel') {
      reservation?.finish();
      return Promise.resolve(this.response(request, { released: true }));
    }
    return (async () => {
      try {
        reservation?.guard();
        if (!reservation || !reservation.ready) throw fault('unauthorized');
        let inner, prepared = null;
        if (method === 'mcp.commit') {
          if (!reservation.prepared || reservation.committed) throw fault('unauthorized');
          reservation.committed = true;
          inner = reservation.inner; prepared = reservation.prepared;
          reservation.prepared = null;
          if (inner.documentToken !== this.service.documentToken || inner.expectedRevision !== this.service.revision)
            throw fault('stale_revision');
          if (this.lease.permission !== 'edit') throw fault('forbidden');
        } else {
          if (reservation.used) throw fault('unauthorized');
          reservation.used = true;
          const tool = resolveLiveTool(payload.name, payload.input);
          if (!tool.readOnly && this.lease.permission !== 'edit') throw fault('forbidden');
          if (payload.runtimeId !== this.runtimeId) throw fault('stale_session');
          if (payload.documentToken !== this.service.documentToken) throw fault('stale_document');
          if (payload.expectedRevision !== this.service.revision) throw fault('stale_revision');
          if (tool.name === 'live.dispositions') return this.response(request, dispositions());
          inner = { protocolVersion: 1, requestId: request.requestId, method: tool.method,
            documentToken: payload.documentToken, expectedRevision: payload.expectedRevision, payload: tool.payload };
          if (method === 'mcp.prepare') {
            if (tool.readOnly) throw fault('forbidden');
            reservation.prepared = this.service.prepareLiveMutation(inner);
            reservation.guard();
            reservation.inner = inner;
            return this.response(request, { prepared: true });
          }
          if (!tool.readOnly) throw fault('forbidden');
        }
        inner = { ...inner, requestId: request.requestId };
        const result = await execute(inner, reservation.guard, prepared);
        if (result.response.ok && !prepared && Buffer.byteLength(JSON.stringify(result.response.payload)) > 1024 * 1024)
          return this.response(request, null, fault('mcp.result_too_large'));
        if (result.response.ok) result.response.payload = {
          documentToken: result.response.documentToken, revision: result.response.revision,
          permission: this.lease?.permission, result: result.response.payload,
        };
        return result;
      } catch (error) { return this.response(request, null, error); }
    })();
  }
  reserve(request) {
    const { reservationId, leaseId } = request.payload || {};
    if (typeof reservationId !== 'string' || reservationId.length > 80 || !reservationId ||
        this.pending.has(reservationId) || this.pending.size >= 8 || !this.lease || this.lease.id !== leaseId)
      return Promise.resolve(this.response(request, null, fault('unauthorized')));
    const lease = this.lease;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const deadline = performance.now() + 5000;
    let timer;
    const reservation = { ready: false, used: false, finished: false,
      finish: () => { reservation.finished = true; reservation.prepared = null; clearTimeout(timer); this.pending.delete(reservationId); release(); },
      guard: () => {
        if (reservation.finished || this.lease !== lease) throw fault('cancelled');
        if (performance.now() >= deadline) throw fault('timeout');
        if (this.service.documentToken !== lease.documentToken) throw fault('stale_document');
      } };
    this.pending.set(reservationId, reservation);
    timer = setTimeout(reservation.finish, 5000);
    let complete;
    const response = new Promise(resolve => { complete = resolve; });
    const operation = this.service.queue.then(async () => {
      try {
        reservation.guard(); reservation.ready = true;
        complete(this.response(request, this.snapshot()));
        await held;
      } catch (error) { complete(this.response(request, null, error)); }
      finally { reservation.finish(); }
    });
    this.service.queue = operation.catch(() => {});
    return response;
  }
}
