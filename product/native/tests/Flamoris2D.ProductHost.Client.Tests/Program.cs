using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;
using Flamoris.Flamoris2D.App;
using Flamoris.Logging;

if (args.Length != 1)
    throw new ArgumentException("Pass the Product Host main.mjs path.");

var hostPath = Path.GetFullPath(args[0]);
TestLoggingConfiguration();
TestStaleProjectionGate();
TestTargetWorkspace();
TestViewportGeometry();
await TestRoundTripAsync(hostPath);
await TestTargetPropertiesAsync(hostPath);
await TestMeshArtworkAsync(hostPath);
await TestCrashInvalidationAsync(hostPath);
await TestControlChannelLossRevokesMcpAsync(hostPath);
await TestDiagnosticBoundaryAsync();
await TestLoggingIntegrationAsync(hostPath);
await DocumentTests.RunAsync(hostPath);
RasterizerTests.Run();
await ExportTests.RunAsync();
Console.WriteLine("Product Host C# client tests passed.");

static void TestLoggingConfiguration()
{
    var root = Path.Combine(Path.GetTempPath(), "Flamoris2D.Logging.Tests", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    try
    {
        var settings = Path.Combine(root, "native-settings.json");
        File.WriteAllText(settings, """
            {
              "logging": {
                "level": "info",
                "categories": { "mcp.transport": "debug" },
                "outputs": [
                  {
                    "type": "file",
                    "path": "logs/test.log",
                    "format": "text",
                    "rotation": { "enabled": true, "maxFileSizeMb": 1, "maxFiles": 2 }
                  }
                ]
              }
            }
            """);
        var options = NativeLoggingConfiguration.Load(out var warning, settings);
        Assert(warning is null && options.Level == "info", "Logging configuration did not bind.");
        Assert(options.Categories["mcp.transport"] == "debug", "Logging category override did not bind.");
        var logger = NativeLoggingConfiguration.CreateLogger(options, root);
        logger.Error("document.save", "Save failed", new InvalidOperationException("proof"),
            new Dictionary<string, object?> { ["operation"] = "save" });
        var path = Path.Combine(root, "logs", "test.log");
        Assert(File.Exists(path), "Logger did not use the supplied writable base path.");
        var text = File.ReadAllText(path);
        Assert(text.Contains("[ERROR] [document.save]") && text.Contains("operation=save") &&
            text.Contains("InvalidOperationException"), "Structured exception event was not written.");

        var blocked = Path.Combine(root, "blocked");
        File.WriteAllText(blocked, "not a directory");
        var failureOptions = new LoggingOptions
        {
            Outputs = [new LogOutputOptions { Type = "file", Path = "blocked/app.log" }],
        };
        var failureSafeLogger = NativeLoggingConfiguration.CreateLogger(failureOptions, root);
        failureSafeLogger.Info("app", "This sink failure must not escape.");
    }
    finally
    {
        try { Directory.Delete(root, true); } catch { }
    }
}

static async Task TestDiagnosticBoundaryAsync()
{
    var root = Path.Combine(Path.GetTempPath(), "Flamoris2D.Logging.Tests", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    var secret = "mcp-secret-must-not-log";
    try
    {
        var options = NativeLoggingConfiguration.CreateDefaultOptions();
        options.Outputs = [new LogOutputOptions { Type = "file", Path = "diagnostics.log" }];
        var logger = NativeLoggingConfiguration.CreateLogger(options, root);
        await using var client = new ProductHostClient(logger);
        var diagnostics = string.Join('\n',
            """FLAMORIS_DIAGNOSTIC {"category":"mcp.auth"}""",
            $$"""FLAMORIS_DIAGNOSTIC {"level":"warn","category":"mcp.auth","message":"MCP authentication failed","properties":{"statusCode":401,"innocent":"{{secret}}","payload":{"token":"{{secret}}"}}}""",
            string.Empty);
        await using var stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(diagnostics));
        using var reader = new StreamReader(stream);
        await client.ReadDiagnosticsForTestingAsync(reader);

        var text = File.ReadAllText(Path.Combine(root, "diagnostics.log"));
        Assert(text.Contains("[WARN ] [mcp.auth]") && text.Contains("statusCode=401"),
            "A valid diagnostic after a malformed envelope was not logged.");
        Assert(!text.Contains(secret) && !text.Contains("payload") && !text.Contains("innocent"),
            "Unknown diagnostic properties crossed the safe-field boundary.");
    }
    finally
    {
        try { Directory.Delete(root, true); } catch { }
    }
}

static async Task TestLoggingIntegrationAsync(string hostPath)
{
    var root = Path.Combine(Path.GetTempPath(), "Flamoris2D.Logging.Tests", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    var options = NativeLoggingConfiguration.CreateDefaultOptions();
    options.Outputs = [new LogOutputOptions { Type = "file", Path = "integration.log" }];
    var logger = NativeLoggingConfiguration.CreateLogger(options, root);
    string? secret = null;
    try
    {
        await using (var client = new ProductHostClient(logger))
        {
            await client.StartAsync(hostPath);
            await client.CreateSessionAsync("Logging proof");
            var connection = await client.EnableMcpAsync(McpPermission.Edit);
            secret = connection.Token;
            using var http = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, connection.Endpoint);
            request.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "invalid");
            request.Content = new StringContent("{}");
            using var response = await http.SendAsync(request);
            Assert(response.StatusCode == System.Net.HttpStatusCode.Unauthorized,
                "Bad MCP credential was not rejected.");
            await client.DisableMcpAsync();
        }
        var text = File.ReadAllText(Path.Combine(root, "integration.log"));
        Assert(text.Contains("[INFO] [mcp.session]") && text.Contains("[WARN ] [mcp.auth]"),
            "MCP attach/detach/auth diagnostics did not reach Flamoris.Logging.");
        Assert(secret is null || !text.Contains(secret), "MCP credential leaked into the log.");
    }
    finally
    {
        try { Directory.Delete(root, true); } catch { }
    }
}

