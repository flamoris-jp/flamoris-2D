import { randomUUID } from 'node:crypto';
import { SequenceTimelineController } from '../src/ui/sequence-timeline-controller.js';
import { TransientPlaybackClock, projectTimelineTime } from '../src/ui/timeline-primitives.js';
import { TEMPORAL_TRACK_DEFINITIONS, temporalChannelDefinition, secondsToTicks, ticksToSeconds } from '../src/core/temporal.js';
import { EASE_PRESETS } from '../src/ui/ease-presets.js';
const idFactory=kind=>`${kind}_${randomUUID()}`;
export function timelineContext(session,context={}) {
 const controller=new SequenceTimelineController(session,{idFactory,scheduleFrame:()=>null,cancelFrame:()=>{}});
 if(context.sequenceId)controller.selectSequence(context.sequenceId);
 if(context.clipId&&controller.clipList().some(c=>c.id===context.clipId))controller.selectClip(context.clipId);
 if(context.trackId&&controller.activeProgram()?.tracks.some(t=>t.trackId===context.trackId))controller.selectTrack(context.trackId);
 if(context.sequenceId)controller.scrubToTick(context.timeTicks||0);
 if(context.channel&&context.keyframeId&&controller.activeProgram()?.tracks.find(t=>t.trackId===context.trackId)?.channels[context.channel]?.keyframes.some(k=>k.id===context.keyframeId))controller.selectKeyframe(context.trackId,context.channel,context.keyframeId);
 return controller;
}
export function timelineProjection(session,context={}) {
 const controller=timelineContext(session,context);const state=controller.getState();
 const {evaluation,...projection}=state;
 return {...projection,durationSeconds:state.sequence?ticksToSeconds(state.sequence.durationTicks):8,clipDurationSeconds:state.selectedClip?ticksToSeconds(state.selectedClip.durationTicks):1,trackDefinitions:TEMPORAL_TRACK_DEFINITIONS,
  channels:state.selectedTrack?Object.fromEntries(TEMPORAL_TRACK_DEFINITIONS[state.selectedTrack.kind].channels.map(channel=>
    [channel,temporalChannelDefinition(state.selectedTrack.kind,channel)])):{},
  targetOptions:context.trackKind?controller.targetOptions(context.trackKind):[],
  keyArts:session.query('keyart.list'),transitions:session.query('transition.list'),
  deformationSamples:session.query('animation.deformation_sample.list'),easePresets:EASE_PRESETS,
  secondsLabel:projectTimelineTime(context.timeTicks||0,'seconds',session.query('project.get_render_settings').frameRate).label};
}
export function executeTimelineTool(session,{context={},tool,input={}}) {
 const controller=timelineContext(session,context);
 const duration=()=>input.durationSeconds===undefined?input.durationTicks:secondsToTicks(input.durationSeconds);
 switch(tool) {
  case 'sequence.create':return controller.createSequence({...input,durationTicks:duration()});
  case 'sequence.rename':return controller.renameSequence(input.displayName);
  case 'sequence.duration':return controller.setSequenceDuration(duration());
  case 'sequence.remove':return controller.removeSequence();
  case 'view.hold':return controller.insertHold(input);
  case 'view.transition':return controller.insertTransition(input);
  case 'view.update':return controller.updateViewItem(input.itemId,input);
  case 'view.remove':return controller.removeViewItem(input.itemId,{absorb:input.absorb});
  case 'view.reorder':return controller.moveViewItem(input.itemId,input.direction);
  case 'clip.create':return controller.createClip({...input,durationTicks:duration()});
  case 'clip.update':return controller.updateClip(input.patch,{durationTicks:duration()??null});
  case 'clip.remove':return controller.removeClip();
  case 'instance.add':return controller.addClipInstance(input);
  case 'instance.update':return controller.commitClipInstance(input.clipInstanceId,input.patch);
  case 'instance.remove':return controller.removeClipInstance(input.clipInstanceId);
  case 'track.add':return controller.addTrack(input.kind,input.target);
  case 'track.remove':return controller.removeTrack(input.trackId);
  case 'key.add':return controller.addKeyframe(input.trackId,input.channel,input);
  case 'key.update':return controller.updateKeyframe(input.trackId,input.channel,input.keyframeId,input.patch);
  case 'key.remove':return controller.removeKeyframe(input.trackId,input.channel,input.keyframeId);
  case 'key.ease':return controller.applyEasePreset(input.trackId,input.channel,input.keyframeId,input.presetId);
  case 'key.interpolation':return controller.setKeyframeInterpolation(input.trackId,input.channel,input.keyframeId,input.kind,input.controls);
  default:throw new Error('Unknown native timeline tool.');
 }
}
export function playbackTick(session,{sequenceId,transitionId,playback}) {
 if(!playback||!Number.isFinite(playback.elapsedMilliseconds)||playback.elapsedMilliseconds<0)throw new Error('Invalid playback sample.');
 const owner=session.query(sequenceId?'sequence.get':'transition.get',sequenceId?{sequenceId}:{transitionId});
 const program=session.query('animation.get_program',{programId:owner.temporalProgramId});
 let timeTicks=playback.startTicks;const clock=new TransientPlaybackClock({onTick:tick=>timeTicks=tick,scheduleFrame:()=>null,cancelFrame:()=>{}});
 clock.setMode(playback.mode);clock.play({durationTicks:program.durationTicks,startTick:playback.mode==='once'&&playback.startTicks===program.durationTicks?0:playback.startTicks,startTimeMs:0});
 clock.advance(playback.elapsedMilliseconds);return {timeTicks,playing:clock.playing};
}
