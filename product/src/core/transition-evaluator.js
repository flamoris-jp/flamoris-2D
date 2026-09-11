import { sampleTemporalProgram } from "./temporal.js";
import { invertAffine, multiplyAffine, worldTransformMatrix } from "./transforms.js";
import {
  keyArtMemberFor,
  semanticMappingFor,
} from "../model/transition-validation.js";
import { clippingBindingForTarget } from "../model/clipping-validation.js";
import { resolveEvaluatedClipping } from "./clipping-evaluator.js";
import {
  createInterpolatedWarpEvaluationStages,
  createWarpEvaluationStages,
  evaluateWarpStages,
  WarpDeformerEvaluationError,
} from "./warp-deformer-evaluator.js";
import {
  evaluateEndpointRigidBoneMesh,
  evaluateMorphRigidBoneMesh,
} from "./rigid-bone-evaluator.js";
import {
  evaluateEndpointSkinMesh,
  evaluateMorphSkinMesh,
} from "./skin-mesh-evaluator.js";
import { skinBindingForTarget } from "../model/skin-binding-validation.js";
import { meshFormCorrectionForContext } from "../model/mesh-form-correction-validation.js";
import {
  evaluateInterpolatedMeshFormCorrection,
  evaluateMeshFormCorrection,
} from "./mesh-form-correction-evaluator.js";
import {
  bonePoseDeltaForKeyArt,
  interpolateBonePoseDeltas,
} from "./bone-fk-evaluator.js";

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

function memberState(project, keyArt, mapping, animation = null) {
  if (!mapping) return null;
  const node = project.scene.nodes[mapping.nodeId];
  const member = keyArtMemberFor(keyArt, mapping.nodeId);
  if (!node || !member) return null;
  const baseWorldTransform = worldTransformMatrix(project, node.id);
  return {
    node,
    member,
    baseWorldTransform,
    worldTransform: animation?.transformOverrides
      ? worldTransformMatrix(project, node.id, animation.transformOverrides)
      : baseWorldTransform,
  };
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
    topologyId: topology.id,
    positions: [...keyform.positions],
    indices: [...topology.indices],
    uvs: [...keyform.uvs],
  };
}

function warpSpace(project, deformerId, partWorldTransform) {
  const toDeformerLocal = multiplyAffine(
    invertAffine(worldTransformMatrix(project, deformerId)),
    partWorldTransform,
  );
  return { toDeformerLocal, fromDeformerLocal: invertAffine(toDeformerLocal) };
}

function warpIssue(issues, error, semanticSlotId, details = {}) {
  const code = error instanceof WarpDeformerEvaluationError
    ? error.code : "DEFORMER_CONTROL_POINT_INVALID";
  issues.push({
    code,
    semanticSlotId,
    details: { ...details, ...(error?.details || {}), reason: error?.message || String(error) },
  });
}

function collectRigidIssues(issues, result, semanticSlotId) {
  for (const entry of result.diagnostics) {
    issues.push({
      code: entry.code,
      semanticSlotId,
      details: {
        boneId: entry.boneId || null,
        bindingId: entry.bindingId || null,
        ...(entry.details || {}),
        reason: entry.message,
      },
    });
  }
  return result.mesh;
}

function endpointPoseForBone(project, keyArtId, animation) {
  if (!animation?.poseForBone) return null;
  return (bone) => animation.poseForBone(
    bone,
    bonePoseDeltaForKeyArt(project, bone.id, keyArtId),
    { keyArtId },
  );
}

function morphPoseForBone(project, fromKeyArtId, toKeyArtId, geometryWeight, animation) {
  if (!animation?.poseForBone) return null;
  return (bone) => animation.poseForBone(
    bone,
    interpolateBonePoseDeltas(
      bonePoseDeltaForKeyArt(project, bone.id, fromKeyArtId),
      bonePoseDeltaForKeyArt(project, bone.id, toKeyArtId),
      geometryWeight,
    ),
    { fromKeyArtId, toKeyArtId, geometryWeight },
  );
}

function endpointRigidMesh(project, state, keyArtId, mesh, semanticSlotId, issues,
  animation = null) {
  if (!state || !mesh) return mesh;
  return collectRigidIssues(issues, evaluateEndpointRigidBoneMesh(project, {
    targetNodeId: state.node.id,
    keyArtId,
    mesh,
    targetWorldTransform: state.baseWorldTransform,
    poseForBone: endpointPoseForBone(project, keyArtId, animation),
    warpKeyformForDeformer: animation?.warpKeyformForDeformer,
  }), semanticSlotId);
}