static void TestViewportGeometry()
{
    static void Near(Point2 actual, Point2 expected)
    { Assert(Math.Abs(actual.X - expected.X) < 1e-8 && Math.Abs(actual.Y - expected.Y) < 1e-8, "Coordinate round-trip drift."); }
    var camera = new ViewportCamera();
    camera.Fit(800, 600, 1920, 1080);
    var point = new Point2(234, 432);
    Near(camera.ToDocument(camera.ToView(point)), point);
    var anchor = new Point2(123, 231);
    var anchored = camera.ToDocument(anchor);
    camera.Zoom(anchor, 1.2);
    Near(camera.ToDocument(anchor), anchored);
    var previous = camera.ToView(point);
    camera.Pan(10, -20);
    Near(camera.ToView(point), new(previous.X + 10, previous.Y - 20));
    foreach (var dpi in new[] { 1.0, 1.25, 1.5, 2.0 })
    {
        var dip = camera.ToView(point);
        Near(camera.DeviceToDocument(new(dip.X * dpi, dip.Y * dpi), dpi, dpi), point);
    }
    var world = new Affine2(0, 2, -3, 0, 10, 20);
    Near(world.Inverse(world.Apply(point)), point);
    var collapsed = new Affine2(0, 0, 0, 1, 0, 0);
    Assert(VertexPicking.HitTriangles([0,0,10,0,0,10],[0,1,2],world.Apply(new(2,2)),world),"Evaluated transformed triangle was not picked.");
    Assert(!VertexPicking.HitTriangles([0,0,10,0,0,10],[0,1,2],world.Apply(new(9,9)),world),"Outside mesh area selected its bounding box.");
    Assert(!VertexPicking.HitTriangles([0,0,0,0,0,0],[0,1,2],new(0,0),Affine2.Identity),"Degenerate mesh was picked.");
    Assert(!collapsed.IsInvertible, "Collapsed targets must not be pickable.");
    AssertThrows<InvalidOperationException>(() => collapsed.Inverse(point));
    double[] positions = [10, 20, 30, 40];
    var screen = camera.ToView(world.Apply(new(10, 20)));
    Assert(VertexPicking.Hit(positions, new(screen.X + 7, screen.Y), camera, world) == 0, "DIP hit radius failed.");
    Assert(VertexPicking.Hit(positions, new(screen.X + 9, screen.Y), camera, world) == -1, "Hit radius grew with zoom.");
    var gesture = new LayoutGesture("document", 7, positions, [0], new(0, 0));
    Assert(gesture.Finish("document", 7) is null, "Click/no-op must not create a command.");
    gesture.Move(new(4.4, 5.4), true);
    Assert(positions[0] == 10 && positions[1] == 20, "Preview mutated the authoritative projection.");
    Assert(gesture.Finish("other", 7) is null && gesture.Finish("document", 8) is null, "Stale drag committed.");
    var moved = gesture.Finish("document", 7)!;
    Assert(moved.SequenceEqual(new double[] { 14, 25, 30, 40 }), "Selected-only snapped move failed.");
    gesture.Move(new(0, 0), false);
    Assert(gesture.Finish("document", 7) is null, "Return-to-start must be a no-op.");
    gesture.Move(new(10, 20), false);
    gesture.Cancel();
    Assert(gesture.Finish("document", 7) is null && gesture.Preview is null, "Cancelled drag must produce no command.");
}

