// Current JS export/encoder contracts are the test-only oracle.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';let serial=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;syncBuiltinESMExports();
import {readFileSync,writeFileSync} from 'node:fs';
import {EditorSession} from '../../src/commands/editor.js';
import {ProductHostService} from '../../product-host/session-service.mjs';
import {nativeExportSettings,nativeExportPlan,nativeEncoderContract} from '../../product-host/native-export.mjs';
import {buildPhase8ProductionProof} from '../../tests/helpers/phase8-production-proof.js';
import {serializeProject} from '../../src/io/project-json.js';
import {encodeRgbaPng} from '../../product-host/document-artwork.mjs';
const cases=[],p=buildPhase8ProductionProof().project,session=new EditorSession(p);function add(name,query,input,action){const row={name,project:p,query,input};try{row.expected=action();}catch(e){row.error=e.message;}cases.push(row);}
add('settings','native.export_settings',{},()=>nativeExportSettings(session));
const spec={sequenceId:'sequence_proof',width:64,height:64,frameRate:{numerator:24000,denominator:1001},video:false};
for(const input of [spec,{...spec,width:1920,height:1920},{...spec,width:65},{...spec,width:8192,height:8192},{...spec,video:true,width:63,height:63},{...spec,transitionId:'transition_ab'}, {...spec,sequenceId:null,transitionId:'transition_ab'},{...spec,width:0},{...spec,frameRate:{numerator:60,denominator:2}}])add('plan','native.export_plan',input,()=>nativeExportPlan(session,input));
const host=new ProductHostService();const png=encodeRgbaPng(2,2,Uint8Array.from({length:16},()=>255));const renderAssets=Object.values(p.scene.nodes).filter(n=>n.kind==='part').map(n=>({nodeId:n.id,width:2,height:2,dataUrl:'data:image/png;base64,'+png.toString('base64')}));let seq=0;
async function send(method,payload){return (await host.handle({protocolVersion:1,requestId:'export-'+ ++seq,method,payload,documentToken:host.documentToken,expectedRevision:host.revision})).response;}
assert.equal((await send('session.open',{document:serializeProject(p,0,{renderAssets})})).ok,true);
const artwork=[...host.document.bindings].map(([nodeId,id])=>{const a=host.assets.get(id,host.documentToken,host.revision);return {id,nodeId,width:a.width,height:a.height,byteLength:a.byteLength};});
for(const frameIndex of [0,1,30,60,119,120]){let input={...spec,frameIndex};const r=await send('export.frame',input);cases.push({name:'frame '+frameIndex,project:p,query:'native.export_frame',input:{...input,artwork},...(r.ok?{expected:r.payload}:{error:r.error.message})});}
for(const input of [
 {frameDirectory:'C:/a b',outputPath:'C:/a b/shot.mp4',frameRate:spec.frameRate,frameCount:120},
 {frameDirectory:'C:\\frames\\',outputPath:'C:\\shot.mp4',frameRate:{numerator:60,denominator:2},frameCount:1},
 {frameDirectory:'  ',outputPath:'shot.mp4',frameRate:spec.frameRate,frameCount:120},
 {frameDirectory:'frames',outputPath:'shot.mp4',frameRate:spec.frameRate,frameCount:0},
 ...[{}, {versionText:'ffmpeg version'}, {versionText:'ffmpeg version',encodersText:' h264_mf '}, {versionText:'ffmpeg version',encodersText:' V..... h264_mf ',filtersText:' ... premultiply '}, ...['--enable-gpl','--enable-nonfree','--enable-libx264'].map(flag=>({versionText:'ffmpeg version',buildConfText:flag,encodersText:'h264_mf',filtersText:'premultiply'})),{versionText:'ffmpeg version',buildConfText:'--enable-gpl-extra',encodersText:'h264_mf',filtersText:'premultiply'}].map(probe=>({probe}))
])add('encoder','native.encoder',input,()=>nativeEncoderContract(input));
const wide=structuredClone(p);wide.canvas={width:960,height:540};wide.renderSettings.frameRate={numerator:24000,denominator:1001};cases.push({name:'resolution and rational presets',project:wide,query:'native.export_settings',input:{},expected:nativeExportSettings(new EditorSession(wide))});
const file=new URL('export-authoring-conformance.json',import.meta.url);if(process.argv.includes('--write'))writeFileSync(file,JSON.stringify(cases)+'\n');else assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),cases);console.log(`Native export authoring: ${cases.length} settings, frame plans, evaluated frames and encoder contracts`);
