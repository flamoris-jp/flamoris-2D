// Test-only oracle for the C++ UI intent compiler and mesh generator.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHandsOnProject,meshContext,executeMeshTool,generateMeshPreview} from '../../product-host/mesh-hands-on.mjs';
import {EditorSession} from '../../src/commands/editor.js';
import {createProject,createSceneNode,cloneProject} from '../../src/model/project.js';
const project=createProject({id:'project',name:'Mesh authoring',width:12,height:8,idFactory:()=> 'root'});
project.scene.nodes.part=createSceneNode({id:'part',displayName:'髪',parentId:'root',bounds:{left:2,top:1,right:10,bottom:7}});
project.scene.nodes.root.children.push('part');
project.keyArts.push({id:'art',displayName:'Art',rootNodeId:'root',members:[{nodeId:'part',appearanceId:'pixels',opacity:1,presence:'present',drawOrder:0,clipping:{sourceNodeId:null}}],metadata:{}});
const candidate={positions:[2,1,10,1,10,7,2,7],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3]};
const cases=[];Date.now=()=>0;
function test(name,p,input,query='native.mesh_tool'){
 const real=new EditorSession(p);let commands=[],label='',result={};
 const adapter={project:real.project,query:real.query.bind(real),execute(c,o={}){commands=[c];label=o.label??'';return {};},executeTransaction(c,o={}){commands=c;label=o.label??'';return {};}};
 try {
  const expected=query==='native.mesh_state'?meshContext(adapter,input,false).preparation.getState():(()=>{result=executeMeshTool(adapter,input)??{};return {commands,label,result};})();
  cases.push({name,project:p,query,input:{...input,idNamespace:'0'},expected});
 }catch(e){cases.push({name,project:p,query,input:{...input,idNamespace:'0'},error:e.message});}
}
test('create mesh',project,{nodeId:'part',context:'structure',tool:'topology.automesh',input:{candidate}});
const ready=new EditorSession(project);ready.executeTransaction(cases[0].expected.commands);const prepared=cloneProject(ready.project),form=prepared.meshKeyforms[0].id;
for(const [name,tool,input] of [
 ['move','deform.move',{positions:[3,2,11,2,11,8,3,8]}],['noop','deform.move',{positions:candidate.positions}],
 ['add','topology.add',{position:{x:6,y:4},uv:{x:.5,y:.5}}],['remove','topology.remove',{vertexId:'vtx_0004'}],
 ['triangle','topology.connect',{vertexIds:['vtx_0001','vtx_0002','vtx_0004']}],['subdivide','topology.subdivide',{vertexIds:['vtx_0001','vtx_0002']}],
 ['label','topology.set-label',{vertexId:'vtx_0001',semanticLabel:'目'}],['clear','topology.clear-label',{vertexId:'vtx_0001'}],
 ['replace mesh','topology.automesh',{candidate,replaceExisting:true}]
])test(name,prepared,{nodeId:'part',keyformId:form,context:tool==='deform.move'?'layout':'structure',tool,input});
for(const p of [project,prepared])test('projection '+p.meshTopologies.length,p,{nodeId:'part'},'native.mesh_state');
test('no selection',project,{nodeId:null},'native.mesh_state');
test('stale keyform',prepared,{nodeId:'part',keyformId:'missing',context:'layout',tool:'deform.move',input:{positions:candidate.positions}});
test('layout topology reject',prepared,{nodeId:'part',context:'layout',tool:'topology.add',input:{}});
const hidden=cloneProject(prepared);hidden.scene.nodes.root.visible=false;test('hidden parent',hidden,{nodeId:'part',context:'structure',tool:'topology.add',input:{}});
const multiple=cloneProject(prepared);multiple.keyArts.push({...cloneProject(multiple.keyArts[0]),id:'art2'});test('ambiguous Key Art',multiple,{nodeId:'part'},'native.mesh_state');test('explicit Key Art',multiple,{nodeId:'part',keyArtId:'art'},'native.mesh_state');
const generators=[];
function gen(name,width,height,visible,input){const bytes=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes[(y*width+x)*4+3]=visible(x,y);const asset={width,height,bytes,left:2,top:-3};try{generators.push({name,width,height,rgba:[...bytes],input:{...input,left:2,top:-3},expected:generateMeshPreview(asset,input)});}catch(e){generators.push({name,width,height,rgba:[...bytes],input:{...input,left:2,top:-3},error:e.message});}}
for(const kind of ['grid','contour'])for(const [name,visible] of [
 ['box',()=>255],['empty',()=>0],['small',(x,y)=>x===1&&y===1?255:0],['hole',(x,y)=>x>=2&&x<=4&&y>=2&&y<=4?0:255],['split',(x,y)=>x<2||x>5?255:0],['concave',(x,y)=>x>3&&y<4?0:255],['alpha',(x,y)=>(x+y)*20]
])for(const density of [.1,.8])gen(`${kind} ${name} ${density}`,8,8,visible,{kind,columns:3,rows:2,settings:{density,interiorDensity:.7,cornerSensitivity:.9,alphaThreshold:.3}});
const output={cases,generators};const path=new URL('mesh-authoring-conformance.json',import.meta.url);
if(process.argv.includes('--write'))writeFileSync(path,JSON.stringify(output)+'\n');else assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),output);
console.log(`Mesh authoring: ${cases.length} intent and ${generators.length} generation cases`);
