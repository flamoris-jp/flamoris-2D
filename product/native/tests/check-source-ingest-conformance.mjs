import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createProjectFromPsd} from '../../src/io/psd-project.js';
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
if(process.argv.includes('--write'))await writeFile(file,JSON.stringify(cases)+'\n');else assert.deepEqual(JSON.parse(await readFile(file,'utf8')),cases);
console.log(`Source ingest conversion: ${cases.length} cases match current JS.`);
