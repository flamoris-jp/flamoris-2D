const EPSILON = 1e-7;
const TRIANGLE_AREA_EPSILON = 2e-4;

export const DEFAULT_CONTOUR_AUTOMESH_SETTINGS = Object.freeze({
  alphaThreshold: 0.1,
  density: 0.45,
  cornerSensitivity: 0.65,
  interiorDensity: 0.3,
});

function diagnostic(code, message, details = {}) {
  return { code, message, details };
}

function clamp01(value, fallback) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

export function normalizeAutoMeshSettings(settings = {}) {
  return {
    alphaThreshold: clamp01(settings.alphaThreshold, DEFAULT_CONTOUR_AUTOMESH_SETTINGS.alphaThreshold),
    density: clamp01(settings.density, DEFAULT_CONTOUR_AUTOMESH_SETTINGS.density),
    cornerSensitivity: clamp01(settings.cornerSensitivity, DEFAULT_CONTOUR_AUTOMESH_SETTINGS.cornerSensitivity),
    interiorDensity: clamp01(settings.interiorDensity, DEFAULT_CONTOUR_AUTOMESH_SETTINGS.interiorDensity),
  };
}

export function createBinaryAlphaMask(imageData, alphaThreshold = 0.1) {
  const { data, width, height } = imageData || {};
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
    !data || data.length !== width * height * 4) {
    throw new TypeError("AutoMesh requires width × height RGBA image data.");
  }
  // A threshold of zero means "accept every non-zero alpha", never that a
  // fully transparent pixel is visible.
  const threshold = Math.max(1, Math.round(clamp01(alphaThreshold, 0.1) * 255));
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = data[index * 4 + 3] >= threshold ? 1 : 0;
  }
  return { width, height, data: mask };
}

function pointKey(point) { return `${point.x},${point.y}`; }
function samePoint(a, b) { return a.x === b.x && a.y === b.y; }
function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function polygonArea(points) {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

function canonicalizeContour(points) {
  let result = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (result.length > 1 && samePoint(result[0], result.at(-1))) result = result.slice(0, -1);
  if (polygonArea(result) < 0) result.reverse();
  let start = 0;
  for (let index = 1; index < result.length; index += 1) {
    if (result[index].y < result[start].y ||
      (result[index].y === result[start].y && result[index].x < result[start].x)) start = index;
  }
  return [...result.slice(start), ...result.slice(0, start)];
}

function connectedComponents(mask) {
  const { width, height, data } = mask;
  const seen = new Uint8Array(data.length);
  let count = 0;
  for (let start = 0; start < data.length; start += 1) {
    if (!data[start] || seen[start]) continue;
    count += 1;
    const queue = [start];
    seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && data[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
  }
  return count;
}

export function extractOuterContour(mask) {
  const { width, height, data } = mask;
  const visibleCount = data.reduce((sum, value) => sum + value, 0);
  if (!visibleCount) return { contour: null, diagnostics: [diagnostic(
    "AUTOMESH_NO_VISIBLE_ALPHA", "No pixels meet the alpha threshold.",
  )] };
  const componentCount = connectedComponents(mask);
  if (componentCount > 1) return { contour: null, diagnostics: [diagnostic(
    "AUTOMESH_MULTIPLE_REGIONS_UNSUPPORTED",
    "The initial contour generator requires one connected visible region.",
    { componentCount },
  )] };

  const edges = [];
  const opaque = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!opaque(x, y)) continue;
      if (!opaque(x, y - 1)) edges.push([{ x, y }, { x: x + 1, y }]);
      if (!opaque(x + 1, y)) edges.push([{ x: x + 1, y }, { x: x + 1, y: y + 1 }]);
      if (!opaque(x, y + 1)) edges.push([{ x: x + 1, y: y + 1 }, { x, y: y + 1 }]);
      if (!opaque(x - 1, y)) edges.push([{ x, y: y + 1 }, { x, y }]);
    }
  }
  const outgoing = new Map();
  for (const edge of edges) {
    const key = pointKey(edge[0]);
    const list = outgoing.get(key) || [];
    list.push(edge[1]);
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    outgoing.set(key, list);
  }
  const unused = new Set(edges.map(([a, b]) => `${pointKey(a)}>${pointKey(b)}`));
  const loops = [];
  while (unused.size) {
    const firstKey = [...unused].sort()[0];
    const [startText] = firstKey.split(">");
    const [startX, startY] = startText.split(",").map(Number);
    const start = { x: startX, y: startY };
    const loop = [start];
    let current = start;
    for (let guard = 0; guard <= edges.length; guard += 1) {
      const next = (outgoing.get(pointKey(current)) || []).find((candidate) =>
        unused.has(`${pointKey(current)}>${pointKey(candidate)}`));
      if (!next) break;
      unused.delete(`${pointKey(current)}>${pointKey(next)}`);
      current = next;
      if (samePoint(current, start)) break;
      loop.push(current);
    }
    if (loop.length >= 3 && samePoint(current, start)) loops.push(canonicalizeContour(loop));
  }
  if (loops.length !== 1) return { contour: null, diagnostics: [diagnostic(
    "AUTOMESH_HOLES_UNSUPPORTED",
    "The initial contour generator does not support holes.",
    { contourCount: loops.length },
  )] };
  if (visibleCount < 4 || Math.abs(polygonArea(loops[0])) < 4) return {
    contour: null,
    diagnostics: [diagnostic("AUTOMESH_CONTOUR_TOO_SMALL", "The visible contour is too small to triangulate.", { visibleCount })],
  };
  return { contour: loops[0], diagnostics: [] };
}

