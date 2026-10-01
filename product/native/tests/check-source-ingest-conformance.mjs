import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';let handsSequence=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++handsSequence).padStart(12,'0')}`;syncBuiltinESMExports();
import {createHandsOnProject} from '../../product-host/mesh-hands-on.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createProjectFromPsd} from '../../src/io/psd-project.js';
import {PsdReimportReview} from '../../src/io/psd-reimport-review.js';
import {createProjectFromCutworkFlimg} from '../../src/io/cutwork-flimg-project.js';
const file=new URL('./source-ingest-conformance.json',import.meta.url);
const options={fileName:'愛乃.psd',projectName:'愛乃',importedAt:'2026-10-01T03:00:00.000Z'};
const psdCases=[
  {width:20,height:20,children:[{id:7,name:'目',left:-2,top:3,right:2,bottom:7,hidden:false,opacity:.5}]},
  {width:20,height:20,children:[{id:0,name:'表情',hidden:true,children:[{id:9,name:'目',left:0,top:0,right:2,bottom:2}]}]},
  {width:20,height:20,children:[{name:'髪 / &',children:[{name:'目',left:0,top:0,right:2,bottom:2},{name:'目',left:2,top:0,right:4,bottom:2}]}]},
  {width:20,height:20,children:[{layerId:'猫/01',name:'𐀀',left:0,top:0,right:2,bottom:2,blendMode:'multiply'}]},
];
const cases=psdCases.map((source,i)=>({name:`psd-${i}`,request:{kind:'psd',source,options},expected:{project:createProjectFromPsd(source,options),bindings:[]}}));
const source={format:'flamoris-cutwork',schemaVersion:2,documentId:'doc',canvas:{width:10,height:10,colorSpace:'srgb8',pixelFormat:'straight-bgra32'},
  original:{asset:'assets/original.png',sourceName:'original.png',sha256:'a'.repeat(64),pixels:Array(400).fill(255)},
  layers:[{id:'patch',kind:'patch',name:'補修',semanticName:null,visible:true,bounds:{x:2,y:2,width:2,height:2},asset:'assets/patch.png',sha256:'b'.repeat(64),
    pixels:Array(16).fill(255),transform:{centerX:5,centerY:5,scale:1,rotationDegrees:30},sourcePolygon:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]},
  {id:'part',kind:'part',name:'',semanticName:'hair',visible:false,bounds:{x:1,y:1,width:2,height:2},asset:'assets/part.png',sha256:'c'.repeat(64),pixels:[0,127,128,255],partOrder:1},
  {id:'repair',kind:'repair',name:'修正',semanticName:null,visible:true,bounds:{x:1,y:1,width:2,height:2},asset:'assets/repair.png',sha256:'d'.repeat(64),pixels:Array(16).fill(128),ownerPartId:'part'},
  {id:'base',kind:'base',name:'Base',semanticName:null,visible:true,bounds:{x:0,y:0,width:10,height:10}}]};
