import { sampleTemporalProgram } from "./temporal.js";
import { worldTransformMatrix } from "./transforms.js";
import {
  keyArtMemberFor,
  semanticMappingFor,
} from "../model/transition-validation.js";
import { clippingBindingForTarget } from "../model/clipping-validation.js";
import { resolveEvaluatedClipping } from "./clipping-evaluator.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function lerpArray(left, right, amount) {
  if (left.length !== right.length) throw new Error("Cannot interpolate arrays with different lengths.");
  return left.map((value, index) => lerp(value, right[index], amount));
}

function entity(project, collection, id, label) {
  const result = (project[collection] || []).find((entry) => entry.id === id);
  if (!result) throw new Error("Unknown " + label + " " + id + ".");
  return result;
}

function memberState(project, keyArt, mapping) {
  if (!mapping) return null;
  const node = project.scene.nodes[mapping.nodeId];
  const member = keyArtMemberFor(keyArt, mapping.nodeId);
  if (!node || !member) return null;
  return { node, member, worldTransform: worldTransformMatrix(project, node.id) };
}

function fallbackMesh(node) {
  const bounds = node.bounds || { left: 0, top: 0, right: 1, bottom: 1 };
  return {
    positions: [
      bounds.left, bounds.top,
      bounds.right, bounds.top,
      bounds.right, bounds.bottom,
      bounds.left, bounds.bottom,
    ],
    indices: [0, 1, 2, 0, 2, 3],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  };
}

function keyformMesh(project, keyformId, fallbackNode) {
  if (!keyformId) return fallbackMesh(fallbackNode);
  const keyform = entity(project, "meshKeyforms", keyformId, "MeshKeyform");
  const topology = entity(project, "meshTopologies", keyform.topologyId, "MeshTopology");
  return {
    positions: [...keyform.positions],
    indices: [...topology.indices],
    uvs: [...keyform.uvs],
  };
}

function normalizedWeights(weights) {
  if (!weights || typeof weights !== "object") return [];
  const entries = Object.entries(weights)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .sort(([left], [right]) => compareText(left, right));
  const sum = entries.reduce((total, [, weight]) => total + weight, 0);
  if (!(sum > 0)) return [];
  return entries.map(([appearanceId, weight]) => ({ appearanceId, weight: weight / sum }));
}

function appearanceSamples(weights, from, to, fromMesh, toMesh) {
  return normalizedWeights(weights).map(({ appearanceId, weight }) => {
    const endpoint = appearanceId === from?.member.appearanceId
      ? { state: from, mesh: fromMesh }
      : appearanceId === to?.member.appearanceId
        ? { state: to, mesh: toMesh }
        : null;
    return {
      appearanceId,
      sourceNodeId: endpoint?.state.node.id ?? null,
      uvs: endpoint ? [...endpoint.mesh.uvs] : [],
      weight,
    };
  });
}

function sampledValue(sample, kind, channel, semanticSlotId, nodeId = null) {
  const candidates = sample.tracks
    .filter((track) => track.kind === kind && track.values[channel] !== null)
    .map((track) => {
      let priority = 0;
      if (track.target.semanticSlotId === semanticSlotId) priority = 3;
      else if (nodeId && track.target.nodeId === nodeId) priority = 2;
      else if (track.target.transitionDefault === true) priority = 1;
      return { track, priority };
    })
    .filter((entry) => entry.priority > 0)
    .sort((left, right) => right.priority - left.priority || compareText(left.track.trackId, right.track.trackId));
  return candidates[0]?.track.values[channel] ?? null;
}

function endpointWeights(from, to, amount) {
  const result = {};
  if (from) result[from.member.appearanceId] = 1 - amount;
  if (to) result[to.member.appearanceId] = (result[to.member.appearanceId] || 0) + amount;
  return result;
}

function endpointPresence(from, to, amount) {
  const state = amount < 0.5 ? from : to;
  return state?.member.presence || "absent";
}

function endpointDrawOrder(from, to, amount) {
  const state = amount < 0.5 ? from : to;
  return state?.member.drawOrder ?? 0;
}

