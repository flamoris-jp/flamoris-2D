function weightFor(entry, boneId) {
  return entry?.influences?.find((influence) => influence.boneId === boneId)?.weight || 0;
}

export function projectWeightOverlay({ topology, positions, binding, boneId, view }) {
  if (!topology || !binding || !boneId || positions?.length !== topology.vertexIds.length * 2) {
    return { vertices: [] };
  }
  const weights = new Map(binding.vertexWeights.map((entry) => [entry.vertexId, entry]));
  return {
    vertices: topology.vertexIds.map((vertexId, index) => {
      const weight = weightFor(weights.get(vertexId), boneId);
      return {
        vertexId,
        weight,
        point: {
          x: view.originX + positions[index * 2] * view.scale,
          y: view.originY + positions[index * 2 + 1] * view.scale,
        },
        color: `rgba(${Math.round(255 * weight)},${Math.round(160 * (1 - weight))},${Math.round(255 * (1 - weight))},0.9)`,
      };
    }),
  };
}
