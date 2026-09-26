import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function control(service, method, payload = {}, tags = {}) {
  return (await service.handle({ protocolVersion: 1, requestId: randomUUID(), method,
    documentToken: service.documentToken, expectedRevision: service.revision, payload, ...tags })).response;
}
export async function callLiveTool(service, leaseId, name, input, overrides = {}) {
  const reservationId = randomUUID();
  const reserved = await control(service, 'mcp.reserve', { reservationId, leaseId });
  assert.equal(reserved.ok, true, JSON.stringify(reserved.error));
  try {
    const snapshot = reserved.payload;
    const result = await control(service, 'mcp.invoke', { reservationId, name, input,
      runtimeId: snapshot.runtimeId, documentToken: snapshot.documentToken,
      expectedRevision: snapshot.revision, ...overrides });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.payload;
  } finally { await control(service, 'mcp.release', { reservationId }); }
}
