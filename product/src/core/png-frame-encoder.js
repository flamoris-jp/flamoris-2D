function assertRgbaFrame(frame) {
  if (!frame || frame.kind !== "rgba8" ||
    !Number.isSafeInteger(frame.width) || frame.width <= 0 ||
    !Number.isSafeInteger(frame.height) || frame.height <= 0 ||
    !(frame.data instanceof Uint8Array) ||
    frame.data.length !== frame.width * frame.height * 4) {
    throw new TypeError("PNG encoding requires a complete RGBA8 frame.");
  }
  if (frame.rowOrder !== "top-to-bottom") {
    throw new RangeError("PNG encoding requires top-to-bottom RGBA rows.");
  }
}

function unpremultiplyRgba8(source) {
  const straight = new Uint8ClampedArray(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3];
    straight[offset + 3] = alpha;
    if (alpha === 0) {
      straight[offset] = 0;
      straight[offset + 1] = 0;
      straight[offset + 2] = 0;
      continue;
    }
    if (alpha === 255) {
      straight[offset] = source[offset];
      straight[offset + 1] = source[offset + 1];
      straight[offset + 2] = source[offset + 2];
      continue;
    }
    straight[offset] = Math.min(255, Math.round(source[offset] * 255 / alpha));
    straight[offset + 1] = Math.min(255, Math.round(source[offset + 1] * 255 / alpha));
    straight[offset + 2] = Math.min(255, Math.round(source[offset + 2] * 255 / alpha));
  }
  return straight;
}

/**
 * Converts the canonical export RGBA8 readback into a lossless PNG using an
 * isolated canvas surface. The renderer emits premultiplied-alpha pixels, while
 * ImageData expects straight alpha, so conversion is explicit at this boundary.
 */
export async function encodeRgba8Png(frame, {
  OffscreenCanvasCtor = globalThis.OffscreenCanvas,
} = {}) {
  assertRgbaFrame(frame);
  if (typeof OffscreenCanvasCtor !== "function") {
    throw new Error("OffscreenCanvas is unavailable for PNG encoding.");
  }
  const canvas = new OffscreenCanvasCtor(frame.width, frame.height);
  const context = canvas.getContext("2d");
  if (!context || typeof context.createImageData !== "function" ||
    typeof context.putImageData !== "function") {
    throw new Error("A 2D canvas context is unavailable for PNG encoding.");
  }
  if (typeof canvas.convertToBlob !== "function") {
    throw new Error("OffscreenCanvas PNG conversion is unavailable.");
  }

  const imageData = context.createImageData(frame.width, frame.height);
  const pixels = frame.alphaMode === "premultiplied"
    ? unpremultiplyRgba8(frame.data)
    : new Uint8ClampedArray(frame.data);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  if (!blob || blob.type !== "image/png") {
    throw new Error("PNG encoder did not return an image/png blob.");
  }
  return new Uint8Array(await blob.arrayBuffer());
}