function bindingClipping(project, targetNodeId) {
  const binding = targetNodeId
    ? clippingBindingForTarget(project, targetNodeId)
    : null;
  if (!binding || !binding.enabled) return null;
  return { sourceNodeId: binding.sourceNodeId, mode: binding.mode };
}

function endpointStateClipping(project, state) {
  const binding = state ? clippingBindingForTarget(project, state.node.id) : null;
  if (binding && !binding.enabled) return { sourceNodeId: null, mode: binding.mode };
  if (state?.member.clipping?.sourceNodeId) {
    return { sourceNodeId: state.member.clipping.sourceNodeId, mode: binding?.mode || "inside" };
  }
  return bindingClipping(project, state?.node.id) || { sourceNodeId: null, mode: "inside" };
}

function endpointClipping(project, from, to, amount) {
  const state = amount < 0.5 ? from : to;
  return endpointStateClipping(project, state);
}

function sampledClipping(project, sample, semanticSlotId, state) {
  const binding = state
    ? clippingBindingForTarget(project, state.node.id)
    : null;
  if (binding && !binding.enabled) {
    return { sourceNodeId: null, mode: binding.mode };
  }
  const sampled = sampledValue(
    sample,
    "ClippingTrack",
    "clipping",
    semanticSlotId,
    state?.node.id,
  );
  if (sampled !== null) {
    return { sourceNodeId: sampled.sourceNodeId, mode: binding?.mode || "inside" };
  }
  return endpointStateClipping(project, state);
}

function endpointOpacity(from, to, amount) {
  return lerp(from?.member.opacity ?? 0, to?.member.opacity ?? 0, amount);
}

function decomposeAffine(matrix) {
  const scaleX = Math.hypot(matrix[0], matrix[1]);
  if (!(scaleX > 1e-12)) throw new Error("Cannot interpolate a singular affine transform.");
  return {
    rotation: Math.atan2(matrix[1], matrix[0]),
    scaleX,
    scaleY: (matrix[0] * matrix[3] - matrix[1] * matrix[2]) / scaleX,
    shear: (matrix[0] * matrix[2] + matrix[1] * matrix[3]) / scaleX,
    translateX: matrix[4],
    translateY: matrix[5],
  };
}

function interpolateAngle(from, to, amount) {
  const turn = Math.PI * 2;
  const delta = ((to - from + Math.PI) % turn + turn) % turn - Math.PI;
  return from + delta * amount;
}

function endpointTransform(from, to, amount) {
  if (!from) return [...to.worldTransform];
  if (!to) return [...from.worldTransform];
  const left = decomposeAffine(from.worldTransform);
  const right = decomposeAffine(to.worldTransform);
  const rotation = interpolateAngle(left.rotation, right.rotation, amount);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const scaleX = lerp(left.scaleX, right.scaleX, amount);
  const scaleY = lerp(left.scaleY, right.scaleY, amount);
  const shear = lerp(left.shear, right.shear, amount);
  return [
    cosine * scaleX,
    sine * scaleX,
    cosine * shear - sine * scaleY,
    sine * shear + cosine * scaleY,
    lerp(left.translateX, right.translateX, amount),
    lerp(left.translateY, right.translateY, amount),
  ];
}

function instance({
  id,
  source,
  mesh,
  appearance,
  opacity,
  drawOrder,
  clipping,
  transform,
  compositeGroupId = null,
  compositeWeight = null,
}) {
  return {
    renderInstanceId: id,
    sourceNodeId: source?.node.id ?? null,
    transform: [...transform],
    mesh: {
      positions: [...mesh.positions],
      indices: [...mesh.indices],
    },
    appearanceSamples: appearance,
    opacity,
    drawOrder,
    clipping: structuredClone(clipping),
    ...(compositeGroupId ? { compositeGroupId, compositeWeight } : {}),
  };
}

