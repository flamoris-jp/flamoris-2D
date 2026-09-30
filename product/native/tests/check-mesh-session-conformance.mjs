import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject } from '../../src/model/project.js';
import { EditorSession } from '../../src/commands/editor.js';
const initial = JSON.parse(await readFile(new URL('./rig-conformance.json', import.meta.url), 'utf8')).initial;
initial.keyArts.push({ ...cloneProject(initial.keyArts[0]), id: 'key_b', displayName: 'B' });
initial.semanticSlots[0].mappings.push({ keyArtId: 'key_b', nodeId: 'part' });
initial.meshKeyforms.push({ ...cloneProject(initial.meshKeyforms[0]), id: 'mesh_b', keyArtId: 'key_b', positions: [2, 3, 12, 3, 2, 13] });
delete initial.meshTopologies[0].vertexMetadata;
delete initial.meshTopologies[0].nextVertexSequence;
const cmd = (type, payload) => ({ type, payload });
const steps = [], invalidSteps = new Set();
const batch = (commands, label = 'mesh edit', cycle = true, invalid = false) => {
  if (invalid) invalidSteps.add(steps.length);
  steps.push({ op: 'transaction', label, commands });
  if (cycle) steps.push({ op: 'undo' }, { op: 'redo' });
};
const edit = (type, payload) => batch([cmd(type, payload)], type);
const invalid = (type, payload) => batch([cmd(type, payload)], type, false, true);
const target = { topologyId: 'topology' };
const generated = { ...target, replaceExisting: true, vertexIds: ['vtx_10', 'vtx_11', 'vtx_12'], indices: [0, 1, 2], positions: [0, 0, 20, 0, 0, 20], uvs: [0, 0, 1, 0, 0, 1] };
invalid('mesh_topology.clear_vertex_label', { ...target, vertexId: 'v1' });
edit('mesh_topology.set_vertex_label', { ...target, vertexId: 'v1', semanticLabel: 'corner' });
edit('mesh_topology.set_vertex_label', { ...target, vertexId: 'v1', semanticLabel: 'corner2' });
invalid('mesh_topology.set_vertex_label', { ...target, vertexId: 'v2', semanticLabel: 'corner2' });
invalid('mesh_topology.set_vertex_label', { ...target, vertexId: 'missing', semanticLabel: 'corner' });
edit('mesh_topology.clear_vertex_label', { ...target, vertexId: 'v1' });
edit('mesh_keyform.move_vertices', { keyformId: 'mesh', positions: [1, 1, 11, 1, 1, 11] });
invalid('mesh_keyform.move_vertices', { keyformId: 'mesh', positions: [0, 0] });
invalid('mesh_keyform.move_vertices', { keyformId: 'missing', positions: [0, 0] });
const skin = { id: 'skin', targetNodeId: 'part', topologyId: 'topology', enabled: true, vertexWeights: ['v1', 'v2', 'v3'].map(vertexId => ({ vertexId, influences: [{ boneId: 'bone_a', weight: 1 }] })) };
edit('skin.create_binding', { binding: skin });
const added = { ...target, vertexId: 'vtx_1', position: { x: 10, y: 10 }, uv: { x: 1, y: 1 }, semanticLabel: 'extra' };
invalid('mesh_topology.add_vertex', added);
invalid('mesh_topology.apply_generated_mesh', { ...generated, replaceExisting: false });
invalid('mesh_topology.remove_vertex', { ...target, vertexId: 'missing' });
invalid('mesh_topology.subdivide_edge', { ...target, vertexIds: ['v1', 'v1'], newVertexId: 'split' });
edit('skin.remove_binding', { bindingId: 'skin' });
invalid('mesh_topology.add_vertex', { ...added, vertexId: 'v1' });
edit('mesh_topology.add_vertex', added);
invalid('mesh_topology.create_triangle', { ...target, vertexIds: ['v1', 'v1', 'v2'] });
invalid('mesh_topology.create_triangle', { ...target, vertexIds: ['v3', 'v2', 'v1'] });
invalid('mesh_topology.create_triangle', { ...target, vertexIds: ['v1', 'v2', 'missing'] });
edit('mesh_topology.create_triangle', { ...target, vertexIds: ['v2', 'vtx_1', 'v3'] });
edit('mesh_topology.subdivide_edge', { ...target, vertexIds: ['v2', 'v3'], newVertexId: 'vtx_2' });
invalid('mesh_topology.subdivide_edge', { ...target, vertexIds: ['v1', 'vtx_1'], newVertexId: 'unused' });
invalid('mesh_topology.subdivide_edge', { ...target, vertexIds: ['v1', 'v1'], newVertexId: 'unused' });
invalid('mesh_topology.subdivide_edge', { ...target, vertexIds: ['v1', 'v2'], newVertexId: 'vtx_1' });
edit('mesh_topology.remove_vertex', { ...target, vertexId: 'v1' });
const correction = { id: 'form', topologyId: 'topology', keyArtId: 'key_a', semanticSlotId: 'slot', vertexOffsets: [{ vertexId: 'v2', x: 1, y: 2 }] };
edit('mesh_form.create_keyform', { keyform: correction });
invalid('mesh_topology.remove_vertex', { ...target, vertexId: 'vtx_1' });
invalid('mesh_topology.apply_generated_mesh', generated);
edit('mesh_topology.add_vertex', { ...added, vertexId: 'unconnected', semanticLabel: 'unconnected' });
edit('mesh_form.reset_keyform', { keyformId: 'form' });
edit('mesh_topology.remove_vertex', { ...target, vertexId: 'unconnected' });
invalid('mesh_topology.add_vertex', { ...added, vertexId: 'vtx_0' });
invalid('mesh_topology.apply_generated_mesh', { ...generated, replaceExisting: false });
invalid('mesh_topology.apply_generated_mesh', { ...generated, vertexIds: ['vtx_10', 'vtx_10', 'vtx_12'] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, positions: [0, 0] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, uvs: [0, 0] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, indices: [] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, indices: [0, 1, 3] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, indices: [0, 1, 1.5] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, indices: [0, 1, 1] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, indices: [0, 1, 2, 2, 1, 0] });
invalid('mesh_topology.apply_generated_mesh', { ...generated, positions: [0, 0, 10, 0, 20, 0] });
edit('mesh_topology.apply_generated_mesh', generated);
invalid('mesh_topology.remove_vertex', { ...target, vertexId: 'vtx_10' });
invalid('mesh_topology.add_vertex', { ...added, vertexId: 'vtx_1' });
// Independent topology ownership and near-degenerate triangles preserve failure order.
edit('mesh_topology.create', { topology: { id: 'other', vertexIds: ['owned_a', 'owned_b', 'owned_c'], indices: [0, 1, 2] } });
invalid('mesh_topology.apply_generated_mesh', { ...generated, vertexIds: ['owned_a', 'fresh_b', 'fresh_c'] });
edit('mesh_topology.add_vertex', { ...target, vertexId: 'collinear', position: { x: 10, y: 0 }, uv: { x: 0.5, y: 0 } });
invalid('mesh_topology.create_triangle', { ...target, vertexIds: ['vtx_10', 'collinear', 'vtx_11'] });
invalid('mesh_topology.remove_vertex', { ...target, vertexId: 'vtx_10' });
edit('mesh_topology.remove_vertex', { ...target, vertexId: 'collinear' });
invalid('mesh_topology.restore_snapshot', { snapshot: { topology: initial.meshTopologies[0], keyforms: initial.meshKeyforms } });
steps.push({ op: 'replace', project: initial, saved: true });
batch([cmd('mesh_keyform.update', { keyformId: 'mesh', keyform: { ...initial.meshKeyforms[0], positions: {} } }), cmd('mesh_topology.subdivide_edge', { ...target, vertexIds: ['v1', 'v2'], newVertexId: 'unsafe' })], 'malformed intermediate keyform', false, true);
// Generated replacement creates default sequence even for ordinary vertex IDs.
edit('mesh_topology.apply_generated_mesh', { ...generated, vertexIds: ['fresh_a', 'fresh_b', 'fresh_c'] });
batch([cmd('mesh_topology.remove_vertex', { ...target, vertexId: 'missing' }), cmd('mesh_topology.add_vertex', { ...added, position: { x: 'invalid', y: 0 } })], 'preflight', false, true);
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
for (let i = 0; i < steps.length; ++i) {
  if (invalidSteps.has(i)) assert.notEqual(expected[i].error, '', `step ${i}: expected rejection`);
  else assert.equal(expected[i].error, '', `step ${i}: ${steps[i].label || steps[i].op}`);
}
const rows = values => values.map(value => '    ' + JSON.stringify(value)).join(',\n');
const text = `{\n  "initial": ${JSON.stringify(initial)},\n  "steps": [\n${rows(steps)}\n  ],\n  "expected": [\n${rows(expected)}\n  ]\n}\n`;
const path = new URL('./mesh-session-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Mesh fixtures differ from current JS');
