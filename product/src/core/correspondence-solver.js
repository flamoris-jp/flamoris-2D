const DISTANCE_EPSILON = 1e-9;

export const CORRESPONDENCE_SOLVER_PRESETS = Object.freeze({
  soft: Object.freeze({ falloffPower: 1 }),
  normal: Object.freeze({ falloffPower: 2 }),
  firm: Object.freeze({ falloffPower: 4 }),
});

function diagnostic(code, message, details = {}) {
  return { code, message, details };
}

function finitePositions(value) {
  return Array.isArray(value) && value.every(Number.isFinite);
}

function normalizeSettings(settings = {}) {
  const preset = Object.hasOwn(CORRESPONDENCE_SOLVER_PRESETS, settings.preset)
    ? settings.preset
    : "normal";
  const requestedPower = settings.falloffPower;
  return {
    preset,
    falloffPower: Number.isFinite(requestedPower) && requestedPower > 0
      ? Math.min(8, Math.max(0.25, requestedPower))
      : CORRESPONDENCE_SOLVER_PRESETS[preset].falloffPower,
  };
}

function pinTarget(pin) {
  return pin?.target || pin?.targetAnchor || null;
}

/**
 * Pure deterministic Stable-Vertex-ID correspondence solve.
 *
 * The current target positions participate in compatibility validation only.
 * The candidate baseline is always the source keyform, so Solve is a
 * reproducible initialization operation rather than an incremental deform.
 */
