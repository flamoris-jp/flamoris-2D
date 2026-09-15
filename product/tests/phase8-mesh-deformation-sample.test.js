import assert from "node:assert/strict";
import test from "node:test";

import { EditorSession, TransactionError } from "../src/commands/editor.js";
import { deserializeProject, migrateProjectSchema, ProjectFormatError, serializeProject }
  from "../src/io/project-json.js";
import {
  canonicalizeMeshDeformationOffsets,
  normalizeMeshDeformationSample,
} from "../src/model/mesh-deformation-sample.js";
import { createIdFactory, createProject, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { HeadlessProductAdapter } from "../src/mcp/adapter.js";

function fixture() {
  const project = createProject({ name: "Samples", width: 32, height: 32,
    idFactory: createIdFactory("samples") });
  project.meshes.push({ id: "mesh" });
  project.meshTopologies.push({ id: "topology", vertexIds: ["v1", "v2", "v3"],
    indices: [0, 1, 2], vertexMetadata: {}, nextVertexSequence: 1 });
  return project;
}

function sample(id = "sample") {
  return { id, meshId: "mesh", topologyId: "topology", offsets: [
    { vertexId: "v3", dx: 0, dy: 0 },
    { vertexId: "v2", dx: 2, dy: -1 },
    { vertexId: "v1", dx: 1, dy: 3 },
  ] };
}

test('identity-only mesh targets enable fresh sample authoring through the shared Command layer',()=>{
 const project=fixture();project.meshes=[];const session=new EditorSession(project),adapter=new HeadlessProductAdapter(session);
 const before=structuredClone(session.project);
 adapter.executeTransaction([{type:'animation.mesh_target.create',payload:{meshId:'mesh'}},{type:'animation.deformation_sample.create',payload:{sample:sample()}}]);
 const after=structuredClone(session.project);assert.deepEqual(after.meshes,[{id:'mesh'}]);assert.equal(after.animation.deformationSamples.length,1);
 assert.throws(()=>adapter.execute({type:'animation.mesh_target.remove',payload:{meshId:'mesh'}}));assert.deepEqual(session.project,after);
 session.undo();assert.deepEqual(session.project,before);session.redo();assert.deepEqual(session.project,after);
 adapter.execute({type:'animation.deformation_sample.remove',payload:{sampleId:'sample'}});
 adapter.execute({type:'animation.mesh_target.remove',payload:{meshId:'mesh'}});assert.deepEqual(session.project.meshes,[]);
 assert.throws(()=>adapter.execute({type:'animation.mesh_target.create',payload:{meshId:'legacy',baseVertices:[0,0]}}));
});

test("MeshDeformationSample has stable identity and canonical sparse offsets", () => {
  const value = normalizeMeshDeformationSample(sample());
  assert.equal(value.id, "sample");
  assert.deepEqual(value.offsets, [
    { vertexId: "v1", dx: 1, dy: 3 },
    { vertexId: "v2", dx: 2, dy: -1 },
  ]);
  assert.throws(() => canonicalizeMeshDeformationOffsets([
    { vertexId: "v1", dx: 1, dy: 0 }, { vertexId: "v1", dx: 2, dy: 0 },
  ]), { code: "ANIMATION_DEFORMATION_VERTEX_DUPLICATE" });
});

test("sample Commands Queries and Undo Redo preserve stable identity", () => {
  const session = new EditorSession(fixture());
  const adapter = new HeadlessProductAdapter(session);
  adapter.execute({ type: "animation.deformation_sample.create", payload: { sample: sample() } });
  assert.deepEqual(adapter.query("animation.deformation_sample.get", { sampleId: "sample" }).offsets
    .map((entry) => entry.vertexId), ["v1", "v2"]);
  adapter.execute({ type: "animation.deformation_sample.update", payload: {
    sampleId: "sample", sample: { ...sample(), offsets: [{ vertexId: "v3", dx: -2, dy: 4 }] },
  } });
  assert.deepEqual(adapter.query("animation.deformation_sample.list", { meshId: "mesh" })[0].offsets,
    [{ vertexId: "v3", dx: -2, dy: 4 }]);
  session.undo();
  assert.equal(adapter.query("animation.deformation_sample.get", { sampleId: "sample" }).offsets.length, 2);
  session.redo();
  adapter.execute({ type: "animation.deformation_sample.remove", payload: { sampleId: "sample" } });
  assert.deepEqual(adapter.query("animation.deformation_sample.list", {}), []);
  session.undo();
  assert.equal(adapter.query("animation.deformation_sample.get", { sampleId: "sample" }).id, "sample");
});

test("sample Save Open is canonical and evaluation-equivalent", () => {
  const project = fixture();
  project.animation.deformationSamples.push(normalizeMeshDeformationSample(sample("z")),
    normalizeMeshDeformationSample({ ...sample("a"), offsets: [{ vertexId: "v3", dx: 1, dy: 1 }] }));
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened.animation.deformationSamples.map((entry) => entry.id), ["a", "z"]);
  assert.deepEqual(reopened.animation.deformationSamples[1].offsets.map((entry) => entry.vertexId),
    ["v1", "v2"]);
  assert.deepEqual(validateProject(reopened), []);
});

