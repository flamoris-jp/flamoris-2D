function positiveDimension(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(label + " must be a positive safe integer.");
  }
  return value;
}

/**
 * Maps Project canvas coordinates to an aspect-compatible output surface.
 * The Project origin remains the output origin and both axes use one uniform
 * scale. Aspect-mismatched output is rejected because crop, stretch, and pad
 * policies are not part of the current render model.
 */
export function createProjectCanvasRenderTarget({
  projectWidth,
  projectHeight,
  outputWidth,
  outputHeight,
}) {
  const sourceWidth = positiveDimension(projectWidth, "Project canvas width");
  const sourceHeight = positiveDimension(projectHeight, "Project canvas height");
  const width = positiveDimension(outputWidth, "Output width");
  const height = positiveDimension(outputHeight, "Output height");
  if (BigInt(sourceWidth) * BigInt(height) !==
    BigInt(sourceHeight) * BigInt(width)) {
    throw new RangeError(
      "Output resolution must preserve the Project canvas aspect ratio; crop, stretch, and padding are undefined.",
    );
  }
  return Object.freeze({
    width,
    height,
    viewportWidth: width,
    viewportHeight: height,
    originX: 0,
    originY: 0,
    scale: width / sourceWidth,
    mapping: "project-origin-uniform-scale",
  });
}