const decoded=structuredClone(source);decoded.original.pixels=Uint8Array.from(source.original.pixels);for(const layer of decoded.layers)if(layer.pixels)layer.pixels=Uint8Array.from(layer.pixels);
const converted=createProjectFromCutworkFlimg(decoded,options);
const bindings=converted.renderAssets.map(r=>({nodeId:r.nodeId,layerId:r.cutworkLayerId,sourceKey:r.sourceKey,left:r.left,top:r.top,width:r.width,height:r.height}));
cases.push({name:'cutwork-v2',request:{kind:'flimg',source,options},expected:{project:converted.project,bindings,result:converted.result}});
function projection(review) {return {canApply:review.canApply,summary:review.summary,rows:review.rows.map(row=>({...structuredClone(row),displayName:review.currentProject.scene.nodes[row.currentNodeId]?.displayName||review.importedProject.scene.nodes[row.importedNodeId]?.displayName||'未対応レイヤー',choices:Object.values(review.importedProject.scene.nodes).filter(n=>review.isCompatibleImportedNode(row,n.id)).map(n=>({id:n.id,displayName:n.displayName}))}))};}
function recordReview(name,review,operation='analyze',beforeRows=undefined,change=undefined) {
 const expected=operation==='build'?(()=>{const result=review.buildResult();return {project:result.project,importedNodeAssignments:Object.fromEntries(result.importedNodeAssignments)};})():projection(review);
 cases.push({name,request:{kind:'psd-review',source:{currentProject:review.currentProject,importedProject:review.importedProject,...(beforeRows?{rows:beforeRows}:{}),...(change?{change}:{})},options:{operation}},expected});
}
const layer=(id,name,x=0)=>({id,name,left:x,top:0,right:x+2,bottom:2,opacity:1,rasterFingerprint:'fnv1a32:2x2:00000000'});
for(const [name,oldLayers,newLayers] of [
 ['same',[layer(1,'A')],[layer(1,'A')]],
 ['changed',[layer(1,'A')],[{...layer(1,'new name',1),hidden:true}]],
 ['add-missing',[layer(1,'A')],[layer(2,'B')]],
 ['ambiguous',[{...layer(1,'Eye'),id:undefined},{...layer(2,'Eye'),id:undefined}],[{...layer(1,'Eye'),id:undefined},{...layer(2,'Eye'),id:undefined}]],
 ['group-add',[layer(1,'A')],[{id:5,name:'Group',children:[layer(1,'A'),layer(3,'B')]}]]
]) {
 const current=createProjectFromPsd({width:20,height:20,children:oldLayers},options),imported=createProjectFromPsd({width:30,height:30,children:newLayers},options);
 const authored=Object.values(current.scene.nodes).find(n=>n.kind==='part');authored.transform.position.x=37;
 const review=new PsdReimportReview(current,null,{importedProject:imported});recordReview(name+' analyze',review);
 if(name==='ambiguous') {
  for(const row of review.rows) {const before=structuredClone(review.rows),target=row.candidateImportedNodeIds[0];review.setMatch(row.id,target);recordReview(name+' match '+row.id,review,'change',before,{rowId:row.id,action:'match',importedNodeId:target});}
 }
 if(review.canApply)recordReview(name+' build',review,'build',structuredClone(review.rows));
 if(name==='changed') {
  const row=review.rows[0],before=structuredClone(review.rows);review.keepExisting(row.id);recordReview(name+' keep',review,'change',before,{rowId:row.id,action:'keep'});
  const rows=structuredClone(review.rows);review.resetToAuto(row.id);recordReview(name+' auto',review,'change',rows,{rowId:row.id,action:'auto'});
 }
}
for(const assets of [[{id:'image-a',name:'素材',width:3,height:2}],[{id:'image-a',name:'素材',width:3,height:2},{id:'image-b',name:'second',width:2,height:4}]]){
 handsSequence=0;const built=createHandsOnProject(assets);let allocated=0;const ids=new Map();const normalize=value=>JSON.parse(JSON.stringify(value).replace(/([a-z]+)_([0-9a-f-]{36})/g,(all,kind)=>{if(!ids.has(all))ids.set(all,`${kind}_hands_fixture_${String(++allocated).padStart(4,'0')}`);return ids.get(all);}));
 // Traverse actual ID allocation order (Project, root, KeyArt, parts).
 for(const v of [built.project.id,built.project.scene.rootId,built.project.keyArts[0].id,...built.bindings.keys()])normalize(v);
 const project=normalize(built.project),bindings=[...built.bindings].map(([nodeId,assetId])=>({nodeId:normalize(nodeId),assetId}));
 cases.push({name:'hands-on-'+assets.length,request:{kind:'hands-on',assets,options:{idNamespace:'hands_fixture'}},expected:{project,bindings,initialProject:project,bootstrapPlans:[]}});
}
if(process.argv.includes('--write'))await writeFile(file,JSON.stringify(cases)+'\n');else assert.deepEqual(JSON.parse(await readFile(file,'utf8')),cases);
console.log(`Source ingest conversion: ${cases.length} cases match current JS.`);