function endpointBoneMesh(project, state, keyArtId, mesh, semanticSlotId, issues,
  animation = null) {
  if (!state || !mesh) return mesh;
  const skin = skinBindingForTarget(project, state.node.id);
  if (!skin) return endpointRigidMesh(
    project, state, keyArtId, mesh, semanticSlotId, issues, animation,
  );
  const topology = (project.meshTopologies || []).find((entry) =>
    entry.id === mesh.topologyId) || null;
  return collectRigidIssues(issues, evaluateEndpointSkinMesh(project, {
    targetNodeId: state.node.id,
    keyArtId,
    topology,
    mesh,
    targetWorldTransform: state.baseWorldTransform,
    poseForBone: endpointPoseForBone(project, keyArtId, animation),
    warpKeyformForDeformer: animation?.warpKeyformForDeformer,
  }), semanticSlotId);
}

function endpointCorrectedMesh(project, keyArtId, semanticSlotId, mesh, issues) {
  if (!mesh?.topologyId) return mesh;
  const topology = (project.meshTopologies || []).find((entry) => entry.id === mesh.topologyId) || null;
  const keyform = meshFormCorrectionForContext(project, {
    topologyId: mesh.topologyId, keyArtId, semanticSlotId,
  });
  return collectRigidIssues(issues, evaluateMeshFormCorrection({
    mesh, topology, keyform,
  }), semanticSlotId);
}

function morphCorrectedMesh(project, topology, slot, fromKeyArtId, toKeyArtId,
  geometryWeight, mesh, issues) {
  const context = { topologyId: topology.id, semanticSlotId: slot.id };
  const fromKeyform = meshFormCorrectionForContext(project, {
    ...context, keyArtId: fromKeyArtId,
  });
  const toKeyform = meshFormCorrectionForContext(project, {
    ...context, keyArtId: toKeyArtId,
  });
  const incompatible = [fromKeyArtId, toKeyArtId].flatMap((keyArtId) =>
    (project.meshFormCorrectionKeyforms || []).filter((entry) =>
      entry.keyArtId === keyArtId && entry.semanticSlotId === slot.id &&
      entry.topologyId !== topology.id));
  if ((!fromKeyform || !toKeyform) && incompatible.length) {
    issues.push({
      code: "MESH_FORM_CORRECTION_TRANSITION_INCOMPATIBLE",
      semanticSlotId: slot.id,
      details: {
        topologyId: topology.id,
        correctionIds: incompatible.map((entry) => entry.id).sort(compareText),
        reason: "Morph endpoint form correction uses an incompatible topology.",
      },
    });
    return mesh;
  }
  return collectRigidIssues(issues, evaluateInterpolatedMeshFormCorrection({
    mesh, topology, fromKeyform, toKeyform, geometryWeight,
  }), slot.id);
}

function endpointWarpMesh(project, state, keyArtId, mesh, semanticSlotId, issues,
  animation = null) {
  if (!state || !mesh) return mesh;
  try {
    const resolved = createWarpEvaluationStages(project, state.node.id, keyArtId, {
      spaceForDeformer: (deformerId) => warpSpace(
        project, deformerId, state.baseWorldTransform,
      ),
      ...(animation?.warpKeyformForDeformer
        ? { keyformForDeformer: animation.warpKeyformForDeformer }
        : {}),
    });
    if (resolved.diagnostics.length) {
      for (const entry of resolved.diagnostics) {
        issues.push({ code: entry.code, semanticSlotId, details: { ...entry } });
      }
      return mesh;
    }
    if (!resolved.stages.length) return mesh;
    return { ...mesh, positions: evaluateWarpStages(mesh.positions, resolved.stages) };
  } catch (error) {
    warpIssue(issues, error, semanticSlotId, { nodeId: state.node.id, keyArtId });
    return mesh;
  }
}

