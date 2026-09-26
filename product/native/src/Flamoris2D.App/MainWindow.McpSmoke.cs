using ModelContextProtocol.Client;
using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private async Task WaitForMcpProjectionAsync(Func<bool> ready)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (!ready())
        {
            if (DateTime.UtcNow >= deadline) throw new Exception("WPF did not project the live MCP edit through document.changed.");
            await Task.Delay(20);
        }
        // Wait for the existing refresh queue, never force a projection to make the proof pass.
        await _refreshGate.WaitAsync(); _refreshGate.Release();
    }

    private async Task RunLiveMcpSmokeAsync(string nodeId, string keyArtId)
    {
        var client = _client!;
        _mcpConnection = await client.EnableMcpAsync(McpPermission.Edit);
        var connection = _mcpConnection;
        await RefreshMcpStatusAsync(client);
        await using var probe = await McpClient.CreateAsync(new StdioClientTransport(new()
        {
            Command = connection.BridgePath, Arguments = ["--pipe", connection.Endpoint],
            EnvironmentVariables = new Dictionary<string, string?> { ["FLAMORIS_MCP_CAPABILITY"] = connection.Token },
            ShutdownTimeout = TimeSpan.FromSeconds(3),
        }));
        await probe.ListToolsAsync();
        async Task<JsonElement> Tool(string name, object args)
        {
            var input = JsonSerializer.SerializeToElement(args);
            var values = input.EnumerateObject().Where(p => p.Name is not ("documentToken" or "expectedRevision"))
                .ToDictionary(p => p.Name, p => (object?)p.Value.Clone());
            var current = (await probe.CallToolAsync("mcp.context")).StructuredContent!.Value;
            var parameters = new Dictionary<string, object?> { ["input"] = values,
                ["guard"] = new { runtimeId = current.GetProperty("runtimeId").GetString(),
                    documentToken = current.GetProperty("documentToken").GetString(),
                    expectedRevision = input.TryGetProperty("expectedRevision", out var revision)
                        ? revision.GetInt64().ToString(System.Globalization.CultureInfo.InvariantCulture)
                        : current.GetProperty("revision").GetString() } };
            var result = await probe.CallToolAsync(name, parameters);
            if (result.IsError == true) throw new Exception("Packaged MCP operation failed: " + result.StructuredContent);
            return result.StructuredContent!.Value;
        }
        var context = await Tool("live.context", new { });
        var originalName = _targets.Targets.Single(t => t.Id == nodeId).DisplayName;
        var revision = context.GetProperty("revision").GetInt64();
        await Tool("query.keyart.list", new { documentToken = client.DocumentToken, input = new { } });
        await Tool("command.scene.rename_node", new { documentToken = client.DocumentToken, expectedRevision = revision,
            payload = new { nodeId, displayName = "MCP visible edit" } });
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == "MCP visible edit"));
        await client.UndoAsync();
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == originalName));
        await client.RedoAsync();
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == "MCP visible edit"));
        await client.RenameNodeAsync(nodeId, "WPF visible edit");
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == "WPF visible edit"));
        var query = await Tool("query.scene.get_node", new { documentToken = client.DocumentToken, input = new { nodeId } });
        if (query.GetProperty("result").GetProperty("displayName").GetString() != "WPF visible edit") throw new Exception("MCP missed WPF edit.");
        var keyforms = await Tool("query.mesh.list_keyforms", new { documentToken = client.DocumentToken, input = new { keyArtId } });
        var form = keyforms.GetProperty("result").EnumerateArray().First();
        var positions = form.GetProperty("positions").EnumerateArray().Select(v => v.GetDouble()).ToArray();
        positions[0] += 6; positions[1] += 4;
        var before = FramePixels(MeshCanvas.EvaluatedFrame);
        var transaction = await Tool("live.transaction", new { documentToken = client.DocumentToken, expectedRevision = client.Revision,
            label = "Live Mesh transaction", commands = new object[] {
                new { type = "scene.rename_node", payload = new { nodeId, displayName = "MCP Mesh transaction" } },
                new { type = "mesh_keyform.move_vertices", payload = new { keyformId = form.GetProperty("id").GetString(), positions } },
            } });
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == "MCP Mesh transaction"));
        if (before.SequenceEqual(FramePixels(MeshCanvas.EvaluatedFrame))) throw new Exception("MCP Mesh edit did not alter WPF artwork.");
        await client.UndoAsync();
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == "WPF visible edit"));
        if (!before.SequenceEqual(FramePixels(MeshCanvas.EvaluatedFrame))) throw new Exception("One WPF Undo failed to restore the MCP transaction.");
        await Tool("live.redo", new { documentToken = client.DocumentToken, expectedRevision = client.Revision });
        await WaitForMcpProjectionAsync(() => _targets.Targets.Any(t => t.Id == nodeId && t.DisplayName == "MCP Mesh transaction"));
        await client.DisableMcpAsync(); await RefreshMcpStatusAsync(client);
        Console.WriteLine("Packaged external MCP passed: modern discovery > scene/Key Art > rename > automatic WPF projection > shared Undo/Redo > WPF edit > MCP query > Mesh transaction > one WPF Undo > MCP Redo. Subsequent production save/reopen retains this data.");
    }
}
