import { projectClipInstanceTick } from "./clip-time.js";
import { sampleTemporalProgram } from "./temporal.js";
import { canonicalizeClipInstances } from "../model/clip-instance.js";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  const canonical = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const DIAGNOSTIC_MESSAGES = Object.freeze({
  ANIMATION_CLIP_TARGET_INCOMPATIBLE:
    "Clip target does not remain the same compatible mapped source across the placement.",
  ANIMATION_TRACK_CONFLICT:
    "Same-layer discrete animation contributions contain incompatible values.",
  ANIMATION_TOPOLOGY_INCOMPATIBLE:
    "Mesh animation does not match the active evaluated topology.",
  ANIMATION_DISCRETE_WEIGHT_INVALID:
    "An active discrete animation contribution requires ClipInstance weight 1.",
  ANIMATION_TRACK_TARGET_INVALID:
    "Animation track target cannot be resolved in the active Sequence state.",
});

function diagnostic(sequenceId, code, details) {
  const evidenceFingerprint = fingerprint({ sequenceId, code, details });
  return {
    key: [code, sequenceId, evidenceFingerprint].join("|"),
    code,
    severity: "error",
    message: DIAGNOSTIC_MESSAGES[code] || code,
    sequenceId,
    details: canonicalize(details),
    evidenceFingerprint,
  };
}

export function sortSequenceDiagnostics(diagnostics) {
  const unique = new Map(diagnostics.map((entry) => [entry.key, entry]));
  return [...unique.values()].sort((left, right) =>
    compareText(left.code, right.code) || compareText(left.key || "", right.key || ""));
}

function programFor(project, programId) {
  const program = project.temporalPrograms.find((entry) => entry.id === programId);
  if (!program) throw new Error("Unknown TemporalProgram " + programId + ".");
  return program;
}

export function resolveActiveClipSamples(project, sequence, sequenceTick) {
  const clipById = new Map(project.animation.clips.map((clip) => [clip.id, clip]));
  return canonicalizeClipInstances(sequence.clipInstances).map((instance) => {
    const clip = clipById.get(instance.clipId);
    if (!clip) throw new Error("Unknown AnimationClip " + instance.clipId + ".");
    const program = programFor(project, clip.temporalProgramId);
    const projection = projectClipInstanceTick(instance, sequenceTick, program.durationTicks);
    return {
      instance,
      clip,
      program,
      projection,
      sample: projection.active
        ? sampleTemporalProgram(program, projection.localTick)
        : null,
    };
  }).filter((entry) => entry.projection.active)
    .sort((left, right) =>
      left.instance.layer - right.instance.layer ||
      compareText(left.instance.id, right.instance.id));
}

function targetStableId(target) {
  return target.nodeId || target.semanticSlotId || target.boneId ||
    (target.deformerId && target.controlPointId
      ? target.deformerId + ":" + target.controlPointId
      : null) || target.meshId || target.cameraId || "";
}

function compareContribution(left, right) {
  return left.layer - right.layer ||
    compareText(left.clipInstanceId, right.clipInstanceId) ||
    compareText(left.trackId, right.trackId) ||
    compareText(left.channel, right.channel) ||
    compareText(left.targetStableId, right.targetStableId);
}

export function collectClipContributions(activeSamples) {
  const result = [];
  for (const active of activeSamples) {
    if (!(active.instance.weight > 0)) continue;
    for (const track of active.sample.tracks) {
      for (const [channel, value] of Object.entries(track.values)) {
        if (value === null) continue;
        result.push({
          kind: track.kind,
          channel,
          target: structuredClone(track.target),
          targetStableId: targetStableId(track.target),
          value: structuredClone(value),
          weight: active.instance.weight,
          layer: active.instance.layer,
          clipInstanceId: active.instance.id,
          clipId: active.clip.id,
          programId: active.program.id,
          trackId: track.trackId,
        });
      }
    }
  }
  return result.sort(compareContribution);
}

function semanticNodeIds(activeSemanticNodes, semanticSlotId) {
  return [...(activeSemanticNodes.get(semanticSlotId) || [])].sort(compareText);
}

function targetNodeIds(contribution, activeSemanticNodes) {
  if (contribution.target.nodeId) return [contribution.target.nodeId];
  if (contribution.target.semanticSlotId) {
    return semanticNodeIds(activeSemanticNodes, contribution.target.semanticSlotId);
  }
  return [];
}

