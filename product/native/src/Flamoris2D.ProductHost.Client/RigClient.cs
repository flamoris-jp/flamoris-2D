namespace Flamoris.Flamoris2D.ProductHost;

public sealed record RigContext(string? NodeId = null, string? KeyArtId = null, string? BoneId = null,
    string? DeformerId = null, string? BindingId = null, string? KeyformId = null)
{
    internal object Wire => new { nodeId = NodeId, keyArtId = KeyArtId, boneId = BoneId, deformerId = DeformerId, bindingId = BindingId, keyformId = KeyformId };
}
public sealed class RigEdit
{
    private RigEdit(string tool, object input) => (Tool, Input) = (tool, input);
    internal string Tool { get; }
    internal object Input { get; }
    public static RigEdit CreateBone(string displayName, double length) => new("bone.create", new { displayName, length });
    public static RigEdit BoneAt(double startX,double startY,double endX,double endY) => new("bone.createAt",new {start=new {x=startX,y=startY},end=new {x=endX,y=endY}});
    public static RigEdit MoveBoneDocument(double startX,double startY,double endX,double endY,bool pose) => new("bone.moveDocument",new {start=new {x=startX,y=startY},end=new {x=endX,y=endY},pose});
    public static RigEdit BoneRest(double x,double y,double rotation,double length) => new("bone.rest", new { x,y,rotation,length });
    public static RigEdit BonePose(double x,double y,double rotation) => new("bone.pose",new { x,y,rotation });
    public static RigEdit ResetBone() => new("bone.reset",new {});
    public static RigEdit RemoveBone() => new("bone.remove",new {});
    public static RigEdit RenameBone(string displayName) => new("bone.rename",new {displayName});
    public static RigEdit EnableBone(bool enabled) => new("bone.enabled",new {enabled});
    public static RigEdit EnableRigidBinding(bool enabled) => new("bone.bindingEnabled",new {enabled});
    public static RigEdit ReparentBone(string parentNodeId) => new("bone.reparent",new {parentNodeId});
    public static RigEdit BindBone() => new("bone.bind",new {});
    public static RigEdit UnbindBone() => new("bone.unbind",new {});
    public static RigEdit MirrorBone(string targetBoneId,double axisX,bool pose) => new("bone.mirror",new {targetBoneId,axisX,pose});
    public static RigEdit LimitBone(double minRotation,double maxRotation,bool enabled) => new("bone.limit",new {minRotation,maxRotation,enabled});
    public static RigEdit RemoveLimit(string constraintId) => new("bone.removeLimit",new {constraintId});
    public static RigEdit CreateIk(string rootBoneId,string midBoneId,string endBoneId,bool clockwise) => new("ik.create",new {
        rootBoneId,midBoneId,endBoneId,bendDirection=clockwise?"clockwise":"counterclockwise",enabled=true});
    public static RigEdit IkTarget(string constraintId,double x,double y) => new("ik.target",new {constraintId,target=new {x,y}});
    public static RigEdit RemoveIk(string constraintId) => new("ik.remove",new {constraintId});
    public static RigEdit EnableIk(string constraintId,bool enabled) => new("ik.enabled",new {constraintId,enabled});
    public static RigEdit BendIk(string constraintId,bool clockwise) => new("ik.bend",new {constraintId,bendDirection=clockwise?"clockwise":"counterclockwise"});
    public static RigEdit CreateWarp(string displayName,string parentNodeId,int size,double left,double top,double right,double bottom,string[] childNodeIds) =>
        new("warp.create",new {displayName,parentNodeId,size,bounds=new {left,top,right,bottom},childNodeIds});
    public static RigEdit RemoveWarp() => new("warp.remove",new {});
    public static RigEdit RenameWarp(string displayName) => new("warp.rename",new {displayName});
    public static RigEdit AttachWarp(string parentNodeId) => new("warp.attach",new {parentNodeId});
    public static RigEdit WarpGrid(int size) => new("warp.grid",new {size});
    public static RigEdit MoveWarp(string[] controlPointIds,double x,double y) => new("warp.move",new {controlPointIds,x,y});
    public static RigEdit MoveWarpDocument(string[] controlPointIds,double sx,double sy,double ex,double ey) => new("warp.moveDocument",new {controlPointIds,start=new {x=sx,y=sy},end=new {x=ex,y=ey}});
    public static RigEdit ResetWarp(string[] controlPointIds) => new("warp.reset",new {controlPointIds});
    public static RigEdit CreateSkin(string topologyId) => new("weight.create",new {topologyId});
    public static RigEdit Paint(string[] vertexIds,double strength,bool subtract) => new("weight.paint",new {vertexIds,strength,operation=subtract?"subtract":"add"});
    public static RigEdit SetWeight(string vertexId,double weight) => new("weight.numeric",new {vertexId,weight});
    public static RigEdit NormalizeWeight(string vertexId) => new("weight.normalize",new {vertexId});
    public static RigEdit ReplaceWeights(string vertexId,(string BoneId,double Weight)[] values) => new("weight.replace",new {vertexId,influences=values.Select(v=>new {boneId=v.BoneId,weight=v.Weight})});
    public static RigEdit ClearWeights(string vertexId) => new("weight.clear",new {vertexId});
    public static RigEdit RemoveSkin() => new("weight.remove",new {});
    public static RigEdit EnableSkin(bool enabled) => new("weight.enabled",new {enabled});
    public static RigEdit ClipSource(string sourceNodeId) => new("clipping.source",new {sourceNodeId});
    public static RigEdit EnableClipping(bool enabled) => new("clipping.enabled",new {enabled});
    public static RigEdit RemoveClipping() => new("clipping.remove",new {});
    public static RigEdit FormMove(string[] vertexIds,double x,double y) => new("form.move",new {vertexIds,x,y});
    public static RigEdit ResetForm() => new("form.reset",new {});
}
public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> GetRigAsync(RigContext context,CancellationToken cancellationToken=default) =>
        SendAsync("rig.projection",context.Wire,false,true,cancellationToken);
    public Task<ProductHostResponse> EditRigAsync(RigContext context,RigEdit edit,long revision,CancellationToken cancellationToken=default) =>
        SendAsync("rig.tool",new {context=context.Wire,tool=edit.Tool,input=edit.Input},true,true,cancellationToken,revision);
}
