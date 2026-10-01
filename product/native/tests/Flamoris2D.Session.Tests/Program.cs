using System.Text.Json;
using Flamoris.Flamoris2D.Session;
using Flamoris.Mcp.Core;

static JsonElement Json(object v)=>JsonSerializer.SerializeToElement(v);
await using var workspace=new NativeWorkspace();int events=0;workspace.Changed+=_=>events++;
var initial=await workspace.NewAsync("Native",1920,1080);string root=await workspace.InvokeAsync(w=>w.Project.GetProperty("scene").GetProperty("rootId").GetString()!);
JsonElement Rename(string name)=>Json(new[]{new {type="scene.rename_node",payload=new {nodeId=root,displayName=name}}});
await workspace.InvokeAsync(w=>w.Execute(Rename("first"),"first"));
var save=await workspace.InvokeAsync(w=>w.PrepareSave("save"));
await workspace.InvokeAsync(w=>w.Execute(Rename("second"),"second"));
await workspace.InvokeAsync(w=>w.AcknowledgeSave(save.ReceiptId!));
if((await workspace.InvokeAsync(w=>w.Snapshot)).State.Dirty==0) throw new Exception("Concurrent edit was marked saved.");
await workspace.InvokeAsync(w=>w.Undo());
if((await workspace.InvokeAsync(w=>w.Snapshot)).State.Dirty!=0) throw new Exception("Undo did not return to captured save point.");
await workspace.InvokeAsync(w=>w.Redo());
using(var cancelled=new CancellationTokenSource()) {cancelled.Cancel();try {await workspace.InvokeAsync(w=>w.Execute(Rename("cancelled"),"cancelled",cancelled.Token));throw new Exception("Cancellation ignored.");}catch(OperationCanceledException) {}}
if((await workspace.InvokeAsync(w=>w.Snapshot)).State.CurrentRevision!=2) throw new Exception("Cancelled prepare changed native revision.");
await workspace.OpenAsync(save.Bytes.ToArray());
if((await workspace.InvokeAsync(w=>w.Project.GetProperty("scene").GetProperty("nodes").GetProperty(root).GetProperty("displayName").GetString()))!="first") throw new Exception("Save/reopen mismatch.");
try {await workspace.InvokeAsync(w=>{w.AssertCurrent(initial.DocumentToken,0);return true;});throw new Exception("Old authority token accepted.");}catch(WorkspaceException e) when(e.Code=="document.conflict") {}
// Concurrent UI/MCP-style callbacks serialize into the same native history.
await Task.WhenAll(Enumerable.Range(0,12).Select(i=>workspace.InvokeAsync(w=>w.Execute(Rename("lane-"+i),"lane"))));
if((await workspace.InvokeAsync(w=>w.Snapshot)).State.UndoDepth!=12) throw new Exception("Shared lane lost edits.");
try {_=workspace.Project;throw new Exception("Native handle escaped the lane.");}catch(InvalidOperationException) {}
foreach(string path in args)
{
    using var fixtures=JsonDocument.Parse(File.ReadAllBytes(path));
    foreach(var fixture in fixtures.RootElement.EnumerateArray())
    {
        string kind=path.Contains("psd-")?"psd":"flimg";await workspace.ImportAsync(Convert.FromBase64String(fixture.GetProperty("archive").GetString()!),kind,"portrait."+kind);
        var receipt=await workspace.InvokeAsync(w=>w.PrepareSave("copy"));var before=await workspace.InvokeAsync(w=>w.Artwork.Values.OrderBy(a=>a.NodeId).Select(a=>Convert.ToBase64String(a.Rgba.Span)).ToArray());
        await workspace.OpenAsync(receipt.Bytes.ToArray());var after=await workspace.InvokeAsync(w=>w.Artwork.Values.OrderBy(a=>a.NodeId).Select(a=>Convert.ToBase64String(a.Rgba.Span)).ToArray());if(!before.SequenceEqual(after))throw new Exception("Source artwork save/reopen mismatch.");
        root=await workspace.InvokeAsync(w=>w.Project.GetProperty("scene").GetProperty("rootId").GetString()!);
        await workspace.InvokeAsync(w=>w.Execute(Rename("branch"),"branch"));await workspace.InvokeAsync(w=>w.Undo());await workspace.InvokeAsync(w=>w.Execute(Rename("new branch"),"branch"));
        if((await workspace.InvokeAsync(w=>w.Snapshot)).State.RedoDepth!=0)throw new Exception("Native branch retained redo.");
        await workspace.InvokeAsync(w=>w.Undo());await workspace.InvokeAsync(w=>w.Redo());
        if(!(await workspace.InvokeAsync(w=>w.Artwork.Values.OrderBy(a=>a.NodeId).Select(a=>Convert.ToBase64String(a.Rgba.Span)).ToArray())).SequenceEqual(before))throw new Exception("Artwork history was lost.");
    }
}
using(var fixtures=JsonDocument.Parse(File.ReadAllBytes(args[1])))
{
    var bytes=Convert.FromBase64String(fixtures.RootElement[0].GetProperty("archive").GetString()!);
    await workspace.ImportAsync(bytes,"psd","before.psd");
    root=await workspace.InvokeAsync(w=>w.Project.GetProperty("scene").GetProperty("rootId").GetString()!);
    var before=await workspace.InvokeAsync(w=>w.Artwork.Values.Select(a=>a.Id).ToArray());
    var review=await workspace.AnalyzeSourceAsync(bytes,"after.psd");string reviewId=review.GetProperty("id").GetString()!;
    if(!review.GetProperty("canApply").GetBoolean())throw new Exception("Native PSD reimport unexpectedly ambiguous.");
    await workspace.InvokeAsync(w=>w.ApplySourceReview(reviewId));
    await workspace.InvokeAsync(w=>w.Undo());if(!(await workspace.InvokeAsync(w=>w.Artwork.Values.Select(a=>a.Id).ToArray())).SequenceEqual(before))throw new Exception("Reimport Undo lost original artwork handles.");
    await workspace.InvokeAsync(w=>w.Redo());
    var stale=await workspace.AnalyzeSourceAsync(bytes,"stale.psd");await workspace.InvokeAsync(w=>w.Execute(Rename("edit"),"edit"));
    try {await workspace.InvokeAsync(w=>w.ApplySourceReview(stale.GetProperty("id").GetString()!));throw new Exception("Stale reimport review applied.");}catch(WorkspaceException e) when(e.Code=="source.review_stale") {}
}
// Exercise the shared Core boundary, not a mock Product dispatcher.
using(var host=new NativeMcpHost(workspace))
using(var boundary=new McpBoundary(host,host.Tools(),new McpOptions(),new McpDiagnostics(Flamoris.Logging.FlamorisLogger.Create(new Flamoris.Logging.LoggingOptions {Level="error"}))))
{
    var grant=await boundary.EnableAsync(McpPermission.Edit);
    var snapshot=await workspace.InvokeAsync(w=>w.Snapshot);
    var guard=new RequestGuard(snapshot.RuntimeId,snapshot.DocumentToken,snapshot.Revision);
    var changed=await boundary.InvokeAsync(grant,"command.scene.rename_node",Json(new {payload=new {nodeId=root,displayName="MCP"}}),guard);
    if(changed.IsError)throw new Exception("Native MCP edit failed: "+changed.Error);
    if(await workspace.InvokeAsync(w=>w.Query("scene.get_node",Json(new {nodeId=root})).GetProperty("displayName").GetString())!="MCP")throw new Exception("UI did not see MCP edit.");
    var stale=await boundary.InvokeAsync(grant,"command.scene.rename_node",Json(new {payload=new {nodeId=root,displayName="stale"}}),guard);
    if(!stale.IsError)throw new Exception("MCP stale guard accepted.");
    await workspace.InvokeAsync(w=>w.Undo());snapshot=await workspace.InvokeAsync(w=>w.Snapshot);
    var redo=await boundary.InvokeAsync(grant,"live.redo",Json(new {}),new(snapshot.RuntimeId,snapshot.DocumentToken,snapshot.Revision));if(redo.IsError)throw new Exception("Shared native redo failed: "+redo.Error);
    var invalid=await boundary.InvokeAsync(grant,"query.scene.get_node",Json(new {input=new {nodeId=root,unknown=true}}),null);if(!invalid.IsError)throw new Exception("Unknown MCP payload field accepted.");
    if(boundary.Tools.Keys.Any(n=>n.Contains("apply_psd_reimport") || n.Contains("restore_internal")))throw new Exception("Private source operation exposed.");
    var readOnly=await boundary.EnableAsync(McpPermission.ReadOnly);
    snapshot=await workspace.InvokeAsync(w=>w.Snapshot);
    if(!(await boundary.InvokeAsync(readOnly,"live.undo",Json(new {}),new(snapshot.RuntimeId,snapshot.DocumentToken,snapshot.Revision))).IsError)throw new Exception("Read-only MCP edit accepted.");
    await workspace.NewAsync("replacement",64,64);if(readOnly.IsActive)throw new Exception("Replaced document retained MCP grant.");
}
Console.WriteLine($"Native workspace: shared lane, cancellation, revision guards, save acknowledgement, Undo/Redo and source reopen passed ({events} changes).");
