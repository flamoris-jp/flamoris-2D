import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductHostService } from '../product-host/session-service.mjs';
import { buildPhase8ProductionProof } from './helpers/phase8-production-proof.js';
import { serializeProject, parseProjectDocument } from '../src/io/project-json.js';
import { playbackTick } from '../product-host/timeline-authoring.mjs';
let sequence=0;
async function send(host,method,payload={}) {
 const r=(await host.handle({protocolVersion:1,requestId:'timeline-'+ ++sequence,method,payload,documentToken:host.documentToken,expectedRevision:host.revision})).response;
 assert.equal(r.ok,true,JSON.stringify(r.error));return r.payload;
}
test('native Sequence/Clip/typed tracks/keyframes and Product playback share exact command history',async()=>{
 const {project}=buildPhase8ProductionProof();const host=new ProductHostService();await send(host,'session.open',{document:serializeProject(project)});
 let context={};
 async function tool(name,input={}) {
  const before=structuredClone(host.document.session.project);const result=await send(host,'timeline.tool',{context,tool:name,input});
  const after=structuredClone(host.document.session.project);await send(host,'session.undo');assert.deepEqual(host.document.session.project,before);
  await send(host,'session.redo');assert.deepEqual(host.document.session.project,after);return result;
 }
 const created=await tool('sequence.create',{displayName:'Native eight seconds',durationSeconds:8,keyArtId:project.keyArts[0].id});context.sequenceId=created.sequenceId;
 let snapshot=await send(host,'timeline.projection',context);assert.equal(snapshot.sequence.durationTicks,960000);
 const track=await tool('track.add',{kind:'CameraTrack',target:{cameraId:'main'}});context.trackId=track.trackId;
 const first=await tool('key.add',{trackId:track.trackId,channel:'positionX',timeTicks:0,value:0});
 await tool('key.add',{trackId:track.trackId,channel:'positionX',timeTicks:960000,value:12});
 await tool('key.ease',{trackId:track.trackId,channel:'positionX',keyframeId:first.keyframeId,presetId:'ease-in-out'});
 delete context.trackId;
 const clip=await tool('clip.create',{displayName:'Blink',durationSeconds:1,defaultLoopMode:'loop'});context.clipId=clip.clipId;
 const opacity=await tool('track.add',{kind:'OpacityTrack',target:{nodeId:'slot_eye_a'}});
 await tool('key.add',{trackId:opacity.trackId,channel:'opacity',timeTicks:0,value:1});
 await tool('key.add',{trackId:opacity.trackId,channel:'opacity',timeTicks:60000,value:0});
 delete context.clipId;
 await tool('instance.add',{clipId:clip.clipId,startTicks:0,endTicks:960000,sourceOffsetTicks:0,playbackRate:{numerator:1,denominator:1},loopMode:'loop',weight:1,layer:0,enabled:true});
 const before=structuredClone(host.document.session.project), revision=host.revision;
 for(const [milliseconds,mode,expected] of [[1250,'once',150000],[9000,'once',960000],[9000,'loop',120000]]) {
  const clock=playbackTick(host.document.session,{sequenceId:context.sequenceId,playback:{elapsedMilliseconds:milliseconds,startTicks:0,mode}});
  assert.equal(clock.timeTicks,expected);assert.equal(clock.playing,mode==='loop'||milliseconds<8000);
 }
 snapshot=await send(host,'timeline.projection',{...context,timeTicks:480000});
 assert.equal(snapshot.currentTick,480000);assert.deepEqual(host.document.session.project,before);assert.equal(host.revision,revision);
 const saved=await send(host,'session.serialize');await send(host,'session.open',{document:saved.document});
 assert.deepEqual(host.document.session.project,parseProjectDocument(serializeProject(before)).project);
});
