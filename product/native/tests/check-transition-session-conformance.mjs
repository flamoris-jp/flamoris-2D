import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject } from '../../src/model/project.js';
import { EditorSession } from '../../src/commands/editor.js';
const initial = JSON.parse(await readFile(new URL('./rig-conformance.json', import.meta.url), 'utf8')).initial;
const cmd = (type, payload) => ({ type, payload });
const steps = [], invalidSteps = new Set();
const batch = (commands, label = 'atomic transition edit', cycle = true, invalid = false) => {
  if (invalid) invalidSteps.add(steps.length);
  steps.push({ op: 'transaction', label, commands });
  if (cycle) steps.push({ op: 'undo' }, { op: 'redo' });
};
const edit = (type, payload) => batch([cmd(type, payload)], type);
const invalid = (type, payload) => batch([cmd(type, payload)], type, false, true);
const emptyArt = { id: 'empty_art', displayName: 'Empty', rootNodeId: initial.scene.rootId, metadata: false };
edit('keyart.create', { keyArt: emptyArt });
edit('keyart.update', { keyArtId: 'empty_art', keyArt: { ...emptyArt, displayName: 'Renamed', metadata: { note: 'test' } } });
invalid('keyart.create', { keyArt: emptyArt });
invalid('keyart.create', { keyArt: { ...emptyArt, id: 'part' } });
invalid('keyart.create', { keyArt: {} });
invalid('keyart.update', { keyArtId: 'empty_art', keyArt: { ...emptyArt, id: 'changed' } });
edit('keyart.remove', { keyArtId: 'empty_art' });
invalid('keyart.remove', { keyArtId: 'missing' });
const artB = { ...initial.keyArts[0], id: 'key_b', displayName: 'B' };
edit('keyart.create', { keyArt: artB });
const slot = { id: 'empty_slot', displayName: 'Empty slot', metadata: 0 };
edit('semantic_slot.create', { semanticSlot: slot });
edit('semantic_slot.update', { semanticSlotId: 'empty_slot', semanticSlot: { ...slot, displayName: 'Updated' } });
invalid('semantic_slot.create', { semanticSlot: slot });
invalid('semantic_slot.map_node', { semanticSlotId: 'empty_slot', keyArtId: 'key_a', nodeId: 'part' });
edit('semantic_slot.map_node', { semanticSlotId: 'empty_slot', keyArtId: 'key_b', nodeId: 'part' });
invalid('semantic_slot.map_node', { semanticSlotId: 'empty_slot', keyArtId: 'key_b', nodeId: 'part' });
edit('semantic_slot.unmap_node', { semanticSlotId: 'empty_slot', keyArtId: 'key_b' });
invalid('semantic_slot.unmap_node', { semanticSlotId: 'empty_slot', keyArtId: 'key_b' });
edit('semantic_slot.remove', { semanticSlotId: 'empty_slot' });
edit('semantic_slot.map_node', { semanticSlotId: 'slot', keyArtId: 'key_b', nodeId: 'part' });
const topology = { id: 'new_topology', vertexIds: ['vtx_010', 'other_2', 'other_3'], indices: [0, 1, 2] };
edit('mesh_topology.create', { topology });
edit('mesh_topology.update', { topologyId: 'new_topology', topology: { ...topology, vertexIds: ['other_3', 'other_2', 'vtx_010'], nextVertexSequence: 12 } });
invalid('mesh_topology.create', { topology });
invalid('mesh_topology.create', { topology: { ...topology, id: 'invalid', vertexIds: ['v1', 'else_a', 'else_b'] } });
invalid('mesh_topology.create', { topology: { ...topology, id: 'invalid', vertexIds: true } });
invalid('mesh_topology.update', { topologyId: 'new_topology', topology: { ...topology, id: 'changed' } });
edit('mesh_topology.remove', { topologyId: 'new_topology' });
invalid('mesh_topology.remove', { topologyId: 'new_topology' });
const keyformB = { ...initial.meshKeyforms[0], id: 'mesh_b', keyArtId: 'key_b', positions: [2, 3, 12, 3, 2, 13] };
edit('mesh_keyform.create', { keyform: keyformB });
edit('mesh_keyform.update', { keyformId: 'mesh_b', keyform: { ...keyformB, positions: [3, 4, 13, 4, 3, 14] } });
invalid('mesh_keyform.create', { keyform: keyformB });
invalid('mesh_keyform.update', { keyformId: 'mesh_b', keyform: { ...keyformB, id: 'changed' } });
invalid('mesh_topology.update', { topologyId: 'topology', topology: { ...initial.meshTopologies[0], vertexIds: ['v3', 'v2', 'v1'] } });
invalid('mesh_topology.remove', { topologyId: 'topology' });
const skin = { id: 'skin_lock', targetNodeId: 'part', topologyId: 'topology', enabled: true, vertexWeights: ['v1', 'v2', 'v3'].map(vertexId => ({ vertexId, influences: [{ boneId: 'bone_a', weight: 1 }] })) };
edit('skin.create_binding', { binding: skin });
invalid('mesh_topology.update', { topologyId: 'topology', topology: { ...initial.meshTopologies[0], vertexIds: ['v3', 'v2', 'v1'] } });
invalid('mesh_topology.remove', { topologyId: 'topology' });
edit('skin.remove_binding', { bindingId: 'skin_lock' });
const correction = { id: 'form_lock', topologyId: 'topology', keyArtId: 'key_a', semanticSlotId: 'slot', vertexOffsets: [{ vertexId: 'v1', x: 1, y: 2 }] };
edit('mesh_form.create_keyform', { keyform: correction });
invalid('mesh_topology.update', { topologyId: 'topology', topology: { ...initial.meshTopologies[0], vertexIds: ['v3', 'v2', 'v1'] } });
invalid('mesh_topology.remove', { topologyId: 'topology' });
edit('mesh_form.reset_keyform', { keyformId: 'form_lock' });
edit('animation.temporal.create_program', { programId: 'transition_program', durationTicks: 100 });
const transition = { id: 'transition', displayName: 'A to B', fromKeyArtId: 'key_a', toKeyArtId: 'key_b', temporalProgramId: 'transition_program' };
edit('transition.create', { transition });
edit('transition.update', { transitionId: 'transition', transition: { ...transition, displayName: 'Renamed' } });
invalid('transition.create', { transition });
invalid('transition.update', { transitionId: 'transition', transition: { ...transition, id: 'changed' } });
const part = { transitionId: 'transition', partTransitionId: 'part_transition', semanticSlotId: 'slot', mode: 'hold' };
edit('transition.set_part_mode', { ...part, configuration: { holdEndpoint: 'from' } });
edit('transition.set_part_mode', { ...part, configuration: { holdEndpoint: 'to' } });
invalid('transition.set_part_mode', { ...part, partTransitionId: 'changed' });
invalid('transition.set_part_topology', { transitionId: 'transition', semanticSlotId: 'missing', topologyId: 'topology', fromKeyformId: 'mesh', toKeyformId: 'mesh_b' });
edit('transition.set_part_topology', { transitionId: 'transition', semanticSlotId: 'slot', topologyId: 'topology', fromKeyformId: 'mesh', toKeyformId: 'mesh_b' });
edit('transition.set_part_mode', { ...part, mode: 'morph', configuration: {} });
invalid('transition.set_part_topology', { transitionId: 'transition', semanticSlotId: 'slot', topologyId: 'missing', fromKeyformId: 'mesh', toKeyformId: 'mesh_b' });
invalid('mesh_keyform.remove', { keyformId: 'mesh_b' });
const override = { key: 'diagnostic', code: 'MANUAL', evidenceFingerprint: 'evidence', semanticSlotId: 'slot', timeTicks: 50 };
edit('transition.set_diagnostic_override', { transitionId: 'transition', override });
edit('transition.set_diagnostic_override', { transitionId: 'transition', override: { ...override, evidenceFingerprint: 'updated' } });
invalid('transition.set_diagnostic_override', { transitionId: 'transition', override: {} });
edit('transition.clear_diagnostic_override', { transitionId: 'transition', key: 'diagnostic' });
invalid('transition.clear_diagnostic_override', { transitionId: 'transition', key: 'diagnostic' });
invalid('transition.remove_part', { transitionId: 'transition', semanticSlotId: 'slot' });
edit('transition.remove', { transitionId: 'transition' });
edit('animation.temporal.remove_program', { programId: 'transition_program' });
edit('mesh_keyform.remove', { keyformId: 'mesh_b' });
edit('semantic_slot.unmap_node', { semanticSlotId: 'slot', keyArtId: 'key_b' });
edit('keyart.remove', { keyArtId: 'key_b' });
for (const [type, payload] of [
  ['keyArts.remove_internal', { id: 'key_a' }],
  ['semanticSlots.remove_internal', { id: 'slot' }],
  ['meshTopologies.remove_internal', { id: 'topology' }],
  ['meshKeyforms.remove_internal', { id: 'mesh' }],
  ['transitions.remove_internal', { id: 'transition' }],
]) invalid(type, payload);
batch([cmd('transition.remove', { transitionId: 'missing' }), cmd('keyart.remove', { keyArtId: 3 })], 'preflight', false, true);
steps.push({ op: 'markSaved' });
const session = new EditorSession(initial);
const expected = steps.map(step => {
  let error = '';
  try {
    if (step.op === 'transaction') session.executeTransaction(step.commands, { label: step.label });
    else if (step.op === 'undo') session.undo();
    else if (step.op === 'redo') session.redo();
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
const path = new URL('./transition-session-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Transition fixtures differ from current JS');
