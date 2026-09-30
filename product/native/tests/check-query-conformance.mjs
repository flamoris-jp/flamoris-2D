import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cloneProject, createSceneNode } from '../../src/model/project.js';
import { validationResult } from '../../src/model/validation.js';
import { projectQueries, queryProject } from '../../src/queries/project.js';
import { TEMPORAL_TRACK_DEFINITIONS } from '../../src/core/temporal.js';
import { createWarpDeformer, defaultWarpKeyformControlPoints } from '../../src/model/warp-deformer.js';

const inventory = await readFile(new URL('../core/src/native_query_names.inc', import.meta.url), 'utf8');
const entries = [...inventory.matchAll(/FL2D_QUERY\(\w+, "([^"]+)", ([01])\)/g)].map(match => ({ name: match[1], implemented: match[2] === '1' }));
assert.deepEqual(entries.map(entry => entry.name), Object.keys(projectQueries), 'Native Query inventory differs from current Product');
const implemented = entries.filter(entry => entry.implemented).map(entry => entry.name);
const pending = entries.filter(entry => !entry.implemented).map(entry => entry.name);
// Query calls are synchronous. Explicit oracle locales make the golden corpus
// independent of the machine's default without adding a Product locale API.
const oracle = (project, name, input, locale = 'en-US') => {
  const compare = String.prototype.localeCompare, lower = String.prototype.toLocaleLowerCase;
  String.prototype.localeCompare = function(other, locales, options) { return compare.call(this, other, locales ?? locale, options); };
  String.prototype.toLocaleLowerCase = function(locales) { return lower.call(this, locales ?? locale); };
  try { return queryProject(project, name, input); }
  finally { String.prototype.localeCompare = compare; String.prototype.toLocaleLowerCase = lower; }
};
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
const temporalSource = projects.find(project => project.sequences.length && project.keyArts.length);
assert(temporalSource);
const exactTime = cloneProject(temporalSource), maximum = Number.MAX_SAFE_INTEGER;
exactTime.sequences = [exactTime.sequences[0]];
const exactSequence = exactTime.sequences[0];
const exactProgram = exactTime.temporalPrograms.find(program => program.id === exactSequence.temporalProgramId);
Object.assign(exactProgram, { durationTicks: maximum, tracks: [], events: [], regions: [] });
exactSequence.viewLaneItems = [{ id: 'query_long_hold', kind: 'KeyArtHold', keyArtId: exactTime.keyArts[0].id, startTicks: 0, endTicks: maximum }];
exactTime.temporalPrograms.push({ id: 'query_exact_clip_program', durationTicks: maximum, tracks: [], events: [], regions: [] });
exactTime.animation.clips.push({ id: 'query_exact_clip', displayName: 'Exact tick edge', temporalProgramId: 'query_exact_clip_program', defaultLoopMode: 'once', metadata: {} });
exactSequence.clipInstances = [
  { id: 'query_near_unity', clipId: 'query_exact_clip', startTicks: 0, endTicks: maximum, sourceOffsetTicks: 0, playbackRate: { numerator: maximum, denominator: maximum - 1 }, loopMode: 'once', weight: 1, layer: 0, enabled: true },
  { id: 'query_near_half', clipId: 'query_exact_clip', startTicks: 0, endTicks: maximum, sourceOffsetTicks: maximum - 1, playbackRate: { numerator: 1, denominator: maximum - 1 }, loopMode: 'loop', weight: 1, layer: 1, enabled: true },
  { id: 'query_disabled', clipId: 'query_exact_clip', startTicks: 0, endTicks: maximum, sourceOffsetTicks: maximum - 1, playbackRate: { numerator: 1, denominator: maximum - 1 }, loopMode: 'loop', weight: 1, layer: 2, enabled: false },
  { id: 'query_zero_weight', clipId: 'query_exact_clip', startTicks: 0, endTicks: maximum, sourceOffsetTicks: 0, playbackRate: { numerator: maximum, denominator: maximum - 1 }, loopMode: 'once', weight: 0, layer: 3, enabled: true },
];
add(exactTime);
const sampling = cloneProject(projects.find(project => project.rig.deformers.length));
const sampleSource = projects.find(project => project.animation.deformationSamples.length);
sampling.meshes = cloneProject(sampleSource.meshes);
sampling.animation.deformationSamples = cloneProject(sampleSource.animation.deformationSamples);
const sample = sampling.animation.deformationSamples[0];
sampling.animation.deformationSamples.push({ ...cloneProject(sample), id: 'query_sample_second' });
const mask = createSceneNode({ id: 'query_sample_mask', displayName: 'Sample mask', parentId: sampling.scene.rootId });
sampling.scene.nodes[mask.id] = mask; sampling.scene.nodes[sampling.scene.rootId].children.push(mask.id);
const samplingProgram = { id: 'query_sampling', durationTicks: 100, tracks: [], events: [
  { id: 'query_event_\uE000', timeTicks: 50, type: 'marker', participants: ['part'], payload: { cue: 'private-use' } },
  { id: 'query_event_\u{10000}', timeTicks: 50, type: 'marker', participants: ['part'], payload: { cue: 'astral' } },
], regions: [
  { id: 'query_region_later', startTicks: 25, endTicks: 100, type: 'hold', metadata: {} },
  { id: 'query_region_first', startTicks: 0, endTicks: 50, type: 'hold', metadata: {} },
] };
const track = (id, kind, target, channels, curve = { kind: 'linear' }) => {
  samplingProgram.tracks.push({ trackId: `query_track_${id}`, version: 1, kind, target, channels:
    Object.fromEntries(Object.entries(channels).map(([name, values]) => [name, { keyframes: values.map((value, index) => ({
      id: `query_key_${id}_${name}_${index}`, timeTicks: index * 100, value,
      interpolationToNext: index ? { kind: 'step' } : curve,
    })) }])) });
};
const nodeTarget = { nodeId: 'part' }, slotTarget = { semanticSlotId: sampling.semanticSlots[0].id };
const bezier = { kind: 'bezier', x1: 0.17, y1: 0.03, x2: 0.83, y2: 0.91 };
track('geometry', 'GeometryBlendTrack', slotTarget, { geometryWeight: [0.1, 0.9] }, bezier);
track('appearance', 'AppearanceTrack', slotTarget, { appearance: [{ appearance: 1 }, { alternate: 1 }] }, bezier);
track('opacity', 'OpacityTrack', nodeTarget, { opacity: [0.2, 0.8] });
track('presence', 'PresenceTrack', nodeTarget, { presence: ['present', 'absent'] }, { kind: 'step' });
track('draw_order', 'DrawOrderTrack', nodeTarget, { drawOrder: [2, -3] }, { kind: 'step' });
track('clipping', 'ClippingTrack', nodeTarget, { clipping: [{ sourceNodeId: null }, { sourceNodeId: mask.id }] }, { kind: 'step' });
track('transform', 'TransformTrack', { ...nodeTarget, coordinateSpace: 'node-local' }, { rotation: [170 * Math.PI / 180, -170 * Math.PI / 180], positionX: [1e308, -1e308], positionY: [], scaleX: [0.5, 2.3] }, bezier);
track('\u{10000}', 'BoneTrack', { boneId: sampling.rig.bones[0].id }, { rotation: [0, Math.PI], x: [-3, 15], y: [0, 6] });
track('\uE000', 'BoneTrack', { boneId: sampling.rig.bones[1].id }, { rotation: [0, -Math.PI] });
const warp = sampling.rig.deformers[0];
track('deformer', 'DeformerTrack', { deformerId: warp.id, controlPointId: warp.controlPointIds[0] }, { deltaX: [-3, 15], deltaY: [0, 6] });
track('camera', 'CameraTrack', { cameraId: 'main' }, { rotation: [0, Math.PI * 2 - 0.01], scale: [1, 2], positionX: [], positionY: [-10, 10] });
track('deformation', 'MeshDeformationTrack', { meshId: sample.meshId }, { deformation: [{ deformationSampleId: sample.id, weight: 0 }, { deformationSampleId: sample.id, weight: 1 }] });
const cameraProgram = { id: 'query_camera_sampling', durationTicks: 100, tracks: samplingProgram.tracks.filter(track => track.kind === 'CameraTrack'), events: [], regions: [] };
samplingProgram.tracks = samplingProgram.tracks.filter(track => track.kind !== 'CameraTrack');
sampling.temporalPrograms.push(samplingProgram, cameraProgram);
sampling.sequences.push({ id: 'query_sampling_sequence', displayName: 'Sample inspection', temporalProgramId: cameraProgram.id,
  viewLaneItems: [{ id: 'query_sampling_hold', kind: 'KeyArtHold', keyArtId: sampling.keyArts[0].id, startTicks: 0, endTicks: 100 }], clipInstances: [], metadata: {} });
add(sampling);
assert.deepEqual([...new Set([...samplingProgram.tracks, ...cameraProgram.tracks].map(track => track.kind))].sort(), Object.keys(TEMPORAL_TRACK_DEFINITIONS).sort(), 'All typed temporal track families must be sampled');

// Evaluated rig fixtures exercise authored poses, both IK bends, constrained
// rotations, document transforms and parent-first non-affine Warp projection.
const posedRig = cloneProject(projects.find(p => p.rig.skinBindings.length && p.rig.bones.some(b => b.id === 'bone_c')));
assert(posedRig);
posedRig.rig.bonePoseKeyforms = posedRig.rig.bones.flatMap((bone, index) => posedRig.keyArts.map(art => ({
  boneId: bone.id, keyArtId: art.id, localDelta: { x: index - 2.25, y: 3 - index,
    rotation: index % 2 ? -Math.PI : Math.PI / 3 },
})));
posedRig.rig.twoBoneIkConstraints = [{ id: 'query_ik', rootBoneId: 'bone_a', midBoneId: 'bone_b', endBoneId: 'bone_c', enabled: true, bendDirection: 'counterclockwise' }];
add(posedRig);
const constrainedRig = cloneProject(posedRig);
constrainedRig.rig.boneRotationConstraints = [{ id: 'query_limit', boneId: 'bone_a', enabled: true, minRotation: -0.2, maxRotation: 0.2 }];
constrainedRig.rig.twoBoneIkConstraints[0].bendDirection = 'clockwise';
add(constrainedRig);
for (const scale of [{ x: 1.3, y: 1.3 }, { x: -1, y: 1 }, { x: 1.2, y: 0.7 }, { x: 1e-8, y: 1e-8 }]) {
  const p = cloneProject(constrainedRig);
  p.scene.nodes[p.scene.rootId].transform = { position: { x: 31, y: -17 }, rotation: 0.53, scale, pivot: { x: 7, y: -2 } };
  add(p);
}
const overflowRig = cloneProject(posedRig);
overflowRig.rig.twoBoneIkConstraints = [];
overflowRig.scene.nodes[overflowRig.scene.rootId].transform.position = { x: 1e308, y: -1e308 };
for (const bone of overflowRig.rig.bones) {
  bone.length = 1e308;
  for (const form of overflowRig.rig.bonePoseKeyforms.filter(k => k.boneId === bone.id)) form.localDelta.x = 1e308;
}
add(overflowRig);
for (const variant of ['translation', 'shear', 'nested', 'missing', 'degenerate']) {
  const p = cloneProject(constrainedRig), root = p.scene.rootId;
  const addWarp = (id, parentId, amount) => {
    const created = createWarpDeformer({ id, displayName: id, parentNodeId: parentId, columns: 2, rows: 2,
      bounds: { left: -20, top: -20, right: 100, bottom: 100 }, controlPointIds: ['tl', 'tr', 'bl', 'br'].map(s => id + '_' + s) });
    p.rig.deformers.push(created.deformer); p.rig.warpControlPoints.push(...created.controlPoints);
    p.scene.nodes[id] = createSceneNode({ id, kind: 'deformer', displayName: id, parentId }); p.scene.nodes[parentId].children.push(id);
    for (const art of p.keyArts) p.rig.warpDeformerKeyforms.push({ deformerId: id, keyArtId: art.id,
      controlPoints: defaultWarpKeyformControlPoints(created.deformer, created.controlPoints).map((v, i) => ({ ...v,
        x: variant === 'degenerate' ? 0 : v.x + (i % 2 ? amount : 3), y: variant === 'degenerate' ? 0 : v.y + (i === 3 ? 13 : amount),
      })) });
    return id;
  };
  let parent = addWarp('query_warp', root, variant === 'translation' ? 3 : 19);
  if (variant === 'nested') parent = addWarp('query_nested', parent, -7);
  for (const bone of p.rig.bones.filter(b => b.parentNodeId === root)) {
    p.scene.nodes[root].children = p.scene.nodes[root].children.filter(id => id !== bone.id);
    p.scene.nodes[parent].children.push(bone.id); p.scene.nodes[bone.id].parentId = parent; bone.parentNodeId = parent;
  }
  if (variant === 'missing') p.rig.warpDeformerKeyforms = [];
  add(p);
}

// Full frame evaluation fixtures: every admitted part mode, endpoint semantics,
// resolved clipping, composite groups and the shared rig/warp/form stages.
const frameSource = cloneProject(projects.find(p => p.transitions.some(t => t.partTransitions.some(part => part.mode === 'morph'))));
frameSource.sequences = [];
for (const mode of ['morph', 'replace', 'hold', 'appear', 'disappear', 'occlusion']) {
  for (const variant of ['plain', 'sampled', 'presence', 'transformed', 'clipping', 'group', 'holdTo']) {
    if (variant === 'group' && mode !== 'replace' || variant === 'holdTo' && mode !== 'hold') continue;
    const p = cloneProject(frameSource), t = p.transitions[0], part = t.partTransitions[0], slot = p.semanticSlots[0];
    part.mode = mode;
    if (mode !== 'morph') part.topologyId = null;
    if (mode === 'appear' || mode === 'disappear') {
      const removed = mode === 'appear' ? t.fromKeyArtId : t.toKeyArtId;
      slot.mappings = slot.mappings.filter(m => m.keyArtId !== removed);
      part[mode === 'appear' ? 'fromKeyformId' : 'toKeyformId'] = null;
    }
    if (variant === 'group') part.configuration.compositeGroupId = 'frame_group';
    if (variant === 'holdTo') part.configuration.holdEndpoint = 'to';
    if (variant === 'presence') p.keyArts.forEach((art, i) => { art.members[0].presence = i ? 'occluded' : 'absent'; art.members[0].opacity = 0.3+i*0.2; });
    if (variant === 'transformed') for (const [i, node] of Object.values(p.scene.nodes).entries()) {
      node.transform = { position: { x: i*3.25, y: -i*2.5 }, rotation: i ? (i === 1 ? 2.8 : -2.8) : 0.37,
        scale: { x: 1+i/8, y: i === 2 ? -1 : 1+i/4 }, pivot: { x: 2, y: -3 } };
    }
    if (variant === 'sampled') {
      const program = p.temporalPrograms.find(v => v.id === t.temporalProgramId);
      const target = { semanticSlotId: slot.id };
      program.tracks = [['geometry','GeometryBlendTrack','geometryWeight',0.2,0.8],
        ['opacity','OpacityTrack','opacity',0.3,0.7], ['presence','PresenceTrack','presence','present','absent'],
        ['order','DrawOrderTrack','drawOrder',7,-3], ['appearance','AppearanceTrack','appearance',{ appearance_a: 0.25, unknown: 0.75 },{ appearance_b: 1 }],
        ['clipping','ClippingTrack','clipping',{ sourceNodeId: null },{ sourceNodeId: null }]].map(([id,kind,channel,a,b]) => ({
          trackId: 'frame_track_'+id, version: 1, kind, target, channels: { [channel]: { keyframes: [
            { id: 'frame_start_'+id, timeTicks: 0, value: a, interpolationToNext: { kind: ['geometry','opacity','appearance'].includes(id) ? 'linear' : 'step' } },
            { id: 'frame_end_'+id, timeTicks: program.durationTicks, value: b, interpolationToNext: { kind: 'step' } },
          ] } },
        }));
    }
    if (variant === 'clipping') {
      const mask = createSceneNode({ id: 'frame_mask', displayName: 'Frame mask', parentId: p.scene.rootId });
      p.scene.nodes[mask.id] = mask; p.scene.nodes[p.scene.rootId].children.push(mask.id);
      p.semanticSlots.push({ id: 'frame_mask_slot', displayName: 'Mask', role: 'mask', mappings: p.keyArts.map(a => ({ keyArtId: a.id, nodeId: mask.id })), metadata: {} });
      for (const art of p.keyArts) { art.members[0].clipping.sourceNodeId = mask.id; art.members.push({ nodeId: mask.id, appearanceId: 'mask_image', opacity: 1, presence: 'present', drawOrder: 3, clipping: { sourceNodeId: null } }); }
      t.partTransitions.push({ id: 'frame_mask_part', semanticSlotId: 'frame_mask_slot', mode: 'hold', topologyId: null, fromKeyformId: null, toKeyformId: null, configuration: {} });
    }
    add(p);
  }
}
for (const kind of ['rigid', 'skin', 'skinMismatch', 'rigidMismatch', 'warp', 'warpMissing', 'form','formOne','formIncompatible','formOverflow']) {
  const p = cloneProject(frameSource), t = p.transitions[0], slot = p.semanticSlots[0], topology = p.meshTopologies[0];
  p.meshKeyforms[0].positions = [0,0,10,0,0,10]; p.meshKeyforms[1].positions = [1,2,12,1,2,13];
  const bone = { id: 'frame_bone', parentNodeId: p.scene.rootId, restLocalTransform: { x: 2, y: 3, rotation: 0.1 }, length: 10, enabled: true };
  p.rig.bones.push(bone); p.scene.nodes[bone.id] = createSceneNode({ id: bone.id, kind: 'bone', displayName: 'Frame bone', parentId: p.scene.rootId }); p.scene.nodes[p.scene.rootId].children.push(bone.id);
  p.scene.nodes[bone.id].transform.position = { x: 2, y: 3 }; p.scene.nodes[bone.id].transform.rotation = 0.1;
  p.rig.bonePoseKeyforms = p.keyArts.map((a,i) => ({ boneId: bone.id, keyArtId: a.id, localDelta: { x: i*4, y: 2-i, rotation: i ? -0.7 : 0.5 } }));
  if (kind.startsWith('skin')) p.rig.skinBindings = ['node_a','node_b'].slice(0,kind === 'skinMismatch' ? 1 : 2).map((node,i) => ({ id: 'frame_skin_'+i, targetNodeId: node, topologyId: topology.id, enabled: true,
    vertexWeights: topology.vertexIds.map(vertexId => ({ vertexId, influences: [{ boneId: bone.id, weight: 1 }] })) }));
  if (kind.startsWith('rigid')) p.rig.rigidBoneBindings = ['node_a','node_b'].slice(0,kind === 'rigidMismatch' ? 1 : 2).map((node,i) => ({ id: 'frame_rigid_'+i, targetNodeId: node, boneId: bone.id, enabled: true }));
  if (kind.startsWith('warp')) {
    const id = 'frame_warp', created = createWarpDeformer({ id, displayName: id, parentNodeId: p.scene.rootId, columns: 2, rows: 2, bounds: { left: -20, top: -20, right: 100, bottom: 100 }, controlPointIds: ['tl','tr','bl','br'].map(s => id+'_'+s) });
    p.rig.deformers.push(created.deformer); p.rig.warpControlPoints.push(...created.controlPoints);
    p.scene.nodes[id] = createSceneNode({ id, kind: 'deformer', displayName: id, parentId: p.scene.rootId }); p.scene.nodes[p.scene.rootId].children.push(id);
    for (const nodeId of ['node_a','node_b',bone.id]) { p.scene.nodes[p.scene.rootId].children = p.scene.nodes[p.scene.rootId].children.filter(v => v !== nodeId); p.scene.nodes[id].children.push(nodeId); p.scene.nodes[nodeId].parentId = id; }
    bone.parentNodeId = id;
    if (kind !== 'warpMissing') p.rig.warpDeformerKeyforms = p.keyArts.map((art,i) => ({ deformerId: id, keyArtId: art.id, controlPoints: defaultWarpKeyformControlPoints(created.deformer,created.controlPoints).map((v,j) => ({ ...v, x: v.x+i*5+(j%2 ? 2 : 0), y: v.y-i*3+(j===3 ? 7 : 0) })) }));
    p.rig.rigidBoneBindings = ['node_a','node_b'].map((node,i) => ({ id: 'frame_rigid_'+i, targetNodeId: node, boneId: bone.id, enabled: true }));
  }
  if (kind.startsWith('form')) p.meshFormCorrectionKeyforms = p.keyArts.map((a,i) => ({ id: 'frame_form_'+i, topologyId: topology.id, keyArtId: a.id, semanticSlotId: slot.id, vertexOffsets: [{ vertexId: topology.vertexIds[1], x: i ? -3 : 2, y: i ? 4 : -1 }] }));
  if (kind === 'formOne') p.meshFormCorrectionKeyforms = p.meshFormCorrectionKeyforms.slice(0,1);
  if (kind === 'formIncompatible') {
    const other = cloneProject(topology); other.id = 'frame_form_topology'; other.vertexIds = other.vertexIds.map(v => 'form_'+v); p.meshTopologies.push(other); p.meshKeyforms.push({ ...cloneProject(p.meshKeyforms[1]),id: 'frame_other_keyform',topologyId: other.id });
    p.meshFormCorrectionKeyforms[1].topologyId = other.id; p.meshFormCorrectionKeyforms[1].vertexOffsets[0].vertexId = other.vertexIds[1];
  }
  if (kind === 'formOverflow') p.meshFormCorrectionKeyforms.forEach((k,i) => { k.vertexOffsets[0].x = i ? -1e308 : 1e308; });
  add(p);
}

// Large finite area ratios exercise JSON.stringify's shortest-decimal spelling
// in diagnostic evidence, including integers whose exact binary value is longer.
for (const width of [1000000000000000128, 1e21, 1e-6]) {
  const p = cloneProject(frameSource);
  p.meshKeyforms[0].positions = [0,0,1,0,0,1];
  p.meshKeyforms[1].positions = [0,0,width,0,0,1];
  add(p);
}

const mixedFrameSource = cloneProject(projects.find(p => p.scene.nodes.frame_warp && p.rig.warpDeformerKeyforms.length));
for (const baseKind of ['KeyArtHold','TransitionInstance']) for (const variant of ['transformNode','transformSlot','opacity','presence','order','clipping','conflict','highestLayer','bone','warp','warpInactive','warpBone','warpMissing','mesh','meshInactive','zero','mixed']) {
  const p = cloneProject(mixedFrameSource), t = p.transitions[0], slot = p.semanticSlots[0];
  const program = { id: 'frame_sequence_program', durationTicks: 100, tracks: [{ trackId: 'frame_camera',version: 1,kind: 'CameraTrack',target: { cameraId: 'main' },channels: { scale: { keyframes: [{ id: 'frame_camera_key',timeTicks: 0,value: 1.5,interpolationToNext: { kind: 'step' } }] } } }],events: [{ id: 'frame_sequence_event',timeTicks: 1,type: 'marker',participants: [],payload: {} }],regions: [] };
  p.temporalPrograms.push(program); p.meshes = [{ id: 'frame_mesh' }];
  p.animation.deformationSamples = [{ id: 'frame_sample',meshId: 'frame_mesh',topologyId: p.meshTopologies[0].id,offsets: [{ vertexId: p.meshTopologies[0].vertexIds[0],dx: 3,dy: -2 }] }];
  const sequence = { id: 'frame_sequence',displayName: 'Frame mixer',temporalProgramId: program.id,viewLaneItems: [{ id: 'frame_view',kind: baseKind,...(baseKind === 'KeyArtHold' ? { keyArtId: t.fromKeyArtId } : { transitionId: t.id }),startTicks: 0,endTicks: 100 }],clipInstances: [],metadata: {} }; p.sequences = [sequence];
  const addClip = (id,kind,target,channels,weight=1,layer=0) => {
    const clipProgram = { id: 'frame_clip_program_'+id,durationTicks: 100,tracks: [{ trackId: 'frame_clip_track_'+id,version: 1,kind,target,channels: Object.fromEntries(Object.entries(channels).map(([channel,value]) => [channel,{ keyframes: [{ id: 'frame_clip_key_'+id+'_'+channel,timeTicks: 0,value,interpolationToNext: { kind: 'step' } }] }])) }],events: [{ id: 'frame_clip_event_'+id,timeTicks: 1,type: 'marker',participants: [],payload: {} }],regions: [] };
    p.temporalPrograms.push(clipProgram); p.animation.clips.push({ id: 'frame_clip_'+id,displayName: id,temporalProgramId: clipProgram.id,defaultLoopMode: 'once',metadata: {} });
    sequence.clipInstances.push({ id: 'frame_instance_'+id,clipId: 'frame_clip_'+id,startTicks: 0,endTicks: 100,sourceOffsetTicks: 0,playbackRate: { numerator: 1,denominator: 1 },loopMode: 'once',weight,layer,enabled: true });
  };
  const semantic = { semanticSlotId: slot.id };
  if (variant === 'transformNode') addClip('node','TransformTrack',{ nodeId: 'node_a',coordinateSpace: 'node-local' },{ positionX: 7,rotation: 0.3,scaleX: 1.5 },0.5);
  if (variant === 'transformSlot' || variant === 'mixed') addClip('slot','TransformTrack',{ ...semantic,coordinateSpace: 'node-local' },{ positionX: 7,positionY: -3,rotation: 0.3,scaleX: 1.5,scaleY: 0.7 },0.5);
  if (variant === 'opacity' || variant === 'zero' || variant === 'mixed') addClip('opacity','OpacityTrack',semantic,{ opacity: 0.3 },variant === 'zero' ? 0 : 0.5);
  if (variant === 'presence' || variant === 'fractional' || variant === 'conflict' || variant === 'highestLayer') addClip('presence','PresenceTrack',semantic,{ presence: 'absent' },variant === 'fractional' ? 0.5 : 1);
  if (variant === 'conflict' || variant === 'highestLayer') addClip('other_presence','PresenceTrack',semantic,{ presence: 'present' },1,variant === 'highestLayer' ? 3 : 0);
  if (variant === 'order' || variant === 'mixed') addClip('order','DrawOrderTrack',semantic,{ drawOrder: 9 });
  if (variant === 'clipping') addClip('clipping','ClippingTrack',{ nodeId: 'node_a' },{ clipping: { sourceNodeId: 'node_b' } });
  if (variant === 'bone' || variant === 'mixed') addClip('bone','BoneTrack',{ boneId: 'frame_bone' },{ x: 2,y: -1,rotation: 0.25 },0.7);
  if (variant === 'warp' || variant === 'warpInactive' || variant === 'warpBone' || variant === 'warpMissing' || variant === 'mixed') {
    if (variant === 'warpMissing') p.rig.warpDeformerKeyforms = [];
    if (variant === 'warpInactive' || variant === 'warpBone') {
      for (const id of (variant === 'warpBone' ? ['node_a','node_b'] : ['node_a','node_b','frame_bone'])) { p.scene.nodes.frame_warp.children = p.scene.nodes.frame_warp.children.filter(v => v !== id); p.scene.nodes[p.scene.rootId].children.push(id); p.scene.nodes[id].parentId = p.scene.rootId; }
      if (variant === 'warpInactive') p.rig.bones[0].parentNodeId = p.scene.rootId;
    }
    addClip('warp','DeformerTrack',{ deformerId: 'frame_warp',controlPointId: p.rig.deformers[0].controlPointIds[0] },{ deltaX: 3,deltaY: -2 },0.7);
  }
  if (variant === 'mesh' || variant === 'meshInactive' || variant === 'mixed') {
    if (variant === 'meshInactive') { const topology = cloneProject(p.meshTopologies[0]); topology.id = 'frame_other_topology'; topology.vertexIds = topology.vertexIds.map(id => 'other_'+id); p.animation.deformationSamples[0].offsets[0].vertexId = topology.vertexIds[0]; p.meshTopologies.push(topology); p.animation.deformationSamples[0].topologyId = topology.id; }
    addClip('mesh','MeshDeformationTrack',{ meshId: 'frame_mesh' },{ deformation: { deformationSampleId: 'frame_sample',weight: 0.3 } },0.7);
  }
  add(p);
}

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
  'transition.get_diagnostics': ['transitions', 'transitionId'],
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
    try { expected = { value: oracle(project, name, input) }; }
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
  if (implemented.includes('bone.get_evaluated_pose')) for (const bone of project.rig.bones) {
    for (const art of [...project.keyArts, { id: 'missing' }]) run('bone.get_evaluated_pose', { boneId: bone.id, keyArtId: art.id });
  }
  if (implemented.includes('bone.get_two_bone_ik_pose')) for (const constraint of [...project.rig.twoBoneIkConstraints, { id: 'missing' }]) {
    for (const art of [...project.keyArts, { id: 'missing' }]) {
      const input = { constraintId: constraint.id, keyArtId: art.id };
      run('bone.get_two_bone_ik_pose', input);
      for (const target of [{ x: 0, y: 0 }, { x: 13, y: -7 }, { x: 1e4, y: 1e4 }, { x: -31, y: 29 }, null, {}, { x: '1', y: 0 }]) run('bone.solve_two_bone_ik', { ...input, target });
    }
  }
  if (implemented.includes('skin.evaluate')) for (const binding of project.rig.skinBindings) for (const art of project.keyArts) {
    const topology = project.meshTopologies.find(t => t.id === binding.topologyId);
    const positions = topology.vertexIds.flatMap((_, i) => [i * 13 - 7, i * -9 + 17]);
    for (const values of [positions, positions.map(() => 1e308), [], positions.slice(1), positions.map((v, i) => i ? v : null), '🐱', false, null, {}]) run('skin.evaluate', { bindingId: binding.id, keyArtId: art.id, positions: values });
    run('skin.evaluate', { bindingId: binding.id, keyArtId: art.id });
  }
  if (implemented.includes('mesh_form.evaluate')) for (const topology of [...project.meshTopologies, { id: 'missing', vertexIds: [] }]) {
    const positions = topology.vertexIds.flatMap((_, i) => [i * 5 - 3, i * -11 + 21]);
    for (const keyformId of [undefined, null, false, 'missing', ...project.meshFormCorrectionKeyforms.map(k => k.id)])
      for (const values of [positions, [], positions.slice(1), positions.map((v, i) => i ? v : null), '🐱', false, null, {}])
        run('mesh_form.evaluate', { topologyId: topology.id, keyformId, positions: values });
  }
  for (const value of project.meshFormCorrectionKeyforms) run('mesh_form.get_for_context', { topologyId: value.topologyId, keyArtId: value.keyArtId, semanticSlotId: value.semanticSlotId });
  for (const value of project.animation.deformationSamples) {
    run('animation.deformation_sample.list', { meshId: value.meshId });
    run('animation.deformation_sample.list', { topologyId: value.topologyId });
    run('animation.deformation_sample.list', { meshId: value.meshId, topologyId: value.topologyId });
  }
  for (const meshId of ['', null, false, 'missing']) run('animation.deformation_sample.list', { meshId });
  for (const name of ['mesh.list_keyforms', 'mesh_form.list_keyforms']) {
    const values = name === 'mesh.list_keyforms' ? project.meshKeyforms : project.meshFormCorrectionKeyforms;
    for (const value of values) {
      for (const key of ['topologyId', 'keyArtId', 'semanticSlotId']) run(name, { [key]: value[key] });
      run(name, { topologyId: value.topologyId, keyArtId: value.keyArtId, semanticSlotId: value.semanticSlotId });
    }
    if (projectIndex === 0 || project === projects.find(candidate => candidate.meshFormCorrectionKeyforms.length))
      for (const value of ['', null, false, 0, [], {}, 'missing']) for (const key of ['topologyId', 'keyArtId', 'semanticSlotId']) run(name, { [key]: value });
  }
  if (project.scene.nodes.query_group) for (const text of ['', null, false, 0, true, 10, {}, ['x', null, 'y'], 'missing', 'Hidden', 'part'])
    for (const includeHidden of [false, true, null, 0]) run('scene.search', { text, includeHidden });
  if (implemented.includes('animation.sample_program')) for (const program of project.temporalPrograms) {
    const times = new Set([0, program.durationTicks, Math.floor(program.durationTicks / 2), 1, 17, 25, 49, 51, 75, 99].filter(time => time <= program.durationTicks));
    for (const event of program.events) times.add(event.timeTicks);
    for (const region of program.regions) { times.add(region.startTicks); times.add(region.endTicks); }
    for (const track of program.tracks) for (const channel of Object.values(track.channels)) {
      const keys = [...channel.keyframes].sort((a, b) => a.timeTicks - b.timeTicks);
      for (const [index, key] of keys.entries()) {
        times.add(key.timeTicks);
        if (index) times.add(Math.floor((keys[index - 1].timeTicks + key.timeTicks) / 2));
      }
    }
    for (const timeTicks of times) run('animation.sample_program', { programId: program.id, timeTicks });
    for (const timeTicks of [-1, null, false, '0', 0.5, program.durationTicks + 1, Number.MAX_SAFE_INTEGER + 1]) run('animation.sample_program', { programId: program.id, timeTicks });
  }
  if (implemented.includes('sequence.project_clip_instances')) for (const sequence of project.sequences) {
    const duration = project.temporalPrograms.find(program => program.id === sequence.temporalProgramId).durationTicks;
    const middle = Math.floor(duration / 2);
    const times = new Set([0, duration, middle, Math.max(0, middle - 1), Math.min(duration, middle + 1)]);
    for (const instance of sequence.clipInstances) for (const time of [instance.startTicks - 1, instance.startTicks, instance.startTicks + 1, instance.endTicks - 1, instance.endTicks])
      if (time >= 0 && time <= duration) times.add(time);
    for (const timeTicks of times) run('sequence.project_clip_instances', { sequenceId: sequence.id, timeTicks });
    for (const timeTicks of [-1, null, false, '0', 0.5, duration + 1]) run('sequence.project_clip_instances', { sequenceId: sequence.id, timeTicks });
  }
  if (implemented.includes('sequence.evaluate')) for (const sequence of project.sequences) {
    const duration = project.temporalPrograms.find(program => program.id === sequence.temporalProgramId).durationTicks;
    const times = new Set([0,1,Math.floor(duration/2),duration-1,duration]);
    for (const item of sequence.viewLaneItems) for (const tick of [item.startTicks,item.startTicks+1,item.endTicks-1,item.endTicks]) if (tick <= duration) times.add(tick);
    for (const instance of sequence.clipInstances) for (const tick of [instance.startTicks,instance.startTicks+1,instance.endTicks-1,instance.endTicks]) if (tick <= duration) times.add(tick);
    for (const timeTicks of [...times,-1,null,'0',0.5,duration+1]) run('sequence.evaluate', { sequenceId: sequence.id,timeTicks });
  }
  if (implemented.includes('export.evaluate_frame')) for (const [collection,key] of [['transitions','transitionId'],['sequences','sequenceId']]) for (const owner of project[collection]) {
    for (const frameRate of [{ numerator: 24,denominator: 1 },{ numerator: 30000,denominator: 1001 },{ numerator: 120000,denominator: 1 }]) {
      const plan = oracle(project,'export.get_frame_plan',{ [key]: owner.id,frameRate });
      for (const frameIndex of new Set([0,1,Math.floor(plan.frameCount/2),plan.frameCount-1,plan.frameCount,-1,null,'0',0.5])) run('export.evaluate_frame', { [key]: owner.id,frameRate,frameIndex });
    }
  }
  if (implemented.includes('transition.evaluate')) for (const transition of project.transitions) {
    const duration = project.temporalPrograms.find(program => program.id === transition.temporalProgramId).durationTicks;
    for (const timeTicks of [-1, 0, 1, Math.floor(duration/4), Math.floor(duration/2), duration-1, duration, duration+1, null, '0', 0.5, Number.MAX_SAFE_INTEGER+1]) run('transition.evaluate', { transitionId: transition.id, timeTicks });
  }
  if (implemented.includes('export.get_frame_plan')) {
    const rates = [{ numerator: 24, denominator: 1 }, { numerator: 30000, denominator: 1001 },
      { numerator: 60000, denominator: 2002 }, { numerator: 1000000, denominator: 1 },
      { numerator: Number.MAX_SAFE_INTEGER, denominator: 1 }, { numerator: 1, denominator: Number.MAX_SAFE_INTEGER },
      { numerator: Number.MAX_SAFE_INTEGER, denominator: Number.MAX_SAFE_INTEGER - 1 },
      { numerator: 0, denominator: 1 }, { numerator: 1, denominator: 0 }, { numerator: '24', denominator: 1 },
      { numerator: 24.5, denominator: 1 }, null, {}];
    for (const transition of project.transitions) for (const frameRate of rates) run('export.get_frame_plan', { transitionId: transition.id, frameRate });
    for (const sequence of project.sequences) for (const frameRate of rates) run('export.get_frame_plan', { sequenceId: sequence.id, frameRate });
  }
  return { name: `query-project-${projectIndex}`, locale: 'en_US', project, cases };
});
const localeLists = {
  'clipping.list': 'clippingBindings', 'deformer.list': 'rig.deformers', 'bone.list': 'rig.bones',
  'bone.list_rotation_constraints': 'rig.boneRotationConstraints', 'bone.list_two_bone_ik': 'rig.twoBoneIkConstraints',
  'bone.list_rigid_bindings': 'rig.rigidBoneBindings', 'skin.list_bindings': 'rig.skinBindings',
  'mesh_form.list_keyforms': 'meshFormCorrectionKeyforms', 'mesh.list_topologies': 'meshTopologies',
  'mesh.list': 'meshes', 'mesh.list_keyforms': 'meshKeyforms',
};
const locales = [['en-US', 'en_US'], ['ja-JP', 'ja_JP'], ['sv-SE', 'sv_SE'], ['tr-TR', 'tr_TR']];
// Rename test identities and references together. This is fixture construction,
// never a Product mutation API. Accent/case/equivalent forms retain stable IDs.
const localeIds = ['Ö', 'Å', 'z', 'ä', 'a\u0308', 'A', 'a', 'İ', 'ı', '\u{10000}', '\uE000'];
const remap = (value, replacements, field = '') => {
  if (typeof value === 'string') return /(^id$|Ids?$|^children$)/.test(field) ? replacements.get(value) ?? value : value;
  if (Array.isArray(value)) return value.map(entry => remap(entry, replacements, field));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [field === "nodes" ? replacements.get(key) ?? key : key, remap(entry, replacements, key)]));
  return value;
};
for (const [name, path] of Object.entries(localeLists)) {
  let project = cloneProject(projects.reduce((left, right) => at(right, path).length > at(left, path).length ? right : left));
  const values = at(project, path);
  assert(values.length);
  if (['rig.boneRotationConstraints', 'rig.twoBoneIkConstraints', 'rig.rigidBoneBindings', 'rig.skinBindings'].includes(path)) {
    const source = cloneProject(values[0]);
    while (values.length < localeIds.length) values.push({ ...cloneProject(source), id: `query_locale_copy_${values.length}`, enabled: false });
  }
  if (path === 'clippingBindings') {
    const source = cloneProject(values[0]);
    while (values.length < localeIds.length) {
      const node = createSceneNode({ id: `query_locale_target_${values.length}`, displayName: 'Locale target', parentId: project.scene.rootId });
      project.scene.nodes[node.id] = node; project.scene.nodes[project.scene.rootId].children.push(node.id);
      values.push({ ...cloneProject(source), id: `query_locale_copy_${values.length}`, targetNodeId: node.id, enabled: false });
    }
  }
  if (path === 'meshFormCorrectionKeyforms' || path === 'meshKeyforms') {
    const source = cloneProject(values[0]);
    const compatible = project.meshKeyforms.find(entry => entry.topologyId === source.topologyId && entry.keyArtId === source.keyArtId && entry.semanticSlotId === source.semanticSlotId);
    while (values.length < localeIds.length) {
      const keyArtId = `query_locale_art_${values.length}`;
      project.keyArts.push({ ...cloneProject(project.keyArts.find(entry => entry.id === source.keyArtId)), id: keyArtId });
      for (const slot of project.semanticSlots) {
        const mapping = slot.mappings.find(entry => entry.keyArtId === source.keyArtId);
        if (mapping) slot.mappings.push({ ...cloneProject(mapping), keyArtId });
      }
      values.push({ ...cloneProject(source), id: `query_locale_copy_${values.length}`, keyArtId });
      if (path === 'meshFormCorrectionKeyforms') project.meshKeyforms.push({ ...cloneProject(compatible), id: `query_locale_layout_${values.length}`, keyArtId });
    }
  }
  project = remap(project, new Map(values.map((entry, index) => [entry.id, `query_locale_${localeIds[index % localeIds.length]}`])));
  assert.equal(validationResult(project).valid, true, `Locale ${name} fixture must be admitted: ${JSON.stringify(validationResult(project).issues.filter(issue => issue.severity === "error"))}`);
  for (const [locale, nativeLocale] of locales) fixtures.push({ name: `locale-${locale}-${name}`, locale: nativeLocale, project,
    cases: [{ request: { name }, expected: { value: oracle(project, name, undefined, locale) } }] });
}
const searchProject = cloneProject(transformed);
for (const [index, displayName] of ['Äpfel', 'Ångström', 'Örebro', 'Istanbul', 'İZMİR', 'ΣΟΣ', 'ΟΣ', 'straße', 'ẞ', 'ﬃ', 'a\u0308', 'emoji 🐱', 'I\u0307', 'Embedded\u0000Name'].entries()) {
  const id = `query_locale_search_${index}`, parentId = index % 2 ? group.id : root.id;
  const n = createSceneNode({ id, displayName, parentId }); searchProject.scene.nodes[id] = n; searchProject.scene.nodes[parentId].children.push(id);
}
assert.equal(validationResult(searchProject).valid, true);
for (const [locale, nativeLocale] of [...locales, ['en-US', 'en_US_POSIX'], ['en-US', 'c']]) {
  const cases = [];
  for (const text of ['i', 'I', 'İ', 'ı', 'σ', 'ς', 'ss', 'ß', 'ä', 'Å', 'a\u0308', '🐱', '\u0000', '']) for (const includeHidden of [true, false]) {
    const input = { text, includeHidden };
    cases.push({ request: { name: 'scene.search', input }, expected: { value: oracle(searchProject, 'scene.search', input, locale) } });
  }
  fixtures.push({ name: `locale-search-${nativeLocale}`, locale: nativeLocale, project: searchProject, cases });
}
// A native POSIX/C default must use V8's en-US collation as well as case mapping.
const boneLocale = fixtures.find(fixture => fixture.name === 'locale-en-US-bone.list');
for (const locale of ['en_US_POSIX', 'c']) fixtures.push({ ...boneLocale, name: `locale-fallback-${locale}`, locale });
const coverage = new Set(fixtures.flatMap(fixture => fixture.cases.map(entry => entry.request.name)));
for (const name of implemented) assert(coverage.has(name));
// Keep committed oracle files bounded; all partitions are read by the same test.
const batches = [[]]; let bytes = 0;
for (const fixture of fixtures) {
  const row = JSON.stringify(fixture);
  if (bytes + Buffer.byteLength(row) > 6 * 1024 * 1024 && batches.at(-1).length) { batches.push([]); bytes = 0; }
  batches.at(-1).push(row); bytes += Buffer.byteLength(row);
}
for (let index = 0; index < batches.length; index++) {
  const text = `{\n"implemented":${JSON.stringify(implemented)},\n"pending":${JSON.stringify(pending)},\n"fixtures":[\n${batches[index].join(',\n')}\n]\n}\n`;
  const path = new URL(index ? `./query-conformance-${index + 1}.json` : './query-conformance.json', import.meta.url);
  if (process.argv.includes('--write')) await writeFile(path, text);
  else assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'), text, 'Query fixtures differ from current JS');
}
console.log(`Query conformance: ${implemented.length}/72 queries; ${fixtures.length} Projects; ${fixtures.reduce((sum, fixture) => sum + fixture.cases.length, 0)} reads in ${batches.length} files.`);
