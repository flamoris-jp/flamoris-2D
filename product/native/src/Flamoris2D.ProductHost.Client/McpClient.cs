using System.Text.Json;
using Flamoris.Mcp.Core;
using CorePermission = Flamoris.Mcp.Core.McpPermission;

namespace Flamoris.Flamoris2D.ProductHost;

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

public sealed partial class ProductHostClient
{
    private readonly SemaphoreSlim _mcpLifecycle = new(1, 1);
    private ProductMcpHost? _mcpHost;
    private McpBoundary? _mcpBoundary;
    private Task? _mcpEndpointTask;
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
    public async Task<McpConnection> EnableMcpAsync(McpPermission permission, CancellationToken cancellationToken = default)
    {
        var epoch = Interlocked.Increment(ref _mcpEpoch);
        await _mcpLifecycle.WaitAsync(cancellationToken);
        try
        {
            await DisableMcpCoreAsync();
            cancellationToken.ThrowIfCancellationRequested();
            var response = await SendAsync("mcp.enable", new { permission = permission == McpPermission.Edit ? "edit" : "read-only" },
                true, true, CancellationToken.None);
            if (epoch != Interlocked.Read(ref _mcpEpoch)) throw new McpFault(McpErrors.Cancelled);
            _mcpPermission = permission;
            var host = new ProductMcpHost(this, response.Payload.GetProperty("leaseId").GetString()!);
            _mcpHost = host;
            var options = new McpOptions { MaxRequestBytes = 4 * 1024 * 1024, MaxConcurrentRequests = 4 };
            var boundary = new McpBoundary(host, host.Tools(response.Payload.GetProperty("tools")), options, new McpDiagnostics(_logger ?? Flamoris.Logging.FlamorisLogger.Create(new Flamoris.Logging.LoggingOptions { Level = "error" })));
            _mcpBoundary = boundary;
            boundary.Status.Changed += PublishMcpStatus;
            var grant = await boundary.EnableAsync(permission == McpPermission.Edit ? CorePermission.Edit : CorePermission.ReadOnly);
            _mcpEndpointTask = new LocalMcpEndpoint(boundary).RunAsync(grant, _lifetime.Token);
            if (!boundary.Status.Current.EndpointAvailable) throw new McpFault(McpErrors.TransportUnavailable);
            _logger?.Info("mcp.session", "Live MCP access enabled");
            return new McpConnection { Endpoint = options.PipeName, Token = grant.ExportCredential(),
                DocumentToken = grant.Snapshot.DocumentToken, Permission = permission };
        }
        catch { await DisableMcpCoreAsync(); throw; }
        finally { _mcpLifecycle.Release(); }
    }
    private async Task DisableMcpCoreAsync()
    {
        // Revoke at the actual authority before waiting on Core's atomic callback lock.
        if (IsRunning && DocumentToken is not null)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            try { await SendAsync("mcp.disable", new { }, false, true, deadline.Token); }
            catch { LoseAuthority("MCP revocation could not reach Product Host.", null); }
        }
        RevokeLocalMcp();
        if (_mcpEndpointTask is not null) await _mcpEndpointTask;
        if (_mcpBoundary is { } boundary)
        {
            boundary.Status.Changed -= PublishMcpStatus;
            boundary.Dispose();
        }
        _mcpBoundary = null; _mcpHost = null; _mcpEndpointTask = null;
        PublishMcpStatus();
    }
    public async Task<ProductHostResponse> DisableMcpAsync()
    {
        Interlocked.Increment(ref _mcpEpoch);
        // Supersede a pending enable immediately, even while Native import work owns the queue.
        if (IsRunning && DocumentToken is not null)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            try { await SendAsync("mcp.disable", new { }, false, true, deadline.Token); }
            catch { LoseAuthority("MCP revocation could not reach Product Host.", null); }
        }
        await _mcpLifecycle.WaitAsync();
        try
        {
            await DisableMcpCoreAsync();
            return new("mcp-disabled", DocumentToken, Revision, JsonSerializer.SerializeToElement(new { enabled = false }));
        }
        finally { _mcpLifecycle.Release(); }
    }
    public Task<ProductHostResponse> GetMcpStatusAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var status = McpStatus;
        return Task.FromResult(new ProductHostResponse("mcp-status", DocumentToken, Revision,
            JsonSerializer.SerializeToElement(new { enabled = status?.Enabled == true,
                permission = _mcpPermission == McpPermission.Edit ? "edit" : "read-only",
                endpoint = _mcpBoundary?.Options.PipeName, connected = status?.Connected == true,
                available = status?.EndpointAvailable == true, active = status?.ForegroundCount ?? 0 })));
    }
    private Task<ProductHostResponse> McpControlAsync(string method, object payload, CancellationToken token) =>
        SendAsync(method, payload, false, false, token);

    private sealed class ProductMcpHost(ProductHostClient client, string leaseId) : IMcpHost
    {
        private readonly SemaphoreSlim lane = new(1, 1);
        private readonly AsyncLocal<string?> reservation = new();
        private volatile bool invalidated;
        public HostSnapshot Snapshot { get; private set; } = new("flamoris.2d", "0.4.0", "", "", 0, false);
        public event Action? Invalidating;
        public void Invalidate() { invalidated = true; Invalidating?.Invoke(); }
        public async Task<T> InvokeAsync<T>(Func<T> action, CancellationToken token)
        {
            await lane.WaitAsync(token).ConfigureAwait(false);
            var id = Guid.NewGuid().ToString("N");
            try
            {
                if (invalidated) throw new McpFault(McpErrors.HostUnavailable);
                using var bounded = CancellationTokenSource.CreateLinkedTokenSource(token);
                bounded.CancelAfter(TimeSpan.FromSeconds(6));
                var pending = client.McpControlAsync("mcp.reserve", new { reservationId = id, leaseId }, bounded.Token);
                using var cancel = bounded.Token.Register(() => _ = ReleaseAsync(id));
                var response = await pending.ConfigureAwait(false);
                var s = response.Payload;
                Snapshot = new(s.GetProperty("productId").GetString()!, s.GetProperty("applicationVersion").GetString()!,
                    s.GetProperty("runtimeId").GetString()!, s.GetProperty("documentToken").GetString()!, s.GetProperty("revision").GetInt64());
                token.ThrowIfCancellationRequested();
                if (invalidated) throw new McpFault(McpErrors.HostUnavailable);
                reservation.Value = id;
                return action();
            }
            catch (ProductHostException e) { throw new McpFault(e.Code); }
            finally
            {
                reservation.Value = null;
                await ReleaseAsync(id).ConfigureAwait(false);
                lane.Release();
            }
        }
        private async Task ReleaseAsync(string id)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            try { await client.McpControlAsync("mcp.release", new { reservationId = id }, deadline.Token).ConfigureAwait(false); }
            catch { client.LoseAuthority("MCP reservation release failed.", null); }
        }
        // The fixed registry supplies the exact Product payload schema. No caller
        // chooses arbitrary methods or property paths; Node validates again.
        private sealed record ProductToolInput(JsonElement Value);
        public IEnumerable<HostTool> Tools(JsonElement definitions)
        {
            foreach (var definition in definitions.EnumerateArray())
            {
                var name = definition.GetProperty("name").GetString()!;
                var readOnly = definition.GetProperty("readOnly").GetBoolean();
                var schema = definition.GetProperty("inputSchema").Clone();
                yield return new HostTool<ProductToolInput>(name, definition.GetProperty("description").GetString()!, schema,
                    readOnly ? OperationKind.Query : OperationKind.Mutation,
                    input => Decode(input, schema), (context, input, token) =>
                    {
                        JsonElement Execute()
                        {
                            token.ThrowIfCancellationRequested();
                            if (reservation.Value is not { } id) throw new McpFault(McpErrors.HostUnavailable);
                            try
                            {
                                using var exchangeDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                                var response = client.McpControlAsync(readOnly ? "mcp.invoke" : "mcp.prepare", new { reservationId = id, name, input = input.Value,
                                    runtimeId = Snapshot.RuntimeId, documentToken = Snapshot.DocumentToken,
                                    expectedRevision = Snapshot.Revision }, exchangeDeadline.Token).GetAwaiter().GetResult();
                                if (!readOnly)
                                {
                                    // Product preparation made no persistent changes. Acknowledge cancellation
                                    // before the small atomic commit on the reserved authoritative lane.
                                    token.ThrowIfCancellationRequested();
                                    response = client.McpControlAsync("mcp.commit", new { reservationId = id }, exchangeDeadline.Token).GetAwaiter().GetResult();
                                }
                                return response.Payload;
                            }
                            catch (ProductHostException e) { throw new McpFault(e.Code); }
                        }
                        return readOnly ? context.ReadAsync(Execute) : context.CommitAsync(Execute);
                    }, foreground: name != "live.context" && name != "live.dispositions");
            }
        }
        private static ProductToolInput Decode(JsonElement input, JsonElement schema)
        {
            if (input.ValueKind != JsonValueKind.Object) throw new McpFault(McpErrors.InvalidRequest);
            var fields = schema.GetProperty("properties");
            foreach (var property in input.EnumerateObject())
                if (!fields.TryGetProperty(property.Name, out _)) throw new McpFault(McpErrors.InvalidRequest);
            foreach (var required in schema.GetProperty("required").EnumerateArray())
                if (!input.TryGetProperty(required.GetString()!, out _)) throw new McpFault(McpErrors.InvalidRequest);
            return new(input.Clone());
        }
    }
}
