import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createBinaryAlphaMask,
  extractOuterContour,
  generateContourAutoMesh,
} from "../src/core/contour-automesh.js";

function alphaImage(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[(y * width + x) * 4 + 3] = rows[y][x] === "#" ? 255 : 0;
  }
  return { data, width, height };
}

const SHAPE = alphaImage([
  "............",
  "....####....",
  "...######...",
  "..########..",
  ".##########.",
  "..########..",
  "...######...",
  "....####....",
  "............",
]);

test("identical alpha and settings produce identical contour, vertices, and triangles", () => {
  const first = generateContourAutoMesh(SHAPE, { density: 0.5, interiorDensity: 0.5 });
  const second = generateContourAutoMesh(SHAPE, { density: 0.5, interiorDensity: 0.5 });
  assert.deepEqual(second, first);
  assert.ok(first.candidate.positions.length >= 6);
  assert.ok(first.candidate.indices.length >= 3);
});

test("empty, tiny, disconnected, and holed alpha return reason-specific diagnostics", () => {
  const empty = alphaImage(["....", "....", "....", "...."]);
  assert.equal(generateContourAutoMesh(empty).diagnostics[0].code, "AUTOMESH_NO_VISIBLE_ALPHA");
  const tiny = alphaImage(["....", ".#..", "....", "...."]);
  assert.equal(generateContourAutoMesh(tiny).diagnostics[0].code, "AUTOMESH_CONTOUR_TOO_SMALL");
  const disconnected = alphaImage(["##..", "##..", "..##", "..##"]);
  assert.equal(generateContourAutoMesh(disconnected).diagnostics[0].code, "AUTOMESH_MULTIPLE_REGIONS_UNSUPPORTED");
  const hole = alphaImage(["#####", "#####", "##.##", "#####", "#####"]);
  assert.equal(generateContourAutoMesh(hole).diagnostics[0].code, "AUTOMESH_HOLES_UNSUPPORTED");
});

test("binary alpha threshold is deterministic", () => {
  const image = alphaImage(["##", "##"]);
  image.data[3] = 100;
  assert.deepEqual([...createBinaryAlphaMask(image, 0.5).data], [0, 1, 1, 1]);
  assert.deepEqual([...createBinaryAlphaMask(image, 0.5).data], [0, 1, 1, 1]);
});

test("zero threshold keeps alpha zero transparent and accepts every non-zero alpha", () => {
  const image = alphaImage(["##", "##"]);
  image.data[3] = 0;
  image.data[7] = 1;
  image.data[11] = 127;
  image.data[15] = 255;
  assert.deepEqual([...createBinaryAlphaMask(image, 0).data], [0, 1, 1, 1]);
});

test("fully transparent alpha at zero threshold reports no visible region", () => {
  const transparent = alphaImage(["....", "....", "....", "...."]);
  assert.equal(
    generateContourAutoMesh(transparent, { alphaThreshold: 0 }).diagnostics[0].code,
    "AUTOMESH_NO_VISIBLE_ALPHA",
  );
});

test("half threshold behavior remains byte-stable", () => {
  const image = alphaImage(["##", "##"]);
  image.data[3] = 127;
  image.data[7] = 128;
  assert.deepEqual([...createBinaryAlphaMask(image, 0.5).data], [0, 1, 1, 1]);
});

test("outer contour is closed by contract without duplicate terminal point", () => {
  const result = extractOuterContour(createBinaryAlphaMask(SHAPE));
  assert.equal(result.diagnostics.length, 0);
  assert.notDeepEqual(result.contour[0], result.contour.at(-1));
  assert.deepEqual(result.contour[0], { x: 4, y: 1 });
});

test("corner retention and long-span sampling stay sparse and deterministic", () => {
  const rectangle = alphaImage(Array.from({ length: 20 }, () => "#".repeat(40)));
  const result = generateContourAutoMesh(rectangle, { density: 0.2, cornerSensitivity: 1, interiorDensity: 0 });
  assert.equal(result.candidate.vertexKinds.filter((kind) => kind === "corner").length, 4);
  assert.ok(result.candidate.boundaryVertexCount > 4);
  assert.equal(result.candidate.interiorVertexCount, 0);
});

test("density and interiorDensity increase support in the expected direction", () => {
  const sparse = generateContourAutoMesh(SHAPE, { density: 0.05, interiorDensity: 0 });
  const detailed = generateContourAutoMesh(SHAPE, { density: 1, interiorDensity: 0 });
  assert.ok(detailed.candidate.boundaryVertexCount >= sparse.candidate.boundaryVertexCount);
  const noInterior = generateContourAutoMesh(SHAPE, { density: 0.5, interiorDensity: 0 });
  const interior = generateContourAutoMesh(SHAPE, { density: 0.5, interiorDensity: 1 });
  assert.ok(interior.candidate.interiorVertexCount >= noInterior.candidate.interiorVertexCount);
});

test("candidate geometry has valid UVs, unique vertices and triangles, and stable winding", () => {
  const { candidate } = generateContourAutoMesh(SHAPE, { density: 0.8, interiorDensity: 0.8 }, {
    left: 10, top: 20, width: 120, height: 90,
  });
  assert.ok(candidate.uvs.every((value) => value >= 0 && value <= 1));
  const points = Array.from({ length: candidate.positions.length / 2 }, (_unused, index) =>
    `${candidate.positions[index * 2]},${candidate.positions[index * 2 + 1]}`);
  assert.equal(new Set(points).size, points.length);
  const signatures = [];
  for (let offset = 0; offset < candidate.indices.length; offset += 3) {
    const triangle = candidate.indices.slice(offset, offset + 3);
    assert.equal(new Set(triangle).size, 3);
    assert.ok(triangle.every((index) => index >= 0 && index < points.length));
    signatures.push([...triangle].sort((a, b) => a - b).join(":"));
    const [a, b, c] = triangle.map((index) => ({
      x: candidate.positions[index * 2], y: candidate.positions[index * 2 + 1],
    }));
    assert.ok((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 2e-4);
  }
  assert.equal(new Set(signatures).size, signatures.length);
});

test("generator and preview controller remain DOM and EditorSession independent", async () => {
  const [generator, controller] = await Promise.all([
    readFile(new URL("../src/core/contour-automesh.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/automesh-preview-controller.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(generator, /\bdocument\b|\bwindow\b|EditorSession|session\./);
  assert.doesNotMatch(controller, /\bdocument\b|\bwindow\b|session\./);
});
