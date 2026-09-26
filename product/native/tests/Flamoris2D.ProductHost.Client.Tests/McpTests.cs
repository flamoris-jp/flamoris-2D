using System.IO.Pipes;
using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;
using ModelContextProtocol.Client;

internal static class McpTests
{
    internal static Task<McpClient> ConnectAsync(McpConnection connection, string? secret = null, string protocol = "2026-07-28") =>
        McpClient.CreateAsync(new StdioClientTransport(new()
        {
            Command = Environment.GetEnvironmentVariable("FLAMORIS_TEST_BRIDGE") ?? throw new Exception("Set FLAMORIS_TEST_BRIDGE."),
            Arguments = ["--pipe", connection.Endpoint],
            EnvironmentVariables = new Dictionary<string, string?> { ["FLAMORIS_MCP_CAPABILITY"] = secret ?? connection.Token },
            ShutdownTimeout = TimeSpan.FromSeconds(3),
        }), new() { ProtocolVersion = protocol }, cancellationToken: new CancellationTokenSource(TimeSpan.FromSeconds(8)).Token);

    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static async Task<JsonElement> Context(McpClient client) => (await client.CallToolAsync("mcp.context")).StructuredContent!.Value;
    private static Dictionary<string, object?> Arguments(JsonElement context, object input, string? revision = null) => new()
    {
        ["input"] = input,
        ["guard"] = new { runtimeId = context.GetProperty("runtimeId").GetString(), documentToken = context.GetProperty("documentToken").GetString(),
            expectedRevision = revision ?? context.GetProperty("revision").GetString() },
    };
    private static async Task Rejected(McpConnection connection, string secret)
    {
        try { await using var probe = await ConnectAsync(connection, secret); throw new Exception("Credential accepted."); }
        catch (Exception e) when (e.Message != "Credential accepted.") { }
    }
    internal static async Task RunAsync(string hostPath)
    {
        await using var host = new ProductHostClient();
        await host.StartAsync(hostPath);
        await host.CreateSessionAsync("Core integration");
        var root = (await host.GetSceneTreeAsync()).Payload.GetProperty("id").GetString()!;
        var connection = await host.EnableMcpAsync(McpPermission.Edit);
        Check(!connection.CopyConfiguration().Contains("Bearer"), "Old HTTP configuration survived.");
        await Rejected(connection, ""); await Rejected(connection, new string('0', 64));
        for (var reconnect = 0; reconnect < 2; reconnect++)
        {
            await using var probe = await ConnectAsync(connection, protocol: reconnect == 0 ? "2026-07-28" : "2025-03-26");
            var context = await Context(probe);
            Check(context.GetProperty("documentToken").GetString() == host.DocumentToken, "Second document created.");
            Check(host.McpStatus?.Connected == true, "Authenticated-client state missing.");
            var tools = await probe.ListToolsAsync();
            Check(tools.Any(t => t.Name == "command.mesh_keyform.move_vertices"), "Typed Mesh tool missing.");
            Check(!tools.Any(t => t.Name.Contains("apply_psd_reimport") || t.Name.Contains("restore_internal")), "Native-only tool exposed.");
            var changed = await probe.CallToolAsync("command.scene.rename_node", Arguments(context, new { payload = new { nodeId = root, displayName = "MCP" } }));
            Check(changed.IsError != true, changed.StructuredContent?.GetRawText() ?? "Mutation failed.");
            Check((await host.GetSceneTreeAsync()).Payload.GetProperty("displayName").GetString() == "MCP", "WPF missed MCP edit.");
            var conflict = await probe.CallToolAsync("command.scene.rename_node", Arguments(context, new { payload = new { nodeId = root, displayName = "stale" } }));
            Check(conflict.IsError == true, "Stale revision accepted.");
            await host.UndoAsync(); await host.GetWorkspaceAsync();
            context = await Context(probe);
            Check((await probe.CallToolAsync("live.redo", Arguments(context, new { }))).IsError != true, "Shared redo failed.");
            await host.GetWorkspaceAsync();
            await host.RenameNodeAsync(root, "WPF");
            var query = await probe.CallToolAsync("query.scene.get_node", new Dictionary<string, object?> { ["input"] = new { input = new { nodeId = root } } });
            Check(query.StructuredContent!.Value.GetProperty("result").GetProperty("displayName").GetString() == "WPF", "MCP missed WPF edit.");
        }
        await host.GetWorkspaceAsync();
        var read = await host.EnableMcpAsync(McpPermission.ReadOnly);
        Check(read.Token != connection.Token && read.Endpoint != connection.Endpoint, "Enable did not rotate grant/pipe.");
        await Rejected(read, connection.Token);
        await using (var probe = await ConnectAsync(read))
        {
            Check(!(await probe.ListToolsAsync()).Any(t => t.Name.StartsWith("command.")), "Read-only discovery contains edits.");
            Check((await probe.CallToolAsync("live.undo", Arguments(await Context(probe), new { }))).IsError == true, "Read-only mutation accepted.");
        }
        await host.CreateSessionAsync("Replacement");
        Check(host.McpStatus?.Enabled != true, "Replacement left old grant active.");
        connection = await host.EnableMcpAsync(McpPermission.Edit);
        await using (var probe = await ConnectAsync(connection))
        {
            await Context(probe);
            var lost = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            host.AuthorityLost += (_, _) => lost.TrySetResult();
            host.BreakControlChannelForTesting();
            await lost.Task.WaitAsync(TimeSpan.FromSeconds(8));
            Check(!host.IsRunning && host.DocumentToken is null && host.McpStatus?.Enabled != true, "Control loss left an MCP-only editor.");
        }
        Console.WriteLine("Official bridge MCP integration passed: shared authority/history, reconnect, schema, permission, rotation and control loss.");
    }
}
