import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject } from '../../src/model/project.js';
import { EditorSession } from '../../src/commands/editor.js';
const initial = JSON.parse(await readFile(new URL('./rig-conformance.json', import.meta.url), 'utf8')).initial;
const cmd = (type, payload) => ({ type, payload });
const steps = [], invalidSteps = new Set();
const batch = (commands, label = 'atomic owner edit', cycle = true, invalid = false) => {
  if (invalid) invalidSteps.add(steps.length);
  steps.push({ op: 'transaction', label, commands });
  if (cycle) steps.push({ op: 'undo' }, { op: 'redo' });
};
const edit = (type, payload) => batch([cmd(type, payload)], type);
const invalid = (type, payload) => batch([cmd(type, payload)], type, false, true);
const reject = commands => batch(commands, 'rejected atomic owner edit', false, true);
const createProgram = programId => cmd('animation.temporal.create_program', { programId, durationTicks: 100 });
const clip = { id: 'clip', displayName: 'Clip', temporalProgramId: 'clip_program', defaultLoopMode: 'once' };
edit('animation.temporal.create_program', { programId: 'standalone', durationTicks: 100 });
edit('animation.temporal.set_duration', { programId: 'standalone', durationTicks: 120 });
invalid('animation.temporal.create_program', { programId: 'standalone', durationTicks: 100 });
invalid('animation.clip.create', { clip: { ...clip, temporalProgramId: 'standalone' } });
invalid('animation.clip.create', { clip: {} });
invalid('sequence.create', { sequence: {} });
invalid('sequence.create', { sequence: { viewLaneItems: true } });
edit('animation.temporal.remove_program', { programId: 'standalone' });
invalid('animation.temporal.remove_program', { programId: 'standalone' });
batch([createProgram('clip_program'), cmd('animation.clip.create', { clip })]);
edit('animation.clip.update', { clipId: 'clip', clip: { ...clip, displayName: 'Updated', metadata: { author: 'test' } } });
invalid('animation.clip.create', { clip });
invalid('animation.clip.update', { clipId: 'clip', clip: { ...clip, id: 'changed' } });
invalid('animation.clip.update', { clipId: 'clip', clip: { ...clip, temporalProgramId: 'changed' } });
invalid('animation.clip.remove', { clipId: 'clip' });
invalid('animation.temporal.remove_program', { programId: 'clip_program' });
const track = { trackId: 'opacity', version: 1, kind: 'OpacityTrack', target: { nodeId: 'part' }, channels: { opacity: { keyframes: [] } } };
edit('animation.temporal.add_track', { programId: 'clip_program', track });
invalid('animation.temporal.add_track', { programId: 'clip_program', track });
invalid('animation.temporal.add_track', { programId: 'clip_program', track: {} });
const frame = { id: 'frame', timeTicks: 20, value: 0.5, interpolationToNext: { kind: 'linear' } };
const frameTarget = { programId: 'clip_program', trackId: 'opacity', channel: 'opacity' };
edit('animation.temporal.add_keyframe', { ...frameTarget, keyframe: frame });
edit('animation.temporal.add_keyframe', { ...frameTarget, keyframe: { ...frame, id: 'later', timeTicks: 80, value: 1 } });
invalid('animation.temporal.add_keyframe', { ...frameTarget, keyframe: { ...frame, id: 'duplicate_time' } });
invalid('animation.temporal.add_keyframe', { ...frameTarget, keyframe: {} });
edit('animation.temporal.update_keyframe', { ...frameTarget, keyframeId: 'frame', keyframe: { ...frame, timeTicks: 10, interpolationToNext: { kind: 'bezier', x1: 0.2, y1: -0.1, x2: 0.8, y2: 1.1 } } });
invalid('animation.temporal.update_keyframe', { ...frameTarget, keyframeId: 'frame', keyframe: { ...frame, id: 'changed' } });
invalid('animation.temporal.set_duration', { programId: 'clip_program', durationTicks: 10 });
invalid('animation.temporal.remove_keyframe', { ...frameTarget, keyframeId: 'missing' });
invalid('animation.temporal.remove_keyframe', { ...frameTarget, channel: 'missing', keyframeId: 'missing' });
invalid('animation.temporal.remove_keyframe', { ...frameTarget, trackId: 'missing', keyframeId: 'missing' });
edit('animation.temporal.remove_keyframe', { ...frameTarget, keyframeId: 'frame' });
edit('animation.temporal.remove_track', { programId: 'clip_program', trackId: 'opacity' });
invalid('animation.temporal.remove_track', { programId: 'clip_program', trackId: 'opacity' });
const event = { id: 'event', timeTicks: 20, type: 'marker', participants: ['part'], payload: { cue: 'ready' } };
edit('animation.temporal.add_event', { programId: 'clip_program', event });
invalid('animation.temporal.add_event', { programId: 'clip_program', event });
invalid('animation.temporal.add_event', { programId: 'clip_program', event: { ...event, id: 'invalid', participants: ['missing'] } });
invalid('animation.temporal.remove_event', { programId: 'clip_program', eventId: 'event' });
invalid('animation.temporal.remove_event', { programId: 'clip_program', eventId: 'missing' });
const region = { id: 'region', startTicks: 0, endTicks: 100, type: 'hold', metadata: {} };
edit('animation.temporal.add_region', { programId: 'clip_program', region });
invalid('animation.temporal.add_region', { programId: 'clip_program', region: { ...region, id: 'invalid', endTicks: 101 } });
invalid('animation.temporal.remove_region', { programId: 'clip_program', regionId: 'region' });
invalid('animation.temporal.remove_region', { programId: 'clip_program', regionId: 'missing' });
const hold = { id: 'hold', kind: 'KeyArtHold', keyArtId: 'key_a', startTicks: 0, endTicks: 100 };
const sequence = { id: 'sequence', displayName: 'Shot', temporalProgramId: 'sequence_program', viewLaneItems: [hold] };
batch([createProgram('sequence_program'), cmd('sequence.create', { sequence })]);
edit('sequence.update', { sequenceId: 'sequence', sequence: { ...sequence, displayName: 'Shot 2', metadata: null } });
invalid('sequence.update', { sequenceId: 'sequence', sequence: { ...sequence, id: 'changed' } });
invalid('sequence.update', { sequenceId: 'sequence', sequence: { ...sequence, temporalProgramId: 'changed' } });
invalid('sequence.create', { sequence });
invalid('sequence.remove', { sequenceId: 'sequence' });
invalid('animation.temporal.remove_program', { programId: 'sequence_program' });
const camera = { trackId: 'camera', version: 1, kind: 'CameraTrack', target: { cameraId: 'main' }, channels: { positionX: { keyframes: [] } } };
edit('animation.temporal.add_track', { programId: 'sequence_program', track: camera });
invalid('animation.temporal.add_track', { programId: 'sequence_program', track: { ...camera, trackId: 'camera2' } });
invalid('animation.temporal.add_track', { programId: 'sequence_program', track });
invalid('animation.temporal.add_track', { programId: 'sequence_program', track: { ...track, trackId: 'wrong_owner' } });
invalid('animation.temporal.add_track', { programId: 'clip_program', track: { ...camera, trackId: 'wrong_clip_owner' } });
edit('animation.temporal.remove_track', { programId: 'sequence_program', trackId: 'camera' });
// Split and join ViewLane in atomic transactions; single-item gaps reject.
invalid('sequence.remove_view_item', { sequenceId: 'sequence', viewItemId: 'hold' });
invalid('sequence.add_view_item', { sequenceId: 'sequence', viewItem: hold });
const first = { ...hold, endTicks: 50 }, second = { ...hold, id: 'second', startTicks: 50 };
batch([cmd('sequence.update_view_item', { sequenceId: 'sequence', viewItemId: 'hold', viewItem: first }), cmd('sequence.add_view_item', { sequenceId: 'sequence', viewItem: second })]);
edit('sequence.update_view_item', { sequenceId: 'sequence', viewItemId: 'second', viewItem: { ...second } });
invalid('sequence.update_view_item', { sequenceId: 'sequence', viewItemId: 'second', viewItem: { ...second, id: 'changed' } });
invalid('sequence.update_view_item', { sequenceId: 'sequence', viewItemId: 'missing', viewItem: second });
batch([cmd('sequence.remove_view_item', { sequenceId: 'sequence', viewItemId: 'second' }), cmd('sequence.update_view_item', { sequenceId: 'sequence', viewItemId: 'hold', viewItem: hold })]);
const instance = { id: 'instance', clipId: 'clip', startTicks: 0, endTicks: 100, sourceOffsetTicks: 0, playbackRate: { numerator: 1, denominator: 1 }, loopMode: 'once', weight: 1, layer: 0, enabled: true };
edit('sequence.add_clip_instance', { sequenceId: 'sequence', clipInstance: instance });
edit('sequence.add_clip_instance', { sequenceId: 'sequence', clipInstance: { ...instance, id: 'second_instance', layer: 1, weight: 0.5 } });
edit('sequence.update_clip_instance', { sequenceId: 'sequence', clipInstanceId: 'instance', clipInstance: { ...instance, weight: 0.25, enabled: false } });
invalid('sequence.update_clip_instance', { sequenceId: 'sequence', clipInstanceId: 'instance', clipInstance: { ...instance, id: 'changed' } });
invalid('sequence.add_clip_instance', { sequenceId: 'sequence', clipInstance: instance });
invalid('sequence.add_clip_instance', { sequenceId: 'sequence', clipInstance: { ...instance, id: 'invalid', playbackRate: { numerator: 2, denominator: 2 } } });
invalid('animation.clip.remove', { clipId: 'clip' });
edit('sequence.remove_clip_instance', { sequenceId: 'sequence', clipInstanceId: 'instance' });
edit('sequence.remove_clip_instance', { sequenceId: 'sequence', clipInstanceId: 'second_instance' });
invalid('sequence.remove_clip_instance', { sequenceId: 'sequence', clipInstanceId: 'missing' });
// Lifecycle checks inspect both snapshots, preventing delete/recreate bypasses.
reject([cmd('animation.clip.remove', { clipId: 'clip' }), createProgram('other_program'), cmd('animation.clip.create', { clip: { ...clip, temporalProgramId: 'other_program' } }), cmd('animation.temporal.remove_program', { programId: 'clip_program' })]);
reject([cmd('sequence.remove', { sequenceId: 'sequence' }), createProgram('other_sequence_program'), cmd('sequence.create', { sequence: { ...sequence, temporalProgramId: 'other_sequence_program' } }), cmd('animation.temporal.remove_program', { programId: 'sequence_program' })]);
batch([cmd('sequence.remove', { sequenceId: 'sequence' }), cmd('animation.temporal.remove_program', { programId: 'sequence_program' })]);
batch([cmd('animation.clip.remove', { clipId: 'clip' }), cmd('animation.temporal.remove_program', { programId: 'clip_program' })]);
invalid('animation.clip.remove', { clipId: 'clip' });
invalid('sequence.remove', { sequenceId: 'sequence' });
for (const [kind, owner] of [['clip', clip], ['sequence', sequence]]) {
  edit('animation.temporal.create_program', { programId: owner.temporalProgramId, durationTicks: 100 });
  invalid(kind === 'clip' ? 'animation.clip.create' : 'sequence.create', { [kind]: owner });
  edit('animation.temporal.remove_program', { programId: owner.temporalProgramId });
}
// Two owners sort by ECMAScript UTF-16 IDs. Include normalization of falsy metadata.
for (const suffix of ['\uE000', '\u{10000}']) batch([createProgram(`program_${suffix}`), cmd('animation.clip.create', { clip: { ...clip, id: `clip_${suffix}`, temporalProgramId: `program_${suffix}`, metadata: 0 } })]);
invalid('animation.temporal.restore_program', { program: { id: 'history', durationTicks: 100, tracks: [], events: [], regions: [] }, index: 0 });
invalid('animation.clip.restore', { clip, index: 0 });
invalid('sequence.restore', { sequence, index: 0 });
reject([cmd('animation.temporal.set_duration', { programId: 'missing', durationTicks: 1 }), cmd('sequence.remove', { sequenceId: 7 })]);
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
const path = new URL('./temporal-session-conformance.json', import.meta.url);
if (process.argv.includes('--write')) await writeFile(path, text);
else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Temporal fixtures differ from current JS');