function endpointPartState(project, transition, part, slot, endpoint, fromKeyArt, toKeyArt) {
  const keyArt = endpoint === "from" ? fromKeyArt : toKeyArt;
  const mapping = semanticMappingFor(slot, keyArt.id);
  const state = memberState(project, keyArt, mapping);
  const presence = state?.member.presence || "absent";
  if (!state || presence !== "present") {
    return { semanticSlotId: slot.id, presence, renderInstances: [] };
  }
  const keyformId = endpoint === "from" ? part?.fromKeyformId : part?.toKeyformId;
  const mesh = keyformMesh(project, keyformId, state.node);
  return {
    semanticSlotId: slot.id,
    presence,
    renderInstances: [instance({
      id: transition.id + ":" + slot.id + ":" + endpoint,
      source: state,
      mesh,
      appearance: appearanceSamples(
        { [state.member.appearanceId]: 1 },
        endpoint === "from" ? state : null,
        endpoint === "to" ? state : null,
        mesh,
        mesh,
      ),
      opacity: state.member.opacity,
      drawOrder: state.member.drawOrder,
      clipping: endpointStateClipping(project, state),
      transform: state.worldTransform,
    })],
  };
}

function evaluateMorph(project, transition, part, slot, from, to, fromMesh, toMesh, sample, u) {
  const geometryWeight = clamp(sampledValue(sample, "GeometryBlendTrack", "geometryWeight", slot.id) ?? u, 0, 1);
  const appearanceWeights = sampledValue(sample, "AppearanceTrack", "appearance", slot.id) ||
    endpointWeights(from, to, u);
  const opacity = clamp(sampledValue(sample, "OpacityTrack", "opacity", slot.id) ?? endpointOpacity(from, to, u), 0, 1);
  const presence = sampledValue(sample, "PresenceTrack", "presence", slot.id) ?? endpointPresence(from, to, u);
  const drawOrder = sampledValue(sample, "DrawOrderTrack", "drawOrder", slot.id) ?? endpointDrawOrder(from, to, u);
  const clippingSample = sampledValue(sample, "ClippingTrack", "clipping", slot.id);
  const clipping = clippingSample !== null
    ? { sourceNodeId: clippingSample.sourceNodeId, mode: "inside" }
    : endpointClipping(project, from, to, u);
  if (presence !== "present") return { semanticSlotId: slot.id, presence, renderInstances: [] };
  const topology = entity(project, "meshTopologies", part.topologyId, "MeshTopology");
  const mesh = {
    positions: lerpArray(fromMesh.positions, toMesh.positions, geometryWeight),
    indices: [...topology.indices],
  };
  return {
    semanticSlotId: slot.id,
    presence,
    renderInstances: [instance({
      id: transition.id + ":" + slot.id + ":morph",
      source: geometryWeight < 1 ? from : to,
      mesh,
      appearance: appearanceSamples(appearanceWeights, from, to, fromMesh, toMesh),
      opacity,
      drawOrder,
      clipping,
      transform: endpointTransform(from, to, geometryWeight),
    })],
  };
}

function sourceInstance(project, transition, part, slot, endpoint, state, mesh, weight, sample, compositeGroupId = null) {
  const opacityValue = sampledValue(sample, "OpacityTrack", "opacity", slot.id, state.node.id);
  const sourceWeight = compositeGroupId ? 1 : weight;
  const opacity = clamp(state.member.opacity * sourceWeight * (opacityValue ?? 1), 0, 1);
  const drawOrder = sampledValue(sample, "DrawOrderTrack", "drawOrder", slot.id, state.node.id) ?? state.member.drawOrder;
  const clipping = sampledClipping(project, sample, slot.id, state);
  return instance({
    id: transition.id + ":" + slot.id + ":" + endpoint,
    source: state,
    mesh,
    appearance: appearanceSamples({ [state.member.appearanceId]: 1 }, endpoint === "from" ? state : null, endpoint === "to" ? state : null, mesh, mesh),
    opacity,
    drawOrder,
    clipping,
    transform: state.worldTransform,
    compositeGroupId,
    compositeWeight: compositeGroupId ? weight : null,
  });
}

