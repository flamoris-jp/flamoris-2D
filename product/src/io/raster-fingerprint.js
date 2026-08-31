function mix(hash, value) {
  hash ^= value;
  return Math.imul(hash, 0x01000193) >>> 0;
}

export function rasterFingerprint(canvas) {
  if (!canvas) return null;
  if (typeof canvas.flamorisRasterFingerprint === "string") {
    return canvas.flamorisRasterFingerprint;
  }
  const width = Number(canvas.width);
  const height = Number(canvas.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
    width < 0 || height < 0 || !canvas.getContext) return null;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = context?.getImageData?.(0, 0, width, height)?.data;
    if (!pixels) return null;
    let hash = 0x811c9dc5;
    hash = mix(hash, width & 0xff);
    hash = mix(hash, (width >>> 8) & 0xff);
    hash = mix(hash, height & 0xff);
    hash = mix(hash, (height >>> 8) & 0xff);
    for (let index = 0; index < pixels.length; index += 1) {
      hash = mix(hash, pixels[index]);
    }
    const fingerprint =
      `fnv1a32:${width}x${height}:${hash.toString(16).padStart(8, "0")}`;
    try {
      canvas.flamorisRasterFingerprint = fingerprint;
    } catch {
      // Some canvas-like hosts may be non-extensible; the digest is still valid.
    }
    return fingerprint;
  } catch {
    return null;
  }
}
