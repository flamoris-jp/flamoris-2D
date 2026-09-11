import { evaluateLinearBlendSkinning } from "./linear-blend-skinning-evaluator.js";
import {
  evaluateEndpointProjectedBoneFk,
  evaluateMorphProjectedBoneFk,
} from "./rigid-bone-evaluator.js";
import { skinBindingForTarget } from "../model/skin-binding-validation.js";

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

function withFkDiagnostics(mesh, binding, fk) {
  return {
    mesh,
    diagnostics: fk.diagnostics.map((entry) => ({
      ...entry,
      bindingId: binding.id,
      topologyId: binding.topologyId,
    })),
  };
}

export function evaluateEndpointSkinMesh(project, {
  targetNodeId, keyArtId, topology, mesh, targetWorldTransform,
  poseForBone = null, warpKeyformForDeformer = undefined, transformOverrides = null,
}) {
  const binding = skinBindingForTarget(project, targetNodeId);
  if (!binding) return { mesh, diagnostics: [] };
  const fk = evaluateEndpointProjectedBoneFk(project, keyArtId, {
    poseForBone,
    warpKeyformForDeformer,
    transformOverrides,
  });
  if (fk.diagnostics.length) return withFkDiagnostics(mesh, binding, fk);
  return evaluateLinearBlendSkinning({
    mesh, topology, binding, bonePoses: fk.poses, targetWorldTransform,
  });
}

function compatibleBindings(from, to) {
  return from && to && from.topologyId === to.topologyId &&
    JSON.stringify(from.vertexWeights) === JSON.stringify(to.vertexWeights);
}

export function evaluateMorphSkinMesh(project, {
  fromTargetNodeId, toTargetNodeId, fromKeyArtId, toKeyArtId,
  geometryWeight, topology, mesh, targetWorldTransform,
  poseForBone = null, warpKeyformForDeformer = undefined, transformOverrides = null,
}) {
  const fromBinding = skinBindingForTarget(project, fromTargetNodeId);
  const toBinding = skinBindingForTarget(project, toTargetNodeId);
  if (!fromBinding && !toBinding) return { mesh, diagnostics: [] };
  if (!compatibleBindings(fromBinding, toBinding) ||
    fromBinding.topologyId !== topology?.id) {
    return { mesh, diagnostics: [diagnostic(
      "SKIN_TRANSITION_INCOMPATIBLE",
      "Morph endpoints must use compatible enabled SkinBindings.",
      {
        bindingId: fromBinding?.id || toBinding?.id || null,
        topologyId: topology?.id || null,
        details: {
          fromBindingId: fromBinding?.id || null,
          toBindingId: toBinding?.id || null,
          fromTopologyId: fromBinding?.topologyId || null,
          toTopologyId: toBinding?.topologyId || null,
        },
      },
    )] };
  }
  const fk = evaluateMorphProjectedBoneFk(
    project, fromKeyArtId, toKeyArtId, geometryWeight, {
      poseForBone,
      warpKeyformForDeformer,
      transformOverrides,
    },
  );
  if (fk.diagnostics.length) return withFkDiagnostics(mesh, fromBinding, fk);
  return evaluateLinearBlendSkinning({
    mesh, topology, binding: fromBinding, bonePoses: fk.poses, targetWorldTransform,
  });
}