function morphWarpMesh(project, from, to, fromKeyArtId, toKeyArtId, mesh,
  geometryWeight, transform, semanticSlotId, issues, animation = null) {
  if (!from || !to || !mesh) return mesh;
  try {
    const stages = createInterpolatedWarpEvaluationStages(
      project,
      from.node.id,
      to.node.id,
      fromKeyArtId,
      toKeyArtId,
      geometryWeight,
      {
        spaceForDeformer: (deformerId) => warpSpace(
          project, deformerId, transform,
        ),
        ...(animation?.warpKeyformForDeformer
          ? { keyformForDeformer: animation.warpKeyformForDeformer }
          : {}),
      },
    );
    if (!stages.length) return mesh;
    return { ...mesh, positions: evaluateWarpStages(mesh.positions, stages) };
  } catch (error) {
    warpIssue(issues, error, semanticSlotId, {
      fromNodeId: from.node.id,
      toNodeId: to.node.id,
      fromKeyArtId,
      toKeyArtId,
    });
    return mesh;
  }
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

function animationIdentity(slot, state) {
  return { semanticSlotId: slot.id, nodeId: state?.node.id ?? null };
}

function animatedPresence(animation, value, slot, state) {
  return animation?.applyPresence
    ? animation.applyPresence(value, animationIdentity(slot, state))
    : value;
}

function animatedOpacity(animation, value, slot, state) {
  return animation?.applyOpacity
    ? animation.applyOpacity(value, animationIdentity(slot, state))
    : value;
}

function animatedDrawOrder(animation, value, slot, state) {
  return animation?.applyDrawOrder
    ? animation.applyDrawOrder(value, animationIdentity(slot, state))
    : value;
}

function animatedClipping(animation, value, slot, state) {
  return animation?.applyClipping
    ? animation.applyClipping(value, animationIdentity(slot, state))
    : value;
}

function animatedMesh(animation, mesh, slot, state) {
  return animation?.applyMesh
    ? animation.applyMesh(mesh, animationIdentity(slot, state))
    : mesh;
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

function endpointTransform(from, to, amount, property = "worldTransform") {
  if (!from) return [...to[property]];
  if (!to) return [...from[property]];
  const left = decomposeAffine(from[property]);
  const right = decomposeAffine(to[property]);
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

function endpointPartState(project, transition, part, slot, endpoint, fromKeyArt, toKeyArt,
  warpIssues, rigidIssues, correctionIssues, animation = null) {
  const keyArt = endpoint === "from" ? fromKeyArt : toKeyArt;
  const mapping = semanticMappingFor(slot, keyArt.id);
  const state = memberState(project, keyArt, mapping, animation);
  const presence = animatedPresence(
    animation, state?.member.presence || "absent", slot, state,
  );
  if (!state || presence !== "present") {
    return { semanticSlotId: slot.id, presence, renderInstances: [] };
  }
  const keyformId = endpoint === "from" ? part?.fromKeyformId : part?.toKeyformId;
  let mesh = endpointWarpMesh(
    project, state, keyArt.id, keyformMesh(project, keyformId, state.node), slot.id,
    warpIssues, animation,
  );
  mesh = endpointBoneMesh(project, state, keyArt.id, mesh, slot.id, rigidIssues, animation);
  mesh = endpointCorrectedMesh(project, keyArt.id, slot.id, mesh, correctionIssues);
  mesh = animatedMesh(animation, mesh, slot, state);
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
      opacity: clamp(animatedOpacity(animation, state.member.opacity, slot, state), 0, 1),
      drawOrder: animatedDrawOrder(animation, state.member.drawOrder, slot, state),
      clipping: animatedClipping(animation, endpointStateClipping(project, state), slot, state),
      transform: state.worldTransform,
    })],
  };
}

