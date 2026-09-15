import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductHostService } from '../product-host/session-service.mjs';
import { buildPhase8ProductionProof } from './helpers/phase8-production-proof.js';
import { encodeRgbaPng } from '../product-host/document-artwork.mjs';
import { serializeProject } from '../src/io/project-json.js';
import { ExportFramePlanner } from '../src/core/export-frame-planner.js';
let id=0;
async function send(host,method,payload={},overrides={}) {
 return (await host.handle({protocolVersion:1,requestId:'export-'+ ++id,documentToken:host.documentToken,expectedRevision:host.revision,method,payload,...overrides})).response;
}
test('native export shares rational frame planning and every evaluated Preview frame without mutating authority',async()=>{
 const {project}=buildPhase8ProductionProof();
 const png=encodeRgbaPng(2,2,Uint8Array.from({length:16},()=>255));
 const renderAssets=Object.values(project.scene.nodes).filter(n=>n.kind==='part').map(n=>({nodeId:n.id,sourceKey:n.id,width:2,height:2,dataUrl:'data:image/png;base64,'+png.toString('base64')}));
 const host=new ProductHostService();assert.equal((await send(host,'session.open',{document:serializeProject(project,0,{renderAssets})})).ok,true);
 const spec={sequenceId:'sequence_proof',width:64,height:64,frameRate:{numerator:24000,denominator:1001},video:false};
 const plan=await send(host,'export.plan',spec);assert.equal(plan.ok,true,JSON.stringify(plan.error));
 const canonical=new ExportFramePlanner({durationTicks:600000,frameRate:spec.frameRate});assert.equal(plan.payload.frameCount,canonical.frameCount);
 const before=structuredClone(host.document.session.project),revision=host.revision;
 for(const frameIndex of [0,1,30,60,canonical.frameCount-1]) {
   const frame=await send(host,'export.frame',{...spec,frameIndex});assert.equal(frame.ok,true,JSON.stringify(frame.error));
   assert.deepEqual(frame.payload.frame,canonical.frameAt(frameIndex));
   const preview=await send(host,'render.project',{sequenceId:spec.sequenceId,timeTicks:frame.payload.frame.timeTicks});assert.equal(preview.ok,true);
   assert.deepEqual(frame.payload.plan,preview.payload.plan);assert.deepEqual(frame.payload.artwork,preview.payload.artwork);
   assert.equal(frame.payload.fileName,`frame_${String(frameIndex+1).padStart(6,'0')}.png`);
 }
 assert.deepEqual(host.document.session.project,before);assert.equal(host.revision,revision);
 assert.equal((await send(host,'export.plan',{...spec,width:65})).ok,false,'aspect mismatch must not silently stretch');
 assert.equal((await send(host,'export.frame',{...spec,frameIndex:canonical.frameCount})).ok,false);
 assert.equal((await send(host,'export.frame',{...spec,frameIndex:0},{expectedRevision:revision-1})).error.code,'revision.conflict');
 const encoder=await send(host,'export.encoder',{frameDirectory:'C:/a b',outputPath:'C:/a b/shot.mp4',frameRate:spec.frameRate,frameCount:canonical.frameCount});
 assert.equal(encoder.ok,true);assert.ok(encoder.payload.args.includes('h264_mf'));assert.ok(encoder.payload.args.includes('24000/1001'));
 assert.equal((await send(host,'export.encoder',{probe:{versionText:'ffmpeg version',buildConfText:'--enable-gpl',encodersText:' h264_mf ',filtersText:' premultiply '}})).error.code,'VIDEO_ENCODER_LICENSE_POLICY_REJECTED');
});
