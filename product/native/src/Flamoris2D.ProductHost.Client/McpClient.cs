using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

public enum McpPermission { ReadOnly, Edit }

// Ephemeral connection capability: never persist or include the token in ToString/logs.
public sealed class McpConnection
{
    public required string Endpoint { get; init; }
    public required string Token { get; init; }
    public required string DocumentToken { get; init; }
    public required McpPermission Permission { get; init; }
    public override string ToString() => $"MCP {Permission}: {Endpoint}";
    public string CopyConfiguration() => JsonSerializer.Serialize(new
    {
        mcpServers = new Dictionary<string, object>
        {
            ["flamoris-2d"] = new { type = "http", url = Endpoint, headers = new { Authorization = $"Bearer {Token}" } },
        },
    }, new JsonSerializerOptions { WriteIndented = true });
}

public sealed partial class ProductHostClient
{
    public async Task<McpConnection> EnableMcpAsync(McpPermission permission,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var response = await SendAsync("mcp.enable", new { permission = permission == McpPermission.Edit ? "edit" : "read-only" },
            true, true, CancellationToken.None);
        return new McpConnection
        {
            Endpoint = response.Payload.GetProperty("endpoint").GetString()!,
            Token = response.Payload.GetProperty("token").GetString()!,
            DocumentToken = response.DocumentToken!, Permission = permission,
        };
    }
    public Task<ProductHostResponse> DisableMcpAsync() =>
        SendAsync("mcp.disable", new { }, false, true, CancellationToken.None);
    public Task<ProductHostResponse> GetMcpStatusAsync(CancellationToken cancellationToken = default) =>
        SendAsync("mcp.status", new { }, false, true, cancellationToken);
}
