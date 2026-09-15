import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductHostService } from '../product-host/session-service.mjs';
let sequence=0;
async function send(host,method,payload={},overrides={}) {
 const response=(await host.handle({protocolVersion:1,requestId:'rig-'+ ++sequence,method,payload,
 documentToken:host.documentToken,expectedRevision:host.revision,...overrides})).response;
 assert.equal(response.ok,true,JSON.stringify(response.error));return response.payload;
}
test('native Bone/Warp/Skin/form tools commit through one history and preserve exact Undo/Redo',async()=>{
 const host=new ProductHostService();await send(host,'session.create');
 const ids=[];
 for(const name of ['eye','mask']){const a=await send(host,'assets.reserve',{name,width:32,height:32});host.assets.entries.get(a.id).bytes=Buffer.alloc(4096,255);ids.push(a.id);}
 await send(host,'handsOn.open',{assetIds:ids});
 const nodeId=[...host.document.bindings.keys()][0], keyArtId=host.document.session.project.keyArts[0].id;
 const context={nodeId,keyArtId};
 async function tool(name,input={}) {
   const before=structuredClone(host.document.session.project);const result=await send(host,'rig.tool',{context,tool:name,input});
   const after=structuredClone(host.document.session.project);
   if(result!==null){await send(host,'session.undo');assert.deepEqual(host.document.session.project,before,name+' undo');
     await send(host,'session.redo');assert.deepEqual(host.document.session.project,after,name+' redo');}
   return result;
 }
 await tool('bone.create',{displayName:'root',length:12});context.boneId=host.document.session.project.rig.bones[0].id;
 await tool('bone.rest',{x:5,y:5,rotation:0,length:12});
 await tool('bone.pose',{x:0,y:0,rotation:.2});
 await tool('bone.limit',{minRotation:-.5,maxRotation:.5,enabled:true});
 await tool('bone.bind');await tool('bone.unbind');
 const snapshot=await send(host,'rig.projection',context);assert.equal(snapshot.fk.poses.length,1);
 context.keyformId=snapshot.part.activeKeyform.id;
 await tool('weight.create',{topologyId:snapshot.part.topology.id});context.bindingId=host.document.session.project.rig.skinBindings[0].id;
 await tool('weight.paint',{vertexIds:[snapshot.part.topology.vertexIds[0]],strength:.2,operation:'add'});
 await tool('form.move',{vertexIds:[snapshot.part.topology.vertexIds[0]],x:2,y:-1});
 const warp=await tool('warp.create',{displayName:'warp',parentNodeId:snapshot.rootId,size:3,bounds:{left:0,top:0,right:32,bottom:32},childNodeIds:[nodeId]});
 context.deformerId=warp.deformerId;
 const points=host.document.session.project.rig.deformers[0].controlPointIds;
 await tool('warp.move',{controlPointIds:[points[0]],x:2,y:3});
 await tool('warp.reset',{controlPointIds:points});
 await tool('clipping.source',{sourceNodeId:[...host.document.bindings.keys()][1]});
 await tool('clipping.enabled',{enabled:false});await tool('clipping.remove');
 await tool('bone.moveDocument',{start:{x:0,y:0},end:{x:2,y:1},pose:true});
 await tool('bone.createAt',{start:{x:10,y:10},end:{x:15,y:15}});
 const rendered=await send(host,'render.project',{keyArtId});assert.equal(rendered.plan.unsupportedReasons.length,0);
 const before=structuredClone(host.document.session.project);
 const stale=(await host.handle({protocolVersion:1,requestId:'stale-rig',method:'rig.tool',documentToken:host.documentToken,
 expectedRevision:host.revision-1,payload:{context,tool:'bone.pose',input:{x:0,y:0,rotation:1}}})).response;
 assert.equal(stale.error.code,'revision.conflict');assert.deepEqual(host.document.session.project,before);
});
