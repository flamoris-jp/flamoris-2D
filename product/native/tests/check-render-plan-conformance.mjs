import {readFileSync,writeFileSync} from 'node:fs';
import {createEvaluatedRenderPlan} from '../../src/core/evaluated-render.js';
import {createClippingRasterPlan} from '../../src/core/clipping-raster-plan.js';
const cases=[];
function add(name,frame,artwork) {
 const plan=createEvaluatedRenderPlan(frame,{resolveArtwork:id=>artwork.includes(id),clippingRasterization:true});
 try {const clipping=createClippingRasterPlan(plan);cases.push({name,input:{frame,artwork},expected:{plan,maskSourceIds:clipping.maskSourceIds,contributions:Object.fromEntries(clipping.contributionById)}});}catch(e){cases.push({name,input:{frame,artwork},error:e.message});}
}
const frames=[];
for(const file of ['query-conformance.json','query-conformance-2.json','query-conformance-3.json'])for(const fixture of JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8')).fixtures)for(const c of fixture.cases) {
 if(!['sequence.evaluate','transition.evaluate','export.evaluate_frame'].includes(c.request.name)||!c.expected.value)continue;
 const frame=c.request.name==='export.evaluate_frame'?c.expected.value.evaluation:c.expected.value;
 if(frame.evaluatedParts?.length)frames.push({name:fixture.name+':'+c.request.name,frame});
}
// Select distinct frames with clipping, weighted composites and camera semantics.
const unique=new Map();for(const entry of frames){const s=JSON.stringify(entry.frame);if(!unique.has(s))unique.set(s,entry);}
for(const {name,frame} of [...unique.values()].slice(0,40)) {
 const artwork=[...new Set(frame.evaluatedParts.flatMap(p=>p.renderInstances.flatMap(i=>i.appearanceSamples.map(a=>a.sourceNodeId))))];add(name,frame,artwork);
}
const sample=(id,order,extra={})=>({renderInstanceId:id,sourceNodeId:'node',drawOrder:order,transform:[1,0,0,1,0,0],opacity:1,mesh:{positions:[0,0,1,0,0,1],indices:[0,1,2]},appearanceSamples:[{sourceNodeId:'node',appearanceId:'art',uvs:[0,0,1,0,0,1],weight:1}],clipping:null,...extra});
const frame=instances=>({evaluatedParts:[{semanticSlotId:'slot',presence:'present',renderInstances:instances}]});
add('weighted camera',{...frame([sample('b',0,{compositeGroupId:'group',compositeWeight:3}),sample('a',0,{compositeGroupId:'group',compositeWeight:1})]),camera:{positionX:2,positionY:3,rotation:.25,scale:2}},['node']);
add('nested clipping',frame([sample('source',0),sample('middle',1,{clipping:{mode:'inside',sourceRenderInstanceId:'source'}}),sample('target',2,{clipping:{mode:'inside',sourceRenderInstanceId:'middle'}})]),['node']);
add('clipping cycle',frame([sample('a',0,{clipping:{mode:'inside',sourceRenderInstanceId:'b'}}),sample('b',1,{clipping:{mode:'inside',sourceRenderInstanceId:'a'}})]),['node']);
add('draw order conflict',frame([sample('a',0),sample('b',0)]),['node']);
add('missing artwork',frame([sample('a',0)]),[]);
add('group order conflict',frame([sample('a',0,{compositeGroupId:'group',compositeWeight:1}),sample('b',1,{compositeGroupId:'group',compositeWeight:1})]),['node']);
add('zero appearance',frame([sample('a',0,{appearanceSamples:[{sourceNodeId:'node',appearanceId:'art',uvs:[0,0,1,0,0,1],weight:0}]})]),['node']);
const output=JSON.stringify(cases)+'\n',path=new URL('render-plan-conformance.json',import.meta.url);
if(process.argv.includes('--write'))writeFileSync(path,output);else if(readFileSync(path,'utf8').replace(/\r\n/g,'\n')!==output)throw Error('Render plan oracle drift');
console.log(`Render and clipping plans: ${cases.length} oracle cases`);
