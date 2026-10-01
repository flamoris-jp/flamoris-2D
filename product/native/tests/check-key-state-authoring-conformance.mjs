// JS host is the test-only oracle until physical Windows acceptance.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
let serial=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;syncBuiltinESMExports();let clock=1700000000000;Date.now=()=>clock++;
import {readFileSync,writeFileSync} from 'node:fs';
import {ProductHostService as OriginalHost} from '../../product-host/session-service.mjs';
import {EditorSession} from '../../src/commands/editor.js';
import {keyStateProjection,executeKeyStateTool,correspondence} from '../../product-host/key-state-authoring.mjs';
import {createProjectFromPsd as originalPsdProject} from '../../src/io/psd-project.js';
import {serializeProject} from '../../src/io/project-json.js';
import {encodeRgbaPng} from '../../product-host/document-artwork.mjs';
const createProjectFromPsd=(source,options={})=>originalPsdProject(source,{...options,importedAt:'2023-11-14T22:13:20.000Z'});
const cases=[],ids=new Map();const uuid=/(?:([a-z_]+)_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
function normalize(value){return JSON.parse(JSON.stringify(value).replace(uuid,(all,kind)=>{if(!ids.has(all))ids.set(all,`${kind||'asset'}_fixture_${ids.size+1}`);return ids.get(all);}));}
function register(commands,namespace){const found=[...JSON.stringify(commands).matchAll(uuid)].filter(m=>!ids.has(m[0]));found.sort((a,b)=>a[2].localeCompare(b[2]));for(const m of found)if(!ids.has(m[0]))ids.set(m[0],`${m[1]}_${namespace}_${String([...ids.values()].filter(v=>v.includes('_'+namespace+'_')).length+1).padStart(4,'0')}`);}
function commandResult(result){return Object.fromEntries(Object.entries(result||{}).filter(([k])=>['keyArtId','transitionId','programId','sampleId','meshId'].includes(k)));}
class ProductHostService extends OriginalHost {
 async handle(request){
  const isTool=request.method==='keyState.tool',isProjection=request.method==='keyState.projection',isCorrespondence=request.method==='keyState.correspondence',before=(isTool||isProjection||isCorrespondence)?normalize(this.document.session.project):null;
  const session=this.document?.session,original=session?.executeTransaction;let commands=[],label='';if(isTool)session.executeTransaction=function(c,o={}){commands=structuredClone(c);label=o.label??'Edit';return original.call(this,c,o);};
  let response;try{response=await super.handle(request);}finally{if(isTool)session.executeTransaction=original;}
  if(isTool||isProjection||isCorrespondence){const idNamespace='000intent'+String(cases.length).padStart(4,'0');register(commands,idNamespace);const row={name:isTool?request.payload.tool:request.method,project:before,query:isTool?'native.key_state_tool':isCorrespondence?'native.correspondence':'native.key_state',input:isTool?{...normalize(request.payload),idNamespace}:normalize(request.payload)};
   if(response.response.ok){row.expected=isTool?{commands:normalize(commands),label:commands.length?label:'',result:normalize(commandResult(response.response.payload))}:normalize(response.response.payload);if(isTool)row.after=normalize(session.project);}else row.error=response.response.error.message;cases.push(row);
  }return response;
 }
}
const original=readFileSync(new URL('../../tests/native-key-state-host.test.js',import.meta.url),'utf8');const start=original.indexOf('async()=>{')+11,end=original.lastIndexOf('\n});');const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
await new AsyncFunction('ProductHostService','assert','createProjectFromPsd','serializeProject','encodeRgbaPng','seq',original.slice(start,end))(ProductHostService,assert,createProjectFromPsd,serializeProject,encodeRgbaPng,0);
function extra(name,project,context,tool,input={},solve=false){
 const real=new EditorSession(project);let commands=[],label='';const before=normalize(project),idNamespace='000intent'+String(cases.length).padStart(4,'0'),adapter={project:real.project,query:real.query.bind(real),execute(c,o={}){commands=[c];label=o.label??'Edit';return {};},executeTransaction(c,o={}){commands=c;label=o.label??'Edit';return {};}};
 const row={name,project:before,query:tool?'native.key_state_tool':solve?'native.correspondence':'native.key_state',input:tool?{context:normalize(context),tool,input:normalize(input),idNamespace}:solve?{context:normalize(context),input:normalize(input)}:normalize(context)};
 try{const result=tool?executeKeyStateTool(adapter,{context,tool,input}):solve?correspondence(adapter,context,input):keyStateProjection(adapter,context);register(commands,idNamespace);row.expected=tool?{commands:normalize(commands),label:commands.length?label:'',result:normalize(commandResult(result))}:normalize(result);}catch(e){row.error=e.message;}cases.push(row);
}
const p=cases.find(c=>c.name==='correspondence.apply').project,c=cases.find(c=>c.name==='correspondence.apply').input.context,form=p.meshKeyforms.find(f=>f.keyArtId===c.keyArtId),slot=p.semanticSlots[0],vertexId=p.meshTopologies[0].vertexIds[0],nodeId=slot.mappings[0].nodeId;
extra('full projection',p,{...c,nodeId});extra('no selection projection',p,{});extra('unknown slot',p,{semanticSlotId:'missing'});
for(const [tool,input,context]of[['object.group',{displayName:'new group',parentId:p.scene.rootId},{nodeId}],['object.reparent',{parentId:p.scene.rootId,index:0},{nodeId}],['keyart.rename',{displayName:'new'},c],['keyart.member',{nodeId,opacity:.4,presence:'present',drawOrder:4},c],['keyart.remove',{},c],['slot.create',{displayName:'new slot'},c],['slot.rename',{displayName:'renamed slot'},c],['slot.remove',{},c],['slot.map',{keyArtId:c.keyArtId,nodeId},c],['slot.unmap',{keyArtId:c.keyArtId},c],['slot.map',{keyArtId:c.keyArtId,nodeId:'missing'},c],['transition.endpoint',{endpoint:'to',keyArtId:c.keyArtId},c],['transition.update',{displayName:'renamed transition',durationSeconds:4},c],['transition.mode',{mode:'hold',configuration:{holdEndpoint:'to'}},c],['transition.mode',{mode:'replace',configuration:{}},c],['transition.mode',{mode:'appear'},c],['transition.clearOverride',{key:'missing'},c],['transition.override',{key:'missing'},c],['mesh.align',{keyformId:form.id,x:3,y:2,rotation:.3,scaleX:1.2,scaleY:.8,pivotX:1,pivotY:2},c],['mesh.uv',{keyformId:form.id,vertexId:'missing',u:0,v:1},c],['sample.update',{sampleId:p.animation.deformationSamples[0]?.id||'missing',offsets:[{vertexId,dx:2,dy:3}]},c]])extra(tool+' extra',p,context,tool,input);
for(const input of [{pins:[],preset:'normal'},{pins:[{vertexId,target:{x:4,y:7}}],preset:'soft'},{pins:[{vertexId,target:{x:4,y:7}}],preset:'firm',reverse:true},{pins:[{vertexId,target:{x:4,y:7}},{vertexId:p.meshTopologies[0].vertexIds.at(-1),target:{x:24,y:20}}],preset:'firm'},{pins:[{vertexId:'missing',target:{x:0,y:0}}]},{pins:[{vertexId,target:{x:0,y:0}},{vertexId,target:{x:1,y:1}}]},{pins:[{vertexId,target:{x:null,y:0}}]},{pins:[],preset:'unknown'}])extra('correspondence extra',p,c,null,input,true);
const degenerate=structuredClone(p);const source=degenerate.meshKeyforms.find(f=>f.id===form.id);source.positions[2]=source.positions[0];source.positions[3]=source.positions[1];extra('poor conditioning',degenerate,c,null,{pins:[{vertexId:degenerate.meshTopologies[0].vertexIds[0],target:{x:1,y:1}},{vertexId:degenerate.meshTopologies[0].vertexIds[1],target:{x:2,y:2}}]},true);
const path=new URL('key-state-authoring-conformance.json',import.meta.url);if(process.argv.includes('--write'))writeFileSync(path,JSON.stringify(cases)+'\n');else assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),cases);console.log(`Key State authoring: ${cases.length} native intents, projections and correspondence samples`);
