export function collectPsdParts(children, ancestors = []) {
  const parts = [];

  function walk(nodes, parentPath, parentHidden, parentOpacity) {
    if (!Array.isArray(nodes)) return;

    for (const node of nodes) {
      const name = node.name || "(unnamed)";
      const path = [...parentPath, name];
      const hidden = parentHidden || Boolean(node.hidden);
      const opacity = parentOpacity * Number(node.opacity ?? 1);

      if (Array.isArray(node.children)) {
        walk(node.children, path, hidden, opacity);
        continue;
      }

      const left = Number(node.left ?? 0);
      const top = Number(node.top ?? 0);
      const right = Number(node.right ?? left + Number(node.canvas?.width ?? 0));
      const bottom = Number(node.bottom ?? top + Number(node.canvas?.height ?? 0));

      parts.push({
        id: path.join("/"),
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
      });
    }
  }

  walk(children, ancestors, false, 1);
  return parts;
}

export function visiblePsdParts(parts) {
  return parts.filter((part) => !part.hidden && part.canvas && part.width > 0 && part.height > 0);
}