export function solveCorrespondence({
  topology,
  sourceKeyform,
  targetKeyform,
  pins = [],
  settings = {},
} = {}) {
  const normalizedSettings = normalizeSettings(settings);
  const fail = (...diagnostics) => ({
    candidatePositions: null,
    diagnostics,
    settings: normalizedSettings,
  });

  if (!sourceKeyform) return fail(diagnostic(
    "CORRESPONDENCE_MISSING_SOURCE_KEYFORM",
    "A source MeshKeyform is required.",
  ));
  if (!targetKeyform) return fail(diagnostic(
    "CORRESPONDENCE_MISSING_TARGET_KEYFORM",
    "A target MeshKeyform is required.",
  ));
  if (!topology || sourceKeyform.topologyId !== topology.id ||
    targetKeyform.topologyId !== topology.id ||
    sourceKeyform.topologyId !== targetKeyform.topologyId) {
    return fail(diagnostic(
      "CORRESPONDENCE_TOPOLOGY_MISMATCH",
      "Source and target MeshKeyforms must share the selected MeshTopology.",
      {
        topologyId: topology?.id || null,
        sourceTopologyId: sourceKeyform.topologyId || null,
        targetTopologyId: targetKeyform.topologyId || null,
      },
    ));
  }

  const vertexIds = Array.isArray(topology.vertexIds) ? topology.vertexIds : [];
  const expectedCount = vertexIds.length * 2;
  if (!finitePositions(sourceKeyform.positions) ||
    sourceKeyform.positions.length !== expectedCount ||
    !finitePositions(targetKeyform.positions) ||
    targetKeyform.positions.length !== expectedCount) {
    return fail(diagnostic(
      "CORRESPONDENCE_POSITION_COUNT_MISMATCH",
      "Source and target positions must contain two finite values per topology vertex.",
      {
        expectedCount,
        sourceCount: sourceKeyform.positions?.length ?? null,
        targetCount: targetKeyform.positions?.length ?? null,
      },
    ));
  }
  if (!Array.isArray(pins) || pins.length === 0) return fail(diagnostic(
    "CORRESPONDENCE_NO_PINS",
    "Add at least one correspondence pin before solving.",
  ));

  const vertexIndex = new Map(vertexIds.map((vertexId, index) => [vertexId, index]));
  const seen = new Set();
  const resolvedPins = [];
  for (const pin of pins) {
    if (!vertexIndex.has(pin?.vertexId)) return fail(diagnostic(
      "CORRESPONDENCE_UNKNOWN_VERTEX_ID",
      `Correspondence pin references unknown stable vertex ID ${pin?.vertexId || "(missing)"}.`,
      { vertexId: pin?.vertexId || null },
    ));
    if (seen.has(pin.vertexId)) return fail(diagnostic(
      "CORRESPONDENCE_DUPLICATE_PIN",
      `Stable vertex ${pin.vertexId} has more than one correspondence pin.`,
      { vertexId: pin.vertexId },
    ));
    const target = pinTarget(pin);
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      return fail(diagnostic(
        "CORRESPONDENCE_INVALID_TARGET_ANCHOR",
        `Correspondence pin ${pin.vertexId} requires a finite target anchor.`,
        { vertexId: pin.vertexId },
      ));
    }
    seen.add(pin.vertexId);
    const index = vertexIndex.get(pin.vertexId);
    const source = {
      x: sourceKeyform.positions[index * 2],
      y: sourceKeyform.positions[index * 2 + 1],
    };
    resolvedPins.push({
      vertexId: pin.vertexId,
      index,
      source,
      target: { x: target.x, y: target.y },
      displacement: { x: target.x - source.x, y: target.y - source.y },
    });
  }
  resolvedPins.sort((a, b) => a.index - b.index);

  for (let left = 0; left < resolvedPins.length; left += 1) {
    for (let right = left + 1; right < resolvedPins.length; right += 1) {
      const a = resolvedPins[left].source;
      const b = resolvedPins[right].source;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= DISTANCE_EPSILON) {
        return fail(diagnostic(
          "CORRESPONDENCE_POORLY_CONDITIONED",
          "Two pinned stable vertices occupy the same source position.",
          { vertexIds: [resolvedPins[left].vertexId, resolvedPins[right].vertexId] },
        ));
      }
    }
  }

  const candidatePositions = [...sourceKeyform.positions];
  if (resolvedPins.length === 1) {
    const displacement = resolvedPins[0].displacement;
    for (let index = 0; index < vertexIds.length; index += 1) {
      candidatePositions[index * 2] += displacement.x;
      candidatePositions[index * 2 + 1] += displacement.y;
    }
  } else {
    for (let index = 0; index < vertexIds.length; index += 1) {
      if (seen.has(vertexIds[index])) continue;
      const x = sourceKeyform.positions[index * 2];
      const y = sourceKeyform.positions[index * 2 + 1];
      let weightTotal = 0;
      let dx = 0;
      let dy = 0;
      for (const pin of resolvedPins) {
        const distance = Math.max(DISTANCE_EPSILON,
          Math.hypot(x - pin.source.x, y - pin.source.y));
        const weight = 1 / (distance ** normalizedSettings.falloffPower);
        weightTotal += weight;
        dx += weight * pin.displacement.x;
        dy += weight * pin.displacement.y;
      }
      candidatePositions[index * 2] = x + dx / weightTotal;
      candidatePositions[index * 2 + 1] = y + dy / weightTotal;
    }
  }

  // Exact constraints are assigned after propagation; no floating-point
  // weighted approximation is allowed to move a pinned vertex off its anchor.
  for (const pin of resolvedPins) {
    candidatePositions[pin.index * 2] = pin.target.x;
    candidatePositions[pin.index * 2 + 1] = pin.target.y;
  }
  if (candidatePositions.length !== expectedCount) return fail(diagnostic(
    "CORRESPONDENCE_CANDIDATE_COUNT_MISMATCH",
    "The solver produced an incompatible target position count.",
  ));
  if (!candidatePositions.every(Number.isFinite)) return fail(diagnostic(
    "CORRESPONDENCE_NON_FINITE_RESULT",
    "The correspondence solve produced a non-finite position.",
  ));
  return {
    candidatePositions,
    diagnostics: [],
    settings: normalizedSettings,
  };
}
