import assert from 'node:assert/strict';
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
const replacement = cloneProject(initial);
replacement.id = 'project_next';
const rename = name => ({ type: 'scene.rename_node', payload: { nodeId: 'part_1', displayName: name } });
const visibility = visible => ({ type: 'scene.set_visibility', payload: { nodeId: 'part_1', visible } });
const transform = { type: 'scene.set_transform', payload: { nodeId: 'part_1', coordinateSpace: 'node-local', transform: {
  position: { x: 12.5, y: -3 }, rotation: 0.75, scale: { x: 1.25, y: -2 }, pivot: { x: 4, y: 6.5 },
} } };
const steps = [
  { op: 'transaction', commands: [rename('夕暮れ')], label: 'rename' },
  { op: 'transaction', commands: [transform, visibility(false), rename('髪')], label: 'three' },
  { op: 'transaction', commands: [rename('do not commit'), visibility('invalid')], label: 'invalid' },
  { op: 'transaction', commands: [visibility(true), rename('  ')], label: 'blank' },
  { op: 'transaction', commands: [], label: 'empty' },
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
  { op: 'replace', project: replacement, saved: false },
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
const serialized = JSON.stringify({ initial, steps, expected }, null, 2) + '\n';
if (process.argv.includes('--write')) await writeFile(path, serialized);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), serialized,
  'Session fixtures differ from current JS; regenerate deliberately with --write');
