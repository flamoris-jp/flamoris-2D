import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject, createSceneNode } from '../../src/model/project.js';
import { boneSceneTransform } from '../../src/model/bone.js';
import { validateProject } from '../../src/model/validation.js';
import { EditorSession } from '../../src/commands/editor.js';
const corpus = JSON.parse(await readFile(new URL('./validation-domain-projects.json', import.meta.url), 'utf8'));
const initial = cloneProject(corpus.find(entry => entry.name === 'domain_keyart_unknown_member').project);
const root = initial.scene.nodes[initial.scene.rootId];
initial.scene.nodes.part = createSceneNode({ id: 'part', displayName: 'Artwork', parentId: root.id });
root.children.push('part'); initial.rig.skinBindings = [];
for (const [childId, parentId] of [['bone_b', 'bone_a'], ['bone_c', 'bone_b']]) {
  root.children = root.children.filter(id => id !== childId);
  const node = initial.scene.nodes[childId], bone = initial.rig.bones.find(entry => entry.id === childId);
  node.parentId = parentId; initial.scene.nodes[parentId].children.push(childId);
  bone.parentNodeId = parentId; bone.restLocalTransform = { x: 10, y: 0, rotation: 0 };
  node.transform = boneSceneTransform(bone.restLocalTransform);
}
for (const id of ['bone_\uE000', 'bone_\u{10000}']) {
  const rest = { x: 0, y: 0, rotation: 0 };
  initial.scene.nodes[id] = createSceneNode({ id, kind: 'bone', displayName: id, parentId: root.id, transform: boneSceneTransform(rest) });
  root.children.push(id); initial.rig.bones.push({ id, parentNodeId: root.id, restLocalTransform: rest, length: 10, enabled: true });
}
assert.deepEqual(validateProject(initial).filter(issue => issue.severity === 'error'), []);
const cmd = (type, payload) => ({ type, payload });
const steps = [];
const edit = (type, payload, cycle = true) => {
  steps.push({ op: 'transaction', label: type, commands: [cmd(type, payload)] });
  if (cycle) steps.push({ op: 'undo' }, { op: 'redo' });
};
const invalid = (type, payload) => edit(type, payload, false);
const rigid = { id: 'rigid', targetNodeId: 'part', boneId: 'bone_a', enabled: true };
edit('bone.create_rigid_binding', { binding: rigid });
edit('bone.set_rigid_binding_bone', { bindingId: 'rigid', boneId: 'bone_d' });
edit('bone.set_rigid_binding_enabled', { bindingId: 'rigid', enabled: false });
invalid('bone.set_rigid_binding_bone', { bindingId: 'rigid', boneId: 'missing' });
invalid('bone.create_rigid_binding', { binding: rigid });
edit('bone.remove_rigid_binding', { bindingId: 'rigid' });
invalid('bone.remove_rigid_binding', { bindingId: 'missing' });
const rotation = { id: 'rotation', boneId: 'bone_d', enabled: true, minRotation: -1, maxRotation: 1 };
edit('bone.create_rotation_constraint', { constraint: rotation });
edit('bone.set_rotation_constraint_bounds', { constraintId: 'rotation', minRotation: -2, maxRotation: 2 });
edit('bone.set_rotation_constraint_enabled', { constraintId: 'rotation', enabled: false });
invalid('bone.set_rotation_constraint_bounds', { constraintId: 'rotation', minRotation: 2, maxRotation: 1 });
edit('bone.remove_rotation_constraint', { constraintId: 'rotation' });
invalid('bone.remove_rotation_constraint', { constraintId: 'missing' });
const ik = { id: 'ik', rootBoneId: 'bone_a', midBoneId: 'bone_b', endBoneId: 'bone_c', enabled: true, bendDirection: 'counterclockwise' };
edit('bone.create_two_bone_ik', { constraint: ik });
edit('bone.set_two_bone_ik_bend_direction', { constraintId: 'ik', bendDirection: 'clockwise' });
edit('bone.set_two_bone_ik_enabled', { constraintId: 'ik', enabled: false });
invalid('bone.set_two_bone_ik_bend_direction', { constraintId: 'ik', bendDirection: 'sideways' });
edit('bone.remove_two_bone_ik', { constraintId: 'ik' });
invalid('bone.remove_two_bone_ik', { constraintId: 'missing' });
const weight = (vertexId, influences = [{ boneId: 'bone_a', weight: 1 }]) => ({ vertexId, influences });
const skin = { id: 'skin', targetNodeId: 'part', topologyId: 'topology', enabled: true, vertexWeights: [weight('v3'), weight('v1'), weight('v2')] };
edit('skin.create_binding', { binding: skin });
edit('skin.set_enabled', { bindingId: 'skin', enabled: false });
edit('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v1', influences: [{ boneId: 'bone_b', weight: 0.2 }, { boneId: 'bone_a', weight: 0.80000000001 }] });
edit('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v2', influences: [{ boneId: 'bone_\uE000', weight: 0.5 }, { boneId: 'bone_\u{10000}', weight: 0.5 }] });
edit('skin.set_weights_bulk', { bindingId: 'skin', vertexWeights: [weight('v3', [{ boneId: 'bone_d', weight: 1 }]), weight('v1')] });
invalid('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v1', influences: [{ boneId: 'bone_a', weight: 0.5 }, { boneId: 'bone_a', weight: 0.5 }] });
invalid('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v1', influences: [{ boneId: 'bone_a', weight: 0.2 }] });
invalid('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v1', influences: [{ boneId: 'bone_a', weight: 1.1 }] });
invalid('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v1', influences: [{ boneId: 'bone_a', weight: 0 }] });
invalid('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'missing', influences: [{ boneId: 'bone_a', weight: 1 }] });
invalid('skin.set_weights_bulk', { bindingId: 'skin', vertexWeights: [weight('v1'), weight('v1')] });
invalid('skin.set_weights_bulk', { bindingId: 'skin', vertexWeights: [weight('missing')] });
edit('skin.clear_vertex_weights', { bindingId: 'skin', vertexId: 'v1' });
edit('skin.set_vertex_weights', { bindingId: 'skin', vertexId: 'v1', influences: [{ boneId: 'bone_b', weight: 1 }] });
edit('skin.remove_binding', { bindingId: 'skin' });
invalid('skin.remove_binding', { bindingId: 'missing' });
const keyform = { id: 'correction', topologyId: 'topology', keyArtId: 'key_a', semanticSlotId: 'slot', vertexOffsets: [{ vertexId: 'v3', x: 0, y: 0 }, { vertexId: 'v1', x: 2, y: -3 }] };
edit('mesh_form.create_keyform', { keyform });
edit('mesh_form.set_vertex_offsets', { keyformId: 'correction', vertexOffsets: [{ vertexId: 'v3', x: 1, y: 2 }, { vertexId: 'v1', x: 0, y: 0 }] });
invalid('mesh_form.set_vertex_offsets', { keyformId: 'correction', vertexOffsets: [{ vertexId: 'v1', x: 0, y: 0 }, { vertexId: 'v1', x: 2, y: 1 }] });
invalid('mesh_form.set_vertex_offsets', { keyformId: 'correction', vertexOffsets: [{ vertexId: 'missing', x: 1, y: 1 }] });
edit('mesh_form.reset_keyform', { keyformId: 'correction' });
invalid('mesh_form.reset_keyform', { keyformId: 'missing' });
for (const [type, payload] of [
  ['bone.remove_rigid_binding_internal', { bindingId: 'rigid' }],
  ['bone.restore_rotation_constraint', { constraint: rotation, index: 0 }],
  ['bone.restore_two_bone_ik', { constraint: ik, index: 0 }],
  ['skin.restore_binding', { binding: skin, index: 0 }],
  ['mesh_form.restore_keyform', { keyform, index: 0 }],
]) invalid(type, payload);
// Domain failure must lose to malformed later payload at batch preflight.
steps.push({ op: 'transaction', label: 'batch preflight', commands: [cmd('skin.remove_binding', { bindingId: 'missing' }), cmd('bone.set_rotation_constraint_enabled', { constraintId: 'missing', enabled: 1 })] });
edit('animation.mesh_target.create', { meshId: 'target_a' });
edit('animation.mesh_target.create', { meshId: 'target_b' });
invalid('animation.mesh_target.create', { meshId: 'target_a' });
invalid('animation.mesh_target.remove', { meshId: 'missing' });
const sample = { id: 'sample_z', meshId: 'target_a', topologyId: 'topology', offsets: [{ vertexId: 'v3', dx: 0, dy: 0 }, { vertexId: 'v1', dx: 2, dy: -1 }] };
edit('animation.deformation_sample.create', { sample });
edit('animation.deformation_sample.create', { sample: { ...sample, id: 'sample_a', offsets: [] } });
invalid('animation.deformation_sample.create', { sample });
edit('animation.deformation_sample.update', { sampleId: 'sample_z', sample: { ...sample, meshId: 'target_b', offsets: [{ vertexId: 'v2', dx: 1, dy: 2 }] } });
invalid('animation.deformation_sample.update', { sampleId: 'sample_z', sample: { ...sample, id: 'changed' } });
invalid('animation.deformation_sample.update', { sampleId: 'sample_z', sample: { ...sample, offsets: [{ vertexId: 'v1', dx: 0, dy: 0 }, { vertexId: 'v1', dx: 1, dy: 1 }] } });
invalid('animation.deformation_sample.update', { sampleId: 'sample_z', sample: { ...sample, offsets: [{ vertexId: 'missing', dx: 1, dy: 1 }] } });
invalid('animation.mesh_target.remove', { meshId: 'target_b' });
edit('animation.deformation_sample.remove', { sampleId: 'sample_z' });
edit('animation.deformation_sample.remove', { sampleId: 'sample_a' });
invalid('animation.deformation_sample.remove', { sampleId: 'missing' });
edit('animation.mesh_target.remove', { meshId: 'target_a' });
edit('animation.mesh_target.remove', { meshId: 'target_b' });
const unicode = cloneProject(initial);
unicode.meshTopologies[0].vertexIds = ['v1', 'v_\uE000', 'v_\u{10000}'];
steps.push({ op: 'replace', project: unicode, saved: true });
edit('skin.create_binding', { binding: { ...skin, vertexWeights: [weight('v_\uE000'), weight('v_\u{10000}'), weight('v1')] } });
edit('skin.remove_binding', { bindingId: 'skin' });
edit('mesh_form.create_keyform', { keyform: { ...keyform, vertexOffsets: [{ vertexId: 'v_\uE000', x: 1, y: 1 }, { vertexId: 'v_\u{10000}', x: 2, y: 2 }] } });
edit('mesh_form.reset_keyform', { keyformId: 'correction' });
edit('animation.mesh_target.create', { meshId: 'target_u' });
edit('animation.deformation_sample.create', { sample: { ...sample, meshId: 'target_u', offsets: [{ vertexId: 'v_\uE000', dx: 1, dy: 1 }, { vertexId: 'v_\u{10000}', dx: 2, dy: 2 }] } });
steps.push({ op: 'markSaved' });
const session = new EditorSession(initial);
const expected = steps.map(step => {
  let error = '';
  try {
    if (step.op === 'transaction') session.executeTransaction(step.commands, { label: step.label });
    else if (step.op === 'undo') session.undo();
    else if (step.op === 'redo') session.redo();
    else if (step.op === 'markSaved') session.markSaved();
    else if (step.op === 'replace') session.replaceProject(step.project, { saved: step.saved });
  } catch (e) { error = e.code || 'project.invalid'; }
  return { error, project: cloneProject(session.project), history: cloneProject(session.history), state: {
    revisionCounter: session.revisionCounter, currentRevision: session.currentRevision, savedRevision: session.savedRevision,
    undoDepth: session.undoStack.length, redoDepth: session.redoStack.length, historyDepth: session.history.length, dirty: session.isDirty,
  } };
});
const rows = values => values.map(value => '    ' + JSON.stringify(value)).join(',\n');
const text = `{\n  "initial": ${JSON.stringify(initial)},\n  "steps": [\n${rows(steps)}\n  ],\n  "expected": [\n${rows(expected)}\n  ]\n}\n`;
const path = new URL('./rig-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Rig fixtures differ from current JS');
