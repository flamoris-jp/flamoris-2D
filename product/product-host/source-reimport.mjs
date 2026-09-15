import { randomUUID } from 'node:crypto';
import { PsdReimportReview } from '../src/io/psd-reimport-review.js';
import { ReimportRenderHistory } from '../src/ui/reimport-render-history.js';
const handle = Symbol('native raster handle');

export function initializeSourceHistory(document, assets) {
  let parts = document.renderAssets.map(record => ({ ...record, [handle]: document.bindings?.get(record.nodeId) }));
  const orphans = parts.filter(part => !document.session.project.scene.nodes[part.nodeId]);
  const editor = { session: document.session, undo: () => document.session.undo(), redo: () => document.session.redo() };
  document.sourceHistory = new ReimportRenderHistory(editor, {
    getParts: () => parts,
    setParts: next => {
      parts = next;
      document.renderAssets = [...next, ...orphans.filter(p => !next.includes(p))].map(({ [handle]: _, ...record }) => record);
      document.bindings = new Map(next.filter(p => p[handle]).map(p => [p.nodeId, p[handle]]));
    },
  });
}
export function collectSourceAssets(document, assets) {
  if (!document.sourceHistory) return;
  if (document.sourceReview?.expires <= Date.now()) document.sourceReview = null;
  const used = new Set([...document.sourceHistory.referencedParts(), ...(document.sourceReview?.parts || [])].map(p => p[handle]));
  for (const [id, asset] of assets.entries) if (asset.attached && !used.has(id)) assets.release(id);
}
export function beginSourceReview(document, assets, parsed, prepared) {
  if (!document.session.project.sourceAssets.some(s => s.kind === 'psd')) throw new Error('PSD素材を含むプロジェクトで再取込してください。');
  const review = new PsdReimportReview(document.session.project, null,
    { importedProject: parsed.project, baseRevision: document.session.currentRevision });
  const ids = new Map(prepared.decoded.map(r => [r.nodeId, r.id]));
  for (const raster of prepared.decoded) assets.entries.set(raster.id, { ...raster, token: document.token,
    revision: document.revision, created: Date.now(), attached: true, uploading: false, abort: null });
  document.sourceReview = { id: randomUUID(), revision: document.revision, review,
    expires: Date.now() + 600000, parts: parsed.renderAssets.map(p => ({ ...p, [handle]: ids.get(p.nodeId) })) };
  return projectSourceReview(document);
}
function current(document, id) {
  const candidate = document.sourceReview;
  if (!candidate || candidate.id !== id || candidate.expires <= Date.now() || candidate.revision !== document.revision)
    throw new Error('再取込レビューが期限切れ、または編集後の状態です。もう一度解析してください。');
  candidate.review.assertSessionCurrent(document.session); return candidate;
}
export function projectSourceReview(document) {
  const c = document.sourceReview, r = c.review;
  return { id: c.id, canApply: r.canApply, summary: r.summary,
    rows: r.rows.map(row => ({ ...row,
      displayName: r.currentProject.scene.nodes[row.currentNodeId]?.displayName || r.importedProject.scene.nodes[row.importedNodeId]?.displayName || '未対応レイヤー',
      choices: Object.values(r.importedProject.scene.nodes).filter(n => r.isCompatibleImportedNode(row,n.id)).map(n => ({ id:n.id,displayName:n.displayName })) })) };
}
export function changeSourceReview(document, { id, rowId, action, importedNodeId }) {
  const { review } = current(document, id);
  switch(action) {
    case 'match':review.setMatch(rowId, importedNodeId);break;
    case 'add':review.markAsNew(rowId);break;
    case 'keep':review.keepExisting(rowId);break;
    case 'remove':review.removeExisting(rowId);break;
    case 'ignore':review.ignore(rowId);break;
    case 'auto':review.resetToAuto(rowId);break;
    default:throw new Error('Unknown source review action.');
  }
  return projectSourceReview(document);
}
export function applySourceReview(document, assets, id) {
  const c = current(document, id);
  const result = document.sourceHistory.apply(c.review, c.parts);
  document.sourceReview = null; collectSourceAssets(document, assets); return result;
}
