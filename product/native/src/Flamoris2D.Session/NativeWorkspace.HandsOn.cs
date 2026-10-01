using System.Collections.ObjectModel;
using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Source;
namespace Flamoris.Flamoris2D.Session;
public sealed record HandsOnArtwork(string Id,string Name,int Width,int Height,ReadOnlyMemory<byte> Rgba);
public sealed partial class NativeWorkspace
{
    private bool proofOnly;
    public bool ProofOnly {get {AssertLane();return proofOnly;}}
    public Task<WorkspaceSnapshot> HandsOnAsync(IReadOnlyList<HandsOnArtwork> images,string expectedToken,long expectedRevision,CancellationToken token=default)=>InvokeAsync(w=>
    {
        w.AssertCurrent(expectedToken,expectedRevision);if(images.Count is <1 or >16 || images.Select(a=>a.Id).Distinct(StringComparer.Ordinal).Count()!=images.Count)throw new WorkspaceException("asset.required");
        long budget=artworkHistory.Values.SelectMany(a=>a.Values).DistinctBy(a=>a.Id).Sum(a=>(long)a.Rgba.Length);foreach(var a in images){RasterCodec.Dimensions(a.Width,a.Height);if(a.Rgba.Length!=checked(a.Width*a.Height*4)||(budget+=(long)a.Width*a.Height*16)>512L*1024*1024)throw new WorkspaceException("asset.too_large");}
        var candidates=images.Select(a=>new {id=a.Id,name=a.Name,width=a.Width,height=a.Height,candidate=NativeDocument.GenerateMesh(a.Width,a.Height,a.Rgba.ToArray(),JsonSerializer.SerializeToElement(new {kind="grid",columns=2,rows=2,left=0,top=0})).GetProperty("candidate")}).ToArray();
        var source=NativeDocument.SourceProject(JsonSerializer.SerializeToElement(new {kind="hands-on",assets=candidates,options=new {idNamespace=Guid.NewGuid().ToString("N")}}));
        var artwork=new Dictionary<string,WorkspaceArtwork>();foreach(var b in source.GetProperty("bindings").EnumerateArray()){var a=images.Single(a=>a.Id==b.GetProperty("assetId").GetString());string node=b.GetProperty("nodeId").GetString()!;artwork[node]=new(a.Id,node,a.Name,a.Width,a.Height,0,0,a.Rgba.ToArray(),JsonSerializer.SerializeToElement(new {}));}
        w.Replace(source.GetProperty("initialProject"),new ReadOnlyDictionary<string,WorkspaceArtwork>(artwork),null,true,null,null,token);w.proofOnly=true;
        // Bootstrap commands and the final Project were validated before replacement.
        // Once replacement commits, finish its acknowledged initialization atomically.
        foreach(var plan in source.GetProperty("bootstrapPlans").EnumerateArray())w.ExecutePlan(plan,CancellationToken.None);
        return w.Snapshot;
    },token);
}
