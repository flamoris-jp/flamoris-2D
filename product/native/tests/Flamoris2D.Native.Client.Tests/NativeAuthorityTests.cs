using System.Text.Json;
using Flamoris.Flamoris2D.Native.Client;
using Flamoris.Mcp.Core;
using Permission = Flamoris.Flamoris2D.Native.Client.McpPermission;

internal static class NativeAuthorityTests
{
    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    internal static async Task RunAsync()
    {
        await using var client = new NativeSessionClient();
        await client.StartAsync(); await client.CreateSessionAsync("Native cutover", 64, 64);
        var raster = await client.UploadRasterAsync(4, 4, "Part", Enumerable.Repeat((byte)255, 64).ToArray());
        await client.OpenHandsOnAsync([raster]);
        var art = (await client.GetWorkspaceAsync()).Payload.GetProperty("keyArts")[0].GetProperty("id").GetString()!;
        var root = (await client.GetSceneTreeAsync()).Payload.GetProperty("id").GetString()!;
        await client.EditKeyStateAsync(new(NodeId: root), KeyStateEdit.CreateGroup(root, "Group"), client.Revision);
        await client.EditRigAsync(new(NodeId: root), RigEdit.CreateBone("Bone", 12), client.Revision);
        await client.EditTimelineAsync(new(), TimelineEdit.CreateClip("Clip", 1, false), client.Revision);
        await client.GetRigAsync(new()); await client.GetTimelineAsync(new()); await client.GetKeyStateAsync(new());
        await client.ProjectRenderAsync(keyArtId: art); await client.GetExportSettingsAsync();
        var before = client.Revision;
        await client.EnableMcpAsync(Permission.Edit, startLocalEndpoint: false);
        var boundary = client.LiveMcpBoundary!; var grant = client.LiveMcpGrant!;
        RequestGuard Guard() => new(grant.Snapshot.RuntimeId, client.DocumentToken!, client.Revision);
        var stale = Guard();
        var changed = await boundary.InvokeAsync(grant, "command.scene.rename_node",
            Json(new { payload = new { nodeId = root, displayName = "MCP native" } }), stale);
        Check(!changed.IsError && client.Revision == before + 1, "MCP did not use the desktop native revision.");
        Check(!client.HasAuthoritativeProjection, "MCP edit left the UI projection current.");
        try { await client.UndoAsync(); throw new Exception("Stale UI command accepted."); }
        catch (StaleProjectionException) { }
        Check((await client.GetWorkspaceAsync()).Payload.GetProperty("tree").GetProperty("displayName").GetString() == "MCP native", "MCP edit missing in desktop projection.");
        Check((await boundary.InvokeAsync(grant, "live.undo", Json(new { }), stale)).IsError, "Stale MCP command accepted.");
        await client.UndoAsync();
        Check(!(await boundary.InvokeAsync(grant, "live.redo", Json(new { }), Guard())).IsError, "Native shared Redo failed.");
        await client.GetWorkspaceAsync(); await client.RenameNodeAsync(root, "Desktop native");
        var query = await boundary.InvokeAsync(grant, "query.scene.get_node", Json(new { input = new { nodeId = root } }), null);
        Check(query.Value!.Value.GetProperty("displayName").GetString() == "Desktop native", "MCP missed desktop command.");
        // Queued requests and replacement share one lane; revocation must never hold that lane while waiting on it.
        var requests = Enumerable.Range(0, 16).Select(_ => boundary.InvokeAsync(grant, "query.scene.get_node", Json(new { input = new { nodeId = root } }), null)).ToArray();
        await client.CreateSessionAsync("Replacement");
        await Task.WhenAll(requests).WaitAsync(TimeSpan.FromSeconds(5));
        Check(!grant.IsActive && client.McpStatus?.Enabled != true, "Replacement retained the old grant.");
        await client.EnableMcpAsync(Permission.ReadOnly, startLocalEndpoint: false);
        boundary = client.LiveMcpBoundary!; grant = client.LiveMcpGrant!;
        Check((await boundary.InvokeAsync(grant, "live.undo", Json(new { }), Guard())).IsError, "Read-only native MCP mutated history.");
        await client.DisableMcpAsync();
        Console.WriteLine("Native desktop/MCP authority: domain routing, shared history, stale projection, concurrent replacement and revocation passed.");
    }
}
