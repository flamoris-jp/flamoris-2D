import { parseStrictJson } from "./strict-json.js";
import { crc32, decodePngRaster, pngInternals } from "./png-raster.js";

export const CUTWORK_FLIMG_LIMITS = Object.freeze({
  maximumDimension: 16_384,
  maximumPixels: 100_000_000,
  maximumEntries: 4_096,
  maximumEntryBytes: 512 * 1024 * 1024,
  maximumArchiveBytes: 1024 * 1024 * 1024,
  maximumPhysicalArchiveBytes: 1088 * 1024 * 1024,
  maximumManifestBytes: 4 * 1024 * 1024,
  maximumRasterWorkingSetBytes: 1024 * 1024 * 1024,
});

export class CutworkFlimgError extends Error {
  constructor(message, code, details = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "CutworkFlimgError";
    this.code = code;
    this.details = details;
  }
}

const error = (message, code, details = null, cause = null) =>
  new CutworkFlimgError(message, code, details, cause);

function uint16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function uint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function safeSlice(bytes, start, length, label) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) ||
    start < 0 || length < 0 || start + length > bytes.length) {
    throw error(`${label} exceeds the archive bounds.`, "flimg.archive_malformed");
  }
  return bytes.subarray(start, start + length);
}

function decodeUtf8(bytes, label) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (cause) { throw error(`${label} is not valid UTF-8.`, "flimg.archive_path_invalid", null, cause); }
}

export function validateFlimgArchivePath(path) {
  if (!path || path !== path.normalize("NFC") || path.startsWith("/") ||
    path.includes("\\") || path.endsWith("/") || path.includes(":") ||
    /[\u0000-\u001f\u007f]/u.test(path)) {
    throw error(`Archive path ${JSON.stringify(path)} is not canonical.`, "flimg.archive_path_invalid", { path });
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw error(`Archive path ${JSON.stringify(path)} contains a dot or empty segment.`, "flimg.archive_path_invalid", { path });
  }
  return path;
}

function locateEndRecord(bytes) {
  const minimum = 22;
  if (bytes.length < minimum) throw error("The ZIP end record is missing.", "flimg.archive_malformed");
  const start = Math.max(0, bytes.length - minimum - 0xffff);
  for (let offset = bytes.length - minimum; offset >= start; offset -= 1) {
    if (uint32(bytes, offset) !== 0x06054b50) continue;
    const commentLength = uint16(bytes, offset + 20);
    if (offset + minimum + commentLength === bytes.length) return offset;
  }
  throw error("The ZIP end record is malformed.", "flimg.archive_malformed");
}

async function defaultInflateRaw(bytes, maximumOutputBytes) {
  return pngInternals.decompress(bytes, "deflate-raw", maximumOutputBytes);
}