function distanceToLine(point, a, b) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length <= EPSILON ? Math.hypot(point.x - a.x, point.y - a.y) : Math.abs(cross(a, b, point)) / length;
}

function simplifyOpen(points, tolerance) {
  if (points.length <= 2) return points;
  let farthest = -1;
  let distance = tolerance;
  for (let index = 1; index < points.length - 1; index += 1) {
    const candidate = distanceToLine(points[index], points[0], points.at(-1));
    if (candidate > distance) { distance = candidate; farthest = index; }
  }
  if (farthest < 0) return [points[0], points.at(-1)];
  const left = simplifyOpen(points.slice(0, farthest + 1), tolerance);
  const right = simplifyOpen(points.slice(farthest), tolerance);
  return [...left.slice(0, -1), ...right];
}

function simplifyClosed(contour, tolerance) {
  const canonical = canonicalizeContour(contour);
  let opposite = 1;
  let maxDistance = -1;
  for (let index = 1; index < canonical.length; index += 1) {
    const distance = Math.hypot(canonical[index].x - canonical[0].x, canonical[index].y - canonical[0].y);
    if (distance > maxDistance) { maxDistance = distance; opposite = index; }
  }
  const first = simplifyOpen(canonical.slice(0, opposite + 1), tolerance);
  const second = simplifyOpen([...canonical.slice(opposite), canonical[0]], tolerance);
  return canonicalizeContour([...first.slice(0, -1), ...second.slice(0, -1)]);
}

function cornerFlags(points, sensitivity) {
  const minimumTurn = (55 - sensitivity * 40) * Math.PI / 180;
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const a = Math.atan2(point.y - previous.y, point.x - previous.x);
    const b = Math.atan2(next.y - point.y, next.x - point.x);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    return turn >= minimumTurn;
  });
}