function add(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function multiply(map, key, value) {
  map.set(key, (map.get(key) ?? 1) * value);
}

function contributionIdentity(entry) {
  return {
    clipInstanceId: entry.clipInstanceId,
    trackId: entry.trackId,
    value: canonicalize(entry.value),
  };
}

function discreteOverrides(sequenceId, contributions, activeSemanticNodes, diagnostics) {
  const candidates = new Map();
  for (const entry of contributions.filter((candidate) =>
    ["PresenceTrack", "DrawOrderTrack", "ClippingTrack"].includes(candidate.kind))) {
    if (entry.weight !== 1) {
      diagnostics.push(diagnostic(sequenceId, "ANIMATION_DISCRETE_WEIGHT_INVALID", {
        clipInstanceId: entry.clipInstanceId,
        trackId: entry.trackId,
        kind: entry.kind,
        channel: entry.channel,
        weight: entry.weight,
      }));
      continue;
    }
    const nodes = targetNodeIds(entry, activeSemanticNodes);
    if (!nodes.length) continue;
    for (const nodeId of nodes) {
      const key = [entry.kind, entry.channel, nodeId].join("\0");
      const list = candidates.get(key) || [];
      list.push({ ...entry, nodeId });
      candidates.set(key, list);
    }
  }
  const overrides = new Map();
  for (const [key, entries] of [...candidates.entries()].sort(([left], [right]) =>
    compareText(left, right))) {
    const highestLayer = Math.max(...entries.map((entry) => entry.layer));
    const highest = entries.filter((entry) => entry.layer === highestLayer)
      .sort(compareContribution);
    const canonicalValues = new Set(highest.map((entry) =>
      JSON.stringify(canonicalize(entry.value))));
    if (canonicalValues.size > 1) {
      const [kind, channel, nodeId] = key.split("\0");
      diagnostics.push(diagnostic(sequenceId, "ANIMATION_TRACK_CONFLICT", {
        targetStableId: nodeId,
        kind,
        channel,
        layer: highestLayer,
        contributions: highest.map(contributionIdentity),
      }));
      continue;
    }
    overrides.set(key, structuredClone(highest[0].value));
  }
  return overrides;
}

function contributionTargetIsValid(project, entry) {
  const target = entry.target;
  if (target.nodeId) return Boolean(project.scene.nodes[target.nodeId]);
  if (target.semanticSlotId) {
    return project.semanticSlots.some((slot) => slot.id === target.semanticSlotId);
  }
  if (target.boneId) return project.rig.bones.some((bone) => bone.id === target.boneId);
  if (target.deformerId || target.controlPointId) {
    const deformer = project.rig.deformers.find((candidate) =>
      candidate.id === target.deformerId);
    const point = project.rig.warpControlPoints.find((candidate) =>
      candidate.id === target.controlPointId && candidate.deformerId === target.deformerId);
    return Boolean(deformer && point && deformer.controlPointIds.includes(point.id));
  }
  if (target.meshId) return project.meshes.some((mesh) => mesh.id === target.meshId);
  return false;
}

export function createSequenceAnimationContext(project, sequence, activeSamples, {
  activeSemanticNodes,
  nodeTargetCompatibility = () => null,
} = {}) {
  const nodesBySlot = activeSemanticNodes || new Map();
  const diagnostics = [];
  const contributions = collectClipContributions(activeSamples);
  const positionX = new Map();
  const positionY = new Map();
  const rotation = new Map();
  const scaleX = new Map();
  const scaleY = new Map();
  const boneX = new Map();
  const boneY = new Map();
  const boneRotation = new Map();
  const deformerX = new Map();
  const deformerY = new Map();
  const opacity = new Map();
  const meshEntries = [];
  const deformerEntries = [];

  for (const entry of contributions) {
    if (!contributionTargetIsValid(project, entry)) {
      diagnostics.push(diagnostic(sequence.id, "ANIMATION_TRACK_TARGET_INVALID", {
        clipInstanceId: entry.clipInstanceId,
        trackId: entry.trackId,
        kind: entry.kind,
        target: entry.target,
      }));
      continue;
    }
    if (entry.kind === "TransformTrack") {
      const active = activeSamples.find((sample) => sample.instance.id === entry.clipInstanceId);
      if (entry.target.nodeId) {
        const incompatible = nodeTargetCompatibility(active.instance, entry.target.nodeId);
        if (incompatible) {
          diagnostics.push(diagnostic(sequence.id, "ANIMATION_CLIP_TARGET_INCOMPATIBLE", {
            clipInstanceId: entry.clipInstanceId,
            trackId: entry.trackId,
            nodeId: entry.target.nodeId,
            ...incompatible,
          }));
          continue;
        }
      }
      const nodes = targetNodeIds(entry, nodesBySlot);
      if (!nodes.length && entry.target.semanticSlotId) continue;
      for (const nodeId of nodes) {
        if (entry.channel === "positionX") add(positionX, nodeId, entry.value * entry.weight);
        if (entry.channel === "positionY") add(positionY, nodeId, entry.value * entry.weight);
        if (entry.channel === "rotation") add(rotation, nodeId, entry.value * entry.weight);
        if (entry.channel === "scaleX") multiply(scaleX, nodeId, Math.pow(entry.value, entry.weight));
        if (entry.channel === "scaleY") multiply(scaleY, nodeId, Math.pow(entry.value, entry.weight));
      }
    } else if (entry.kind === "BoneTrack") {
      if (entry.channel === "x") add(boneX, entry.target.boneId, entry.value * entry.weight);
      if (entry.channel === "y") add(boneY, entry.target.boneId, entry.value * entry.weight);
      if (entry.channel === "rotation") {
        add(boneRotation, entry.target.boneId, entry.value * entry.weight);
      }
    } else if (entry.kind === "DeformerTrack") {
      deformerEntries.push(entry);
      const key = entry.target.deformerId + "\0" + entry.target.controlPointId;
      if (entry.channel === "deltaX") add(deformerX, key, entry.value * entry.weight);
      if (entry.channel === "deltaY") add(deformerY, key, entry.value * entry.weight);
    } else if (entry.kind === "MeshDeformationTrack") {
      meshEntries.push(entry);
    } else if (entry.kind === "OpacityTrack") {
      for (const nodeId of targetNodeIds(entry, nodesBySlot)) {
        multiply(opacity, nodeId, 1 + entry.weight * (entry.value - 1));
      }
    }
  }

  const transformOverrides = new Map();
  const transformNodeIds = new Set([
    ...positionX.keys(), ...positionY.keys(), ...rotation.keys(), ...scaleX.keys(), ...scaleY.keys(),
  ]);
  for (const nodeId of [...transformNodeIds].sort(compareText)) {
    const node = project.scene.nodes[nodeId];
    if (!node) {
      diagnostics.push(diagnostic(sequence.id, "ANIMATION_TRACK_TARGET_INVALID", { nodeId }));
      continue;
    }
    transformOverrides.set(nodeId, {
      ...structuredClone(node.transform),
      position: {
        x: node.transform.position.x + (positionX.get(nodeId) || 0),
        y: node.transform.position.y + (positionY.get(nodeId) || 0),
      },
      rotation: node.transform.rotation + (rotation.get(nodeId) || 0),
      scale: {
        x: node.transform.scale.x * (scaleX.get(nodeId) ?? 1),
        y: node.transform.scale.y * (scaleY.get(nodeId) ?? 1),
      },
    });
  }

  const discrete = discreteOverrides(sequence.id, contributions, nodesBySlot, diagnostics);
  const applyDiscrete = (kind, channel, baseValue, { nodeId }) => {
    const key = [kind, channel, nodeId].join("\0");
    return discrete.has(key) ? structuredClone(discrete.get(key)) : baseValue;
  };

  const warpKeyformCache = new Map();
  const activeDeformerIds = new Set();
  const activeMeshTopologyIds = new Set();
  const appliedMeshEntries = new Set();
  let finalized = false;
  return {
    contributions,
    diagnostics,
    transformOverrides,
    warpKeyformForDeformer: (context) => {
      const { deformer, keyform } = context;
      activeDeformerIds.add(deformer.id);
      const cacheKey = JSON.stringify(canonicalize({
        deformerId: deformer.id,
        keyArtId: context.keyArtId || null,
        fromKeyArtId: context.fromKeyArtId || null,
        toKeyArtId: context.toKeyArtId || null,
        amount: context.amount ?? null,
        controlPoints: keyform.controlPoints,
      }));
      if (warpKeyformCache.has(cacheKey)) return warpKeyformCache.get(cacheKey);
      const overlaid = {
        ...structuredClone(keyform),
        controlPoints: keyform.controlPoints.map((point) => {
          const key = deformer.id + "\0" + point.controlPointId;
          return {
            ...point,
            x: point.x + (deformerX.get(key) || 0),
            y: point.y + (deformerY.get(key) || 0),
          };
        }),
      };
      warpKeyformCache.set(cacheKey, overlaid);
      return overlaid;
    },
    poseForBone: (bone, basePose) => ({
      x: basePose.x + (boneX.get(bone.id) || 0),
      y: basePose.y + (boneY.get(bone.id) || 0),
      rotation: basePose.rotation + (boneRotation.get(bone.id) || 0),
    }),
    applyMesh: (mesh) => {
      if (mesh?.topologyId) activeMeshTopologyIds.add(mesh.topologyId);
      let result = mesh;
      for (const entry of meshEntries) {
        const deformation = project.animation.deformationSamples.find((sample) =>
          sample.id === entry.value.deformationSampleId);
        if (!deformation || deformation.meshId !== entry.target.meshId ||
          !mesh?.topologyId || deformation.topologyId !== mesh.topologyId) {
          continue;
        }
        const topology = project.meshTopologies.find((candidate) =>
          candidate.id === mesh.topologyId);
        if (!topology) continue;
        appliedMeshEntries.add(entry);
        const positions = [...result.positions];
        const effectiveWeight = entry.value.weight * entry.weight;
        let compatible = true;
        for (const offset of deformation.offsets) {
          const index = topology.vertexIds.indexOf(offset.vertexId);
          if (index < 0) {
            compatible = false;
            diagnostics.push(diagnostic(sequence.id, "ANIMATION_TOPOLOGY_INCOMPATIBLE", {
              clipInstanceId: entry.clipInstanceId,
              trackId: entry.trackId,
              meshId: entry.target.meshId,
              topologyId: topology.id,
              vertexId: offset.vertexId,
            }));
            break;
          }
          positions[index * 2] += offset.dx * effectiveWeight;
          positions[index * 2 + 1] += offset.dy * effectiveWeight;
        }
        if (compatible) result = { ...result, positions };
      }
      return result;
    },
    applyOpacity: (baseValue, { nodeId }) => baseValue * (opacity.get(nodeId) ?? 1),
    applyPresence: (baseValue, identity) =>
      applyDiscrete("PresenceTrack", "presence", baseValue, identity),
    applyDrawOrder: (baseValue, identity) =>
      applyDiscrete("DrawOrderTrack", "drawOrder", baseValue, identity),
    applyClipping: (baseValue, identity) => {
      const value = applyDiscrete("ClippingTrack", "clipping", baseValue, identity);
      return value === baseValue ? value : { ...baseValue, ...value };
    },
    finalize() {
      if (finalized) return;
      finalized = true;
      for (const entry of deformerEntries) {
        if (activeDeformerIds.has(entry.target.deformerId)) continue;
        diagnostics.push(diagnostic(sequence.id, "ANIMATION_TRACK_TARGET_INVALID", {
          clipInstanceId: entry.clipInstanceId,
          trackId: entry.trackId,
          kind: entry.kind,
          target: entry.target,
          reason: "deformer-not-active",
        }));
      }
      for (const entry of meshEntries) {
        if (appliedMeshEntries.has(entry)) continue;
        const deformation = project.animation.deformationSamples.find((sample) =>
          sample.id === entry.value.deformationSampleId);
        if (!deformation || deformation.meshId !== entry.target.meshId) {
          diagnostics.push(diagnostic(sequence.id, "ANIMATION_TRACK_TARGET_INVALID", {
            clipInstanceId: entry.clipInstanceId,
            trackId: entry.trackId,
            kind: entry.kind,
            target: entry.target,
            deformationSampleId: entry.value.deformationSampleId,
            reason: !deformation ? "deformation-sample-missing" : "sample-mesh-mismatch",
          }));
          continue;
        }
        diagnostics.push(diagnostic(sequence.id, "ANIMATION_TOPOLOGY_INCOMPATIBLE", {
          clipInstanceId: entry.clipInstanceId,
          trackId: entry.trackId,
          meshId: entry.target.meshId,
          sampleTopologyId: deformation.topologyId,
          activeTopologyIds: [...activeMeshTopologyIds].sort(compareText),
          reason: "topology-not-active",
        }));
      }
    },
  };
}

export function evaluateSequenceCamera(sequenceProgram, sequenceTick) {
  const sample = sampleTemporalProgram(sequenceProgram, sequenceTick);
  const track = sample.tracks.find((entry) => entry.kind === "CameraTrack") || null;
  return {
    positionX: track?.values.positionX ?? 0,
    positionY: track?.values.positionY ?? 0,
    rotation: track?.values.rotation ?? 0,
    scale: track?.values.scale ?? 1,
  };
}

export function evaluateSequenceEvents(sequenceProgram, sequenceTick, activeSamples) {
  const events = sampleTemporalProgram(sequenceProgram, sequenceTick).events.map((event) => ({
    sequenceTick,
    sourceScope: "sequence",
    clipInstanceId: null,
    programId: sequenceProgram.id,
    event: structuredClone(event),
  }));
  for (const active of activeSamples) {
    for (const event of active.sample.events) {
      events.push({
        sequenceTick,
        sourceScope: "clip",
        clipInstanceId: active.instance.id,
        programId: active.program.id,
        event: structuredClone(event),
      });
    }
  }
  const scope = { sequence: 0, clip: 1 };
  return events.sort((left, right) =>
    left.sequenceTick - right.sequenceTick ||
    scope[left.sourceScope] - scope[right.sourceScope] ||
    compareText(left.clipInstanceId || "", right.clipInstanceId || "") ||
    compareText(left.programId, right.programId) ||
    compareText(left.event.id, right.event.id));
}
