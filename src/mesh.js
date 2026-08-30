export function clampGridSize(value, fallback = 6) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(32, Math.max(1, number)) : fallback;
}

export function findAlphaBounds(imageData, threshold = 0) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

export function generateGridMesh(bounds, textureWidth, textureHeight, columns, rows) {
  if (!bounds) throw new Error("Visible pixels were not found in the PNG.");
  const cols = clampGridSize(columns);
  const rowCount = clampGridSize(rows);
  const baseVertices = [];
  const uvs = [];
  const indices = [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  for (let row = 0; row <= rowCount; row += 1) {
    const y = bounds.minY + (height * row) / rowCount;
    for (let col = 0; col <= cols; col += 1) {
      const x = bounds.minX + (width * col) / cols;
      baseVertices.push(x, y);
      uvs.push(x / textureWidth, y / textureHeight);
    }
  }

  const stride = cols + 1;
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const topLeft = row * stride + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
    }
  }

  return {
    columns: cols,
    rows: rowCount,
    baseVertices: new Float32Array(baseVertices),
    vertexOffsets: new Float32Array(baseVertices.length),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

export function getDeformedVertices(mesh, offsets = mesh.vertexOffsets) {
  const result = new Float32Array(mesh.baseVertices.length);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = mesh.baseVertices[index] + offsets[index];
  }
  return result;
}

export function moveVertices(mesh, selectedIndices, deltaX, deltaY) {
  for (const vertexIndex of selectedIndices) {
    mesh.vertexOffsets[vertexIndex * 2] += deltaX;
    mesh.vertexOffsets[vertexIndex * 2 + 1] += deltaY;
  }
}

export function resetDeformation(mesh) {
  mesh.vertexOffsets.fill(0);
}

export function createViewTransform(viewWidth, viewHeight, imageWidth, imageHeight, padding = 48) {
  const availableWidth = Math.max(1, viewWidth - padding * 2);
  const availableHeight = Math.max(1, viewHeight - padding * 2);
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight, 1.5);
  return {
    scale,
    originX: (viewWidth - imageWidth * scale) / 2,
    originY: (viewHeight - imageHeight * scale) / 2,
  };
}

export function imageToScreen(x, y, view) {
  return { x: view.originX + x * view.scale, y: view.originY + y * view.scale };
}

export function screenToImage(x, y, view) {
  return { x: (x - view.originX) / view.scale, y: (y - view.originY) / view.scale };
}
