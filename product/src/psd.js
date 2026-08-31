import {
  psdIdentitySegment,
  psdLayerSourceKey,
} from "./io/psd-project.js";
import { rasterFingerprint } from "./io/raster-fingerprint.js";

export function collectPsdParts(children, ancestors = []) {
  const parts = [];

  function walk(
    nodes,
    parentPath,
    parentIdentityPath,
    parentHidden,
    parentOpacity,
  ) {
    if (!Array.isArray(nodes)) return;

    const occurrences = new Map();
    for (const node of nodes) {
      const name = node.name || "(unnamed)";
      const occurrence = (occurrences.get(name) || 0) + 1;
      occurrences.set(name, occurrence);
      const path = [...parentPath, name];
      const identityPath = [
        ...parentIdentityPath,
        psdIdentitySegment(node, name, occurrence),
      ];
      const hidden = parentHidden || Boolean(node.hidden);
      const opacity = parentOpacity * Number(node.opacity ?? 1);

      if (Array.isArray(node.children)) {
        walk(node.children, path, identityPath, hidden, opacity);
        continue;
      }

      const left = Number(node.left ?? 0);
      const top = Number(node.top ?? 0);
      const right = Number(node.right ?? left + Number(node.canvas?.width ?? 0));
      const bottom = Number(node.bottom ?? top + Number(node.canvas?.height ?? 0));

      parts.push({
        sourceKey: psdLayerSourceKey(node, identityPath),
        name,
        path: path.join("/"),
        hidden,
        opacity,
        blendMode: node.blendMode || "normal",
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        canvas: node.canvas || null,
        mask: node.mask || null,
        clipping: Boolean(node.clipping),
        rasterFingerprint: rasterFingerprint(node.canvas),
      });
    }
  }

  walk(children, ancestors, [], false, 1);
  return parts;
}

export function visiblePsdParts(parts) {
  return parts.filter((part) => !part.hidden && part.canvas && part.width > 0 && part.height > 0);
}
