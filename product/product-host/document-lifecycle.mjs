import { randomUUID } from 'node:crypto';
import { serializeProject } from '../src/io/project-json.js';
import { DOCUMENT_LIMITS } from './document-transfer.mjs';

const fail = (message, code = 'document.receipt_invalid') => { throw Object.assign(new Error(message), { code }); };
export function initializeDocumentLifecycle(document, { renderAssets = [], metadata = {}, lineageId,
  restoredSnapshotId = null, dirty = false } = {}) {
  const timestamp = new Date().toISOString();
  document.renderAssets = structuredClone(renderAssets);
  document.metadata = { createdAt: metadata.createdAt || timestamp, modifiedAt: metadata.modifiedAt || timestamp };
  document.lineageId = lineageId || randomUUID();
  document.restoredSnapshotId = restoredSnapshotId;
  document.saveReceipts = new Map();
  if (dirty) document.session.replaceProject(document.session.project, { saved: false });
}
export function serializeDocument(document, spacing = 2) {
  return serializeProject(document.session.project, spacing, { ...document.metadata, renderAssets: document.renderAssets });
}
export function prepareDocumentSave(document, transfers, operation) {
  if (!['save', 'saveAs', 'incremental', 'copy', 'recovery'].includes(operation)) fail('Unknown save operation.');
  const intentional = !['copy', 'recovery'].includes(operation);
  for (const [id, r] of document.saveReceipts) {
    if (r.expires <= Date.now() || !transfers.entries.has(r.transferId)) document.saveReceipts.delete(id);
    else if (intentional) fail('An intentional save is already in progress.', 'document.save_busy');
  }
  const modifiedAt = operation === 'recovery' ? document.metadata.modifiedAt : new Date().toISOString();
  const serialized = serializeProject(document.session.project, 0,
    { ...document.metadata, modifiedAt, renderAssets: document.renderAssets });
  if (Buffer.byteLength(serialized) > DOCUMENT_LIMITS.bytes) fail('Document exceeds the native save limit.', 'document.budget');
  const bytes = Buffer.from(serialized);
  const transfer = transfers.reserve(bytes.length, 'download', document.token, document.revision, bytes);
  const receiptId = intentional ? randomUUID() : null;
  const identity = { lineageId: document.lineageId, documentToken: document.token,
    revision: document.revision, editorRevision: document.session.currentRevision,
    snapshotId: randomUUID(), timestamp: new Date().toISOString(), name: document.session.project.displayName };
  if (intentional) document.saveReceipts.set(receiptId, { ...identity, modifiedAt,
    transferId: transfer.id, expires: Date.now() + DOCUMENT_LIMITS.lifetimeMs });
  return { ...transfer, receiptId, operation, identity };
}
export function acknowledgeDocumentSave(document, transfers, receiptId) {
  const receipt = document.saveReceipts.get(receiptId);
  if (!receipt || receipt.documentToken !== document.token || receipt.expires <= Date.now() ||
      !transfers.entries.has(receipt.transferId)) fail('Save receipt is stale, expired, released or consumed.');
  document.session.markSaved(receipt.editorRevision);
  document.metadata.modifiedAt = receipt.modifiedAt;
  document.saveReceipts.delete(receiptId);
  transfers.release(receipt.transferId);
  const cleanup = { lineageId: document.lineageId, documentToken: document.token,
    throughRevision: receipt.revision, restoredSnapshotId: document.restoredSnapshotId };
  document.restoredSnapshotId = null;
  return { acknowledged: true, isDirty: document.session.isDirty,
    savedRevision: document.session.savedRevision, cleanup };
}