export async function readFlimgZip(input, {
  inflateRaw = defaultInflateRaw,
  limits = CUTWORK_FLIMG_LIMITS,
} = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length > limits.maximumPhysicalArchiveBytes) {
    throw error("The .flimg archive is too large.", "flimg.size_limit_exceeded");
  }
  const endOffset = locateEndRecord(bytes);
  const disk = uint16(bytes, endOffset + 4);
  const directoryDisk = uint16(bytes, endOffset + 6);
  const entriesOnDisk = uint16(bytes, endOffset + 8);
  const entryCount = uint16(bytes, endOffset + 10);
  const directorySize = uint32(bytes, endOffset + 12);
  const directoryOffset = uint32(bytes, endOffset + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount ||
    entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw error("Multi-disk and ZIP64 archives are not accepted by the v1 importer.", "flimg.archive_malformed");
  }
  if (entryCount > limits.maximumEntries) {
    throw error("The .flimg archive has too many entries.", "flimg.size_limit_exceeded");
  }
  if (directoryOffset + directorySize !== endOffset) {
    throw error("The ZIP central directory bounds are invalid.", "flimg.archive_malformed");
  }
  let cursor = directoryOffset;
  let totalUncompressed = 0;
  const descriptors = [];
  const exactNames = new Set();
  const canonicalNames = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    safeSlice(bytes, cursor, 46, "ZIP central directory record");
    if (uint32(bytes, cursor) !== 0x02014b50) {
      throw error("The ZIP central directory is malformed.", "flimg.archive_malformed");
    }
    const flags = uint16(bytes, cursor + 8);
    const method = uint16(bytes, cursor + 10);
    const expectedCrc = uint32(bytes, cursor + 16);
    const compressedSize = uint32(bytes, cursor + 20);
    const uncompressedSize = uint32(bytes, cursor + 24);
    const nameLength = uint16(bytes, cursor + 28);
    const extraLength = uint16(bytes, cursor + 30);
    const commentLength = uint16(bytes, cursor + 32);
    const localOffset = uint32(bytes, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    safeSlice(bytes, cursor, recordLength, "ZIP central directory record");
    if ((flags & ~0x0808) !== 0 || ![0, 8].includes(method) ||
      [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      throw error("The ZIP entry encoding is unsupported.", "flimg.archive_malformed");
    }
    if (uncompressedSize > limits.maximumEntryBytes) {
      throw error("A .flimg entry exceeds the size limit.", "flimg.size_limit_exceeded");
    }
    totalUncompressed += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > limits.maximumArchiveBytes) {
      throw error("The .flimg archive exceeds the uncompressed-size limit.", "flimg.size_limit_exceeded");
    }
    const name = validateFlimgArchivePath(decodeUtf8(
      safeSlice(bytes, cursor + 46, nameLength, "ZIP entry name"),
      "ZIP entry name",
    ));
    if (name === "manifest.json" && uncompressedSize > limits.maximumManifestBytes) {
      throw error("manifest.json exceeds the size limit.", "flimg.size_limit_exceeded");
    }
    const canonical = name.normalize("NFC").toLocaleLowerCase("en-US");
    if (exactNames.has(name) || canonicalNames.has(canonical)) {
      throw error(`Duplicate archive entry ${name}.`, "flimg.archive_entry_duplicate", { path: name });
    }
    exactNames.add(name);
    canonicalNames.add(canonical);
    descriptors.push({ name, flags, method, expectedCrc, compressedSize, uncompressedSize, localOffset });
    cursor += recordLength;
  }
  if (cursor !== endOffset) throw error("The ZIP central directory has trailing data.", "flimg.archive_malformed");

  const occupied = [];
  const entries = new Map();
  for (const descriptor of descriptors) {
    const { localOffset, name, flags, method, compressedSize, uncompressedSize, expectedCrc } = descriptor;
    safeSlice(bytes, localOffset, 30, "ZIP local header");
    if (uint32(bytes, localOffset) !== 0x04034b50) {
      throw error(`ZIP local header for ${name} is invalid.`, "flimg.archive_malformed");
    }
    const localFlags = uint16(bytes, localOffset + 6);
    const localMethod = uint16(bytes, localOffset + 8);
    const localNameLength = uint16(bytes, localOffset + 26);
    const localExtraLength = uint16(bytes, localOffset + 28);
    const localName = decodeUtf8(
      safeSlice(bytes, localOffset + 30, localNameLength, "ZIP local entry name"),
      "ZIP local entry name",
    );
    if (localName !== name || localFlags !== flags || localMethod !== method) {
      throw error(`ZIP headers disagree for ${name}.`, "flimg.archive_malformed");
    }
    if ((flags & 0x0008) === 0 &&
      (uint32(bytes, localOffset + 14) !== expectedCrc ||
        uint32(bytes, localOffset + 18) !== compressedSize ||
        uint32(bytes, localOffset + 22) !== uncompressedSize)) {
      throw error(`ZIP local sizes disagree for ${name}.`, "flimg.archive_malformed");
    }
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    safeSlice(bytes, dataStart, compressedSize, `ZIP entry ${name}`);
    if (dataEnd > directoryOffset) {
      throw error(`ZIP entry ${name} overlaps the central directory.`, "flimg.archive_malformed");
    }
    occupied.push([localOffset, dataEnd, name]);
    const compressed = bytes.subarray(dataStart, dataEnd);
    let content;
    try {
      content = method === 0 ? compressed.slice() : await inflateRaw(compressed, uncompressedSize);
    } catch (cause) {
      throw error(`ZIP entry ${name} cannot be decompressed.`, "flimg.archive_malformed", { path: name }, cause);
    }
    if (!(content instanceof Uint8Array)) content = new Uint8Array(content);
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
      throw error(`ZIP entry ${name} failed its physical length or CRC check.`, "flimg.archive_malformed", { path: name });
    }
    entries.set(name, content);
  }
  occupied.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < occupied.length; index += 1) {
    if (occupied[index][0] < occupied[index - 1][1]) {
      throw error("ZIP entry data overlaps another entry.", "flimg.archive_malformed", {
        paths: [occupied[index - 1][2], occupied[index][2]],
      });
    }
  }
  return entries;
}