function resampleBoundary(points, flags, maximumEdgeLength) {
  const result = [];
  const kinds = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    result.push(a);
    kinds.push(flags[index] ? "corner" : "boundary");
    const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maximumEdgeLength);
    for (let step = 1; step < count; step += 1) {
      result.push({ x: a.x + (b.x - a.x) * step / count, y: a.y + (b.y - a.y) * step / count });
      kinds.push("boundary");
    }
  }
  return { points: result, kinds };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator <= EPSILON ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function interiorPoints(polygon, bounds, maximumEdgeLength, interiorDensity) {
  if (interiorDensity <= 0) return [];
  const spacing = maximumEdgeLength * (2.2 - interiorDensity * 1.2);
  const inset = Math.max(0.5, spacing * 0.32);
  const result = [];
  for (let y = bounds.minY + spacing / 2; y < bounds.maxY; y += spacing) {
    for (let x = bounds.minX + spacing / 2; x < bounds.maxX; x += spacing) {
      const point = { x, y };
      if (!pointInPolygon(point, polygon)) continue;
      let boundaryDistance = Infinity;
      for (let index = 0; index < polygon.length; index += 1) {
        boundaryDistance = Math.min(boundaryDistance, pointSegmentDistance(
          point, polygon[index], polygon[(index + 1) % polygon.length],
        ));
      }
      if (boundaryDistance >= inset) result.push(point);
    }
  }
  return result;
}

function pointInTriangle(point, a, b, c) {
  const d1 = cross(a, b, point);
  const d2 = cross(b, c, point);
  const d3 = cross(c, a, point);
  return d1 >= -EPSILON && d2 >= -EPSILON && d3 >= -EPSILON;
}

function triangulateBoundary(points) {
  const remaining = points.map((_point, index) => index);
  const triangles = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      if (cross(points[previous], points[current], points[next]) <= EPSILON) continue;
      if (remaining.some((candidate) => candidate !== previous && candidate !== current && candidate !== next &&
        pointInTriangle(points[candidate], points[previous], points[current], points[next]))) continue;
      triangles.push([previous, current, next]);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (remaining.length === 3 && cross(points[remaining[0]], points[remaining[1]], points[remaining[2]]) > EPSILON) {
    triangles.push([...remaining]);
  }
  return triangles;
}

function insertInteriorPoints(vertices, boundaryCount, interior) {
  const triangles = triangulateBoundary(vertices.slice(0, boundaryCount));
  if (!triangles) return null;
  for (const point of interior) {
    const vertexIndex = vertices.length;
    const triangleIndex = triangles.findIndex(([a, b, c]) =>
      pointInTriangle(point, vertices[a], vertices[b], vertices[c]));
    if (triangleIndex < 0) continue;
    const [a, b, c] = triangles[triangleIndex];
    if ([
      [a, b], [b, c], [c, a],
    ].some(([first, second]) => Math.abs(cross(vertices[first], vertices[second], point)) <= TRIANGLE_AREA_EPSILON)) continue;
    vertices.push(point);
    triangles.splice(triangleIndex, 1, [a, b, vertexIndex], [b, c, vertexIndex], [c, a, vertexIndex]);
  }
  return triangles;
}

function geometryBounds(points) {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x), minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x), maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function validateCandidateGeometry(vertices, triangles) {
  if (vertices.length < 3) return [diagnostic(
    "AUTOMESH_TOO_FEW_VERTICES", "AutoMesh requires at least three candidate vertices.",
  )];
  const vertexKeys = vertices.map((point) => `${point.x},${point.y}`);
  if (new Set(vertexKeys).size !== vertexKeys.length) return [diagnostic(
    "AUTOMESH_DUPLICATE_CANDIDATE_VERTEX", "AutoMesh produced duplicate candidate vertices.",
  )];
  const signatures = new Set();
  for (const triangle of triangles) {
    if (triangle.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= vertices.length)) {
      return [diagnostic("AUTOMESH_INVALID_TRIANGLE_REFERENCE", "A generated triangle references an unknown candidate vertex.", { triangle })];
    }
    if (new Set(triangle).size !== 3) return [diagnostic(
      "AUTOMESH_REPEATED_TRIANGLE_VERTEX", "A generated triangle repeats a candidate vertex.", { triangle },
    )];
    const signature = [...triangle].sort((a, b) => a - b).join(":");
    if (signatures.has(signature)) return [diagnostic(
      "AUTOMESH_DUPLICATE_TRIANGLE", "AutoMesh produced a duplicate triangle.", { triangle },
    )];
    signatures.add(signature);
    const area = Math.abs(cross(vertices[triangle[0]], vertices[triangle[1]], vertices[triangle[2]]));
    if (area <= EPSILON) return [diagnostic(
      "AUTOMESH_ZERO_AREA_TRIANGLE", "AutoMesh produced a zero-area triangle.", { triangle },
    )];
    if (area <= TRIANGLE_AREA_EPSILON) return [diagnostic(
      "AUTOMESH_NEAR_DEGENERATE_TRIANGLE", "AutoMesh produced a near-degenerate triangle.", { triangle },
    )];
  }
  return [];
}

