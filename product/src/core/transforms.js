export function multiplyAffine(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function localTransformMatrix(transform) {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  const { x: pivotX, y: pivotY } = transform.pivot;
  const a = cosine * transform.scale.x;
  const b = sine * transform.scale.x;
  const c = -sine * transform.scale.y;
  const d = cosine * transform.scale.y;
  return [
    a,
    b,
    c,
    d,
    transform.position.x + pivotX - a * pivotX - c * pivotY,
    transform.position.y + pivotY - b * pivotX - d * pivotY,
  ];
}

export function worldTransformMatrix(project, nodeId) {
  const node = project.scene.nodes[nodeId];
  if (!node) throw new Error("Unknown node " + nodeId + ".");
  const local = localTransformMatrix(node.transform);
  return node.parentId
    ? multiplyAffine(worldTransformMatrix(project, node.parentId), local)
    : local;
}

export function transformPoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}
