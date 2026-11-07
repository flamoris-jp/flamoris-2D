using System.Globalization;
using System.Text.Json;
using Flamoris.Mcp.Core;
using Flamoris.Flamoris2D.Session;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Flamoris.Flamoris2D.Cli;

// Process-owned stdio only. The official SDK handles JSON-RPC; MCP Core still
// owns every tool authorization, deadline, revision check and atomic commit.
internal static class StdioHost
{
    public static async Task RunAsync(NativeMcpHost host, McpBoundary boundary, CapabilityGrant grant, CancellationToken token)
    {
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(token, grant.Revoked);
        await using var input = new BoundedInput(Console.OpenStandardInput(), lifetime, boundary.Options);
        await using var transport = new StreamServerTransport(input, Console.OpenStandardOutput(), grant.Snapshot.ProductId);
        var tools = boundary.DescribeCatalog().EnumerateArray()
            .Where(t => t.GetProperty("name").GetString() == "mcp.context" || grant.Permission == McpPermission.Edit ||
                boundary.Tools[t.GetProperty("name").GetString()!].Kind == OperationKind.Query)
            .Select(t => new Tool { Name = t.GetProperty("name").GetString()!, Description = t.GetProperty("description").GetString(), InputSchema = t.GetProperty("input_schema").Clone() }).ToArray();
        var options = new McpServerOptions
        {
            ServerInfo = new() { Name = grant.Snapshot.ProductId, Version = grant.Snapshot.ApplicationVersion },
            ScopeRequests = false, InitializationTimeout = TimeSpan.FromSeconds(10), Capabilities = new() { Tools = new() },
            Handlers = new()
            {
                ListToolsHandler = (request, ct) =>
                {
                    ct.ThrowIfCancellationRequested(); grant.Revoked.ThrowIfCancellationRequested();
                    var cursor = request.Params?.Cursor;
                    var offset = 0;
                    if (cursor is not null && (!int.TryParse(cursor, NumberStyles.None, CultureInfo.InvariantCulture, out offset) || offset < 0 || offset > tools.Length))
                        throw new ModelContextProtocol.McpException("invalid_request");
                    return ValueTask.FromResult(new ListToolsResult
                    {
                        Tools = tools.Skip(offset).Take(32).ToList(), NextCursor = offset + 32 < tools.Length ? (offset + 32).ToString(CultureInfo.InvariantCulture) : null
                    });
                },
                CallToolHandler = async (request, ct) =>
                {
                    using var call = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetime.Token);
                    call.CancelAfter(boundary.Options.RequestTimeoutMs);
                    try
                    {
                        var name = request.Params?.Name ?? "";
                        var args = JsonSerializer.SerializeToElement(request.Params?.Arguments ?? new Dictionary<string, JsonElement>());
                        if (name == "mcp.context")
                        {
                            if (args.EnumerateObject().Any()) throw new McpFault(McpErrors.InvalidRequest);
                            return Wire(new(await host.InvokeAsync(() =>
                            {
                                if (!grant.IsActive) throw new McpFault(McpErrors.Unauthorized);
                                var s = host.Snapshot;
                                if (!s.Available || s.RuntimeId != grant.Snapshot.RuntimeId || !boundary.Options.ApplicationLifetime && s.DocumentToken != grant.Snapshot.DocumentToken)
                                    throw new McpFault(McpErrors.StaleSession);
                                return JsonSerializer.SerializeToElement(new
                                {
                                    productId = s.ProductId, applicationVersion = s.ApplicationVersion, runtimeId = s.RuntimeId,
                                    documentToken = s.DocumentToken, revision = s.Revision.ToString(CultureInfo.InvariantCulture),
                                    available = s.Available, hasDocument = s.HasDocument, busy = s.HumanEditing,
                                    permission = grant.Permission == McpPermission.Edit ? "edit" : "readOnly"
                                });
                            }, call.Token)));
                        }
                        if (args.EnumerateObject().Any(p => p.Name is not ("input" or "guard")) || !args.TryGetProperty("input", out var value))
                            throw new McpFault(McpErrors.InvalidRequest);
                        var guard = args.TryGetProperty("guard", out var g) ? Guard(g) : null;
                        return Wire(await boundary.InvokeAsync(grant, name, value, guard, call.Token));
                    }
                    catch (McpFault e) { return Wire(McpResult.Failure(e.Code)); }
                    catch (OperationCanceledException) { return Wire(McpResult.Failure(McpErrors.Cancelled)); }
                    catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException)
                    { return Wire(McpResult.Failure(McpErrors.InvalidRequest)); }
                }
            }
        };
        await using var server = McpServer.Create(transport, options);
        try { await server.RunAsync(lifetime.Token); }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        finally { boundary.Disable(); }
    }

    private static RequestGuard Guard(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Any(p => p.Name is not ("runtimeId" or "documentToken" or "expectedRevision")) ||
            value.EnumerateObject().Select(p => p.Name).Distinct().Count() != value.EnumerateObject().Count()) throw new McpFault(McpErrors.InvalidRequest);
        string Text(string name) => value.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: >= 1 and <= 128 } s
            ? s : throw new McpFault(McpErrors.InvalidRequest);
        long? revision = null;
        if (value.TryGetProperty("expectedRevision", out _))
        {
            var text = Text("expectedRevision");
            if (!long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number < 0 || number.ToString(CultureInfo.InvariantCulture) != text)
                throw new McpFault(McpErrors.InvalidRequest);
            revision = number;
        }
        return new(Text("runtimeId"), Text("documentToken"), revision);
    }

    private static CallToolResult Wire(McpResult result)
    {
        var value = result.Error is { } code ? JsonSerializer.SerializeToElement(new { error = new { code } }) : result.Value ?? JsonSerializer.SerializeToElement(new { });
        var content = new List<ContentBlock> { new TextContentBlock { Text = value.GetRawText() } };
        if (!result.IsError && result.Image is { } image) content.Add(ImageContentBlock.FromBytes(image.Bytes, image.MimeType));
        return new() { IsError = result.IsError, StructuredContent = value, Content = content };
    }

    private sealed class BoundedInput(Stream source, CancellationTokenSource lifetime, McpOptions options) : Stream
    {
        private int frameBytes;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            using var read = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, lifetime.Token);
            if (frameBytes > 0) read.CancelAfter(options.ReadTimeoutMs);
            var count = await source.ReadAsync(buffer, read.Token);
            // Cancellation callbacks can wait for the transport reader itself.
            // Do not synchronously run them from inside that reader at EOF.
            if (count == 0) { _ = lifetime.CancelAsync(); return 0; }
            foreach (var b in buffer.Span[..count])
            {
                if (b == '\n') frameBytes = 0;
                else if (++frameBytes > options.MaxRequestBytes) { _ = lifetime.CancelAsync(); throw new IOException("MCP frame exceeds the size limit."); }
            }
            return count;
        }
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) source.Dispose(); base.Dispose(disposing); }
    }
}