test("sample validation rejects unknown fields references vertices duplicates and non-finite offsets", () => {
  const cases = [
    { ...sample(), future: true },
    { ...sample(), meshId: "missing" },
    { ...sample(), topologyId: "missing" },
    { ...sample(), offsets: [{ vertexId: "missing", dx: 1, dy: 1 }] },
    { ...sample(), offsets: [{ vertexId: "v1", dx: 1, dy: 1 },
      { vertexId: "v1", dx: 2, dy: 2 }] },
    { ...sample(), offsets: [{ vertexId: "v1", dx: Number.NaN, dy: 1 }] },
  ];
  const expected = ["ANIMATION_DEFORMATION_SAMPLE_INVALID", "ANIMATION_TRACK_TARGET_INVALID",
    "ANIMATION_TOPOLOGY_INCOMPATIBLE", "ANIMATION_TOPOLOGY_INCOMPATIBLE",
    "ANIMATION_DEFORMATION_VERTEX_DUPLICATE", "ANIMATION_DEFORMATION_OFFSET_INVALID"];
  cases.forEach((value, index) => {
    const project = fixture();
    project.animation.deformationSamples.push(value);
    assert.ok(validateProject(project).some((issue) => issue.code === expected[index]), expected[index]);
  });
});

test("commands reject identity changes and dangling sample removal atomically", () => {
  const project = fixture();
  project.animation.deformationSamples.push(normalizeMeshDeformationSample(sample()));
  project.temporalPrograms.push({ id: "program", durationTicks: 10, events: [], regions: [], tracks: [{
    trackId: "mesh_track", version: 1, kind: "MeshDeformationTrack", target: { meshId: "mesh" },
    channels: { deformation: { keyframes: [{ id: "key", timeTicks: 0,
      value: { deformationSampleId: "sample", weight: 1 }, interpolationToNext: { kind: "step" } }] } },
  }] });
  const session = new EditorSession(project);
  assert.throws(() => session.execute({ type: "animation.deformation_sample.update", payload: {
    sampleId: "sample", sample: { ...sample("changed"), offsets: [] },
  } }), { code: "identity.changed" });
  assert.throws(() => session.execute({ type: "animation.deformation_sample.remove", payload: {
    sampleId: "sample",
  } }), (error) => error instanceof TransactionError &&
    error.issues.some((issue) => issue.code === "ANIMATION_TOPOLOGY_INCOMPATIBLE"));
  assert.equal(session.history.length, 0);
});

test("schema 14 migrates only the guaranteed empty sample placeholder to schema 15", () => {
  const legacy = fixture();
  legacy.schemaVersion = 14;
  legacy.temporalPrograms.push({ id: "program", durationTicks: 10,
    tracks: [], events: [], regions: [] });
  legacy.animation.clips.push({ id: "clip", displayName: "Clip", temporalProgramId: "program",
    defaultLoopMode: "once", metadata: {} });
  const migrated = migrateProjectSchema(legacy);
  assert.equal(PROJECT_SCHEMA_VERSION, 15);
  assert.equal(migrated.schemaVersion, 15);
  assert.equal(migrated.animation.clips[0].id, "clip");
  assert.deepEqual(migrated.animation.deformationSamples, []);
  assert.equal(migrated.temporalPrograms[0].id, "program");

  legacy.animation.deformationSamples = [{ id: "future" }];
  assert.throws(() => migrateProjectSchema(legacy), (error) =>
    error instanceof ProjectFormatError && error.code === "project.schema_invalid" &&
    error.details?.path === "animation.deformationSamples");
});
