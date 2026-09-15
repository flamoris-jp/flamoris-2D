export const FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY = Object.freeze({
  onCancel: "keep-written-frames",
  onFailure: "keep-written-frames",
  overwrite: "reject-existing-output",
});

export function exportFrameFileName(frameIndex, minimumDigits = 6) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError("Export frame index must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(minimumDigits) || minimumDigits < 1) {
    throw new RangeError("Frame filename digit width must be a positive safe integer.");
  }
  return `frame_${String(frameIndex + 1).padStart(minimumDigits, "0")}.png`;
}

