import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSequence } from "../src/core/sequence-evaluator.js";
import { createIdFactory, createProject, createSceneNode } from "../src/model/project.js";

const step = Object.freeze({ kind: "step" });

function fixture() {
  const project = createProject({
    name: "Mesh target resolution",
    width: 100,
    height: 100,
    idFactory: createIdFactory("mesh_target"),
  });
  const rootId = project.scene.rootId;
  project.scene.nodes.part = createSceneNode({
    id: "part",
    displayName: "Part",
    parentId: rootId,
    sourceRef: {
      sourceAssetId: "source_psd",
      sourceKey: "layer:42",
      path: "Part",
      identityPath: "id:42",
      identityKind: "native",
      orderDependent: false,
      rasterFingerprint: null,
    },
    bounds: { left: 0, top: 0, right: 10, bottom: 10 },
  });
  project.scene.nodes[rootId].children.push("part");
  project.meshes.push({ id: "mesh_subject" });
  project.meshTopologies.push({
    id: "topology",
    vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2],
    vertexMetadata: {},
    nextVertexSequence: 1,
  });
  project.meshKeyforms.push({
    id: "keyform",
    topologyId: "topology",
    keyArtId: "key",
    semanticSlotId: "slot",
    positions: [0, 0, 10, 0, 0, 10],
    uvs: [0, 0, 1, 0, 0, 1],
  });
  project.keyArts.push({
    id: "key",
    displayName: "Key",
    rootNodeId: rootId,
    members: [{
      nodeId: "part",
      appearanceId: "appearance",
      opacity: 1,
      presence: "present",
      drawOrder: 0,
      clipping: { sourceNodeId: null },
    }],
    metadata: {},
  });
  project.semanticSlots.push({
    id: "slot",
    displayName: "Part",
    role: null,
    mappings: [{ keyArtId: "key", nodeId: "part" }],
    metadata: {},
  });
  project.animation.deformationSamples.push({
    id: "sample",
    meshId: "mesh_subject",
    topologyId: "topology",
    offsets: [{ vertexId: "v1", dx: 5, dy: 7 }],
  });
  project.temporalPrograms.push(
    {
      id: "sequence_program",
      durationTicks: 100,
      tracks: [],
      events: [],
      regions: [],
    },
    {
      id: "clip_program",
      durationTicks: 100,
      tracks: [{
        trackId: "mesh_track",
        version: 1,
        kind: "MeshDeformationTrack",
        target: { meshId: "mesh_subject" },
        channels: {
          deformation: {
            keyframes: [{
              id: "mesh_key",
              timeTicks: 0,
              value: { deformationSampleId: "sample", weight: 1 },
              interpolationToNext: step,
            }],
          },
        },
      }],
      events: [],
      regions: [],
    },
  );
  project.animation.clips.push({
    id: "clip",
    displayName: "Mesh motion",
    temporalProgramId: "clip_program",
    defaultLoopMode: "once",
    metadata: {},
  });
  project.sequences.push({
    id: "sequence",
    displayName: "Shot",
    temporalProgramId: "sequence_program",
    viewLaneItems: [{
      id: "hold",
      kind: "KeyArtHold",
      keyArtId: "key",
      startTicks: 0,
      endTicks: 100,
    }],
    clipInstances: [{
      id: "instance",
      clipId: "clip",
      startTicks: 0,
      endTicks: 100,
      sourceOffsetTicks: 0,
      playbackRate: { numerator: 1, denominator: 1 },
      loopMode: "once",
      weight: 1,
      layer: 0,
      enabled: true,
    }],
    metadata: {},
  });
  return project;
}

test("MeshDeformationTrack resolves by active topology with production-style PSD source identity", () => {
  const project = fixture();
  const result = evaluateSequence(project, "sequence", 50);
  assert.deepEqual(
    result.evaluatedParts[0].renderInstances[0].mesh.positions.slice(0, 2),
    [5, 7],
  );
  assert.ok(!result.diagnostics.some((entry) =>
    entry.code === "ANIMATION_TRACK_TARGET_INVALID" ||
    entry.code === "ANIMATION_TOPOLOGY_INCOMPATIBLE"));
});
