import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject } from '../../src/model/project.js';
import { EditorSession } from '../../src/commands/editor.js';
const initial = JSON.parse(await readFile(new URL('./rig-conformance.json', import.meta.url), 'utf8')).initial;
const root = initial.scene.rootId;
const cmd = (type, payload) => ({ type, payload });
const steps = [];
const invalidSteps = new Set();
const edit = (type, payload, cycle = true) => {
  steps.push({ op: 'transaction', label: type, commands: [cmd(type, payload)] });
  if (cycle) steps.push({ op: 'undo' }, { op: 'redo' });
};
const invalid = (type, payload) => { invalidSteps.add(steps.length); edit(type, payload, false); };
const rest = { x: 1, y: -2, rotation: 0.25 };
const bone = { id: 'new_a', displayName: '  新しい骨  ', parentNodeId: root, restLocalTransform: rest, length: 20, index: 1 };
edit('bone.create', bone);
invalid('bone.create', bone);
invalid('bone.create', { ...bone, id: 'invalid', parentNodeId: 'part' });
invalid('bone.create', { ...bone, id: 'invalid', parentNodeId: 'missing' });
edit('bone.create', { ...bone, id: 'new_b', parentNodeId: 'new_a', enabled: false, index: 100 });
invalid('bone.remove', { boneId: 'new_a' });
invalid('bone.reparent', { boneId: 'new_a', parentNodeId: 'new_b' });
edit('bone.rename', { boneId: 'new_b', displayName: '\u3000改名\uFEFF' });
edit('bone.set_enabled', { boneId: 'new_b', enabled: true });
edit('bone.set_rest', { boneId: 'new_a', restLocalTransform: { x: 4, y: 5, rotation: -0.75 }, length: 30 });
edit('bone.reparent', { boneId: 'new_b', parentNodeId: root, index: 0 });
edit('bone.reparent', { boneId: 'new_b', parentNodeId: root, index: 2 });
edit('bone.reparent', { boneId: 'new_b', parentNodeId: 'new_a' });
const pose = { boneId: 'new_b', keyArtId: 'key_a', localDelta: { x: 2, y: 3, rotation: 0.5 } };
edit('bone.set_keyform', pose);
edit('bone.set_keyform', { ...pose, localDelta: { x: 4, y: 1, rotation: -1 } });
invalid('bone.set_rest', { boneId: 'new_a', restLocalTransform: rest, length: 10 });
invalid('bone.reparent', { boneId: 'new_b', parentNodeId: root });
invalid('bone.remove', { boneId: 'new_b' });
edit('bone.reset_keyform', { boneId: 'new_b', keyArtId: 'key_a' });
invalid('bone.reset_keyform', { boneId: 'new_b', keyArtId: 'key_a' });
invalid('bone.set_keyform', { ...pose, keyArtId: 'missing' });
const rigid = { id: 'dep', targetNodeId: 'part', boneId: 'new_b', enabled: true };
edit('bone.create_rigid_binding', { binding: rigid });
invalid('bone.set_rest', { boneId: 'new_a', restLocalTransform: rest, length: 10 });
invalid('bone.remove', { boneId: 'new_b' });
edit('bone.remove_rigid_binding', { bindingId: 'dep' });
const skin = { id: 'skin_dep', targetNodeId: 'part', topologyId: 'topology', enabled: true, vertexWeights: ['v1', 'v2', 'v3'].map(vertexId => ({ vertexId, influences: [{ boneId: 'new_b', weight: 1 }] })) };
edit('skin.create_binding', { binding: skin });
invalid('bone.reparent', { boneId: 'new_a', parentNodeId: root });
invalid('bone.remove', { boneId: 'new_b' });
edit('skin.remove_binding', { bindingId: 'skin_dep' });
const rotation = { id: 'limit', boneId: 'new_b', enabled: true, minRotation: -1, maxRotation: 1 };
edit('bone.create_rotation_constraint', { constraint: rotation });
invalid('bone.remove', { boneId: 'new_b' });
edit('bone.remove_rotation_constraint', { constraintId: 'limit' });
const ik = { id: 'ik_dep', rootBoneId: 'bone_a', midBoneId: 'bone_b', endBoneId: 'bone_c', enabled: true, bendDirection: 'counterclockwise' };
edit('bone.create_two_bone_ik', { constraint: ik });
invalid('bone.set_rest', { boneId: 'bone_a', restLocalTransform: rest, length: 10 });
invalid('bone.reparent', { boneId: 'bone_c', parentNodeId: root });
edit('bone.remove_two_bone_ik', { constraintId: 'ik_dep' });
edit('bone.remove', { boneId: 'new_b' });
edit('bone.remove', { boneId: 'new_a' });
invalid('bone.rename', { boneId: 'missing', displayName: 'missing' });
invalid('bone.remove_internal', { boneId: 'bone_d' });
invalid('bone.remove_keyform_internal', { boneId: 'bone_d', keyArtId: 'key_a' });
// Reset the fixture to keep domain evidence compact and test replace/history reset.
steps.push({ op: 'replace', project: initial, saved: true });
const ids = (prefix, dimension) => Array.from({ length: dimension ** 2 }, (_, i) => `${prefix}_${i}`);
const bounds = { left: -10, top: -20, right: 30, bottom: 60 };
const warp = { id: 'warp', displayName: '  Warp  ', parentNodeId: root, columns: 2, rows: 2, bounds, controlPointIds: ids('p', 2), index: 0 };
edit('deformer.create_warp', warp);
invalid('deformer.create_warp', warp);
invalid('deformer.create_warp', { ...warp, id: 'invalid', parentNodeId: 'missing' });
invalid('deformer.create_warp', { ...warp, id: 'invalid', parentNodeId: 'bone_a' });
invalid('deformer.create_warp', { ...warp, id: 'invalid', columns: 3, rows: 2 });
invalid('deformer.create_warp', { ...warp, id: 'invalid', controlPointIds: ['p0'] });
edit('deformer.rename', { deformerId: 'warp', displayName: '\u3000曲げ\uFEFF' });
for (const dimension of [3, 4, 2]) edit('deformer.set_grid', { deformerId: 'warp', columns: dimension, rows: dimension, bounds, controlPointIds: ids('p', dimension) });
edit('deformer.create_warp', { ...warp, id: 'nested', parentNodeId: 'warp', controlPointIds: ids('n', 2) });
edit('deformer.reparent_node', { nodeId: 'part', parentId: 'warp', index: 0 });
invalid('deformer.reparent_node', { nodeId: 'warp', parentId: 'nested' });
const keyform = { deformerId: 'warp', keyArtId: 'key_a', controlPoints: ids('p', 2).map((controlPointId, i) => ({ controlPointId, x: i * 10, y: -i * 5 })).reverse() };
invalid('deformer.move_control_points', { ...keyform, controlPoints: [keyform.controlPoints[0]] });
invalid('deformer.set_keyform', { ...keyform, controlPoints: [keyform.controlPoints[0]] });
invalid('deformer.set_keyform', { ...keyform, controlPoints: [keyform.controlPoints[0], keyform.controlPoints[0]] });
invalid('deformer.set_keyform', { ...keyform, controlPoints: [{ controlPointId: 'missing', x: 0, y: 0 }] });
edit('deformer.set_keyform', keyform);
edit('deformer.set_keyform', { ...keyform, controlPoints: keyform.controlPoints.map(p => ({ ...p, x: p.x + 1 })) });
edit('deformer.move_control_points', { ...keyform, controlPoints: [keyform.controlPoints[2], keyform.controlPoints[0]].map(p => ({ ...p, x: 15.5, y: -3 })) });
invalid('deformer.move_control_points', { ...keyform, controlPoints: [keyform.controlPoints[0], keyform.controlPoints[0]] });
invalid('deformer.set_grid', { deformerId: 'warp', columns: 3, rows: 3, bounds, controlPointIds: ids('p', 3) });
edit('deformer.reset_control_points', { deformerId: 'warp', keyArtId: 'key_a' });
edit('deformer.reset_control_points', { deformerId: 'nested', keyArtId: 'key_a' });
edit('deformer.remove', { deformerId: 'warp' });
edit('deformer.remove', { deformerId: 'nested' });
invalid('deformer.remove', { deformerId: 'missing' });
invalid('deformer.remove_internal', { deformerId: 'warp' });
invalid('deformer.remove_keyform_internal', { deformerId: 'warp', keyArtId: 'key_a' });
// A Bone child must retain the current JS candidate-admission rejection atomically.
edit('deformer.create_warp', warp);
edit('bone.create', { ...bone, parentNodeId: 'warp' });
invalid('deformer.remove', { deformerId: 'warp' });
edit('bone.remove', { boneId: 'new_a' });
edit('deformer.remove', { deformerId: 'warp' });
invalidSteps.add(steps.length);
steps.push({ op: 'transaction', label: 'preflight', commands: [cmd('bone.remove', { boneId: 'missing' }), cmd('deformer.rename', { deformerId: 'missing', displayName: 7 })] });
steps.push({ op: 'markSaved' });
const session = new EditorSession(initial);
const expected = steps.map(step => {
  let error = '';
  try {
    if (step.op === 'transaction') session.executeTransaction(step.commands, { label: step.label });
    else if (step.op === 'undo') session.undo();
    else if (step.op === 'redo') session.redo();
    else if (step.op === 'replace') session.replaceProject(step.project, { saved: step.saved });
    else if (step.op === 'markSaved') session.markSaved();
  } catch (e) { error = e.code || 'project.invalid'; }
  return { error, project: cloneProject(session.project), history: cloneProject(session.history), state: {
    revisionCounter: session.revisionCounter, currentRevision: session.currentRevision, savedRevision: session.savedRevision,
    undoDepth: session.undoStack.length, redoDepth: session.redoStack.length, historyDepth: session.history.length, dirty: session.isDirty,
  } };
});
// Every explicitly invalid edit must reject, and every valid cycle must succeed.
for (let i = 0; i < steps.length; ++i) {
  if (invalidSteps.has(i)) assert.notEqual(expected[i].error, '', `step ${i}: expected rejection`);
  else assert.equal(expected[i].error, '', `step ${i}: ${steps[i].label || steps[i].op}`);
}
const rows = values => values.map(value => '    ' + JSON.stringify(value)).join(',\n');
const text = `{\n  "initial": ${JSON.stringify(initial)},\n  "steps": [\n${rows(steps)}\n  ],\n  "expected": [\n${rows(expected)}\n  ]\n}\n`;
const path = new URL('./hierarchy-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Hierarchy fixtures differ from current JS');
