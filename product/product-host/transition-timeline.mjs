import { randomUUID } from 'node:crypto';
import { TransitionAuthoringController } from '../src/ui/transition-authoring-controller.js';
import { TransitionPreviewController, TRANSITION_TRACK_KINDS } from '../src/ui/transition-preview-controller.js';
import { TEMPORAL_TRACK_DEFINITIONS, temporalChannelDefinition, ticksToSeconds } from '../src/core/temporal.js';
import { compileEasePreset } from '../src/ui/ease-presets.js';
function controller(session,context) {
 const authoring=new TransitionAuthoringController(session);authoring.selectTransition(context.transitionId);
 const preview=new TransitionPreviewController(session,authoring);
 if(context.trackId&&preview.activeProgram().tracks.some(t=>t.trackId===context.trackId))preview.selectTrack(context.trackId);
 preview.setTick(context.timeTicks||0);return preview;
}
export function transitionTimelineProjection(session,context) {
 const c=controller(session,context),{evaluation,...state}=c.getState();
 const slots=session.query('semantic_slot.list');const nodes=Object.values(session.project.scene.nodes).filter(n=>n.kind==='part');
 const slotTargets=slots.map(s=>({label:s.displayName,target:{semanticSlotId:s.id}}));
 const targetOptions=['GeometryBlendTrack','AppearanceTrack'].includes(context.trackKind)?slotTargets:
   [{label:'遷移全体',target:{transitionDefault:true}},...slotTargets,...nodes.map(n=>({label:n.displayName,target:{nodeId:n.id}}))];
 const arts=[state.activeTransition.fromKeyArtId,state.activeTransition.toKeyArtId].map(keyArtId=>session.query('keyart.get',{keyArtId}));
 const appearanceOptions=[...new Map(arts.flatMap(art=>art.members.map(m=>[m.appearanceId,{id:m.appearanceId,label:`${art.displayName} · ${session.project.scene.nodes[m.nodeId]?.displayName||'画像'}`}]))).values()];
 return {...state,transitionId:context.transitionId,sequence:null,selectedClipId:null,selectedClip:null,clips:[],clipInstances:[],viewItems:[],
   allowedTrackKinds:TRANSITION_TRACK_KINDS,targetOptions,appearanceOptions,
   durationSeconds:ticksToSeconds(state.program.durationTicks),channels:state.selectedTrack?Object.fromEntries(TEMPORAL_TRACK_DEFINITIONS[state.selectedTrack.kind].channels.map(name=>[name,temporalChannelDefinition(state.selectedTrack.kind,name)])):{},
   keyArts:session.query('keyart.list'),transitions:session.query('transition.list'),deformationSamples:session.query('animation.deformation_sample.list')};
}
export function executeTransitionTimeline(session,{context,tool,input={}}) {
 const c=controller(session,context),program=c.activeProgram();
 const previous=()=>{const frame=program.tracks.find(t=>t.trackId===input.trackId)?.channels[input.channel]?.keyframes.find(k=>k.id===input.keyframeId);if(!frame)throw new Error('Unknown Transition keyframe.');return frame;};
 switch(tool) {
  case 'track.add': {const trackId=`track_${randomUUID()}`;return {...c.addTrack({...input,trackId}),trackId};}
  case 'track.remove':return session.execute({type:'animation.temporal.remove_track',payload:{programId:program.id,trackId:input.trackId}});
  case 'key.add': {
   const track=program.tracks.find(t=>t.trackId===input.trackId);if(!track)throw new Error('Unknown Transition track.');
   const keyframeId=`key_${randomUUID()}`;return {...c.addKeyframe(input.trackId,input.channel,{...input,id:keyframeId,
     interpolationToNext:{kind:temporalChannelDefinition(track.kind,input.channel).discrete?'step':'linear'}}),keyframeId};
  }
  case 'key.update':return c.updateKeyframe(input.trackId,input.channel,input.keyframeId,{...previous(),...input.patch});
  case 'key.remove':return c.removeKeyframe(input.trackId,input.channel,input.keyframeId);
  case 'key.ease':return c.updateKeyframe(input.trackId,input.channel,input.keyframeId,{...previous(),interpolationToNext:compileEasePreset(input.presetId)});
  case 'key.interpolation':return c.updateKeyframe(input.trackId,input.channel,input.keyframeId,{...previous(),interpolationToNext:input.kind==='bezier'?{kind:'bezier',...input.controls}:{kind:input.kind}});
  default:throw new Error('This tool requires a Sequence or Clip.');
 }
}
