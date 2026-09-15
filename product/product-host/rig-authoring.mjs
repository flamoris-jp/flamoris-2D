import { randomUUID } from 'node:crypto';
import { BoneAuthoringController } from '../src/ui/bone-authoring-controller.js';
import { BoneMirrorAuthoringController } from '../src/ui/bone-mirror-authoring-controller.js';
import { TwoBoneIkAuthoringController } from '../src/ui/two-bone-ik-authoring-controller.js';
import { WeightAuthoringController } from '../src/ui/weight-authoring-controller.js';
import { ClippingAuthoringController } from '../src/ui/clipping-authoring-controller.js';
import { FormCorrectionAuthoringController } from '../src/ui/form-correction-authoring-controller.js';
import { defaultWarpKeyformControlPoints, isWarpGridDimension } from '../src/model/warp-deformer.js';
import { evaluateEndpointProjectedBoneFk, createEndpointBoneWarpEvaluationStages } from '../src/core/rigid-bone-evaluator.js';
import { invertWarpStages, resolveWarpEvaluationStages } from '../src/core/warp-deformer-evaluator.js';
import { worldTransformMatrix, invertAffine, transformPoint } from '../src/core/transforms.js';
import { meshContext } from './mesh-hands-on.mjs';
import { projectDeformerLattice, unprojectDeformerDocumentPoint } from '../src/ui/deformer-viewport-overlay.js';
import { createBoneAuthoringSpace } from '../src/ui/bone-viewport-overlay.js';
const idFactory = kind => `${kind}_${randomUUID()}`;
function boneController(session, context) {
  const controller = new BoneAuthoringController(session, {idFactory});
  controller.setActiveKeyArt(context.keyArtId || null); controller.selectBone(context.boneId || null);
  return controller;
}
function editableNode(session,id) {
  if(!id)return;
  const node=session.query('scene.get_node',{nodeId:id});
  if(node.locked||!node.effectiveVisible)throw new Error('非表示・ロック中の対象は編集できません。');
}
export function rigProjection(session, context = {}) {
  const keyArtId=context.keyArtId || null;
  const bone=boneController(session,context);
  const part=context.nodeId?meshContext(session,{nodeId:context.nodeId,keyformId:context.keyformId,keyArtId},false).preparation.getState():null;
  const warps=session.query('deformer.list').map(d=>{
    const full=session.query('deformer.get',{deformerId:d.id});
    const keyform=keyArtId?session.query('deformer.get_keyform',{deformerId:d.id,keyArtId}):null;
    const positions=keyform?.controlPoints || defaultWarpKeyformControlPoints(full,full.controlPoints);
    const lattice=projectDeformerLattice({project:session.project,deformer:full,keyArtId,controlPoints:positions,view:{scale:1,originX:0,originY:0}});
    return {...full,positions,documentPositions:lattice.points.map(p=>({controlPointId:p.controlPointId,...p.document})),diagnostics:lattice.diagnostics,
      worldTransform:session.query('scene.get_node',{nodeId:d.id}).worldTransform};
  });
  return {bones:session.query('bone.list'),bone:bone.getState(),
    fk:keyArtId?evaluateEndpointProjectedBoneFk(session.project,keyArtId):{poses:[],diagnostics:[]},
    warps,part,rigidBindings:session.query('bone.list_rigid_bindings'),skinBindings:session.query('skin.list_bindings'),
    rotationConstraints:session.query('bone.list_rotation_constraints'),ikConstraints:session.query('bone.list_two_bone_ik'),
    clipping:context.nodeId?new ClippingAuthoringController(session).getState(context.nodeId):null,
    rootId:session.project.scene.rootId};
}
export function executeRigTool(session, {context = {}, tool, input = {}}) {
  editableNode(session,context.nodeId);editableNode(session,context.boneId);editableNode(session,context.deformerId);
  const bone=boneController(session,context);
  switch(tool) {
    case 'bone.create':return bone.createChild(input);
    case 'bone.createAt':{
      const parentNodeId=context.boneId||session.project.scene.rootId;
      const inverse=invertAffine(worldTransformMatrix(session.project,parentNodeId));
      const stages=context.boneId?resolveWarpEvaluationStages(createEndpointBoneWarpEvaluationStages(session.project,context.boneId,context.keyArtId)):[];
      const a=transformPoint(inverse,invertWarpStages(input.start,stages)),b=transformPoint(inverse,invertWarpStages(input.end,stages));
      const length=Math.hypot(b.x-a.x,b.y-a.y);
      if(length<.001)throw new Error('Boneの始点から終点へドラッグしてください。');
      return session.execute({type:'bone.create',payload:{id:idFactory('bone'),displayName:'Bone',parentNodeId,
        restLocalTransform:{x:a.x,y:a.y,rotation:Math.atan2(b.y-a.y,b.x-a.x)},length}});
    }
    case 'bone.moveDocument':{
      const selected=bone.selectedBone();if(!selected)throw new Error('Select a Bone.');
      const space=createBoneAuthoringSpace({project:session.project,boneId:selected.id,authoring:{mode:input.pose?'pose':'edit',activeKeyArt:context.keyArtId?{id:context.keyArtId}:null}});
      if(space.diagnostics.length)throw new Error(space.diagnostics.map(d=>d.message||d.code).join('\n'));
      const a=space.toLocal(input.start),b=space.toLocal(input.end);
      const current=input.pose?bone.persistentPose()?.localDelta||{x:0,y:0,rotation:0}:selected.restLocalTransform;
      const next={...current,x:current.x+b.x-a.x,y:current.y+b.y-a.y};
      return input.pose?bone.setPose(next):bone.setRest({...next,length:selected.length});
    }
    case 'bone.rest':return bone.setRest(input);
    case 'bone.pose':return bone.setPose(input);
    case 'bone.reset':return bone.resetPose();
    case 'bone.remove':return bone.remove();
    case 'bone.rename':return bone.rename(input.displayName);
    case 'bone.enabled':return session.execute({type:'bone.set_enabled',payload:{boneId:context.boneId,enabled:input.enabled}});
    case 'bone.reparent':return bone.reparent(input.parentNodeId);
    case 'bone.bind':return bone.bindTarget(context.nodeId);
    case 'bone.bindingEnabled': {
      const binding=session.query('bone.list_rigid_bindings').find(b=>b.targetNodeId===context.nodeId);
      if(!binding)throw new Error('Select a rigidly attached Part.');
      return session.execute({type:'bone.set_rigid_binding_enabled',payload:{bindingId:binding.id,enabled:input.enabled}});
    }
    case 'bone.unbind':{
      const binding=session.query('bone.list_rigid_bindings').find(b=>b.targetNodeId===context.nodeId);
      return binding?session.execute({type:'bone.remove_rigid_binding',payload:{bindingId:binding.id}}):null;
    }
    case 'bone.mirror':{
      editableNode(session,input.targetBoneId);
      const mirror=new BoneMirrorAuthoringController(session);
      mirror.setPair({sourceBoneId:context.boneId,targetBoneId:input.targetBoneId,activeKeyArtId:context.keyArtId,axisX:input.axisX});
      return input.pose?mirror.mirrorPose():mirror.mirrorRest();
    }
    case 'bone.limit':{
      const existing=session.query('bone.get_rotation_constraint_for_bone',{boneId:context.boneId});
      return existing?session.executeTransaction([
        {type:'bone.set_rotation_constraint_bounds',payload:{constraintId:existing.id,minRotation:input.minRotation,maxRotation:input.maxRotation}},
        {type:'bone.set_rotation_constraint_enabled',payload:{constraintId:existing.id,enabled:input.enabled}},
      ],{label:'Edit Bone rotation limit'}):session.execute({type:'bone.create_rotation_constraint',payload:{constraint:{
        id:idFactory('rotation_limit'),boneId:context.boneId,enabled:input.enabled,minRotation:input.minRotation,maxRotation:input.maxRotation}}});
    }
    case 'bone.removeLimit':return session.execute({type:'bone.remove_rotation_constraint',payload:{constraintId:input.constraintId}});
    case 'ik.create':return new TwoBoneIkAuthoringController(session,{idFactory}).createConstraint(input);
    case 'ik.remove':case 'ik.enabled':case 'ik.bend':case 'ik.target':{
      const constraint=session.query('bone.get_two_bone_ik',{constraintId:input.constraintId});
      for(const boneId of [constraint.rootBoneId,constraint.midBoneId,constraint.endBoneId])editableNode(session,boneId);
      const ik=new TwoBoneIkAuthoringController(session,{idFactory});ik.setContext({constraintId:input.constraintId,keyArtId:context.keyArtId});
      if(tool==='ik.remove')return ik.removeConstraint();
      if(tool==='ik.enabled')return ik.setEnabled(input.enabled);
      if(tool==='ik.bend')return ik.setBendDirection(input.bendDirection);
      ik.beginTargetDrag(input.target);const preview=ik.previewTarget(input.target);
      if(preview.diagnostics.length)throw new Error(preview.diagnostics.map(d=>d.code).join(', '));
      return ik.commitTargetDrag();
    }
    case 'warp.create':{
      const id=idFactory('warp');const size=input.size;
      if(!isWarpGridDimension(size))throw new Error('Warp grid must be 2, 3 or 4.');
      const commands=[{type:'deformer.create_warp',payload:{id,displayName:input.displayName,parentNodeId:input.parentNodeId,
        columns:size,rows:size,bounds:input.bounds,controlPointIds:Array.from({length:size*size},()=>idFactory('control_point'))}}];
      for(const nodeId of input.childNodeIds || []){editableNode(session,nodeId);commands.push({type:'deformer.reparent_node',payload:{nodeId,parentId:id}});}
      const result=session.executeTransaction(commands,{label:'Create Warp and attach targets'});return {...result,deformerId:id};
    }
    case 'warp.moveDocument': {
      const deformer=session.query('deformer.get',{deformerId:context.deformerId});
      const projectPoint=documentPoint=>unprojectDeformerDocumentPoint({project:session.project,deformer,keyArtId:context.keyArtId,documentPoint});
      const a=projectPoint(input.start),b=projectPoint(input.end);
      if(!a.point||!b.point||a.diagnostics.length||b.diagnostics.length)throw new Error('親Warpの編集座標へ変換できません。');
      return executeRigTool(session,{context,tool:'warp.move',input:{controlPointIds:input.controlPointIds,x:b.point.x-a.point.x,y:b.point.y-a.point.y}});
    }
    case 'warp.remove':return session.execute({type:'deformer.remove',payload:{deformerId:context.deformerId}});
    case 'warp.rename':return session.execute({type:'deformer.rename',payload:{deformerId:context.deformerId,displayName:input.displayName}});
    case 'warp.attach':return session.execute({type:'deformer.reparent_node',payload:{nodeId:context.nodeId,parentId:input.parentNodeId}});
    case 'warp.grid':
      if(!isWarpGridDimension(input.size))throw new Error('Warp grid must be 2, 3 or 4.');
      return session.execute({type:'deformer.set_grid',payload:{deformerId:context.deformerId,columns:input.size,rows:input.size,
      controlPointIds:Array.from({length:input.size*input.size},()=>idFactory('control_point'))}});
    case 'warp.move':case 'warp.reset':{
      const deformer=session.query('deformer.get',{deformerId:context.deformerId});
      const original=session.query('deformer.get_keyform',{deformerId:context.deformerId,keyArtId:context.keyArtId});
      const defaults=defaultWarpKeyformControlPoints(deformer,deformer.controlPoints);
      const selected=new Set(input.controlPointIds || deformer.controlPointIds);
      if([...selected].some(id=>!deformer.controlPointIds.includes(id)))throw new Error('Unknown Warp control point.');
      const controlPoints=(original?.controlPoints||defaults).map(p=>selected.has(p.controlPointId)
        ?tool==='warp.reset'?defaults.find(d=>d.controlPointId===p.controlPointId):{...p,x:p.x+input.x,y:p.y+input.y}:p);
      return session.execute({type:'deformer.set_keyform',payload:{deformerId:context.deformerId,keyArtId:context.keyArtId,controlPoints}});
    }
    case 'weight.create':case 'weight.paint':case 'weight.numeric':case 'weight.normalize':case 'weight.replace':{
      const controller=new WeightAuthoringController(session,{idFactory});
      controller.setContext({bindingId:context.bindingId,targetNodeId:context.nodeId,boneId:context.boneId,keyArtId:context.keyArtId});
      if(tool==='weight.create')return controller.createBinding({topologyId:input.topologyId});
      if(tool==='weight.paint'){controller.setBrush(input);controller.beginStroke();controller.previewStroke(input.vertexIds);return controller.commitStroke();}
      if(tool==='weight.numeric')return controller.setNumericWeight(input.vertexId,input.weight);
      if(tool==='weight.normalize')return controller.normalize(input.vertexId);
      return controller.replaceInfluences(input.vertexId,input.influences);
    }
    case 'weight.remove':return session.execute({type:'skin.remove_binding',payload:{bindingId:context.bindingId}});
    case 'weight.clear':return session.execute({type:'skin.clear_vertex_weights',payload:{bindingId:context.bindingId,vertexId:input.vertexId}});
    case 'weight.enabled':return session.execute({type:'skin.set_enabled',payload:{bindingId:context.bindingId,enabled:input.enabled}});
    case 'clipping.source':return new ClippingAuthoringController(session,{idFactory}).setSource(context.nodeId,input.sourceNodeId);
    case 'clipping.enabled':return new ClippingAuthoringController(session,{idFactory}).setEnabled(context.nodeId,input.enabled);
    case 'clipping.remove':return new ClippingAuthoringController(session,{idFactory}).remove(context.nodeId);
    case 'form.move':case 'form.reset':{
      const state=meshContext(session,{nodeId:context.nodeId,keyformId:context.keyformId,keyArtId:context.keyArtId}).preparation.getState();
      if(!state.topology||!state.semanticSlot)throw new Error('Select a prepared Part mesh.');
      const form=new FormCorrectionAuthoringController(session,{idFactory});
      form.setContext({topologyId:state.topology.id,semanticSlotId:state.semanticSlot.id,keyArtId:context.keyArtId,targetNodeId:context.nodeId});
      if(tool==='form.reset')return form.reset();
      for(const vertexId of input.vertexIds)form.selectVertex(vertexId,true);
      form.beginGesture();form.previewGesture({x:input.x,y:input.y});return form.commitGesture();
    }
    default:throw new Error('Unknown native Rig tool.');
  }
}