function evaluateReplace(project, transition, part, slot, from, to, fromMesh, toMesh, sample, u) {
  const authored = sampledValue(sample, "AppearanceTrack", "appearance", slot.id);
  const weights = normalizedWeights(authored || endpointWeights(from, to, u));
  const weightFor = (appearanceId) => weights.find((entry) => entry.appearanceId === appearanceId)?.weight ?? 0;
  const compositeGroupId = part.configuration?.compositeGroupId || null;
  const renderInstances = [];
  const fromWeight = from ? weightFor(from.member.appearanceId) : 0;
  const toWeight = to ? weightFor(to.member.appearanceId) : 0;
  if (from && fromWeight > 0) renderInstances.push(sourceInstance(project, transition, part, slot, "from", from, fromMesh, fromWeight, sample, compositeGroupId));
  if (to && toWeight > 0) renderInstances.push(sourceInstance(project, transition, part, slot, "to", to, toMesh, toWeight, sample, compositeGroupId));
  const authoredPresence = sampledValue(sample, "PresenceTrack", "presence", slot.id);
  const presence = authoredPresence ?? (renderInstances.length ? "present" : "absent");
  return { semanticSlotId: slot.id, presence, renderInstances: presence === "present" ? renderInstances : [] };
}

function evaluateSingle(project, transition, part, slot, endpoint, state, mesh, sample, opacity, presence) {
  const authoredPresence = sampledValue(sample, "PresenceTrack", "presence", slot.id, state?.node.id);
  const resolvedPresence = authoredPresence ?? presence;
  if (!state || resolvedPresence !== "present") return { semanticSlotId: slot.id, presence: resolvedPresence, renderInstances: [] };
  const authoredOpacity = sampledValue(sample, "OpacityTrack", "opacity", slot.id, state.node.id);
  const resolvedOpacity = clamp(authoredOpacity ?? opacity, 0, 1);
  const drawOrder = sampledValue(sample, "DrawOrderTrack", "drawOrder", slot.id, state.node.id) ?? state.member.drawOrder;
  const clipping = sampledClipping(project, sample, slot.id, state);
  return {
    semanticSlotId: slot.id,
    presence: resolvedPresence,
    renderInstances: [instance({
      id: transition.id + ":" + slot.id + ":" + part.mode,
      source: state,
      mesh,
      appearance: appearanceSamples({ [state.member.appearanceId]: 1 }, endpoint === "from" ? state : null, endpoint === "to" ? state : null, mesh, mesh),
      opacity: resolvedOpacity,
      drawOrder,
      clipping,
      transform: state.worldTransform,
    })],
  };
}

