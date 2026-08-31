import {
  changePivotPreservingLocalMatrix,
  invertAffine,
  transformPoint,
  worldTransformMatrix,
} from "../core/transforms.js";

const MIN_SCALE = 0.001;

export function pickNodeAtDocumentPoint(parts, adapter, point) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part.nodeId) continue;
    const node = adapter.getNode(part.nodeId);
    if (!node.effectiveVisible || node.locked) continue;
    const local = transformPoint(
      invertAffine(adapter.worldTransform(part.nodeId)),
      point,
    );
    if (
      local.x >= part.left && local.x <= part.right &&
      local.y >= part.top && local.y <= part.bottom
    ) return part.nodeId;
  }
  return null;
}

export function parentLocalPoint(project, node, documentPoint) {
  if (!node.parentId) return { ...documentPoint };
  return transformPoint(
    invertAffine(worldTransformMatrix(project, node.parentId)),
    documentPoint,
  );
}

export function createTransformGesture(
  project,
  node,
  tool,
  startDocumentPoint,
) {
  const initialTransform = structuredClone(node.transform);
  const startParentPoint = parentLocalPoint(
    project,
    node,
    startDocumentPoint,
  );
  const pivotParent = {
    x: initialTransform.position.x + initialTransform.pivot.x,
    y: initialTransform.position.y + initialTransform.pivot.y,
  };
  const startDistance = Math.max(
    MIN_SCALE,
    Math.hypot(
      startParentPoint.x - pivotParent.x,
      startParentPoint.y - pivotParent.y,
    ),
  );
  const startAngle = Math.atan2(
    startParentPoint.y - pivotParent.y,
    startParentPoint.x - pivotParent.x,
  );
  const startNodePoint = transformPoint(
    invertAffine(worldTransformMatrix(project, node.id)),
    startDocumentPoint,
  );

  return {
    update(documentPoint) {
      const currentParentPoint = parentLocalPoint(
        project,
        node,
        documentPoint,
      );
      const next = structuredClone(initialTransform);
      if (tool === "translate") {
        next.position.x += currentParentPoint.x - startParentPoint.x;
        next.position.y += currentParentPoint.y - startParentPoint.y;
      } else if (tool === "rotate") {
        const angle = Math.atan2(
          currentParentPoint.y - pivotParent.y,
          currentParentPoint.x - pivotParent.x,
        );
        next.rotation += angle - startAngle;
      } else if (tool === "scale") {
        const distance = Math.max(
          MIN_SCALE,
          Math.hypot(
            currentParentPoint.x - pivotParent.x,
            currentParentPoint.y - pivotParent.y,
          ),
        );
        const factor = distance / startDistance;
        next.scale.x = Math.sign(next.scale.x || 1) *
          Math.max(MIN_SCALE, Math.abs(next.scale.x * factor));
        next.scale.y = Math.sign(next.scale.y || 1) *
          Math.max(MIN_SCALE, Math.abs(next.scale.y * factor));
      } else if (tool === "pivot") {
        const currentNodePoint = transformPoint(
          invertAffine(worldTransformMatrix(project, node.id)),
          documentPoint,
        );
        const pivot = {
          x: initialTransform.pivot.x +
            currentNodePoint.x - startNodePoint.x,
          y: initialTransform.pivot.y +
            currentNodePoint.y - startNodePoint.y,
        };
        return changePivotPreservingLocalMatrix(initialTransform, pivot);
      }
      return next;
    },
  };
}
