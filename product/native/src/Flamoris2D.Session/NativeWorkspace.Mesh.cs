using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;

namespace Flamoris.Flamoris2D.Session;

public sealed partial class NativeWorkspace
{
    public JsonElement Mesh(string? nodeId,string? keyformId=null,string? keyArtId=null)
    {
        var state=nodeId is null?default(JsonElement?):Query("native.mesh_state",JsonSerializer.SerializeToElement(new {nodeId,keyformId,keyArtId}));
        var nodes=Project.GetProperty("scene").GetProperty("nodes");
        var images=Artwork.Values.Where(a=>nodes.TryGetProperty(a.NodeId,out _)).Select(a=>
        {
            var node=Query("scene.get_node",JsonSerializer.SerializeToElement(new {nodeId=a.NodeId}));
            return new {id=a.Id,nodeId=a.NodeId,width=a.Width,height=a.Height,byteLength=a.Rgba.Length,visible=node.GetProperty("effectiveVisible"),locked=node.GetProperty("locked"),bounds=node.GetProperty("bounds"),worldTransform=node.GetProperty("worldTransform"),left=a.Left,top=a.Top};
        }).ToArray();
        return JsonSerializer.SerializeToElement(new {state,artwork=images,proofOnly=false,diagnostics=Array.Empty<object>()});
    }
    public JsonElement CompileMesh(string nodeId,string? keyformId,string? keyArtId,string context,string tool,JsonElement input)=>
        Query("native.mesh_tool",JsonSerializer.SerializeToElement(new {nodeId,keyformId,keyArtId,context,tool,input,idNamespace=Guid.NewGuid().ToString("N")}));
    public JsonElement ExecutePlan(JsonElement plan,CancellationToken token=default)
    {
        var commands=plan.GetProperty("commands");
        if(commands.GetArrayLength()==0)return JsonSerializer.SerializeToElement<object?>(null);
        var result=Execute(commands,plan.GetProperty("label").GetString()!,token);
        var merged=result.EnumerateObject().ToDictionary(p=>p.Name,p=>p.Value.Clone());
        if(plan.TryGetProperty("result",out var extra))foreach(var p in extra.EnumerateObject())merged[p.Name]=p.Value.Clone();
        return JsonSerializer.SerializeToElement(merged);
    }
    public async Task<JsonElement> GenerateMeshAsync(string nodeId,string kind,int columns,int rows,JsonElement settings,string expectedToken,long expectedRevision,CancellationToken token=default)
    {
        var image=await InvokeAsync(w=>{w.AssertCurrent(expectedToken,expectedRevision);return w.Artwork.TryGetValue(nodeId,out var a)?a:throw new WorkspaceException("asset.required");},token).ConfigureAwait(false);
        var request=JsonSerializer.SerializeToElement(new {kind,columns,rows,settings,left=image.Left,top=image.Top});
        var result=await Task.Run(()=>NativeDocument.GenerateMesh(image.Width,image.Height,image.Rgba.ToArray(),request),token).ConfigureAwait(false);
        return await InvokeAsync(w=>{token.ThrowIfCancellationRequested();w.AssertCurrent(expectedToken,expectedRevision);return result;},token).ConfigureAwait(false);
    }
}