function exactKeys(value, expected, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw error(`${path} must be an object.`, "flimg.manifest_malformed", { path });
  }
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw error(`${path} contains missing or unknown properties.`, "flimg.manifest_malformed", {
      path, expected: sorted, actual,
    });
  }
}

function parseId(value, path) {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (typeof value !== "string" || !pattern.test(value) || value === "00000000-0000-0000-0000-000000000000") {
    throw error(`${path} is not a canonical stable UUID.`, "flimg.identity_invalid", { path, value });
  }
  return value;
}

function parseBounds(value, canvas, path) {
  exactKeys(value, ["x", "y", "width", "height"], path);
  const numbers = [value.x, value.y, value.width, value.height];
  if (!numbers.every(Number.isSafeInteger) || value.x < 0 || value.y < 0 ||
    value.width <= 0 || value.height <= 0 || value.x + value.width > canvas.width ||
    value.y + value.height > canvas.height) {
    throw error(`${path} is outside the canvas.`, "flimg.layer_bounds_invalid", { path, bounds: value });
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function requireHash(value, path) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw error(`${path} is not a canonical SHA-256 checksum.`, "flimg.checksum_invalid", { path });
  }
  return value;
}

async function sha256(bytes, digest) {
  const digestFunction = digest || (async (value) => {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this runtime.");
    return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", value));
  });
  const result = await digestFunction(bytes);
  return [...result].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function patchBounds(width, height, transform) {
  const radians = transform.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians) * transform.scale;
  const sine = Math.sin(radians) * transform.scale;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight],
  ];
  const xs = corners.map(([x, y]) => transform.centerX + x * cosine - y * sine);
  const ys = corners.map(([x, y]) => transform.centerY + x * sine + y * cosine);
  return {
    left: Math.floor(Math.min(...xs)), top: Math.floor(Math.min(...ys)),
    right: Math.ceil(Math.max(...xs)), bottom: Math.ceil(Math.max(...ys)),
  };
}

function validatePatchTransform(value, bounds, canvas, path) {
  exactKeys(value, ["centerX", "centerY", "scale", "rotationDegrees"], path);
  const numbers = [value.centerX, value.centerY, value.scale, value.rotationDegrees];
  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number)) ||
    value.scale < 0.01 || value.scale > 10 ||
    value.rotationDegrees <= -180 || value.rotationDegrees > 180) {
    throw error(`${path} is outside the Cutwork v1 transform range.`, "flimg.patch_transform_invalid", { path });
  }
  const transformed = patchBounds(bounds.width, bounds.height, value);
  if (transformed.left < 0 || transformed.top < 0 || transformed.right > canvas.width ||
    transformed.bottom > canvas.height || transformed.right <= transformed.left ||
    transformed.bottom <= transformed.top) {
    throw error(`${path} places the Patch outside the canvas.`, "flimg.patch_transform_invalid", { path, transformed });
  }
  return { ...value };
}

function validateSourcePolygon(value, canvas, path) {
  if (!Array.isArray(value) || (value.length > 0 && value.length < 3)) {
    throw error(`${path} must be empty or contain at least three points.`, "flimg.layer_invalid", { path });
  }
  return value.map((point, index) => {
    exactKeys(point, ["x", "y"], `${path}.${index}`);
    if (![point.x, point.y].every((number) => typeof number === "number" && Number.isFinite(number)) ||
      point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) {
      throw error(`${path}.${index} is outside the canvas.`, "flimg.layer_invalid", { path: `${path}.${index}` });
    }
    return { x: point.x, y: point.y };
  });
}

function addRasterBudget(total, pixels, bytesPerPixel, limit, label) {
  if (!Number.isSafeInteger(pixels) || pixels < 0 ||
    !Number.isSafeInteger(bytesPerPixel) || bytesPerPixel < 0 ||
    pixels > Math.floor(Number.MAX_SAFE_INTEGER / bytesPerPixel)) {
    throw error(`Raster memory calculation overflowed for ${label}.`,
      "flimg.size_limit_exceeded", { resource: "raster-working-set", label });
  }
  const bytes = pixels * bytesPerPixel;
  if (total > Number.MAX_SAFE_INTEGER - bytes) {
    throw error(`Raster memory calculation overflowed for ${label}.`,
      "flimg.size_limit_exceeded", { resource: "raster-working-set", label });
  }
  const next = total + bytes;
  if (next > limit) {
    throw error("The .flimg raster working set exceeds the import limit.",
      "flimg.size_limit_exceeded", {
        resource: "raster-working-set",
        estimatedBytes: next,
        maximumBytes: limit,
      });
  }
  return next;
}

