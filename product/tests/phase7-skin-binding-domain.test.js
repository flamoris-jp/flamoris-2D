import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeSkinInfluences,
  createSkinBinding,
  SKIN_WEIGHT_SUM_TOLERANCE,
} from "../src/model/skin-binding.js";

test("SkinBinding canonicalizes stable vertex and Bone influence order", () => {
  const binding = createSkinBinding({
    id: "skin",
    targetNodeId: "part",
    topologyId: "topology",
    enabled: false,
    vertexWeights: [
      {
        vertexId: "v2",
        influences: [
          { boneId: "bone_b", weight: 0.25 },
          { boneId: "bone_a", weight: 0.75 },
        ],
      },
      { vertexId: "v1", influences: [{ boneId: "bone_a", weight: 1 }] },
    ],
  });
  assert.deepEqual(binding.vertexWeights.map((entry) => entry.vertexId), ["v1", "v2"]);
  assert.deepEqual(binding.vertexWeights[1].influences, [
    { boneId: "bone_a", weight: 0.75 },
    { boneId: "bone_b", weight: 0.25 },
  ]);
});

test("SkinBinding canonicalization rejects duplicate stable identities", () => {
  assert.throws(() => createSkinBinding({
    id: "skin",
    targetNodeId: "part",
    topologyId: "topology",
    vertexWeights: [
      { vertexId: "v1", influences: [{ boneId: "bone", weight: 1 }] },
      { vertexId: "v1", influences: [{ boneId: "bone", weight: 1 }] },
    ],
  }), { code: "SKIN_BINDING_VERTEX_DUPLICATE" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: 0.5 },
    { boneId: "bone", weight: 0.5 },
  ]), { code: "SKIN_BINDING_INFLUENCE_DUPLICATE" });
});

test("SkinBinding accepts only positive normalized one-to-four influence weights", () => {
  assert.equal(canonicalizeSkinInfluences([
    { boneId: "bone_a", weight: 0.5 + SKIN_WEIGHT_SUM_TOLERANCE / 4 },
    { boneId: "bone_b", weight: 0.5 },
  ]).reduce((sum, entry) => sum + entry.weight, 0), 1);
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: 0 },
  ]), { code: "SKIN_BINDING_WEIGHT_INVALID" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone", weight: Number.NaN },
  ]), { code: "SKIN_BINDING_WEIGHT_INVALID" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "bone_a", weight: 0.4 },
    { boneId: "bone_b", weight: 0.4 },
  ]), { code: "SKIN_BINDING_WEIGHT_NOT_NORMALIZED" });
  assert.throws(() => canonicalizeSkinInfluences([
    { boneId: "a", weight: 0.2 },
    { boneId: "b", weight: 0.2 },
    { boneId: "c", weight: 0.2 },
    { boneId: "d", weight: 0.2 },
    { boneId: "e", weight: 0.2 },
  ]), { code: "SKIN_BINDING_INFLUENCE_COUNT_INVALID" });
});
