import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProductHostService } from '../product-host/session-service.mjs';
import { buildPhase8ProductionProof, PROOF_TICKS } from './helpers/phase8-production-proof.js';
import { encodeRgbaPng } from '../product-host/document-artwork.mjs';
import { serializeProject } from '../src/io/project-json.js';
import { createEvaluatedRenderPlan } from '../src/core/evaluated-render.js';
import { evaluateSequence } from '../src/core/sequence-evaluator.js';
let sequence=0;
async function send(host,method,payload={}) {
  const r=(await host.handle({protocolVersion:1,requestId:'render-'+ ++sequence,method,payload,
    documentToken:host.documentToken,expectedRevision:host.revision})).response;
  assert.equal(r.ok,true,JSON.stringify(r.error));return r.payload;
}
test('native render projection reuses canonical production-shot evaluation for clipping/Warp/Bone/correction/animation/camera',async()=>{
  const {project}=buildPhase8ProductionProof();
  const png=encodeRgbaPng(2,2,new Uint8Array([255,0,0,255,0,255,0,128,0,0,255,255,255,255,255,0]));
  const renderAssets=Object.values(project.scene.nodes).filter(n=>n.kind==='part').map(n=>({nodeId:n.id,
    sourceKey:n.sourceRef?.sourceKey||n.id,width:2,height:2,left:0,top:0,dataUrl:'data:image/png;base64,'+png.toString('base64')}));
  const host=new ProductHostService();await send(host,'session.open',{document:serializeProject(project,0,{renderAssets})});
  const before=structuredClone(host.document.session.project);
  const fixtures=[];
  for(const timeTicks of [PROOF_TICKS.start,PROOF_TICKS.transitionAB,PROOF_TICKS.transitionBC,PROOF_TICKS.blinkC,PROOF_TICKS.terminal-1]) {
    const native=await send(host,'render.project',{sequenceId:'sequence_proof',timeTicks});
    const canonical=createEvaluatedRenderPlan(evaluateSequence(project,'sequence_proof',timeTicks),{resolveArtwork:()=>true,clippingRasterization:true});
    assert.deepEqual(native.plan,canonical);assert.deepEqual(host.document.session.project,before);
    fixtures.push(native);
  }
  const keyform=host.document.session.project.meshKeyforms[0];
  const positions=keyform.positions.map((v,i)=>i===0?v+3:v);
  const identity={revision:host.revision,current:host.document.session.currentRevision,saved:host.document.session.savedRevision,
    history:structuredClone(host.document.session.history)};
  const preview=await send(host,'render.project',{keyArtId:keyform.keyArtId,layoutPreview:{keyformId:keyform.id,positions}});
  assert.deepEqual(host.document.session.project,before);
  assert.deepEqual({revision:host.revision,current:host.document.session.currentRevision,saved:host.document.session.savedRevision,
    history:host.document.session.history},identity);
  await send(host,'session.execute',{command:{type:'mesh_keyform.move_vertices',payload:{keyformId:keyform.id,positions}}});
  const committed=await send(host,'render.project',{keyArtId:keyform.keyArtId});
  assert.deepEqual(preview.plan,committed.plan,'drag preview must equal the same committed Product command');
  await send(host,'session.undo');assert.deepEqual(host.document.session.project,before);
  const invalid=(await host.handle({protocolVersion:1,requestId:'invalid-preview',method:'render.project',documentToken:host.documentToken,
    expectedRevision:host.revision,payload:{keyArtId:keyform.keyArtId,layoutPreview:{keyformId:keyform.id,positions:[1,2]}}})).response;
  assert.equal(invalid.ok,false);assert.deepEqual(host.document.session.project,before);
  // Optional explicit test output for Windows renderer conformance/measurement. Never Product bootstrap.
  if(process.env.FLAMORIS_RENDER_FIXTURE_DIR) {
    const directory=process.env.FLAMORIS_RENDER_FIXTURE_DIR;mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'production-render-projections.json'),JSON.stringify(fixtures));
    writeFileSync(join(directory,'production-render-textures.json'),JSON.stringify(renderAssets.map(a=>({nodeId:a.nodeId,width:2,height:2,
      bgra:[0,0,255,255,0,255,0,128,255,0,0,255,255,255,255,0]}))));
  }
});