export function generateContourAutoMesh(imageData, settings = {}, localBounds = null) {
  const normalized = normalizeAutoMeshSettings(settings);
  const mask = createBinaryAlphaMask(imageData, normalized.alphaThreshold);
  const extraction = extractOuterContour(mask);
  if (!extraction.contour) return { settings: normalized, candidate: null, diagnostics: extraction.diagnostics };
  const rawBounds = geometryBounds(extraction.contour);
  const shortestSide = Math.max(1, Math.min(rawBounds.maxX - rawBounds.minX, rawBounds.maxY - rawBounds.minY));
  const tolerance = shortestSide / (10 + normalized.density * 24) * (1.5 - normalized.cornerSensitivity);
  const simplified = simplifyClosed(extraction.contour, tolerance);
  if (simplified.length < 3 || Math.abs(polygonArea(simplified)) <= EPSILON) return {
    settings: normalized, candidate: null,
    diagnostics: [diagnostic("AUTOMESH_DEGENERATE_CONTOUR", "Contour simplification produced a degenerate polygon.")],
  };
  const maximumEdgeLength = shortestSide / (3 + normalized.density * 9);
  const sampled = resampleBoundary(simplified, cornerFlags(simplified, normalized.cornerSensitivity), maximumEdgeLength);
  const supports = interiorPoints(sampled.points, rawBounds, maximumEdgeLength, normalized.interiorDensity);
  const vertices = sampled.points.map((point) => ({ ...point }));
  const triangles = insertInteriorPoints(vertices, sampled.points.length, supports);
  if (!triangles?.length) return { settings: normalized, candidate: null, diagnostics: [diagnostic(
    "AUTOMESH_TRIANGULATION_FAILURE", "The candidate contour could not be triangulated.",
  )] };
  const geometryDiagnostics = validateCandidateGeometry(vertices, triangles);
  if (geometryDiagnostics.length) return { settings: normalized, candidate: null, diagnostics: geometryDiagnostics };
  const bounds = localBounds || { left: 0, top: 0, width: imageData.width, height: imageData.height };
  if (!(bounds.width > 0) || !(bounds.height > 0)) return { settings: normalized, candidate: null, diagnostics: [diagnostic(
    "AUTOMESH_UV_INITIALIZATION_FAILURE", "Artwork bounds must have positive width and height.",
  )] };
  const positions = [];
  const uvs = [];
  const kinds = [...sampled.kinds, ...Array(vertices.length - sampled.points.length).fill("interior")];
  for (const point of vertices) {
    const x = bounds.left + point.x / imageData.width * bounds.width;
    const y = bounds.top + point.y / imageData.height * bounds.height;
    positions.push(x, y);
    uvs.push((x - bounds.left) / bounds.width, (y - bounds.top) / bounds.height);
  }
  return {
    settings: normalized,
    diagnostics: [],
    candidate: {
      contour: extraction.contour.map((point) => ({
        x: bounds.left + point.x / imageData.width * bounds.width,
        y: bounds.top + point.y / imageData.height * bounds.height,
      })),
      positions,
      uvs,
      indices: triangles.flat(),
      vertexKinds: kinds,
      temporaryVertexIds: vertices.map((_point, index) => `candidate_${String(index + 1).padStart(4, "0")}`),
      boundaryVertexCount: sampled.points.length,
      interiorVertexCount: vertices.length - sampled.points.length,
    },
  };
}