function preflightRasterWorkingSet(canvas, layers, limits) {
  const canvasPixels = canvas.width * canvas.height;
  let total = 0;
  // Original RGBA + materialized Base RGBA + the Base union Gray8 buffer.
  total = addRasterBudget(total, canvasPixels, 9,
    limits.maximumRasterWorkingSetBytes, "Original, Base, and Part union");
  for (const layer of layers) {
    if (layer.kind === "base") continue;
    const pixels = layer.bounds.width * layer.bounds.height;
    // Parts retain Gray8 and materialize RGBA. Patch/Repair retain decoded RGBA
    // while the current materializer creates an independent render raster.
    const bytesPerPixel = layer.kind === "part" ? 5 : 8;
    total = addRasterBudget(total, pixels, bytesPerPixel,
      limits.maximumRasterWorkingSetBytes, `layer ${layer.id}`);
  }
  return total;
}

async function readAsset(entries, path, expectedHash, dimensions, colorType, options) {
  const bytes = entries.get(path);
  if (!bytes) throw error(`Required asset ${path} is missing.`, "flimg.asset_missing", { path });
  if (await sha256(bytes, options.digest) !== requireHash(expectedHash, `${path}.sha256`)) {
    throw error(`Asset ${path} does not match its SHA-256 checksum.`, "flimg.checksum_mismatch", { path });
  }
  try {
    return await decodePngRaster(bytes, {
      expectedWidth: dimensions.width,
      expectedHeight: dimensions.height,
      expectedColorType: colorType,
      inflate: options.inflateZlib,
    });
  } catch (cause) {
    throw error(`Asset ${path} is not the required PNG raster.`, "flimg.png_invalid", {
      path, width: dimensions.width, height: dimensions.height, colorType,
    }, cause);
  }
}

