import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject, createSceneNode } from '../../src/model/project.js';
import { EditorSession } from '../../src/commands/editor.js';
const initial = JSON.parse(await readFile(new URL('./rig-conformance.json', import.meta.url), 'utf8')).initial;
const cmd = (type, payload) => ({ type, payload });
const steps = [], invalidSteps = new Set();
const batch = (commands, label = 'source edit', cycle = true, invalid = false) => {
  if (invalid) invalidSteps.add(steps.length);
  steps.push({ op: 'transaction', label, commands });
  if (cycle) steps.push({ op: 'undo' }, { op: 'redo' });
};
const edit = project => batch([cmd('source.apply_psd_reimport', { project })], 'source.apply_psd_reimport');
const invalid = project => batch([cmd('source.apply_psd_reimport', { project })], 'source rejection', false, true);
const next = cloneProject(initial);
next.name = '再取り込み';
next.scene.nodes.part.displayName = 'Updated artwork';
for (const id of ['z_new', '10', '2', '01', '4294967294', '4294967295', 'a_new', 'node_\u{10000}', 'node_\uE000']) {
  next.scene.nodes[id] = createSceneNode({ id, displayName: id, parentId: next.scene.rootId });
  next.scene.nodes[next.scene.rootId].children.push(id);
}
edit(next);
invalid({ ...next, id: 'changed' });
const malformed = cloneProject(next); malformed.scene.nodes.part.parentId = 'missing'; invalid(malformed);
edit(initial);
// Typed edits mutate key order; source inverse copies preserve the same order.
batch([cmd('scene.create_group', { id: 'z_group', displayName: 'Group', parentId: initial.scene.rootId })], 'append group');
edit(next);
// Copy/restore of whole Project preserves existing Clip/Sequence lifecycle rules.
const program = { id: 'clip_program', durationTicks: 100, tracks: [], events: [], regions: [] };
const clip = { id: 'clip', displayName: 'Clip', temporalProgramId: 'clip_program', defaultLoopMode: 'once', metadata: {} };
const clipProject = cloneProject(next); clipProject.temporalPrograms.push(program); clipProject.animation.clips.push(clip);
edit(clipProject);
const orphan = cloneProject(clipProject); orphan.animation.clips = []; invalid(orphan);
const reassigned = cloneProject(clipProject); reassigned.temporalPrograms[0].id = 'reassigned'; reassigned.animation.clips[0].temporalProgramId = 'reassigned'; invalid(reassigned);
const unowned = cloneProject(next); unowned.temporalPrograms.push(program);
// Removing owner and program is atomic; adopting an existing program is rejected.
edit(next);
edit(unowned);
invalid(clipProject);
edit(next);
const sequenceProgram = { ...program, id: 'sequence_program' };
const sequence = { id: 'sequence', displayName: 'Shot', temporalProgramId: 'sequence_program', viewLaneItems: [{ id: 'hold', kind: 'KeyArtHold', keyArtId: 'key_a', startTicks: 0, endTicks: 100 }], clipInstances: [], metadata: {} };
const sequenceProject = cloneProject(next); sequenceProject.temporalPrograms.push(sequenceProgram); sequenceProject.sequences.push(sequence);
edit(sequenceProject);
const sequenceOrphan = cloneProject(sequenceProject); sequenceOrphan.sequences = []; invalid(sequenceOrphan);
const sequenceReassigned = cloneProject(sequenceProject); sequenceReassigned.temporalPrograms[0].id = 'sequence_reassigned'; sequenceReassigned.sequences[0].temporalProgramId = 'sequence_reassigned'; invalid(sequenceReassigned);
edit(next);
const sequenceUnowned = cloneProject(next); sequenceUnowned.temporalPrograms.push(sequenceProgram);
edit(sequenceUnowned); invalid(sequenceProject); edit(next);
// A failed later handler must leave the re-import and its history uncommitted.
batch([cmd('source.apply_psd_reimport', { project: initial }), cmd('scene.rename_node', { nodeId: 'missing', displayName: 'missing' })], 'atomic rejection after source', false, true);
batch([cmd('source.apply_psd_reimport', { project: { ...initial, id: 'changed' } }), cmd('scene.rename_node', { nodeId: 'missing', displayName: 3 })], 'source batch preflight', false, true);
// Round-trip parsed JSON preserves integer-key enumeration and insertion order.
steps.push({ op: 'replace', project: JSON.parse(JSON.stringify(next)), saved: true });
edit(initial); edit(next);
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
const path = new URL('./source-session-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Source fixtures differ from current JS');
