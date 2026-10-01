using System.Collections.ObjectModel;
using System.Text.Json;
using System.Text.Json.Nodes;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Source;

namespace Flamoris.Flamoris2D.Session;

public sealed partial class NativeWorkspace
{
    private sealed record SourceReview(string Id,string Token,long Revision,DateTimeOffset Expires,JsonElement Current,JsonElement Imported,JsonElement Projection,IReadOnlyDictionary<string,WorkspaceArtwork> Artwork);
    private SourceReview? sourceReview;
    public async Task<JsonElement> AnalyzeSourceAsync(byte[] bytes,string fileName,CancellationToken token=default)
    {
        var guard=await InvokeAsync(w=>(Snapshot:w.Snapshot,Project:w.Project),token).ConfigureAwait(false);
        if(!guard.Project.GetProperty("sourceAssets").EnumerateArray().Any(s=>s.GetProperty("kind").GetString()=="psd"))throw new WorkspaceException("source.psd_required");
        var decoded=await Task.Run(()=>PsdCodec.Decode(bytes,token),token).ConfigureAwait(false);
        var imported=await Task.Run(()=>NativeDocument.SourceProject(JsonSerializer.SerializeToElement(new {kind="psd",source=decoded.Description,options=new {fileName,projectName=fileName,importedAt=Now()}})),token).ConfigureAwait(false);
        var project=imported.GetProperty("project");var images=BuildSourceArtwork(project,imported.GetProperty("bindings"),decoded,"psd",token);
        var projection=ReviewOperation(guard.Project,project,"analyze");
        return await InvokeAsync(w=>
        {
            w.AssertCurrent(guard.Snapshot.DocumentToken,guard.Snapshot.Revision);token.ThrowIfCancellationRequested();
            long retained=w.artworkHistory.Values.SelectMany(a=>a.Values).DistinctBy(a=>a.Id).Sum(a=>(long)a.Rgba.Length);
            if(retained+images.Values.Sum(a=>(long)a.Rgba.Length)>512L*1024*1024)throw new WorkspaceException("document.artwork_invalid");
            w.sourceReview=new(Guid.NewGuid().ToString(),guard.Snapshot.DocumentToken,guard.Snapshot.Revision,DateTimeOffset.UtcNow.AddMinutes(10),guard.Project,project,projection,images);return w.SourceReviewProjection();
        },token).ConfigureAwait(false);
    }
    private static JsonElement ReviewOperation(JsonElement current,JsonElement imported,string operation,JsonElement? rows=null,object? change=null)=>NativeDocument.SourceProject(JsonSerializer.SerializeToElement(new {kind="psd-review",source=new {currentProject=current,importedProject=imported,rows,change},options=new {operation}}));
    private SourceReview CurrentReview(string id)
    {
        AssertLane();var review=sourceReview;
        if(review is null || review.Id!=id || review.Expires<=DateTimeOffset.UtcNow)throw new WorkspaceException("source.review_stale");AssertCurrent(review.Token,review.Revision);return review;
    }
    private JsonElement SourceReviewProjection()
    {
        var r=sourceReview!;return JsonSerializer.SerializeToElement(new {id=r.Id,canApply=r.Projection.GetProperty("canApply"),summary=r.Projection.GetProperty("summary"),rows=r.Projection.GetProperty("rows")});
    }
    public JsonElement ChangeSourceReview(string id,string rowId,string action,string? importedNodeId)
    {
        var r=CurrentReview(id);sourceReview=r with {Projection=ReviewOperation(r.Current,r.Imported,"change",r.Projection.GetProperty("rows"),new {rowId,action,importedNodeId})};return SourceReviewProjection();
    }
    public JsonElement ApplySourceReview(string id,CancellationToken token=default)
    {
        var r=CurrentReview(id);var built=ReviewOperation(r.Current,r.Imported,"build",r.Projection.GetProperty("rows"));
        var project=built.GetProperty("project");var nodes=project.GetProperty("scene").GetProperty("nodes");var assignments=built.GetProperty("importedNodeAssignments");
        var next=artwork.Where(a=>nodes.TryGetProperty(a.Key,out _)).ToDictionary(a=>a.Key,a=>a.Value);
        WorkspaceArtwork Rebind(WorkspaceArtwork asset,string nodeId)
        {
            var record=JsonNode.Parse(asset.Record.GetRawText())!.AsObject();record["nodeId"]=nodeId;return asset with {NodeId=nodeId,Record=JsonSerializer.SerializeToElement(record)};
        }
        foreach(var row in r.Projection.GetProperty("rows").EnumerateArray())
        {
            string action=row.GetProperty("action").GetString()!;string? current=row.GetProperty("currentNodeId").GetString(),imported=row.GetProperty("importedNodeId").GetString();
            if(action=="update" && current is not null) {next.Remove(current);if(imported is not null && r.Artwork.TryGetValue(imported,out var asset) && nodes.TryGetProperty(current,out _))next[current]=Rebind(asset,current);}
            else if(action=="keep" && current is not null && imported is not null && !next.ContainsKey(current) && r.Artwork.TryGetValue(imported,out var asset) && nodes.TryGetProperty(current,out _))next[current]=Rebind(asset,current);
            else if(action=="add" && imported is not null && assignments.TryGetProperty(imported,out var assigned) && r.Artwork.TryGetValue(imported,out var added)) {string nodeId=assigned.GetString()!;if(nodes.TryGetProperty(nodeId,out _))next[nodeId]=Rebind(added,nodeId);}
        }
        var ordered=new Dictionary<string,WorkspaceArtwork>();
        void Walk(string nodeId) {if(next.TryGetValue(nodeId,out var image))ordered.Add(nodeId,image);foreach(var child in nodes.GetProperty(nodeId).GetProperty("children").EnumerateArray())Walk(child.GetString()!);}
        Walk(project.GetProperty("scene").GetProperty("rootId").GetString()!);
        return Execute(JsonSerializer.SerializeToElement(new[]{new {type="source.apply_psd_reimport",payload=new {project}}}),"PSD Re-import",token,new ReadOnlyDictionary<string,WorkspaceArtwork>(ordered));
    }
    public void DiscardSourceReview(string id) {AssertLane();if(sourceReview?.Id==id)sourceReview=null;}
}