function triangleArea(positions, a, b, c) {
  const ax = positions[a * 2];
  const ay = positions[a * 2 + 1];
  const bx = positions[b * 2];
  const by = positions[b * 2 + 1];
  const cx = positions[c * 2];
  const cy = positions[c * 2 + 1];
  return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableFingerprint(value) {
  const canonical = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const DIAGNOSTIC_MESSAGES = Object.freeze({
  TRANSITION_MISSING_CORRESPONDENCE: "SemanticSlot correspondence is incomplete for this Transition.",
  TRANSITION_INVALID_MODE_FOR_MAPPING: "PartTransition mode is incompatible with the available endpoint mappings.",
  TRANSITION_TOPOLOGY_INCOMPATIBLE: "Morph endpoints do not share a compatible MeshTopology.",
  TRANSITION_MISSING_KEYFORM: "A required endpoint MeshKeyform is missing.",
  TRANSITION_TRIANGLE_DEGENERATE: "An endpoint mesh triangle has zero area.",
  TRANSITION_TRIANGLE_INVERSION: "A mesh triangle changes winding between endpoints.",
  TRANSITION_GEOMETRY_STRETCH_HIGH: "Mesh geometry stretches substantially between endpoints.",
  TRANSITION_GEOMETRY_COMPRESSION_HIGH: "Mesh geometry compresses substantially between endpoints.",
  TRANSITION_UV_DISTORTION_HIGH: "Per-Key-Art UV geometry changes substantially between endpoints.",
  TRANSITION_TEXTURE_GHOSTING_RISK: "Weighted endpoint appearances may produce visible ghosting.",
  TRANSITION_INTERMEDIATE_KEYART_RECOMMENDED: "An intermediate Key Art may improve this Transition.",
  TRANSITION_DRAW_ORDER_CROSSING: "Endpoint draw order changes across this Transition.",
  TRANSITION_PART_PRESENCE_MISMATCH: "Endpoint presence states differ for this SemanticSlot.",
  TRANSITION_CLIPPING_REFERENCE_INVALID: "A clipping reference does not resolve to a scene node.",
  TRANSITION_CLIPPING_RENDER_UNSUPPORTED: "The evaluator produced clipping state that the current renderer cannot rasterize.",
  TRANSITION_DRAW_ORDER_CONFLICT: "Multiple visible render instances conflict at the same explicit draw order.",
  CLIPPING_SOURCE_MISSING: "The evaluated clipping source node is missing.",
  CLIPPING_SOURCE_NOT_RENDERABLE: "The clipping source cannot be resolved to one evaluated render instance.",
  CLIPPING_CYCLE: "The evaluated clipping relationships contain a cycle.",
});

function diagnostic(transitionId, code, severity, semanticSlotId = null, timeTicks = null, details = {}) {
  const evidenceFingerprint = stableFingerprint({ transitionId, code, semanticSlotId, timeTicks, details });
  return {
    key: [code, transitionId, semanticSlotId || "-", timeTicks ?? "-", evidenceFingerprint].join("|"),
    code,
    severity,
    message: DIAGNOSTIC_MESSAGES[code] || code,
    transitionId,
    ...(semanticSlotId ? { semanticSlotId } : {}),
    ...(timeTicks !== null ? { timeTicks } : {}),
    details,
    evidenceFingerprint,
  };
}

function structuralDiagnostics(project, transition, fromKeyArt, toKeyArt, slots, partBySlot) {
  const diagnostics = [];
  for (const slot of slots) {
    const fromMapping = semanticMappingFor(slot, fromKeyArt.id);
    const toMapping = semanticMappingFor(slot, toKeyArt.id);
    const part = partBySlot.get(slot.id);
    if (!part) {
      diagnostics.push(diagnostic(transition.id, "TRANSITION_MISSING_CORRESPONDENCE", "warning", slot.id, null, {
        fromNodeId: fromMapping?.nodeId ?? null,
        toNodeId: toMapping?.nodeId ?? null,
        reason: "missing-part-transition",
      }));
      continue;
    }
    const needsBoth = ["morph", "replace", "occlusion"].includes(part.mode);
    if (needsBoth && (!fromMapping || !toMapping)) {
      diagnostics.push(diagnostic(transition.id, "TRANSITION_MISSING_CORRESPONDENCE", "error", slot.id, null, {
        fromNodeId: fromMapping?.nodeId ?? null,
        toNodeId: toMapping?.nodeId ?? null,
      }));
      diagnostics.push(diagnostic(transition.id, "TRANSITION_INVALID_MODE_FOR_MAPPING", "error", slot.id, null, { mode: part.mode }));
    }
    if (part.mode === "morph") {
      const topology = (project.meshTopologies || []).find((entry) => entry.id === part.topologyId);
      const fromKeyform = (project.meshKeyforms || []).find((entry) => entry.id === part.fromKeyformId);
      const toKeyform = (project.meshKeyforms || []).find((entry) => entry.id === part.toKeyformId);
      if (!topology || !fromKeyform || !toKeyform || fromKeyform.topologyId !== topology?.id || toKeyform.topologyId !== topology?.id) {
        const referenceDetails = {
          partTransitionId: part.id,
          topologyId: part.topologyId,
          fromKeyformId: part.fromKeyformId,
          toKeyformId: part.toKeyformId,
        };
        diagnostics.push(diagnostic(transition.id, "TRANSITION_TOPOLOGY_INCOMPATIBLE", "error", slot.id, null, referenceDetails));
        if (!fromKeyform || !toKeyform) diagnostics.push(diagnostic(
          transition.id,
          "TRANSITION_MISSING_KEYFORM",
          "error",
          slot.id,
          null,
          {
            ...referenceDetails,
            missingEndpoints: [
              ...(!fromKeyform ? ["from"] : []),
              ...(!toKeyform ? ["to"] : []),
            ],
          },
        ));
      } else {
        let intermediateRecommended = false;
        let ghostingRisk = false;
        for (let offset = 0; offset < topology.indices.length; offset += 3) {
          const [a, b, c] = topology.indices.slice(offset, offset + 3);
          const fromArea = triangleArea(fromKeyform.positions, a, b, c);
          const toArea = triangleArea(toKeyform.positions, a, b, c);
          if (Math.abs(fromArea) < 1e-9 || Math.abs(toArea) < 1e-9) {
            diagnostics.push(diagnostic(transition.id, "TRANSITION_TRIANGLE_DEGENERATE", "error", slot.id, null, { triangleIndex: offset / 3 }));
          } else if (Math.sign(fromArea) !== Math.sign(toArea)) {
            diagnostics.push(diagnostic(transition.id, "TRANSITION_TRIANGLE_INVERSION", "warning", slot.id, null, { triangleIndex: offset / 3 }));
            intermediateRecommended = true;
            ghostingRisk = true;
          } else {
            const ratio = Math.abs(toArea / fromArea);
            if (ratio > 4) {
              diagnostics.push(diagnostic(transition.id, "TRANSITION_GEOMETRY_STRETCH_HIGH", "warning", slot.id, null, { triangleIndex: offset / 3, areaRatio: ratio }));
              intermediateRecommended = true;
            }
            if (ratio < 0.25) {
              diagnostics.push(diagnostic(transition.id, "TRANSITION_GEOMETRY_COMPRESSION_HIGH", "warning", slot.id, null, { triangleIndex: offset / 3, areaRatio: ratio }));
              intermediateRecommended = true;
            }
          }
          const fromUvArea = triangleArea(fromKeyform.uvs, a, b, c);
          const toUvArea = triangleArea(toKeyform.uvs, a, b, c);
          if (Math.abs(fromUvArea) > 1e-12 && Math.abs(toUvArea) > 1e-12) {
            const uvRatio = Math.abs(toUvArea / fromUvArea);
            if (uvRatio > 4 || uvRatio < 0.25 || Math.sign(fromUvArea) !== Math.sign(toUvArea)) {
              diagnostics.push(diagnostic(transition.id, "TRANSITION_UV_DISTORTION_HIGH", "warning", slot.id, null, { triangleIndex: offset / 3, areaRatio: uvRatio }));
              intermediateRecommended = true;
              ghostingRisk = true;
            }
          }
        }
        if (ghostingRisk && fromMapping && toMapping) {
          diagnostics.push(diagnostic(transition.id, "TRANSITION_TEXTURE_GHOSTING_RISK", "warning", slot.id));
        }
        if (intermediateRecommended) {
          diagnostics.push(diagnostic(transition.id, "TRANSITION_INTERMEDIATE_KEYART_RECOMMENDED", "info", slot.id));
        }
      }
    }
    const fromState = memberState(project, fromKeyArt, fromMapping);
    const toState = memberState(project, toKeyArt, toMapping);
    if (fromState && toState && fromState.member.drawOrder !== toState.member.drawOrder) {
      diagnostics.push(diagnostic(transition.id, "TRANSITION_DRAW_ORDER_CROSSING", "info", slot.id, null, {
        fromDrawOrder: fromState.member.drawOrder,
        toDrawOrder: toState.member.drawOrder,
      }));
    }
    if (fromState && toState && fromState.member.presence !== toState.member.presence) {
      diagnostics.push(diagnostic(transition.id, "TRANSITION_PART_PRESENCE_MISMATCH", "info", slot.id, null, {
        fromPresence: fromState.member.presence,
        toPresence: toState.member.presence,
      }));
    }
    const clippingNodeIds = [
      fromState?.member.clipping?.sourceNodeId,
      toState?.member.clipping?.sourceNodeId,
    ].filter(Boolean);
    for (const sourceNodeId of clippingNodeIds) {
      if (!project.scene.nodes[sourceNodeId]) {
        diagnostics.push(diagnostic(transition.id, "TRANSITION_CLIPPING_REFERENCE_INVALID", "error", slot.id, null, { sourceNodeId }));
      }
    }
    if (clippingNodeIds.length) {
      diagnostics.push(diagnostic(transition.id, "TRANSITION_CLIPPING_RENDER_UNSUPPORTED", "warning", slot.id));
    }
  }
  return diagnostics;
}

function drawOrderDiagnostics(transition, evaluatedParts, timeTicks) {
  const groups = new Map();
  for (const part of evaluatedParts) {
    for (const renderInstance of part.renderInstances) {
      const values = groups.get(renderInstance.drawOrder) || [];
      values.push({
        semanticSlotId: part.semanticSlotId,
        renderInstanceId: renderInstance.renderInstanceId,
        compositeGroupId: renderInstance.compositeGroupId || null,
      });
      groups.set(renderInstance.drawOrder, values);
    }
  }
  return [...groups.entries()]
    .filter(([, entries]) => {
      if (entries.length < 2) return false;
      const groupIds = new Set(entries.map((entry) => entry.compositeGroupId));
      return groupIds.size !== 1 || groupIds.has(null);
    })
    .map(([drawOrder, entries]) => diagnostic(
      transition.id,
      "TRANSITION_DRAW_ORDER_CONFLICT",
      "error",
      null,
      timeTicks,
      { drawOrder, renderInstanceIds: entries.map((entry) => entry.renderInstanceId).sort() },
    ));
}

function attachAcknowledgements(transition, diagnostics) {
  const overrides = new Map((transition.diagnosticOverrides || []).map((entry) => [entry.key, entry]));
  return diagnostics.map((entry) => {
    const override = overrides.get(entry.key);
    return {
      ...entry,
      acknowledged: Boolean(override && override.evidenceFingerprint === entry.evidenceFingerprint),
    };
  });
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.semanticSlotId || "", right.semanticSlotId || "") ||
    (left.timeTicks ?? -1) - (right.timeTicks ?? -1) ||
    compareText(left.key, right.key));
}

