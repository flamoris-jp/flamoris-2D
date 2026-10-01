using System.Text.Json;
using Flamoris.Mcp.Core;
using Flamoris.Flamoris2D.Session;
using CorePermission = Flamoris.Mcp.Core.McpPermission;

namespace Flamoris.Flamoris2D.Native.Client;

public enum McpPermission { ReadOnly, Edit }

public sealed class McpConnection
{
    public required string Endpoint { get; init; }
    public required string Token { get; init; }
    public required string DocumentToken { get; init; }
    public required McpPermission Permission { get; init; }
    public string BridgePath { get; init; } = Path.Combine(AppContext.BaseDirectory, "mcp", "Flamoris.Mcp.Bridge.exe");
    public override string ToString() => $"MCP {Permission}: {Endpoint}";
    public string CopyConfiguration() => JsonSerializer.Serialize(new
    {
        mcpServers = new Dictionary<string, object>
        {
            ["flamoris-2d"] = new { command = BridgePath, args = new[] { "--pipe", Endpoint },
                env = new Dictionary<string, string> { [StdioBridge.CredentialEnvironmentVariable] = Token } },
        },
    }, new JsonSerializerOptions { WriteIndented = true });
}

public sealed partial class NativeSessionClient
{
    private readonly SemaphoreSlim _mcpLifecycle = new(1, 1);
    private NativeMcpHost? _mcpHost;
    private McpBoundary? _mcpBoundary;
    private Task? _mcpEndpointTask;
    private CapabilityGrant? _mcpGrant;
    public McpBoundary? LiveMcpBoundary => _mcpBoundary;
    public CapabilityGrant? LiveMcpGrant => _mcpGrant;
    private McpPermission _mcpPermission;
    private long _mcpEpoch;
    public event Action? McpStatusChanged;
    public McpStatus? McpStatus => _mcpBoundary?.Status.Current;

    private void PublishMcpStatus()
    {
        foreach (Action handler in McpStatusChanged?.GetInvocationList() ?? [])
            try { handler(); } catch { }
    }
    private void RevokeLocalMcp()
    {
        _mcpHost?.Invalidate();
        _mcpBoundary?.Disable();
        PublishMcpStatus();
    }
    public async Task<McpConnection> EnableMcpAsync(McpPermission permission, CancellationToken cancellationToken = default, bool startLocalEndpoint = true)
    {
        var epoch = Interlocked.Increment(ref _mcpEpoch);
        await _mcpLifecycle.WaitAsync(cancellationToken);
        try
        {
            await DisableMcpCoreAsync();
            cancellationToken.ThrowIfCancellationRequested();
            EnsureReady();var expectedToken=DocumentToken!;
            await _workspace.InvokeAsync(w=>{if(w.Snapshot.DocumentToken!=expectedToken)throw new McpFault(McpErrors.HostUnavailable);return true;},cancellationToken);
            if (epoch != Interlocked.Read(ref _mcpEpoch)) throw new McpFault(McpErrors.Cancelled);
            _mcpPermission = permission;
            var host = new NativeMcpHost(_workspace,expectedToken,permission==McpPermission.Edit?CorePermission.Edit:CorePermission.ReadOnly);
            _mcpHost = host;
            var options = new McpOptions { MaxRequestBytes = 4 * 1024 * 1024, MaxConcurrentRequests = 4 };
            var boundary = new McpBoundary(host, host.Tools(), options, new McpDiagnostics(_logger ?? Flamoris.Logging.FlamorisLogger.Create(new Flamoris.Logging.LoggingOptions { Level = "error" })));
            _mcpBoundary = boundary;
            boundary.Status.Changed += PublishMcpStatus;
            var grant = await boundary.EnableAsync(permission == McpPermission.Edit ? CorePermission.Edit : CorePermission.ReadOnly);
            _mcpGrant = grant;
            if (startLocalEndpoint)
            {
                _mcpEndpointTask = new LocalMcpEndpoint(boundary).RunAsync(grant, _lifetime.Token);
                if (!boundary.Status.Current.EndpointAvailable) throw new McpFault(McpErrors.TransportUnavailable);
            }
            _logger?.Info("mcp.session", "Live MCP access enabled");
            return new McpConnection { Endpoint = options.PipeName, Token = grant.ExportCredential(),
                DocumentToken = grant.Snapshot.DocumentToken, Permission = permission };
        }
        catch { await DisableMcpCoreAsync(); throw; }
        finally { _mcpLifecycle.Release(); }
    }
    private async Task DisableMcpCoreAsync()
    {
        RevokeLocalMcp();
        if (_mcpEndpointTask is not null) await _mcpEndpointTask;
        if (_mcpBoundary is { } boundary)
        {
            boundary.Status.Changed -= PublishMcpStatus;
            boundary.Dispose();
        }
        _mcpHost?.Dispose();
        _mcpBoundary = null; _mcpGrant = null; _mcpHost = null; _mcpEndpointTask = null;
        PublishMcpStatus();
    }
    public async Task<NativeSessionResponse> DisableMcpAsync()
    {
        Interlocked.Increment(ref _mcpEpoch);
        RevokeLocalMcp();
        await _mcpLifecycle.WaitAsync();
        try
        {
            await DisableMcpCoreAsync();
            return new("mcp-disabled", DocumentToken, Revision, JsonSerializer.SerializeToElement(new { enabled = false }));
        }
        finally { _mcpLifecycle.Release(); }
    }
    public Task<NativeSessionResponse> GetMcpStatusAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var status = McpStatus;
        return Task.FromResult(new NativeSessionResponse("mcp-status", DocumentToken, Revision,
            JsonSerializer.SerializeToElement(new { enabled = status?.Enabled == true,
                permission = _mcpPermission == McpPermission.Edit ? "edit" : "read-only",
                endpoint = _mcpBoundary?.Options.PipeName, connected = status?.Connected == true,
                available = status?.EndpointAvailable == true, active = status?.ForegroundCount ?? 0 })));
    }
}
