import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject, createSceneNode } from '../../src/model/project.js';
import { validationResult } from '../../src/model/validation.js';
import { projectQueries, queryProject } from '../../src/queries/project.js';

const inventory = await readFile(new URL('../core/src/native_query_names.inc', import.meta.url), 'utf8');
const entries = [...inventory.matchAll(/FL2D_QUERY\(\w+, "([^"]+)", ([01])\)/g)].map(match => ({ name: match[1], implemented: match[2] === '1' }));
assert.deepEqual(entries.map(entry => entry.name), Object.keys(projectQueries), 'Native Query inventory differs from current Product');
const implemented = entries.filter(entry => entry.implemented).map(entry => entry.name);
const pending = entries.filter(entry => !entry.implemented).map(entry => entry.name);
const projects = [], seen = new Set();
const add = project => {
  const validation = validationResult(project);
  assert.equal(validation.valid, true, `Query fixture must be admitted Project state: ${JSON.stringify(validation.issues.filter(issue => issue.severity === 'error'))}`);
  const text = JSON.stringify(project);
  if (!seen.has(text)) { seen.add(text); projects.push(cloneProject(project)); }
};
const at = (project, path) => path.split('.').reduce((value, key) => value[key], project);
const paths = ['keyArts', 'semanticSlots', 'meshTopologies', 'meshKeyforms', 'meshFormCorrectionKeyforms', 'clippingBindings', 'rig.deformers', 'rig.warpDeformerKeyforms', 'rig.bones', 'rig.bonePoseKeyforms', 'rig.boneRotationConstraints', 'rig.twoBoneIkConstraints', 'rig.rigidBoneBindings', 'rig.skinBindings', 'animation.clips', 'animation.deformationSamples', 'temporalPrograms', 'transitions', 'sequences'];
for (const name of ['session', 'rig', 'hierarchy', 'temporal-session', 'transition-session', 'mesh-session', 'source-session']) {
  const corpus = JSON.parse(await readFile(new URL(`./${name}-conformance.json`, import.meta.url), 'utf8'));
  add(corpus.initial);
  const states = corpus.expected.map(entry => entry.project);
  for (const path of paths) {
    const best = states.reduce((left, right) => at(right, path).length > at(left, path).length ? right : left, corpus.initial);
    if (at(best, path).length) add(best);
  }
  add(states.at(-1));
}
// Non-identity ancestor/pivot matrices, hidden subtrees and JS property-key coercion.
const transformed = cloneProject(projects[0]);
const root = transformed.scene.nodes[transformed.scene.rootId];
root.transform = { position: { x: 3.25, y: -9 }, rotation: 0.37, scale: { x: 1.2, y: -0.8 }, pivot: { x: 17, y: 23 } };
const group = createSceneNode({ id: 'query_group', kind: 'group', displayName: 'Hidden parent', parentId: root.id });
group.visible = false;
group.transform = { position: { x: 11, y: 2 }, rotation: -0.83, scale: { x: -1.1, y: 2 }, pivot: { x: 7, y: -5 } };
root.children.push(group.id); transformed.scene.nodes[group.id] = group;
for (const id of ['2', '10', 'undefined', 'null', 'true', 'x,y']) {
  const child = createSceneNode({ id, displayName: id, parentId: group.id });
  child.transform = { position: { x: -13, y: 29 }, rotation: 1.13, scale: { x: 0.7, y: 0.5 }, pivot: { x: -2, y: 3 } };
  group.children.push(id); transformed.scene.nodes[id] = child;
}
add(transformed);
const hiddenRoot = cloneProject(transformed); hiddenRoot.scene.nodes[root.id].visible = false; add(hiddenRoot);
const unnamed = cloneProject(projects[0]); delete unnamed.displayName; add(unnamed);
const validationFixtures = JSON.parse(await readFile(new URL('./project-conformance.json', import.meta.url), 'utf8'));
for (const fixture of validationFixtures) {
  if (fixture.expected.some(issue => issue.severity === 'warning') && !fixture.expected.some(issue => issue.severity === 'error'))
    add(JSON.parse(fixture.projectJson));
}
const loopSource = projects.find(project => validationResult(project).issues.some(issue => issue.code === 'ANIMATION_LOOP_ENDPOINT_MISMATCH'));
assert(loopSource, 'Loop warning projection must be covered');
const loopChannels = cloneProject(loopSource);
const loopProgram = loopChannels.temporalPrograms.find(program => program.id === loopChannels.animation.clips[0].temporalProgramId);
loopProgram.tracks.push({ trackId: 'query_transform_track', version: 1, kind: 'TransformTrack', target: { nodeId: 'part_1', coordinateSpace: 'node-local' }, channels:
  Object.fromEntries(['rotation', 'positionY', 'positionX'].map((channel, index) => [channel, { keyframes: [
    { id: `query_${channel}_start`, timeTicks: 0, value: index, interpolationToNext: { kind: 'linear' } },
    { id: `query_${channel}_end`, timeTicks: loopProgram.durationTicks, value: index + 1, interpolationToNext: { kind: 'step' } },
  ] }])) });
add(loopChannels);
const vertexSource = projects.find(project => project.meshTopologies.length && !project.rig.skinBindings.length && !project.meshFormCorrectionKeyforms.length);
assert(vertexSource, 'Optional topology metadata must be covered');
const hugeVertices = cloneProject(vertexSource);
let vertexIndex = 0;
for (const topology of hugeVertices.meshTopologies) {
  delete topology.nextVertexSequence; delete topology.vertexMetadata;
  topology.vertexIds = topology.vertexIds.map(() => vertexIndex++ === 0 ? 'vtx_1000000000000000000000' : `vtx_${vertexIndex}`);
}
add(hugeVertices);

const getters = {
  'deformer.get': ['rig.deformers', 'deformerId'], 'bone.get': ['rig.bones', 'boneId'],
  'bone.get_rotation_constraint': ['rig.boneRotationConstraints', 'constraintId'],
  'bone.get_two_bone_ik': ['rig.twoBoneIkConstraints', 'constraintId'],
  'bone.get_rigid_binding': ['rig.rigidBoneBindings', 'bindingId'],
  'skin.get_binding': ['rig.skinBindings', 'bindingId'], 'skin.get_vertex_weights': ['rig.skinBindings', 'bindingId'],
  'mesh_form.get_keyform': ['meshFormCorrectionKeyforms', 'keyformId'],
  'animation.get_program': ['temporalPrograms', 'programId'], 'animation.list_tracks': ['temporalPrograms', 'programId'],
  'animation.clip.get': ['animation.clips', 'clipId'],
  'animation.deformation_sample.get': ['animation.deformationSamples', 'sampleId'],
  'keyart.get': ['keyArts', 'keyArtId'], 'semantic_slot.get': ['semanticSlots', 'semanticSlotId'],
  'semantic_slot.get_mapping': ['semanticSlots', 'semanticSlotId'],
  'mesh.get_topology': ['meshTopologies', 'topologyId'], 'mesh.get_vertex': ['meshTopologies', 'topologyId'],
  'mesh.get_keyform': ['meshKeyforms', 'keyformId'],
  'transition.get': ['transitions', 'transitionId'], 'transition.get_authoring': ['transitions', 'transitionId'],
  'sequence.get': ['sequences', 'sequenceId'], 'sequence.get_diagnostics': ['sequences', 'sequenceId'],
};
const fixtures = projects.map((project, projectIndex) => {
  const cases = [], seenRequests = new Set();
  const run = (name, input) => {
    const request = input === undefined ? { name } : { name, input };
    const text = JSON.stringify(request);
    if (seenRequests.has(text)) return;
    seenRequests.add(text);
    const before = JSON.stringify(project);
    let expected;
    try { expected = { value: queryProject(project, name, input) }; }
    catch (error) { expected = { error: { name: error.name, message: error.message } }; }
    assert.equal(JSON.stringify(project), before, `JS query mutated Project: ${name}`);
    cases.push({ request, expected: JSON.parse(JSON.stringify(expected)) });
  };
  for (const name of implemented) run(name);
  run('unknown.query');
  for (const [name, [path, key]] of Object.entries(getters)) {
    for (const entry of at(project, path)) {
      const input = { [key]: entry.id };
      if (name === 'skin.get_vertex_weights') {
        for (const weight of entry.vertexWeights) run(name, { ...input, vertexId: weight.vertexId });
      } else if (name === 'semantic_slot.get_mapping') {
        for (const mapping of entry.mappings) run(name, { ...input, keyArtId: mapping.keyArtId });
      } else if (name === 'mesh.get_vertex') {
        for (const vertexId of entry.vertexIds) run(name, { ...input, vertexId });
      }
      run(name, input);
      run(name, { ...input, vertexId: 'missing', keyArtId: 'missing' });
    }
    for (const value of ['missing', null, false, 1e-7, 1e20, 1e21, {}, ['x', null, 'y']]) run(name, { [key]: value });
  }
  for (const node of Object.values(project.scene.nodes)) {
    run('scene.get_node', { nodeId: node.id });
    run('clipping.get_for_node', { nodeId: node.id });
    run('bone.get_rigid_binding_for_target', { targetNodeId: node.id });
    run('skin.get_binding_for_target', { targetNodeId: node.id });
    run('bone.get_rotation_constraint_for_bone', { boneId: node.id });
  }
  for (const nodeId of [2, 10, null, true, {}, ['x', 'y'], 'missing']) run('scene.get_node', { nodeId });
  for (const includeHidden of [false, true, null, 0]) run('scene.get_tree', { includeHidden });
  for (const value of project.rig.warpDeformerKeyforms) run('deformer.get_keyform', { deformerId: value.deformerId, keyArtId: value.keyArtId });
  for (const value of project.rig.bonePoseKeyforms) run('bone.get_keyform', { boneId: value.boneId, keyArtId: value.keyArtId });
  for (const value of project.meshFormCorrectionKeyforms) run('mesh_form.get_for_context', { topologyId: value.topologyId, keyArtId: value.keyArtId, semanticSlotId: value.semanticSlotId });
  for (const value of project.animation.deformationSamples) {
    run('animation.deformation_sample.list', { meshId: value.meshId });
    run('animation.deformation_sample.list', { topologyId: value.topologyId });
    run('animation.deformation_sample.list', { meshId: value.meshId, topologyId: value.topologyId });
  }
  for (const meshId of ['', null, false, 'missing']) run('animation.deformation_sample.list', { meshId });
  return { name: `query-project-${projectIndex}`, project, cases };
});
const coverage = new Set(fixtures.flatMap(fixture => fixture.cases.map(entry => entry.request.name)));
for (const name of implemented) assert(coverage.has(name));
const rows = fixtures.map(fixture => JSON.stringify(fixture)).join(',\n');
const text = `{\n"implemented":${JSON.stringify(implemented)},\n"pending":${JSON.stringify(pending)},\n"fixtures":[\n${rows}\n]\n}\n`;
const path = new URL('./query-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Query fixtures differ from current JS');
console.log(`Query conformance: ${implemented.length}/72 queries; ${fixtures.length} Projects; ${fixtures.reduce((sum, fixture) => sum + fixture.cases.length, 0)} reads.`);