function relevantSlots(project, transition) {
  return [...(project.semanticSlots || [])]
    .filter((slot) =>
      semanticMappingFor(slot, transition.fromKeyArtId) ||
      semanticMappingFor(slot, transition.toKeyArtId) ||
      transition.partTransitions.some((part) => part.semanticSlotId === slot.id))
    .sort((left, right) => compareText(left.id, right.id));
}

function compositeGroups(evaluatedParts) {
  const groups = new Map();
  for (const part of evaluatedParts) {
    for (const renderInstance of part.renderInstances) {
      if (!renderInstance.compositeGroupId) continue;
      const group = groups.get(renderInstance.compositeGroupId) || {
        compositeGroupId: renderInstance.compositeGroupId,
        mode: "weighted-premultiplied",
        members: [],
      };
      group.members.push({
        renderInstanceId: renderInstance.renderInstanceId,
        weight: renderInstance.compositeWeight,
      });
      groups.set(group.compositeGroupId, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, members: group.members.sort((a, b) => compareText(a.renderInstanceId, b.renderInstanceId)) }))
    .sort((a, b) => compareText(a.compositeGroupId, b.compositeGroupId));
}

export function getTransitionDiagnostics(project, transitionId) {
  const transition = entity(project, "transitions", transitionId, "Transition");
  const fromKeyArt = entity(project, "keyArts", transition.fromKeyArtId, "KeyArt");
  const toKeyArt = entity(project, "keyArts", transition.toKeyArtId, "KeyArt");
  const slots = relevantSlots(project, transition);
  const partBySlot = new Map(transition.partTransitions.map((part) => [part.semanticSlotId, part]));
  return sortDiagnostics(attachAcknowledgements(
    transition,
    structuralDiagnostics(project, transition, fromKeyArt, toKeyArt, slots, partBySlot),
  ));
}