function evaluateMorph(project, transition, part, slot, from, to, fromMesh, toMesh,
  fromKeyArtId, toKeyArtId, sample, u, warpIssues, rigidIssues, correctionIssues,
  animation = null) {
  const geometryWeight = clamp(sampledValue(sample, "GeometryBlendTrack", "geometryWeight", slot.id) ?? u, 0, 1);
  const appearanceWeights = sampledValue(sample, "AppearanceTrack", "appearance", slot.id) ||
    endpointWeights(from, to, u);
  const selectedState = u < 0.5 ? from : to;
  const opacity = clamp(animatedOpacity(animation,
    sampledValue(sample, "OpacityTrack", "opacity", slot.id) ?? endpointOpacity(from, to, u),
    slot, selectedState), 0, 1);
  const presence = animatedPresence(animation,
    sampledValue(sample, "PresenceTrack", "presence", slot.id) ?? endpointPresence(from, to, u),
    slot, selectedState);
  const drawOrder = animatedDrawOrder(animation,
    sampledValue(sample, "DrawOrderTrack", "drawOrder", slot.id) ?? endpointDrawOrder(from, to, u),
    slot, selectedState);
  const clipping = animatedClipping(animation,
    sampledClipping(project, sample, slot.id, selectedState), slot, selectedState);
  if (presence !== "present") return { semanticSlotId: slot.id, presence, renderInstances: [] };
  const topology = entity(project, "meshTopologies", part.topologyId, "MeshTopology");
  let mesh = {
    topologyId: topology.id,
    positions: lerpArray(fromMesh.positions, toMesh.positions, geometryWeight),
    indices: [...topology.indices],
  };
  const baseTransform = endpointTransform(from, to, geometryWeight, "baseWorldTransform");
  const transform = endpointTransform(from, to, geometryWeight);
  mesh = morphWarpMesh(
    project, from, to, fromKeyArtId, toKeyArtId, mesh, geometryWeight, baseTransform,
    slot.id, warpIssues, animation,
  );
  const hasSkin = skinBindingForTarget(project, from.node.id) ||
    skinBindingForTarget(project, to.node.id);
  mesh = collectRigidIssues(rigidIssues, hasSkin
    ? evaluateMorphSkinMesh(project, {
      fromTargetNodeId: from.node.id,
      toTargetNodeId: to.node.id,
      fromKeyArtId,
      toKeyArtId,
      geometryWeight,
      topology,
      mesh,
      targetWorldTransform: baseTransform,
      poseForBone: morphPoseForBone(
        project, fromKeyArtId, toKeyArtId, geometryWeight, animation,
      ),
      warpKeyformForDeformer: animation?.warpKeyformForDeformer,
    })
    : evaluateMorphRigidBoneMesh(project, {
      fromTargetNodeId: from.node.id,
      toTargetNodeId: to.node.id,
      fromKeyArtId,
      toKeyArtId,
      geometryWeight,
      mesh,
      targetWorldTransform: baseTransform,
      poseForBone: morphPoseForBone(
        project, fromKeyArtId, toKeyArtId, geometryWeight, animation,
      ),
      warpKeyformForDeformer: animation?.warpKeyformForDeformer,
    }), slot.id);
  mesh = morphCorrectedMesh(project, topology, slot, fromKeyArtId, toKeyArtId,
    geometryWeight, mesh, correctionIssues);
  mesh = animatedMesh(animation, mesh, slot, geometryWeight < 1 ? from : to);
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
      transform,
    })],
  };
}

function sourceInstance(project, transition, part, slot, endpoint, state, keyArtId, mesh,
  weight, sample, warpIssues, rigidIssues, correctionIssues, compositeGroupId = null,
  animation = null) {
  if (animatedPresence(animation, state.member.presence, slot, state) !== "present") {
    return null;
  }
  const opacityValue = sampledValue(sample, "OpacityTrack", "opacity", slot.id, state.node.id);
  const sourceWeight = compositeGroupId ? 1 : weight;
  const opacity = clamp(animatedOpacity(animation,
    state.member.opacity * sourceWeight * (opacityValue ?? 1), slot, state), 0, 1);
  const drawOrder = animatedDrawOrder(animation,
    sampledValue(sample, "DrawOrderTrack", "drawOrder", slot.id, state.node.id) ??
      state.member.drawOrder, slot, state);
  const clipping = animatedClipping(animation,
    sampledClipping(project, sample, slot.id, state), slot, state);
  const warpedMesh = endpointWarpMesh(
    project, state, keyArtId, mesh, slot.id, warpIssues, animation,
  );
  const boneMesh = endpointBoneMesh(
    project, state, keyArtId, warpedMesh, slot.id, rigidIssues, animation,
  );
  let correctedMesh = endpointCorrectedMesh(
    project, keyArtId, slot.id, boneMesh, correctionIssues,
  );
  correctedMesh = animatedMesh(animation, correctedMesh, slot, state);
  return instance({
    id: transition.id + ":" + slot.id + ":" + endpoint,
    source: state,
    mesh: correctedMesh,
    appearance: appearanceSamples({ [state.member.appearanceId]: 1 }, endpoint === "from" ? state : null, endpoint === "to" ? state : null, mesh, mesh),
    opacity,
    drawOrder,
    clipping,
    transform: state.worldTransform,
    compositeGroupId,
    compositeWeight: compositeGroupId ? weight : null,
  });
}

