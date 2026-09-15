import { randomUUID } from 'node:crypto';
import { TransitionAuthoringController, PART_TRANSITION_MODES } from '../src/ui/transition-authoring-controller.js';
import { EndpointMeshController } from '../src/ui/endpoint-mesh-controller.js';
import { CorrespondencePreviewController } from '../src/ui/correspondence-preview-controller.js';
import { secondsToTicks, ticksToSeconds } from '../src/core/temporal.js';
const id = kind => `${kind}_${randomUUID()}`;
const command = (type,payload) => ({type,payload});

export function registerSourceParts(session) {
  const commands=[];
  for(const art of session.project.keyArts) for(const member of art.members) {
    if(session.project.scene.nodes[member.nodeId]?.kind!=='part'||session.project.semanticSlots.some(s=>s.mappings.some(m=>m.keyArtId===art.id&&m.nodeId===member.nodeId)))continue;
    const semanticSlotId=id('slot');
    commands.push(command('semantic_slot.create',{semanticSlot:{id:semanticSlotId,displayName:session.project.scene.nodes[member.nodeId].displayName,role:null,metadata:{},mappings:[{keyArtId:art.id,nodeId:member.nodeId}]}}));
  }
  return commands.length?session.executeTransaction(commands,{label:'Include source parts in Key Art composition'}):null;
}
function authoring(session, context) {
  const controller=new TransitionAuthoringController(session,{idFactory:id});
  if(context.transitionId)controller.selectTransition(context.transitionId);
  if(context.keyArtId)controller.selectKeyArt(context.keyArtId);
  if(context.semanticSlotId)controller.selectSemanticSlot(context.semanticSlotId);
  return controller;
}
export function keyStateProjection(session,context={}) {
  const state=authoring(session,context).getState();
  return {...state,durationSeconds:state.activeTransition?ticksToSeconds(state.activeTransition.durationTicks):1,slots:session.query('semantic_slot.list'),keyforms:session.query('mesh.list_keyforms'),
    topologies:session.query('mesh.list_topologies'),modes:PART_TRANSITION_MODES,
    nodes:Object.values(session.project.scene.nodes).filter(n=>n.kind==='part').map(n=>({id:n.id,displayName:n.displayName})),
    diagnostics:context.transitionId?session.query('transition.get_diagnostics',{transitionId:context.transitionId}):[],
    samples:session.query('animation.deformation_sample.list'),meshes:session.query('mesh.list')};
}
export function correspondence(session,context,input,apply=false) {
  const a=authoring(session,context),e=new EndpointMeshController(session,a);
  // Selection uses the persisted shared references. Selecting keyforms with the
  // interactive controller would commit syncPartTopology during a read.
  const c=new CorrespondencePreviewController(session,e);
  c.setDirection(input.reverse?'to':'from',input.reverse?'from':'to');c.setPreset(input.preset||'normal');
  if(!Array.isArray(input.pins)||input.pins.length>10000)throw new Error('Invalid correspondence pins.');
  for(const pin of input.pins)c.addPin(pin.vertexId,pin.target);
  const state=c.solve();return apply?c.apply():state;
}
export function executeKeyStateTool(session,{context={},tool,input={}}) {
  const a=authoring(session,context),p=session.project;
  const run=(type,payload)=>session.execute(command(type,payload));
  switch(tool) {
    case 'source.include':return registerSourceParts(session);
    case 'keyart.duplicate': {
      const source=session.query('keyart.get',{keyArtId:context.keyArtId}),keyArtId=id('keyart');
      const commands=[command('keyart.create',{keyArt:{...source,id:keyArtId,displayName:input.displayName}})];
      for(const slot of p.semanticSlots)for(const m of slot.mappings.filter(m=>m.keyArtId===source.id))commands.push(command('semantic_slot.map_node',{semanticSlotId:slot.id,keyArtId,nodeId:m.nodeId}));
      for(const k of p.meshKeyforms.filter(k=>k.keyArtId===source.id))commands.push(command('mesh_keyform.create',{keyform:{...k,id:id('keyform'),keyArtId}}));
      for(const k of p.rig.bonePoseKeyforms.filter(k=>k.keyArtId===source.id))commands.push(command('bone.set_keyform',{...k,keyArtId}));
      for(const k of p.rig.warpDeformerKeyforms.filter(k=>k.keyArtId===source.id))commands.push(command('deformer.set_keyform',{...k,keyArtId}));
      for(const k of p.meshFormCorrectionKeyforms.filter(k=>k.keyArtId===source.id))commands.push(command('mesh_form.create_keyform',{keyform:{...k,id:id('correction'),keyArtId}}));
      return {...session.executeTransaction(commands,{label:'Duplicate Key Art state'}),keyArtId};
    }
    case 'keyart.rename': {
      const keyArt=session.query('keyart.get',{keyArtId:context.keyArtId});
      return run('keyart.update',{keyArtId:keyArt.id,keyArt:{...keyArt,displayName:input.displayName}});
    }
    case 'keyart.member': {
      const art=session.query('keyart.get',{keyArtId:context.keyArtId});
      if(!art.members.some(m=>m.nodeId===input.nodeId))throw new Error('Part is not a member of the selected Key Art.');
      const {nodeId,opacity,presence,drawOrder}=input;
      return run('keyart.update',{keyArtId:art.id,keyArt:{...art,members:art.members.map(m=>m.nodeId===nodeId?{...m,opacity,presence,drawOrder}:m)}});
    }
    case 'keyart.remove':return run('keyart.remove',{keyArtId:context.keyArtId});
    case 'slot.create':return run('semantic_slot.create',{semanticSlot:{id:id('slot'),displayName:input.displayName,role:null,mappings:[],metadata:{}}});
    case 'slot.rename':return run('semantic_slot.update',{semanticSlotId:context.semanticSlotId,semanticSlot:{...session.query('semantic_slot.get',{semanticSlotId:context.semanticSlotId}),displayName:input.displayName}});
    case 'slot.remove':return run('semantic_slot.remove',{semanticSlotId:context.semanticSlotId});
    case 'slot.map':return a.mapNode(input.keyArtId,input.nodeId);
    case 'slot.unmap':return a.unmapNode(input.keyArtId);
    case 'transition.create':return a.createTransitionWithProgram({...input,durationTicks:secondsToTicks(input.durationSeconds)});
    case 'transition.endpoint':return a.setEndpoint(input.endpoint,input.keyArtId);
    case 'transition.update': {
      const {durationTicks,...transition}=session.query('transition.get',{transitionId:context.transitionId});
      return session.executeTransaction([command('transition.update',{transitionId:transition.id,transition:{...transition,displayName:input.displayName}}),
        command('animation.temporal.set_duration',{programId:transition.temporalProgramId,durationTicks:secondsToTicks(input.durationSeconds)})]);
    }
    case 'transition.remove':return run('transition.remove',{transitionId:context.transitionId});
    case 'transition.mode':return a.setPartMode(input.mode,input.configuration||{});
    case 'transition.topology': {
      const part=a.getState().selectedSemanticSlot?.partTransition;
      return session.executeTransaction([
        command('transition.set_part_mode',{transitionId:context.transitionId,semanticSlotId:context.semanticSlotId,partTransitionId:part?.id||id('part_transition'),mode:'morph',configuration:{}}),
        command('transition.set_part_topology',{transitionId:context.transitionId,semanticSlotId:context.semanticSlotId,...input})],{label:'Connect shared Morph endpoints'});
    }
    case 'transition.override':return run('transition.set_diagnostic_override',{transitionId:context.transitionId,...input});
    case 'transition.clearOverride':return run('transition.clear_diagnostic_override',{transitionId:context.transitionId,...input});
    case 'correspondence.apply':return correspondence(session,context,input,true);
    case 'mesh.align': {
      const keyform=session.query('mesh.get_keyform',{keyformId:input.keyformId});
      if(keyform.keyArtId!==context.keyArtId)throw new Error('Select the mesh Key Art before alignment.');
      const {x,y,rotation,scaleX,scaleY,pivotX,pivotY}=input;
      if(![x,y,rotation,scaleX,scaleY,pivotX,pivotY].every(Number.isFinite))throw new Error('Alignment requires finite values.');
      const positions=[];for(let i=0;i<keyform.positions.length;i+=2){const dx=(keyform.positions[i]-pivotX)*scaleX,dy=(keyform.positions[i+1]-pivotY)*scaleY;
        positions.push(pivotX+x+dx*Math.cos(rotation)-dy*Math.sin(rotation),pivotY+y+dx*Math.sin(rotation)+dy*Math.cos(rotation));}
      return run('mesh_keyform.move_vertices',{keyformId:keyform.id,positions});
    }
    case 'sample.create':return run('animation.deformation_sample.create',{sample:{id:id('sample'),meshId:input.meshId,topologyId:input.topologyId,offsets:input.offsets}});
    case 'sample.update':return run('animation.deformation_sample.update',{sampleId:input.sampleId,sample:{...session.query('animation.deformation_sample.get',{sampleId:input.sampleId}),offsets:input.offsets}});
    case 'sample.remove':return run('animation.deformation_sample.remove',{sampleId:input.sampleId});
    default:throw new Error('Unknown native Key State tool.');
  }
}
