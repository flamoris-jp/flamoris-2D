using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;
using Flamoris.Flamoris2D.App;

if (args.Length != 1)
    throw new ArgumentException("Pass the Product Host main.mjs path.");

var hostPath = Path.GetFullPath(args[0]);
TestStaleProjectionGate();
TestTargetWorkspace();
await TestRoundTripAsync(hostPath);
await TestTargetPropertiesAsync(hostPath);
await TestCrashInvalidationAsync(hostPath);
Console.WriteLine("Product Host C# client tests passed.");

static void TestTargetWorkspace()
{
    using var tree = JsonDocument.Parse("""
        {"id":"root","displayName":"Root","kind":"group","visible":true,"effectiveVisible":true,"locked":false,
         "children":[{"id":"part","displayName":"Eye","kind":"part","visible":false,"effectiveVisible":false,"locked":true,"children":[]}]}
        """);
    var workspace = new TargetWorkspace();
    workspace.Attach("doc-1");
    workspace.Apply("doc-1", 1, tree.RootElement);
    workspace.Select("part");
    workspace.Apply("doc-1", 2, tree.RootElement);
    Assert(workspace.SelectedId == "part", "Hidden/locked row selection must survive refresh.");
    Assert(workspace.Selected?.Depth == 1, "Hierarchy depth must be projected.");
    AssertThrows<StaleProjectionException>(() => workspace.Apply("doc-1", 1, tree.RootElement));
    AssertThrows<StaleProjectionException>(() => workspace.Apply("old-doc", 3, tree.RootElement));
    workspace.Attach("doc-2");
    Assert(workspace.SelectedId is null, "New document must clear old selection.");
    AssertThrows<StaleProjectionException>(() => workspace.Apply("doc-1", 4, tree.RootElement));
    workspace.Invalidate();
    Assert(workspace.Targets.Count == 0 && workspace.DocumentToken is null,
        "Host loss must clear all disposable projections.");
}

static async Task TestTargetPropertiesAsync(string hostPath)
{
    await using var client = new ProductHostClient();
    await client.StartAsync(hostPath);
    await client.CreateSessionAsync("Target proof");
    var before = await client.GetWorkspaceAsync();
    var nodeId = before.Payload.GetProperty("tree").GetProperty("id").GetString()!;
    await client.ApplyTargetPropertiesAsync(nodeId, "Hidden", false, true, before.Revision!.Value);
    var after = await client.GetWorkspaceAsync();
    Assert(after.Payload.GetProperty("tree").GetProperty("visible").GetBoolean() == false,
        "Visibility command did not reach Product.");
    Assert(after.Payload.GetProperty("tree").GetProperty("locked").GetBoolean(),
        "Lock command did not reach Product.");
    try
    {
        await client.ApplyTargetPropertiesAsync(nodeId, "Stale draft", true, false, before.Revision.Value);
        throw new InvalidOperationException("Old property draft must not overwrite a later edit.");
    }
    catch (ProductHostException error) when (error.Code == "revision.conflict") { }
    Assert(client.Revision == 1, "Rejected draft must not advance the revision.");
    await client.UndoAsync();
    var undone = await client.GetWorkspaceAsync();
    Assert(undone.Payload.GetProperty("tree").GetProperty("displayName").GetString() == "Target proof",
        "One Undo must restore the whole properties transaction.");
    await client.RedoAsync();
    var redone = await client.GetWorkspaceAsync();
    await client.SetTargetVisibilityAsync(nodeId, true, redone.Revision!.Value);
    var visible = await client.GetWorkspaceAsync();
    await client.SetTargetLockedAsync(nodeId, false, visible.Revision!.Value);
    var unlocked = await client.GetWorkspaceAsync();
    Assert(!unlocked.Payload.GetProperty("tree").GetProperty("locked").GetBoolean(), "Unlock failed.");
}

static void TestStaleProjectionGate()
{
    var gate = new StaleProjectionGate();
    gate.Attach("document-1", 4);
    gate.Accept("document-1", 5);
    Assert(gate.Revision == 5, "The latest revision should be accepted.");
    AssertThrows<StaleProjectionException>(() => gate.Accept("document-1", 4));
    AssertThrows<StaleProjectionException>(() => gate.Accept("document-other", 6));
    gate.Invalidate();
    Assert(!gate.IsAuthoritative, "Invalidation must clear client authority.");
}

static async Task TestRoundTripAsync(string hostPath)
{
    await using var client = new ProductHostClient();
    var handshake = await client.StartAsync(hostPath);
    Assert(handshake.ProtocolVersion == 1, "Protocol handshake mismatch.");
    Assert(handshake.ProductSchemaVersion == 15, "Project schema handshake mismatch.");
    await client.CreateSessionAsync("C# boundary proof", 640, 360);
    var summary = await client.GetProjectSummaryAsync();
    Assert(summary.Payload.GetProperty("displayName").GetString() == "C# boundary proof",
        "Query round-trip failed.");
    var tree = await client.GetSceneTreeAsync();
    var rootId = tree.Payload.GetProperty("id").GetString()
        ?? throw new InvalidOperationException("Root ID was not projected.");
    await client.RenameNodeAsync(rootId, "WPF command", "WPF command");
    await client.ExecuteTransactionAsync(
        [
            ProductCommand.RenameNode(rootId, "Transaction A"),
            ProductCommand.RenameNode(rootId, "Transaction B"),
        ],
        "WPF transaction");
    await client.UndoAsync();
    var afterUndo = await client.GetSceneTreeAsync();
    Assert(afterUndo.Payload.GetProperty("displayName").GetString() == "WPF command",
        "Undo did not use Product history.");
    await client.RedoAsync();
    var afterRedo = await client.GetSceneTreeAsync();
    Assert(afterRedo.Payload.GetProperty("displayName").GetString() == "Transaction B",
        "Redo did not use Product history.");
    Assert(client.Revision == 4, "Host revision must be monotonic across Command/Undo/Redo.");
    await client.ShutdownAsync();
}

static async Task TestCrashInvalidationAsync(string hostPath)
{
    await using var client = new ProductHostClient();
    var lost = new TaskCompletionSource<AuthorityLostEventArgs>(
        TaskCreationOptions.RunContinuationsAsynchronously);
    client.AuthorityLost += (_, eventArgs) => lost.TrySetResult(eventArgs);
    await client.StartAsync(hostPath);
    await client.CreateSessionAsync("Crash proof", 640, 360);
    Assert(client.HasAuthoritativeProjection, "Projection should be authoritative before crash.");
    client.TerminateHostForTesting();
    await lost.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert(!client.HasAuthoritativeProjection,
        "Host failure must invalidate, not preserve, the client projection.");
    Assert(client.DocumentToken is null, "Host failure must clear the document token.");
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void AssertThrows<T>(Action action) where T : Exception
{
    try
    {
        action();
    }
    catch (T)
    {
        return;
    }
    throw new InvalidOperationException($"Expected {typeof(T).Name}.");
}
