// Existing JS host regression is the readonly oracle until Windows acceptance.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
let uuidSequence=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++uuidSequence).padStart(12,'0')}`;syncBuiltinESMExports();
let clock=1700000000000;Date.now=()=>clock++;
import {readFileSync,writeFileSync} from 'node:fs';
import {EditorSession} from '../../src/commands/editor.js';
import {rigProjection,executeRigTool} from '../../product-host/rig-authoring.mjs';
import {ProductHostService} from '../../product-host/session-service.mjs';
const cases=[],ids=new Map();let sequence=0,lastHost;
const uuid=/(?:([a-z_]+)_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
function normalize(value){return JSON.parse(JSON.stringify(value).replace(uuid,(all,kind)=>{if(!ids.has(all))ids.set(all,`${kind||'asset'}_fixture_${ids.size+1}`);return ids.get(all);}));}
async function send(host,method,payload={},overrides={}) {
 lastHost=host;
 const session=host.document?.session;
 const isTool=method==='rig.tool',isProjection=method==='rig.projection';
 const before=isTool||isProjection?normalize(session.project):null;
 let commands=[],label='';const original=session?.executeTransaction;
 if(isTool)session.executeTransaction=function(c,o={}){commands=structuredClone(c);label=o.label??'Edit';return original.call(this,c,o);};
 let response;
 try {response=(await host.handle({protocolVersion:1,requestId:'rig-'+ ++sequence,method,payload,documentToken:host.documentToken,expectedRevision:host.revision,...overrides})).response;}
 finally {if(isTool)session.executeTransaction=original;}
 assert.equal(response.ok,true,JSON.stringify(response.error));
 if(isTool){
  const idNamespace='intent'+String(cases.length).padStart(4,'0');let allocated=0;
  // Existing stable IDs were registered by the before projection. Assign only
  // new IDs in command construction order to the native deterministic factory.
  JSON.stringify(commands).replace(uuid,(all,kind)=>{if(!ids.has(all))ids.set(all,`${kind}_${idNamespace}_${String(++allocated).padStart(4,'0')}`);return all;});
  cases.push({name:payload.tool,project:before,query:'native.rig_tool',input:{...normalize(payload),idNamespace},expected:{commands:normalize(commands),label,result:payload.tool==='warp.create'?{deformerId:normalize(response.payload).deformerId}:{}} ,after:normalize(session.project)});
 }else if(isProjection)cases.push({name:'projection',project:before,query:'native.rig_state',input:normalize(payload),expected:normalize(response.payload)});
 return response.payload;
}
const original=readFileSync(new URL('../../tests/native-rig-host.test.js',import.meta.url),'utf8');
const start=original.indexOf('async()=>{')+11,end=original.lastIndexOf('\n});');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
await new AsyncFunction('ProductHostService','send','assert',original.slice(start,end))(ProductHostService,send,assert);

function extra(name,project,context,tool,input={}) {
 const real=new EditorSession(project);let commands=[],label='';
 const adapter={project:real.project,query:real.query.bind(real),execute(c,o={}){commands=[c];label=o.label??'Edit';return {};},executeTransaction(c,o={}){commands=c;label=o.label??'Edit';return {};}};
 const before=normalize(project),idNamespace='intent'+String(cases.length).padStart(4,'0');
 try {
  const result=tool?executeRigTool(adapter,{context,tool,input}):rigProjection(adapter,context);
  JSON.stringify(commands).replace(uuid,(all,kind)=>{if(!ids.has(all))ids.set(all,`${kind}_${idNamespace}_${String([...ids.values()].filter(v=>v.includes('_'+idNamespace+'_')).length+1).padStart(4,'0')}`);return all;});
  const expected=tool?{commands:normalize(commands),label,result:tool==='warp.create'?{deformerId:normalize(result).deformerId}:{}}:normalize(result);
  cases.push({name,project:before,query:tool?'native.rig_tool':'native.rig_state',input:tool?{context:normalize(context),tool,input:normalize(input),idNamespace}:normalize(context),expected});
 } catch(e){cases.push({name,project:before,query:tool?'native.rig_tool':'native.rig_state',input:tool?{context:normalize(context),tool,input:normalize(input),idNamespace}:normalize(context),error:e.message});}
}
const p=lastHost.document.session.project;
const nodeId=p.rig.skinBindings[0].targetNodeId,keyArtId=p.keyArts[0].id,boneId=p.rig.skinBindings[0].vertexWeights[1].influences[0].boneId;
const keyformId=p.meshKeyforms.find(f=>p.semanticSlots.find(s=>s.id===f.semanticSlotId).mappings.some(m=>m.nodeId===nodeId)).id;
const context={nodeId,keyArtId,boneId,keyformId,bindingId:p.rig.skinBindings[0].id,deformerId:p.rig.deformers[0].id};
const vertexId=p.meshTopologies[0].vertexIds[1];
for(const [tool,input] of [
 ['bone.rename',{displayName:'renamed'}],['bone.reset',{}],['bone.remove',{}],['bone.reparent',{parentNodeId:p.scene.rootId}],['bone.removeLimit',{constraintId:p.rig.boneRotationConstraints[0].id}],
 ['weight.numeric',{vertexId,weight:1}],['weight.normalize',{vertexId}],['weight.remove',{}],['form.reset',{}],['warp.rename',{displayName:'Warp'}],['warp.remove',{}],['warp.grid',{size:2}],['warp.attach',{parentNodeId:p.scene.rootId}],
 ['weight.numeric',{vertexId,weight:0}],['weight.paint',{vertexIds:[vertexId],strength:-1}],['weight.paint',{vertexIds:[],strength:.2}],['weight.numeric',{vertexId,weight:2}],['warp.grid',{size:5}],['form.move',{vertexIds:[],x:1,y:1}],
])extra(tool+' extra',p,context,tool,input);
extra('no selection',p,{},null);extra('unknown Bone',p,{boneId:'missing'},null);
extra('rest bone drag',p,context,'bone.moveDocument',{start:{x:2,y:1},end:{x:7,y:4},pose:false});
const nested=new EditorSession(p);nested.execute({type:'bone.create',payload:{id:'nested_bone',displayName:'nested',parentNodeId:context.deformerId,restLocalTransform:{x:2,y:3,rotation:.2},length:6}});
nested.execute({type:'bone.set_keyform',payload:{boneId:'nested_bone',keyArtId,localDelta:{x:1,y:2,rotation:.1}}});
const nestedContext={...context,boneId:'nested_bone'};
extra('nested Warp Bone projection',nested.project,nestedContext,null);
extra('nested Warp Bone rest drag',nested.project,nestedContext,'bone.moveDocument',{start:{x:2,y:1},end:{x:7,y:4},pose:false});
extra('nested Warp Bone pose drag',nested.project,nestedContext,'bone.moveDocument',{start:{x:2,y:1},end:{x:7,y:4},pose:true});
extra('nested Warp child Bone',nested.project,nestedContext,'bone.createAt',{start:{x:2,y:1},end:{x:7,y:4}});
const path=new URL('rig-authoring-conformance.json',import.meta.url);
if(process.argv.includes('--write'))writeFileSync(path,JSON.stringify(cases)+'\n');else assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),cases);
console.log(`Rig authoring: ${cases.length} real host intents and projections`);