export async function readCutworkFlimg(input, options = {}) {
  const entries = await readFlimgZip(input, options);
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw error("manifest.json is missing.", "flimg.manifest_missing");
  if (manifestBytes.length > (options.limits || CUTWORK_FLIMG_LIMITS).maximumManifestBytes) {
    throw error("manifest.json exceeds the size limit.", "flimg.size_limit_exceeded");
  }
  let manifest;
  try {
    manifest = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch (cause) {
    throw error("manifest.json is malformed.", "flimg.manifest_malformed", null, cause);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
    manifest.format !== "flamoris-cutwork") {
    throw error("The archive is not a FLAMORIS Cutwork project.", "flimg.format_invalid");
  }
  if (!Number.isInteger(manifest.schemaVersion)) {
    throw error("schemaVersion must be an integer.", "flimg.manifest_malformed");
  }
  if (manifest.schemaVersion !== 1) {
    throw error(`Cutwork schema ${manifest.schemaVersion} is unsupported.`, "flimg.schema_unsupported", {
      schemaVersion: manifest.schemaVersion,
    });
  }
  exactKeys(manifest, ["format", "schemaVersion", "documentId", "canvas", "original", "layers"], "$manifest");
  const documentId = parseId(manifest.documentId, "documentId");
  exactKeys(manifest.canvas, ["width", "height", "colorSpace", "pixelFormat"], "canvas");
  const { width, height, colorSpace, pixelFormat } = manifest.canvas;
  const limits = options.limits || CUTWORK_FLIMG_LIMITS;
  const canvasPixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
    width > limits.maximumDimension || height > limits.maximumDimension ||
    !Number.isSafeInteger(canvasPixels) || canvasPixels > limits.maximumPixels ||
    colorSpace !== "srgb8" || pixelFormat !== "straight-bgra32") {
    throw error("Canvas metadata is invalid for .flimg v1.", "flimg.canvas_invalid");
  }
  const canvas = { width, height, colorSpace, pixelFormat };
  exactKeys(manifest.original, ["asset", "sha256", "sourceName"], "original");
  if (manifest.original.asset !== "assets/original.png" ||
    typeof manifest.original.sourceName !== "string" || !manifest.original.sourceName.trim()) {
    throw error("Original metadata is invalid.", "flimg.manifest_malformed", { path: "original" });
  }
  requireHash(manifest.original.sha256, "original.sha256");
  if (!Array.isArray(manifest.layers)) {
    throw error("layers must be an array.", "flimg.manifest_malformed", { path: "layers" });
  }
  const identities = new Set([documentId]);
  const referenced = new Set(["manifest.json", "assets/original.png"]);
  const layers = [];
  let baseIndex = -1;
  for (const [index, layer] of manifest.layers.entries()) {
    const path = `layers.${index}`;
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw error(`${path} must be an object.`, "flimg.layer_invalid", { path });
    }
    const common = ["id", "kind", "name", "semanticName", "visible", "bounds"];
    const kindKeys = layer.kind === "base" ? []
      : layer.kind === "patch" ? ["asset", "sha256", "transform", "sourcePolygon"]
        : ["asset", "sha256"];
    exactKeys(layer, [...common, ...kindKeys], path);
    const id = parseId(layer.id, `${path}.id`);
    if (identities.has(id)) throw error(`Duplicate stable ID ${id}.`, "flimg.identity_duplicate", { path: `${path}.id`, id });
    identities.add(id);
    if (!["part", "base", "patch", "repair"].includes(layer.kind) ||
      typeof layer.name !== "string" || typeof layer.visible !== "boolean" ||
      !(layer.semanticName === null || (typeof layer.semanticName === "string" && layer.semanticName.trim()))) {
      throw error(`${path} metadata is invalid.`, "flimg.layer_invalid", { path });
    }
    const bounds = parseBounds(layer.bounds, canvas, `${path}.bounds`);
    if (layer.kind === "base") {
      if (baseIndex >= 0 || bounds.x !== 0 || bounds.y !== 0 || bounds.width !== width || bounds.height !== height) {
        throw error("The layer stack must contain exactly one full-canvas Base.", "flimg.base_invalid", { path });
      }
      baseIndex = index;
      layers.push({ id, kind: layer.kind, name: layer.name, semanticName: layer.semanticName,
        visible: layer.visible, bounds });
      continue;
    }
    const idN = id.replaceAll("-", "");
    const file = layer.kind === "part" ? "mask.png" : "pixels.png";
    const asset = `layers/${idN}/${file}`;
    if (layer.asset !== asset) {
      throw error(`${path}.asset is not canonical for its stable ID.`, "flimg.layer_invalid", { path: `${path}.asset` });
    }
    requireHash(layer.sha256, `${path}.sha256`);
    referenced.add(asset);
    const normalized = { id, kind: layer.kind, name: layer.name,
      semanticName: layer.semanticName, visible: layer.visible, bounds, asset,
      sha256: layer.sha256 };
    if (layer.kind === "patch") {
      normalized.transform = validatePatchTransform(layer.transform, bounds, canvas, `${path}.transform`);
      normalized.sourcePolygon = validateSourcePolygon(layer.sourcePolygon, canvas, `${path}.sourcePolygon`);
    }
    layers.push(normalized);
  }
  if (baseIndex < 0 || layers.some((layer, index) =>
    index < baseIndex ? layer.kind !== "part" : index > baseIndex ? !["patch", "repair"].includes(layer.kind) : false)) {
    throw error("Cutwork layer bands or Base position are invalid.", "flimg.layer_order_invalid");
  }
  const unexpected = [...entries.keys()].filter((path) => !referenced.has(path));
  if (unexpected.length) {
    throw error("The archive contains unexpected assets.", "flimg.asset_unexpected", { paths: unexpected.sort() });
  }
  preflightRasterWorkingSet(canvas, layers, limits);
  const original = await readAsset(entries, "assets/original.png", manifest.original.sha256,
    canvas, 6, options);
  for (const layer of layers) {
    if (layer.kind === "base") continue;
    const raster = await readAsset(entries, layer.asset, layer.sha256, layer.bounds,
      layer.kind === "part" ? 0 : 6, options);
    layer.pixels = raster.pixels;
  }
  return {
    format: manifest.format,
    schemaVersion: 1,
    documentId,
    canvas,
    original: {
      asset: manifest.original.asset,
      sha256: manifest.original.sha256,
      sourceName: manifest.original.sourceName,
      pixels: original.pixels,
    },
    layers,
  };
}
