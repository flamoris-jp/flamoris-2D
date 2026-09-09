import { invertAffine, multiplyAffine } from "./transforms.js";

/**
 * Converts an evaluated document-space FK skin matrix to the target geometry's
 * local space, keeping the ordinary node/world transform downstream.
 */
export function boneSkinMatrixInGeometrySpace(skinMatrix, targetWorldTransform) {
  return multiplyAffine(
    multiplyAffine(invertAffine(targetWorldTransform), skinMatrix),
    targetWorldTransform,
  );
}