function evaluateReplace(project, transition, part, slot, from, to, fromMesh, toMesh,
  sample, u, warpIssues, rigidIssues, correctionIssues, animation = null) {
  const authored = sampledValue(sample, "AppearanceTrack", "appearance", slot.id);
  const weights = normalizedWeights(authored || endpointWeights(from, to, u));
  const weightFor = (appearanceId) => weights.find((entry) => entry.appearanceId === appearanceId)?.weight ?? 0;
  const compositeGroupId = part.configuration?.compositeGroupId || null;
  const renderInstances = [];
  const fromWeight = from ? weightFor(from.member.appearanceId) : 0;
  const toWeight = to ? weightFor(to.member.appearanceId) : 0;
  if (from && fromWeight > 0) {
    const value = sourceInstance(
      project, transition, part, slot, "from", from, transition.fromKeyArtId, fromMesh,
      fromWeight, sample, warpIssues, rigidIssues, correctionIssues, compositeGroupId,
      animation,
    );
    if (value) renderInstances.push(value);
  }
  if (to && toWeight > 0) {
    const value = sourceInstance(
      project, transition, part, slot, "to", to, transition.toKeyArtId, toMesh,
      toWeight, sample, warpIssues, rigidIssues, correctionIssues, compositeGroupId,
      animation,
    );
    if (value) renderInstances.push(value);
  }
  const authoredPresence = sampledValue(sample, "PresenceTrack", "presence", slot.id);
  const presence = animatedPresence(
    animation,
    authoredPresence ?? (renderInstances.length ? "present" : "absent"),
    slot,
    u < 0.5 ? from : to,
  );
  return { semanticSlotId: slot.id, presence, renderInstances: presence === "present" ? renderInstances : [] };
}

