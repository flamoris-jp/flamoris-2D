import { transformPoint } from "./transforms.js";
import { boneSkinMatrixInGeometrySpace } from "./bone-skin-matrix.js";
import { canonicalizeSkinVertexWeights } from "../model/skin-binding.js";

const IDENTITY_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnostic(code, message, {
  bindingId = null,
  topologyId = null,
  vertexId = null,
  boneId = null,
  details = null,
} = {}) {
  return {
    code,
    bindingId,
    topologyId,
    vertexId,
    boneId,
    message,
    ...(details ? { details } : {}),
  };
}

function sortedDiagnostics(values) {
  return values.sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.bindingId || "", right.bindingId || "") ||
    compareText(left.topologyId || "", right.topologyId || "") ||
    compareText(left.vertexId || "", right.vertexId || "") ||
    compareText(left.boneId || "", right.boneId || "") ||
    compareText(left.message, right.message));
}

function unchanged(mesh, diagnostics = []) {
  return {
    mesh: { ...mesh, positions: [...(mesh?.positions || [])] },
    diagnostics: sortedDiagnostics(diagnostics),
  };
}

function finiteAffine(matrix) {
  return (Array.isArray(matrix) || ArrayBuffer.isView(matrix)) &&
    matrix.length === 6 && [...matrix].every(Number.isFinite);
}

/**
 * Pure deterministic 2D LBS. Stable MeshTopology vertex IDs associate
 * persistent weights with the current flat position array; evaluated FK poses
 * supply the only Bone skin matrices used by the calculation.
 */
export function evaluateLinearBlendSkinning({
  mesh,
  topology,
  binding,
  bonePoses,
  targetWorldTransform = IDENTITY_AFFINE,
}) {
  if (!binding || binding.enabled === false) return unchanged(mesh);
  const issues = [];
  const bindingId = binding?.id || null;
  const topologyId = topology?.id || binding?.topologyId || null;
  if (!mesh || (!Array.isArray(mesh.positions) && !ArrayBuffer.isView(mesh.positions)) ||
    ![...mesh.positions].every(Number.isFinite)) {
    issues.push(diagnostic(
      "SKIN_MESH_POSITION_INVALID",
      "Skinning requires a flat finite mesh position array.",
      { bindingId, topologyId },
    ));
  }
  const vertexIds = Array.isArray(topology?.vertexIds) ? topology.vertexIds : [];
  if (!topology || !vertexIds.length || new Set(vertexIds).size !== vertexIds.length) {
    issues.push(diagnostic(
      "SKIN_TOPOLOGY_INVALID",
      "Skinning requires unique stable MeshTopology vertex IDs.",
      { bindingId, topologyId },
    ));
  }
  if (binding?.topologyId !== topology?.id) {
    issues.push(diagnostic(
      "SKIN_BINDING_TOPOLOGY_MISMATCH",
      "SkinBinding topology does not match the evaluated mesh topology.",
      { bindingId, topologyId, details: { bindingTopologyId: binding?.topologyId || null } },
    ));
  }
  if (mesh?.positions?.length !== vertexIds.length * 2) {
    issues.push(diagnostic(
      "SKIN_MESH_POSITION_COUNT_MISMATCH",
      "Skinning requires exactly two position values per stable topology vertex.",
      {
        bindingId,
        topologyId,
        details: { positionCount: mesh?.positions?.length ?? null, vertexCount: vertexIds.length },
      },
    ));
  }
  const geometryTransformValid = finiteAffine(targetWorldTransform) &&
    Math.abs(targetWorldTransform[0] * targetWorldTransform[3] -
      targetWorldTransform[1] * targetWorldTransform[2]) >= 1e-12;
  if (!geometryTransformValid) {
    issues.push(diagnostic(
      "SKIN_GEOMETRY_TRANSFORM_INVALID",
      "Skinning requires an invertible finite target world transform.",
      { bindingId, topologyId },
    ));
  }
  let vertexWeights = [];
  try {
    vertexWeights = canonicalizeSkinVertexWeights(binding?.vertexWeights);
  } catch (error) {
    issues.push(diagnostic(
      error?.code || "SKIN_BINDING_INVALID",
      error?.message || "SkinBinding weights are invalid.",
      {
        bindingId,
        topologyId,
        vertexId: error?.details?.vertexId || null,
        boneId: error?.details?.boneId || null,
        details: error?.details || null,
      },
    ));
  }
  const weightsByVertex = new Map(vertexWeights.map((entry) => [entry.vertexId, entry]));
  const topologyVertexIds = new Set(vertexIds);
  for (const entry of vertexWeights) {
    if (!topologyVertexIds.has(entry.vertexId)) {
      issues.push(diagnostic(
        "SKIN_BINDING_VERTEX_MISSING",
        "Skin weight references a stable vertex outside the evaluated MeshTopology.",
        { bindingId, topologyId, vertexId: entry.vertexId },
      ));
    }
  }
  for (const vertexId of [...vertexIds].sort(compareText)) {
    if (!weightsByVertex.has(vertexId)) {
      issues.push(diagnostic(
        "SKIN_BINDING_VERTEX_MISSING",
        "Enabled SkinBinding must weight every stable topology vertex.",
        { bindingId, topologyId, vertexId },
      ));
    }
  }
  const posesByBone = new Map();
  for (const pose of [...(Array.isArray(bonePoses) ? bonePoses : [])]
    .sort((left, right) => compareText(left?.boneId || "", right?.boneId || ""))) {
    if (!pose?.boneId || !finiteAffine(pose.skinMatrix)) {
      issues.push(diagnostic(
        "SKIN_BONE_POSE_INVALID",
        "Skinning requires a finite affine skin matrix for every evaluated Bone pose.",
        { bindingId, topologyId, boneId: pose?.boneId || null },
      ));
      continue;
    }
    if (posesByBone.has(pose.boneId)) {
      issues.push(diagnostic(
        "SKIN_BONE_POSE_DUPLICATE",
        "Skinning received duplicate evaluated poses for one Bone.",
        { bindingId, topologyId, boneId: pose.boneId },
      ));
      continue;
    }
    if (!geometryTransformValid) {
      posesByBone.set(pose.boneId, pose);
    } else {
      posesByBone.set(pose.boneId, {
        ...pose,
        geometrySkinMatrix: boneSkinMatrixInGeometrySpace(
          pose.skinMatrix,
          targetWorldTransform,
        ),
      });
    }
  }
  for (const entry of vertexWeights) {
    for (const influence of entry.influences) {
      if (!posesByBone.has(influence.boneId)) {
        issues.push(diagnostic(
          "SKIN_BONE_POSE_MISSING",
          "Skin influence references a Bone without an evaluated FK pose.",
          {
            bindingId,
            topologyId,
            vertexId: entry.vertexId,
            boneId: influence.boneId,
          },
        ));
      }
    }
  }
  if (issues.length) return unchanged(mesh, issues);

  const positions = [];
  for (let index = 0; index < vertexIds.length; index += 1) {
    const vertexId = vertexIds[index];
    const point = { x: mesh.positions[index * 2], y: mesh.positions[index * 2 + 1] };
    let x = 0;
    let y = 0;
    for (const influence of weightsByVertex.get(vertexId).influences) {
      const transformed = transformPoint(
        posesByBone.get(influence.boneId).geometrySkinMatrix,
        point,
      );
      x += influence.weight * transformed.x;
      y += influence.weight * transformed.y;
    }
    positions.push(x, y);
  }
  return { mesh: { ...mesh, positions }, diagnostics: [] };
}
