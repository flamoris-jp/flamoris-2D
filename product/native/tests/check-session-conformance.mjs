import assert from 'node:assert/strict';
import './check-command-schemas.mjs';
import './check-rig-conformance.mjs';
import './check-hierarchy-conformance.mjs';
import './check-temporal-session-conformance.mjs';
import './check-transition-session-conformance.mjs';
import './check-mesh-session-conformance.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProject, createSceneNode, cloneProject } from '../../src/model/project.js';
import { EditorSession } from '../../src/commands/editor.js';

const path = fileURLToPath(new URL('./session-conformance.json', import.meta.url));
const initial = createProject({ id: 'project_あ', name: '夜明け', width: 1920, height: 1080,
  idFactory: (() => { let n = 0; return () => `node_${++n}`; })() });
const root = initial.scene.nodes[initial.scene.rootId];
const part = createSceneNode({ id: 'part_1', displayName: '前髪', parentId: root.id });
root.children.push(part.id);
initial.scene.nodes[part.id] = part;
const mask = createSceneNode({ id: 'mask_1', displayName: 'Mask', parentId: root.id });
root.children.push(mask.id);
initial.scene.nodes[mask.id] = mask;
const alternate = createSceneNode({ id: 'mask_2', displayName: 'Alternate', parentId: root.id });
root.children.push(alternate.id);
initial.scene.nodes[alternate.id] = alternate;
const replacement = cloneProject(initial);
replacement.id = 'project_next';
const rename = name => ({ type: 'scene.rename_node', payload: { nodeId: 'part_1', displayName: name } });
const visibility = visible => ({ type: 'scene.set_visibility', payload: { nodeId: 'part_1', visible } });
const transform = { type: 'scene.set_transform', payload: { nodeId: 'part_1', coordinateSpace: 'node-local', transform: {
  position: { x: 12.5, y: -3 }, rotation: 0.75, scale: { x: 1.25, y: -2 }, pivot: { x: 4, y: 6.5 },
} } };
const command = (type, payload) => ({ type, payload });
const tx = (label, ...commands) => ({ op: 'transaction', commands, label });
const group = (id, parentId = root.id, index) => command('scene.create_group', { id, parentId, displayName: '　Group ' + id + '　', ...(index === undefined ? {} : { index }) });
const reparent = (nodeId, parentId, index) => command('scene.reparent_node', { nodeId, parentId, ...(index === undefined ? {} : { index }) });
const binding = (id, targetNodeId = part.id, sourceNodeId = mask.id) => ({ id, targetNodeId, sourceNodeId, mode: 'inside', enabled: true });
const sceneClippingSteps = [
  tx('locked', command('scene.set_locked', { nodeId: part.id, locked: true })), { op: 'undo' }, { op: 'redo' },
  tx('groups', group('group_z', root.id, 0), group('group_a')),
  { op: 'undo' }, { op: 'redo' },
  tx('move node', reparent(part.id, 'group_z', 9007199254740992)), { op: 'undo' }, { op: 'redo' },
  tx('same-parent reorder', reparent(mask.id, root.id, 0)), { op: 'undo' }, { op: 'redo' },
  tx('nested groups', reparent('group_a', 'group_z', 0)), { op: 'undo' }, { op: 'redo' },
  tx('reject cycle', reparent('group_z', 'group_a')),
  tx('reject root move', reparent(root.id, 'group_z')),
  tx('reject part parent', group('group_bad', mask.id)),
  tx('reject duplicate group', group('group_z')),
  tx('reject missing parent', reparent(part.id, 'missing')),
  tx('reject negative index', group('group_negative', root.id, -1)),
  tx('reject fractional index', reparent(part.id, root.id, 0.5)),
  tx('reject unknown field', command('scene.set_locked', { nodeId: part.id, locked: true, unknown: 1 })),
  tx('reject public history command', command('scene.remove_empty_group', { nodeId: 'group_a' })),
  tx('batch envelope precedence', command('scene.rename_node', { nodeId: 'missing', displayName: 'x' }), command('scene.set_locked', { nodeId: part.id, locked: 'yes' })),
  tx('create binding', command('clipping.create', { binding: binding('clip_1') })), { op: 'undo' }, { op: 'redo' },
  tx('disable binding', command('clipping.set_enabled', { bindingId: 'clip_1', enabled: false })), { op: 'undo' }, { op: 'redo' },
  tx('enable binding', command('clipping.set_enabled', { bindingId: 'clip_1', enabled: true })),
  tx('reject self clipping', command('clipping.set_source', { bindingId: 'clip_1', sourceNodeId: part.id })),
  tx('reject clipping cycle', command('clipping.create', { binding: binding('clip_2', mask.id, part.id) })),
  tx('reject duplicate binding', command('clipping.create', { binding: binding('clip_1') })),
  tx('reject clipping missing source', command('clipping.set_source', { bindingId: 'clip_1', sourceNodeId: 'missing' })),
  tx('reject clipping absent binding', command('clipping.remove', { bindingId: 'missing' })),
  tx('reject clipping bad mode', command('clipping.create', { binding: { ...binding('bad'), mode: 'outside' } })),
  tx('reject public clipping history', command('clipping.remove_internal', { bindingId: 'clip_1' })),
  tx('reject public clipping restore', command('clipping.restore', { binding: binding('clip_3'), index: 0 })),
  tx('remove binding', command('clipping.remove', { bindingId: 'clip_1' })), { op: 'undo' }, { op: 'redo' },
  tx('binding and toggle atomically', command('clipping.create', { binding: binding('clip_1') }), command('clipping.set_enabled', { bindingId: 'clip_1', enabled: false })),
  { op: 'undo' }, { op: 'redo' },
  tx('clipping source affected ordering', command('clipping.set_source', { bindingId: 'clip_1', sourceNodeId: alternate.id })),
  { op: 'undo' }, { op: 'redo' },
  { op: 'prepare', key: 'scene_stale', commands: [group('stale_group')], label: 'stale group' },
  tx('advance scene', command('scene.set_locked', { nodeId: part.id, locked: false })),
  { op: 'commit', key: 'scene_stale' },
];
const steps = [
  { op: 'transaction', commands: [rename('夕暮れ')], label: 'rename' },
  ...sceneClippingSteps,
  { op: 'transaction', commands: [transform, visibility(false), rename('髪')], label: 'three' },
  { op: 'transaction', commands: [rename('do not commit'), visibility('invalid')], label: 'invalid' },
  { op: 'transaction', commands: [visibility(true), rename('  ')], label: 'blank' },
  { op: 'transaction', commands: [visibility(true), rename('　')], label: 'ideographic blank' },
  { op: 'transaction', commands: [rename('\u00a0')], label: 'nbsp blank' },
  { op: 'transaction', commands: [rename(' \u3000\u00a0 ')], label: 'mixed Unicode blank' },
  { op: 'transaction', commands: [], label: 'empty' },
  { op: 'transaction', commands: [rename('untouched'), { ...transform, payload: { ...transform.payload, transform: { ...transform.payload.transform, scale: { x: 0, y: 1 } } } }], label: 'invalid project' },
  { op: 'transaction', commands: [rename('untouched'), visibility(false), { type: 'scene.rename_node', payload: { nodeId: 'missing', displayName: 'ghost' } }], label: 'missing node' },
  { op: 'undo' }, { op: 'undo' }, { op: 'redo' },
  { op: 'transaction', commands: [rename('新規')], label: 'new' }, { op: 'redo' },
  { op: 'markSaved' },
  { op: 'transaction', commands: [visibility(true)], label: 'visible' },
  { op: 'undo' }, { op: 'redo' },
  { op: 'markSaved', revision: 999 },
  { op: 'prepare', key: 'A', commands: [rename('古い')], label: 'old' },
  { op: 'transaction', commands: [rename('新しい')], label: 'newer' },
  { op: 'commit', key: 'A' },
  { op: 'prepare', key: 'B', commands: [rename('準備')], label: 'prepared' },
  { op: 'commit', key: 'B' }, { op: 'commit', key: 'B' },
  { op: 'prepare', key: 'C', commands: [rename('replacement stale')], label: 'will replace' },
  { op: 'replace', project: replacement, saved: false },
  { op: 'commit', key: 'C' },
  { op: 'markSaved' },
  { op: 'undo' }, { op: 'redo' },
];
const session = new EditorSession(initial);
const prepared = new Map();
const expected = steps.map(step => {
  let error = '';
  try {
    if (step.op === 'transaction') session.executeTransaction(step.commands, { label: step.label });
    else if (step.op === 'undo') session.undo();
    else if (step.op === 'redo') session.redo();
    else if (step.op === 'markSaved') session.markSaved(step.revision);
    else if (step.op === 'prepare') prepared.set(step.key, session.prepareTransactionCommit(step.commands, { label: step.label }));
    else if (step.op === 'commit') prepared.get(step.key)();
    else if (step.op === 'replace') session.replaceProject(step.project, { saved: step.saved });
  } catch (e) { error = e.code || 'project.invalid'; }
  return { error, project: cloneProject(session.project), state: {
    revisionCounter: session.revisionCounter, currentRevision: session.currentRevision,
    savedRevision: session.savedRevision, undoDepth: session.undoStack.length,
    redoDepth: session.redoStack.length, historyDepth: session.history.length,
    dirty: session.isDirty,
  }, history: cloneProject(session.history) };
});
// Keep full state evidence while avoiding tens of thousands of repetitive lines.
const rows = values => values.map(value => '    ' + JSON.stringify(value)).join(',\n');
const serialized = `{\n  "initial": ${JSON.stringify(initial)},\n  "steps": [\n${rows(steps)}\n  ],\n  "expected": [\n${rows(expected)}\n  ]\n}\n`;
if (process.argv.includes('--write')) await writeFile(path, serialized);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), serialized,
  'Session fixtures differ from current JS; regenerate deliberately with --write');
