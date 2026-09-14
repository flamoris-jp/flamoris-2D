using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;

if (args.Length != 1)
    throw new ArgumentException("Pass the Product Host main.mjs path.");

var hostPath = Path.GetFullPath(args[0]);
TestStaleProjectionGate();
await TestRoundTripAsync(hostPath);
await TestCrashInvalidationAsync(hostPath);
Console.WriteLine("Product Host C# client tests passed.");

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