function evaluateSingle(project, transition, part, slot, endpoint, state, keyArtId, mesh,
  sample, opacity, presence, warpIssues, rigidIssues, correctionIssues, animation = null) {
  const authoredPresence = sampledValue(sample, "PresenceTrack", "presence", slot.id, state?.node.id);
  const resolvedPresence = animatedPresence(
    animation, authoredPresence ?? presence, slot, state,
  );
  if (!state || resolvedPresence !== "present") return { semanticSlotId: slot.id, presence: resolvedPresence, renderInstances: [] };
  const authoredOpacity = sampledValue(sample, "OpacityTrack", "opacity", slot.id, state.node.id);
  const resolvedOpacity = clamp(animatedOpacity(
    animation, authoredOpacity ?? opacity, slot, state,
  ), 0, 1);
  const drawOrder = animatedDrawOrder(animation,
    sampledValue(sample, "DrawOrderTrack", "drawOrder", slot.id, state.node.id) ??
      state.member.drawOrder, slot, state);
  const clipping = animatedClipping(animation,
    sampledClipping(project, sample, slot.id, state), slot, state);
  const warpedMesh = endpointWarpMesh(
    project, state, keyArtId, mesh, slot.id, warpIssues, animation,
  );
  const boneMesh = endpointBoneMesh(
    project, state, keyArtId, warpedMesh, slot.id, rigidIssues, animation,
  );
  let correctedMesh = endpointCorrectedMesh(
    project, keyArtId, slot.id, boneMesh, correctionIssues,
  );
  correctedMesh = animatedMesh(animation, correctedMesh, slot, state);
  return {
    semanticSlotId: slot.id,
    presence: resolvedPresence,
    renderInstances: [instance({
      id: transition.id + ":" + slot.id + ":" + part.mode,
      source: state,
      mesh: correctedMesh,
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
  SEQUENCE_KEYART_BASE_AMBIGUOUS: "Standalone KeyArt base state has multiple compatible MeshKeyforms.",
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
  DEFORMER_KEYFORM_MISSING: "A required WarpDeformer keyform is missing.",
  DEFORMER_KEYFORM_INCOMPATIBLE: "WarpDeformer endpoint keyforms or hierarchy are incompatible.",
  DEFORMER_CONTROL_POINT_INVALID: "WarpDeformer control-point data cannot be evaluated.",
  DEFORMER_CHILD_REFERENCE_INVALID: "The evaluated Scene child does not resolve to a WarpDeformer hierarchy.",
  DEFORMER_PARENT_MISSING: "The evaluated WarpDeformer hierarchy has a missing parent.",
  DEFORMER_CYCLE: "The evaluated WarpDeformer hierarchy contains a cycle.",
  BONE_HIERARCHY_CYCLE: "The evaluated Bone hierarchy contains a cycle.",
  BONE_NODE_MISSING: "A rigid attachment references a missing Bone.",
  BONE_PARENT_INVALID: "The evaluated Bone hierarchy has an invalid parent.",
  BONE_SCENE_IDENTITY_MISMATCH: "Bone identity does not match the Scene hierarchy.",
  BONE_POSE_INVALID: "A Bone pose cannot be evaluated.",
  BONE_PROJECTED_FRAME_DEGENERATE: "A post-Warp Bone bind frame is degenerate.",
  BONE_TRANSITION_INCOMPATIBLE: "Morph endpoints have incompatible rigid Bone state.",
});

function keyArtBaseDiagnostic(keyArtId, code, semanticSlotId = null, details = {}, severity = "error") {
  const evidenceFingerprint = stableFingerprint({ keyArtId, code, semanticSlotId, details });
  return {
    key: [code, keyArtId, semanticSlotId || "-", evidenceFingerprint].join("|"),
    code,
    severity,
    message: DIAGNOSTIC_MESSAGES[code] || code,
    keyArtId,
    ...(semanticSlotId ? { semanticSlotId } : {}),
    details,
    evidenceFingerprint,
  };
}

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

export function evaluateKeyArtBaseState(project, keyArtId, {
  evaluationId = "keyart:" + keyArtId,
  animation = null,
} = {}) {
  const keyArt = entity(project, "keyArts", keyArtId, "KeyArt");
  const slots = [...(project.semanticSlots || [])]
    .filter((slot) => semanticMappingFor(slot, keyArtId))
    .sort((left, right) => compareText(left.id, right.id));
  const pseudoTransition = { id: evaluationId };
  const evaluatedParts = [];
  const selections = [];
  const ambiguityIssues = [];
  const warpIssues = [];
  const rigidIssues = [];
  const correctionIssues = [];
  for (const slot of slots) {
    const candidates = (project.meshKeyforms || [])
      .filter((keyform) => keyform.keyArtId === keyArtId && keyform.semanticSlotId === slot.id)
      .sort((left, right) => compareText(left.id, right.id));
    const keyform = candidates.length === 1 ? candidates[0] : null;
    selections.push({
      semanticSlotId: slot.id,
      keyformId: keyform?.id ?? null,
      topologyId: keyform?.topologyId ?? null,
    });
    if (candidates.length > 1) {
      ambiguityIssues.push(keyArtBaseDiagnostic(
        keyArtId,
        "SEQUENCE_KEYART_BASE_AMBIGUOUS",
        slot.id,
        { keyformIds: candidates.map((entry) => entry.id) },
      ));
    }
    evaluatedParts.push(endpointPartState(
      project,
      pseudoTransition,
      { fromKeyformId: keyform?.id ?? null },
      slot,
      "from",
      keyArt,
      keyArt,
      warpIssues,
      rigidIssues,
      correctionIssues,
      animation,
    ));
  }
  const orderedParts = evaluatedParts.sort((left, right) => compareText(left.semanticSlotId, right.semanticSlotId));
  const clipping = resolveEvaluatedClipping(project, orderedParts);
  const derived = [
    ...clipping.diagnostics.map((entry) => keyArtBaseDiagnostic(
      keyArtId, entry.code, entry.semanticSlotId, {
        renderInstanceId: entry.renderInstanceId,
        targetNodeId: entry.targetNodeId,
        sourceNodeId: entry.sourceNodeId,
        ...entry.details,
      }, entry.severity)),
    ...[...warpIssues, ...rigidIssues, ...correctionIssues].map((entry) =>
      keyArtBaseDiagnostic(keyArtId, entry.code, entry.semanticSlotId, entry.details)),
  ];
  return {
    keyArtId,
    evaluatedParts: clipping.evaluatedParts,
    compositeGroups: compositeGroups(clipping.evaluatedParts),
    baseSelections: selections,
    diagnostics: sortDiagnostics([...ambiguityIssues, ...derived]),
  };
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

export function evaluateTransition(project, transitionId, timeTicks, {
  animation = null,
} = {}) {
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
  const warpIssues = [];
  const rigidIssues = [];
  const correctionIssues = [];
  for (const slot of slots) {
    const part = partBySlot.get(slot.id) || null;
    if (clampedTicks === 0) {
      evaluatedParts.push(endpointPartState(
        project, transition, part, slot, "from", fromKeyArt, toKeyArt,
        warpIssues, rigidIssues, correctionIssues, animation,
      ));
      continue;
    }
    if (clampedTicks === program.durationTicks) {
      evaluatedParts.push(endpointPartState(
        project, transition, part, slot, "to", fromKeyArt, toKeyArt,
        warpIssues, rigidIssues, correctionIssues, animation,
      ));
      continue;
    }
    if (!part) {
      evaluatedParts.push({ semanticSlotId: slot.id, presence: "absent", renderInstances: [] });
      continue;
    }
    const fromMapping = semanticMappingFor(slot, fromKeyArt.id);
    const toMapping = semanticMappingFor(slot, toKeyArt.id);
    const from = memberState(project, fromKeyArt, fromMapping, animation);
    const to = memberState(project, toKeyArt, toMapping, animation);
    const fromMesh = from ? keyformMesh(project, part.fromKeyformId, from.node) : null;
    const toMesh = to ? keyformMesh(project, part.toKeyformId, to.node) : null;
    if (part.mode === "morph") evaluatedParts.push(evaluateMorph(
      project, transition, part, slot, from, to, fromMesh, toMesh,
      fromKeyArt.id, toKeyArt.id, sample, normalizedTime, warpIssues, rigidIssues,
      correctionIssues, animation,
    ));
    else if (part.mode === "replace") evaluatedParts.push(evaluateReplace(
      project, transition, part, slot, from, to, fromMesh, toMesh,
      sample, normalizedTime, warpIssues, rigidIssues, correctionIssues, animation,
    ));
    else if (part.mode === "hold") {
      const holdTo = part.configuration?.holdEndpoint === "to";
      const state = holdTo ? to : from || to;
      const mesh = holdTo ? toMesh : fromMesh || toMesh;
      const endpoint = holdTo || !from ? "to" : "from";
      evaluatedParts.push(evaluateSingle(
        project, transition, part, slot, endpoint, state,
        endpoint === "to" ? toKeyArt.id : fromKeyArt.id, mesh, sample,
        state?.member.opacity ?? 0, state?.member.presence ?? "absent",
        warpIssues, rigidIssues, correctionIssues, animation,
      ));
    } else if (part.mode === "appear") {
      evaluatedParts.push(evaluateSingle(
        project, transition, part, slot, "to", to, toKeyArt.id, toMesh, sample,
        (to?.member.opacity ?? 0) * normalizedTime, "present", warpIssues, rigidIssues,
        correctionIssues, animation,
      ));
    } else if (part.mode === "disappear") {
      evaluatedParts.push(evaluateSingle(
        project, transition, part, slot, "from", from, fromKeyArt.id, fromMesh, sample,
        (from?.member.opacity ?? 0) * (1 - normalizedTime), "present", warpIssues, rigidIssues,
        correctionIssues, animation,
      ));
    } else if (part.mode === "occlusion") {
      const defaultPresence = normalizedTime < 0.5 ? from?.member.presence ?? "present" : "occluded";
      evaluatedParts.push(evaluateSingle(
        project, transition, part, slot, "from", from, fromKeyArt.id, fromMesh, sample,
        from?.member.opacity ?? 0, defaultPresence, warpIssues, rigidIssues,
        correctionIssues, animation,
      ));
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
    ...warpIssues.map((entry) => diagnostic(
      transition.id,
      entry.code,
      "error",
      entry.semanticSlotId,
      clampedTicks,
      entry.details,
    )),
    ...rigidIssues.map((entry) => diagnostic(
      transition.id,
      entry.code,
      "error",
      entry.semanticSlotId,
      clampedTicks,
      entry.details,
    )),
    ...correctionIssues.map((entry) => diagnostic(
      transition.id,
      entry.code,
      "error",
      entry.semanticSlotId,
      clampedTicks,
      entry.details,
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