export function evaluateTransition(project, transitionId, timeTicks) {
  if (!Number.isSafeInteger(timeTicks)) throw new RangeError("Transition timeTicks must be a safe integer.");
  const transition = entity(project, "transitions", transitionId, "Transition");
  const program = entity(project, "temporalPrograms", transition.temporalProgramId, "TemporalProgram");
  const clampedTicks = clamp(timeTicks, 0, program.durationTicks);
  const normalizedTime = clampedTicks / program.durationTicks;
  const fromKeyArt = entity(project, "keyArts", transition.fromKeyArtId, "KeyArt");
  const toKeyArt = entity(project, "keyArts", transition.toKeyArtId, "KeyArt");
  const sample = sampleTemporalProgram(program, clampedTicks);
  const slots = relevantSlots(project, transition);
  const partBySlot = new Map(transition.partTransitions.map((part) => [part.semanticSlotId, part]));
  const evaluatedParts = [];
  for (const slot of slots) {
    const part = partBySlot.get(slot.id) || null;
    if (clampedTicks === 0) {
      evaluatedParts.push(endpointPartState(project, transition, part, slot, "from", fromKeyArt, toKeyArt));
      continue;
    }
    if (clampedTicks === program.durationTicks) {
      evaluatedParts.push(endpointPartState(project, transition, part, slot, "to", fromKeyArt, toKeyArt));
      continue;
    }
    if (!part) {
      evaluatedParts.push({ semanticSlotId: slot.id, presence: "absent", renderInstances: [] });
      continue;
    }
    const fromMapping = semanticMappingFor(slot, fromKeyArt.id);
    const toMapping = semanticMappingFor(slot, toKeyArt.id);
    const from = memberState(project, fromKeyArt, fromMapping);
    const to = memberState(project, toKeyArt, toMapping);
    const fromMesh = from ? keyformMesh(project, part.fromKeyformId, from.node) : null;
    const toMesh = to ? keyformMesh(project, part.toKeyformId, to.node) : null;
    if (part.mode === "morph") evaluatedParts.push(evaluateMorph(project, transition, part, slot, from, to, fromMesh, toMesh, sample, normalizedTime));
    else if (part.mode === "replace") evaluatedParts.push(evaluateReplace(project, transition, part, slot, from, to, fromMesh, toMesh, sample, normalizedTime));
    else if (part.mode === "hold") {
      const holdTo = part.configuration?.holdEndpoint === "to";
      const state = holdTo ? to : from || to;
      const mesh = holdTo ? toMesh : fromMesh || toMesh;
      evaluatedParts.push(evaluateSingle(project, transition, part, slot, holdTo ? "to" : "from", state, mesh, sample, state?.member.opacity ?? 0, state?.member.presence ?? "absent"));
    } else if (part.mode === "appear") {
      evaluatedParts.push(evaluateSingle(project, transition, part, slot, "to", to, toMesh, sample, (to?.member.opacity ?? 0) * normalizedTime, "present"));
    } else if (part.mode === "disappear") {
      evaluatedParts.push(evaluateSingle(project, transition, part, slot, "from", from, fromMesh, sample, (from?.member.opacity ?? 0) * (1 - normalizedTime), "present"));
    } else if (part.mode === "occlusion") {
      const defaultPresence = normalizedTime < 0.5 ? from?.member.presence ?? "present" : "occluded";
      evaluatedParts.push(evaluateSingle(project, transition, part, slot, "from", from, fromMesh, sample, from?.member.opacity ?? 0, defaultPresence));
    }
  }
  const orderedParts = evaluatedParts.sort((left, right) => compareText(left.semanticSlotId, right.semanticSlotId));
  const clipping = resolveEvaluatedClipping(project, orderedParts);
  const diagnostics = sortDiagnostics(attachAcknowledgements(transition, [
    ...structuralDiagnostics(project, transition, fromKeyArt, toKeyArt, slots, partBySlot),
    ...drawOrderDiagnostics(transition, clipping.evaluatedParts, clampedTicks),
    ...clipping.diagnostics.map((entry) => diagnostic(
      transition.id,
      entry.code,
      entry.severity,
      entry.semanticSlotId,
      clampedTicks,
      {
        renderInstanceId: entry.renderInstanceId,
        targetNodeId: entry.targetNodeId,
        sourceNodeId: entry.sourceNodeId,
        ...entry.details,
      },
    )),
  ]));
  return {
    transitionId: transition.id,
    timeTicks: clampedTicks,
    normalizedTime,
    evaluatedParts: clipping.evaluatedParts,
    compositeGroups: compositeGroups(clipping.evaluatedParts),
    diagnostics,
  };
}