static async Task TestMeshArtworkAsync(string hostPath)
{
    await using var client = new ProductHostClient();
    await client.StartAsync(hostPath);
    await client.CreateSessionAsync("Raster boundary");
    var bytes = Enumerable.Repeat((byte)255, 32 * 32 * 4).ToArray();
    var id = await client.UploadRasterAsync(32, 32, "右目", bytes);
    await client.OpenHandsOnAsync([id]);
    var projection = await client.GetMeshAsync(null);
    var nodeId = projection.Payload.GetProperty("artwork")[0].GetProperty("nodeId").GetString()!;
    var received = await client.DownloadRasterAsync(id, bytes.Length, client.DocumentToken!, client.Revision);
    Assert(bytes.SequenceEqual(received), "Binary raster round-trip changed bytes.");
    var mesh = await client.GetMeshAsync(nodeId);
    var keyform = mesh.Payload.GetProperty("state").GetProperty("activeKeyform");
    var keyformId = keyform.GetProperty("id").GetString()!;
    var before = keyform.GetProperty("positions").EnumerateArray().Select(v => v.GetDouble()).ToArray();
    await client.SetNodeVisibilityAsync(nodeId, true);
    var startingRevision = client.Revision;
    var after = (double[])before.Clone(); after[0] += 2;
    await client.EditMeshAsync(nodeId, keyformId, MeshEdit.Move(after), startingRevision);
    var history = await client.GetHistoryAsync();
    Assert(history.Payload.GetProperty("entries").EnumerateArray().Last().GetProperty("commandTypes")[0].GetString() == "mesh_keyform.move_vertices",
        "Native drag failed to enter Product history.");
    await client.UndoAsync();
    var undo = await client.GetMeshAsync(nodeId);
    Assert(undo.Payload.GetProperty("state").GetProperty("activeKeyform").GetProperty("positions").EnumerateArray()
        .Select(v => v.GetDouble()).SequenceEqual(before), "Undo restored visibility instead of Mesh.");
    await client.RedoAsync();
    var redo = await client.GetMeshAsync(nodeId);
    Assert(redo.Payload.GetProperty("state").GetProperty("activeKeyform").GetProperty("positions").EnumerateArray()
        .Select(v => v.GetDouble()).SequenceEqual(after), "Redo did not restore the Mesh edit.");
    AssertThrows<StaleProjectionException>(() => client.AssertCurrent(client.DocumentToken!, startingRevision));
}

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

static async Task TestControlChannelLossRevokesMcpAsync(string hostPath)
{
    await using var client = new ProductHostClient();
    var lost = new TaskCompletionSource<AuthorityLostEventArgs>(
        TaskCreationOptions.RunContinuationsAsynchronously);
    client.AuthorityLost += (_, eventArgs) => lost.TrySetResult(eventArgs);
    await client.StartAsync(hostPath);
    await client.CreateSessionAsync("Broken control channel", 640, 360);
    var rootId = (await client.GetSceneTreeAsync()).Payload.GetProperty("id").GetString()!;
    var connection = await client.EnableMcpAsync(McpPermission.Edit);
    var documentToken = client.DocumentToken!;
    var revision = client.Revision;
    Assert(client.IsRunning, "The Host must still be alive before breaking only the control channel.");

    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    HttpRequestMessage Request(string tool, object arguments)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, connection.Endpoint);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", connection.Token);
        request.Headers.TryAddWithoutValidation("Accept", "application/json, text/event-stream");
        request.Headers.Add("MCP-Protocol-Version", "2026-07-28");
        request.Headers.Add("Mcp-Method", "tools/call");
        request.Headers.Add("Mcp-Name", tool);
        var parameters = new Dictionary<string, object>
        {
            ["name"] = tool,
            ["arguments"] = arguments,
            ["_meta"] = new Dictionary<string, object>
            {
                ["io.modelcontextprotocol/protocolVersion"] = "2026-07-28",
                ["io.modelcontextprotocol/clientInfo"] = new { name = "authority-loss-proof", version = "1" },
                ["io.modelcontextprotocol/clientCapabilities"] = new { },
            },
        };
        request.Content = new StringContent(JsonSerializer.Serialize(
            new { jsonrpc = "2.0", id = 1, method = "tools/call", @params = parameters }),
            System.Text.Encoding.UTF8, "application/json");
        return request;
    }

    using (var before = Request("live.context", new { }))
    using (var response = await http.SendAsync(before))
        Assert(response.IsSuccessStatusCode, "Live MCP endpoint was not usable before control-channel loss.");
    client.BreakControlChannelForTesting();
    await lost.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert(!client.HasAuthoritativeProjection, "Broken control channel must invalidate WPF authority.");
    Assert(!client.IsRunning, "Broken control channel must terminate the still-running Host.");

    using var request = Request("command.scene.rename_node", new
    {
        documentToken,
        expectedRevision = revision,
        payload = new { nodeId = rootId, displayName = "Must not commit" },
    });
    try
    {
        using var response = await http.SendAsync(request);
        Assert(!response.IsSuccessStatusCode, "Old MCP capability remained usable after WPF authority loss.");
    }
    catch (HttpRequestException) { }
    catch (TaskCanceledException) { }
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
