using System.Text.Json;
namespace Flamoris.Flamoris2D.ProductHost;
public sealed record KeyStateContext(string? KeyArtId=null,string? TransitionId=null,string? SemanticSlotId=null,string? NodeId=null)
{internal object Wire=>new {keyArtId=KeyArtId,transitionId=TransitionId,semanticSlotId=SemanticSlotId,nodeId=NodeId};}
public sealed record CorrespondencePin(string VertexId,double X,double Y)
{internal object Wire=>new {vertexId=VertexId,target=new {x=X,y=Y}};}
public sealed record VertexOffset(string VertexId,double Dx,double Dy)
{internal object Wire=>new {vertexId=VertexId,dx=Dx,dy=Dy};}
public sealed class KeyStateEdit
{
    private KeyStateEdit(string tool,object input)=>(Tool,Input)=(tool,input);
    internal string Tool {get;} internal object Input {get;}
    public static KeyStateEdit ObjectTransform(double x,double y,double rotation,double sx,double sy,double px,double py)=>new("object.transform",new {transform=new {position=new {x,y},rotation,scale=new {x=sx,y=sy},pivot=new {x=px,y=py}}});
    public static KeyStateEdit CreateGroup(string parentId,string displayName)=>new("object.group",new {parentId,displayName});
    public static KeyStateEdit Reparent(string parentId,int index)=>new("object.reparent",new {parentId,index});
    public static KeyStateEdit IncludeSource()=>new("source.include",new {});
    public static KeyStateEdit DuplicateArt(string displayName)=>new("keyart.duplicate",new {displayName});
    public static KeyStateEdit RenameArt(string displayName)=>new("keyart.rename",new {displayName});
    public static KeyStateEdit RemoveArt()=>new("keyart.remove",new {});
    public static KeyStateEdit Member(string nodeId,double opacity,string presence,int drawOrder)=>new("keyart.member",new {nodeId,opacity,presence,drawOrder});
    public static KeyStateEdit CreateSlot(string displayName)=>new("slot.create",new {displayName});
    public static KeyStateEdit RenameSlot(string displayName)=>new("slot.rename",new {displayName});
    public static KeyStateEdit RemoveSlot()=>new("slot.remove",new {});
    public static KeyStateEdit Map(string keyArtId,string nodeId)=>new("slot.map",new {keyArtId,nodeId});
    public static KeyStateEdit Unmap(string keyArtId)=>new("slot.unmap",new {keyArtId});
    public static KeyStateEdit CreateTransition(string displayName,string fromKeyArtId,string toKeyArtId,double durationSeconds)=>new("transition.create",new {displayName,fromKeyArtId,toKeyArtId,durationSeconds});
    public static KeyStateEdit UpdateTransition(string displayName,double durationSeconds)=>new("transition.update",new {displayName,durationSeconds});
    public static KeyStateEdit Endpoint(bool from,string keyArtId)=>new("transition.endpoint",new {endpoint=from?"from":"to",keyArtId});
    public static KeyStateEdit RemoveTransition()=>new("transition.remove",new {});
    public static KeyStateEdit Mode(string mode,bool holdFrom=true,string? compositeGroupId=null)=>new("transition.mode",new {mode,configuration=new {holdEndpoint=holdFrom?"from":"to",compositeGroupId}});
    public static KeyStateEdit SharedTopology(string topologyId,string fromKeyformId,string toKeyformId)=>new("transition.topology",new {topologyId,fromKeyformId,toKeyformId});
    public static KeyStateEdit Alignment(string keyformId,double x,double y,double rotation,double scaleX,double scaleY,double pivotX,double pivotY)=>new("mesh.align",new {keyformId,x,y,rotation,scaleX,scaleY,pivotX,pivotY});
    public static KeyStateEdit ApplyCorrespondence(CorrespondencePin[] pins,string preset,bool reverse)=>new("correspondence.apply",new {pins=pins.Select(p=>p.Wire),preset,reverse});
    public static KeyStateEdit CreateSample(string? meshId,string topologyId,VertexOffset[] offsets)=>new("sample.create",new {meshId,topologyId,offsets=offsets.Select(o=>o.Wire)});
    public static KeyStateEdit UpdateSample(string sampleId,VertexOffset[] offsets)=>new("sample.update",new {sampleId,offsets=offsets.Select(o=>o.Wire)});
    public static KeyStateEdit RemoveSample(string sampleId)=>new("sample.remove",new {sampleId});
    public static KeyStateEdit RemoveMeshTarget(string meshId)=>new("sample.removeTarget",new {meshId});
}
public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> GetKeyStateAsync(KeyStateContext context)=>SendAsync("keyState.projection",context.Wire,false,true,CancellationToken.None);
    public Task<ProductHostResponse> EditKeyStateAsync(KeyStateContext context,KeyStateEdit edit,long revision)=>SendAsync("keyState.tool",new {context=context.Wire,tool=edit.Tool,input=edit.Input},true,true,CancellationToken.None,revision);
    public Task<ProductHostResponse> SolveCorrespondenceAsync(KeyStateContext context,CorrespondencePin[] pins,string preset,bool reverse,long revision)=>
        SendAsync("keyState.correspondence",new {context=context.Wire,input=new {pins=pins.Select(p=>p.Wire),preset,reverse}},true,true,CancellationToken.None,revision);
}
