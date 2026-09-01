const PNG_DATA_URL = /^data:image\/png;base64,[a-z0-9+/=]+$/i;

function persistedPart(part, dataUrl) {
  return {
    nodeId: part.nodeId,
    sourceKey: part.sourceKey,
    name: part.name,
    path: part.path,
    hidden: Boolean(part.hidden),
    opacity: Number(part.opacity ?? 1),
    blendMode: part.blendMode || "normal",
    left: Number(part.left ?? 0),
    top: Number(part.top ?? 0),
    right: Number(part.right ?? 0),
    bottom: Number(part.bottom ?? 0),
    width: Number(part.width ?? 0),
    height: Number(part.height ?? 0),
    dataUrl,
  };
}

export function serializePsdRenderAssets(parts = []) {
  const result = [];
  for (const part of parts) {
    if (!part?.nodeId || !part?.sourceKey) continue;
    const dataUrl = typeof part.dataUrl === "string"
      ? part.dataUrl
      : part.canvas?.toDataURL?.("image/png");
    if (!PNG_DATA_URL.test(dataUrl || "")) continue;
    result.push(persistedPart(part, dataUrl));
  }
  return result;
}

export function normalizePsdRenderAssets(records = [], project = null) {
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  const result = [];
  for (const record of records) {
    if (!record || typeof record.nodeId !== "string" ||
      typeof record.sourceKey !== "string" ||
      !PNG_DATA_URL.test(record.dataUrl || "") ||
      (project && !project.scene.nodes[record.nodeId]) ||
      seen.has(record.nodeId)) continue;
    const part = persistedPart(record, record.dataUrl);
    if (![part.left, part.top, part.right, part.bottom, part.width, part.height,
      part.opacity].every(Number.isFinite)) continue;
    seen.add(part.nodeId);
    result.push(part);
  }
  return result;
}

export async function hydratePsdRenderAssets(
  records,
  project,
  { loadImage } = {},
) {
  if (typeof loadImage !== "function") {
    throw new TypeError("A render asset image loader is required.");
  }
  const sourceCount = Array.isArray(records) ? records.length : 0;
  const normalized = normalizePsdRenderAssets(records, project);
  const outcomes = await Promise.allSettled(normalized.map(async (part) => ({
    ...part,
    canvas: await loadImage(part.dataUrl),
  })));
  const parts = outcomes
    .filter((outcome) => outcome.status === "fulfilled")
    .map((outcome) => outcome.value);
  return {
    parts,
    totalCount: sourceCount,
    failedCount: sourceCount - normalized.length + outcomes.length - parts.length,
  };
}
