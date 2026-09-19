using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Flamoris.Logging;

namespace Flamoris.Flamoris2D.ProductHost;

public sealed partial class ProductHostClient : IAsyncDisposable
{
    public const int ProtocolVersion = 1;
    private const int MaximumFrameBytes = 8 * 1024 * 1024;

    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly CancellationTokenSource _controlReader = new();
    private readonly StaleProjectionGate _projectionGate = new();
    private readonly FlamorisLogger? _logger;
    private Process? _process;
    private Task? _readerTask;
    private Task? _stderrTask;
    private long _requestSequence;
    private int _authorityLost;
    private bool _shutdownRequested;
    private volatile bool _projectionStale;

    public ProductHostClient(FlamorisLogger? logger = null) => _logger = logger;

    public event EventHandler<DocumentChangedEventArgs>? DocumentChanged;
    public event EventHandler<AuthorityLostEventArgs>? AuthorityLost;
    public event EventHandler<string>? DiagnosticReceived;

    public bool IsRunning => _process is { HasExited: false };
    public bool HasAuthoritativeProjection =>
        _projectionGate.IsAuthoritative && !_projectionStale && IsRunning;
    public string? DocumentToken => _projectionGate.DocumentToken;
    public long Revision => _projectionGate.Revision;

    public async Task<ProductHostHandshake> StartAsync(
        string hostScriptPath,
        string? nodeExecutable = null,
        CancellationToken cancellationToken = default)
    {
        if (_process is not null) throw new InvalidOperationException("Product Host is already started.");
        _logger?.Debug("app.startup", "Starting Product Host",
            new Dictionary<string, object?> { ["runtime"] = string.IsNullOrWhiteSpace(nodeExecutable) ? "node" : "configured" });
        hostScriptPath = Path.GetFullPath(hostScriptPath);
        if (!File.Exists(hostScriptPath)) throw new FileNotFoundException("Product Host entry was not found.", hostScriptPath);

        var startInfo = new ProcessStartInfo
        {
            FileName = string.IsNullOrWhiteSpace(nodeExecutable) ? "node" : nodeExecutable,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(hostScriptPath)!,
        };
        startInfo.ArgumentList.Add(hostScriptPath);
        _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _process.Exited += (_, _) =>
        {
            if (!_shutdownRequested) LoseAuthority("Product Host exited.", null);
        };
        if (!_process.Start()) throw new InvalidOperationException("Product Host could not be started.");
        _readerTask = ReadLoopAsync(_process.StandardOutput.BaseStream, _controlReader.Token);
        _stderrTask = ReadDiagnosticsAsync(_process.StandardError, _lifetime.Token);

        using var startupTimeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, _lifetime.Token);
        startupTimeout.CancelAfter(TimeSpan.FromSeconds(10));
        ProductHostResponse response;
        try
        {
            response = await SendAsync(
                "protocol.handshake", new { }, false, false, startupTimeout.Token);
        }
        catch
        {
            if (!_process.HasExited) _process.Kill(true);
            throw;
        }
        var payload = response.Payload;
        ConfigureBulk(payload);
        var handshake = new ProductHostHandshake(
            payload.GetProperty("protocolVersion").GetInt32(),
            payload.GetProperty("productSchemaVersion").GetInt32(),
            payload.GetProperty("mcpSchemaVersion").GetInt32(),
            payload.GetProperty("runtime").GetProperty("actual").GetString() ?? "");
        if (handshake.ProtocolVersion != ProtocolVersion)
            throw new ProductHostException("Product Host protocol mismatch.", "protocol.version_unsupported", default, false);
        _logger?.Info("app.startup", "Product Host connected",
            new Dictionary<string, object?>
            {
                ["protocolVersion"] = handshake.ProtocolVersion,
                ["productSchemaVersion"] = handshake.ProductSchemaVersion,
                ["mcpSchemaVersion"] = handshake.McpSchemaVersion,
            });
        return handshake;
    }

    public async Task<ProductHostResponse> HealthAsync(CancellationToken cancellationToken = default) =>
        await SendAsync("host.health", new { }, false, false, cancellationToken);

    public async Task<ProductHostResponse> CreateSessionAsync(
        string name = "名称未設定",
        int width = 1920,
        int height = 1080,
        CancellationToken cancellationToken = default)
    {
        var replacing = HasAuthoritativeProjection;
        cancellationToken.ThrowIfCancellationRequested();
        var response = await SendAsync(replacing ? "document.new" : "session.create", new { name, width, height },
            replacing, replacing, CancellationToken.None, replacingDocument: replacing);
        AttachOpenedDocument(response);
        return response;
    }

    public Task<ProductHostResponse> GetProjectSummaryAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.query", new { name = "project.get_summary", input = new { } },
            false, true, cancellationToken);

    public Task<ProductHostResponse> GetSceneTreeAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.query", new { name = "scene.get_tree", input = new { includeHidden = true } },
            false, true, cancellationToken);

    public Task<ProductHostResponse> GetWorkspaceAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.workspace", new { }, false, true, cancellationToken);

    public Task<ProductHostResponse> ApplyTargetPropertiesAsync(
        string nodeId, string displayName, bool visible, bool locked, long expectedRevision,
        CancellationToken cancellationToken = default) =>
        SendAsync("session.executeTransaction", new
        {
            commands = new[]
            {
                ProductCommand.RenameNode(nodeId, displayName).ToWireValue(),
                ProductCommand.SetVisibility(nodeId, visible).ToWireValue(),
                ProductCommand.SetLocked(nodeId, locked).ToWireValue(),
            },
            label = "対象のプロパティを変更",
        }, true, true, cancellationToken, expectedRevision);

    public Task<ProductHostResponse> SetTargetVisibilityAsync(
        string nodeId, bool visible, long expectedRevision,
        CancellationToken cancellationToken = default) =>
        SendAsync("session.execute", new
        {
            command = ProductCommand.SetVisibility(nodeId, visible).ToWireValue(),
            label = "対象の表示を変更",
        }, true, true, cancellationToken, expectedRevision);

    public Task<ProductHostResponse> SetTargetLockedAsync(
        string nodeId, bool locked, long expectedRevision,
        CancellationToken cancellationToken = default) =>
        SendAsync("session.execute", new
        {
            command = ProductCommand.SetLocked(nodeId, locked).ToWireValue(),
            label = "対象のロックを変更",
        }, true, true, cancellationToken, expectedRevision);

    public Task<ProductHostResponse> RenameNodeAsync(
        string nodeId,
        string displayName,
        string label = "Rename node",
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(ProductCommand.RenameNode(nodeId, displayName), label, cancellationToken);

    public Task<ProductHostResponse> SetNodeVisibilityAsync(
        string nodeId,
        bool visible,
        string label = "Set visibility",
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(ProductCommand.SetVisibility(nodeId, visible), label, cancellationToken);

    public Task<ProductHostResponse> ExecuteTransactionAsync(
        IReadOnlyList<ProductCommand> commands,
        string label,
        CancellationToken cancellationToken = default)
    {
        if (commands.Count == 0) throw new ArgumentException("A transaction needs commands.", nameof(commands));
        return SendAsync("session.executeTransaction",
            new { commands = commands.Select(command => command.ToWireValue()).ToArray(), label },
            true, true, cancellationToken);
    }

    public Task<ProductHostResponse> UndoAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.undo", new { }, true, true, cancellationToken);

    public Task<ProductHostResponse> RedoAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.redo", new { }, true, true, cancellationToken);

    public Task<ProductHostResponse> GetHistoryAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.history", new { }, false, true, cancellationToken);

    public Task<ProductHostResponse> SerializeAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.serialize", new { spacing = 2 }, false, true, cancellationToken);

    public async Task ShutdownAsync(CancellationToken cancellationToken = default)
    {
        var process = _process;
        if (process is null) return;
        _shutdownRequested = true;
        if (!process.HasExited)
        {
            using var shutdownTimeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken, _lifetime.Token);
            shutdownTimeout.CancelAfter(TimeSpan.FromSeconds(5));
            try
            {
                await SendAsync("host.shutdown", new { }, false, false, shutdownTimeout.Token);
                await process.WaitForExitAsync(shutdownTimeout.Token);
            }
            catch
            {
                if (!process.HasExited) process.Kill(true);
                if (cancellationToken.IsCancellationRequested) throw;
            }
        }
        _projectionGate.Invalidate();
        _projectionStale = false;
        _logger?.Info("app.shutdown", "Product Host stopped");
    }

    internal void TerminateHostForTesting()
    {
        if (_process is { HasExited: false } process) process.Kill(true);
    }

    internal void BreakControlChannelForTesting()
    {
        if (_process is not { HasExited: false })
            throw new InvalidOperationException("Product Host is not running.");
        // Simulate WPF losing the authoritative stdout control channel while
        // the child itself is still alive. LoseAuthority must fail closed.
        _controlReader.Cancel();
    }

    private Task<ProductHostResponse> ExecuteAsync(
        ProductCommand command,
        string label,
        CancellationToken cancellationToken) =>
        SendAsync("session.execute", new { command = command.ToWireValue(), label },
            true, true, cancellationToken);

    private void AttachOpenedDocument(ProductHostResponse response)
    {
        if (response.DocumentToken is null || response.Revision is null)
            throw new ProductHostException("Document response omitted authority tags.",
                "protocol.authority_tags_missing", default, false);
        _projectionGate.Attach(response.DocumentToken, response.Revision.Value);
        _projectionStale = false;
    }

    private async Task<ProductHostResponse> SendAsync(
        string method,
        object payload,
        bool mutating,
        bool documentScoped,
        CancellationToken cancellationToken,
        long? expectedRevision = null,
        bool replacingDocument = false)
    {
        var process = _process;
        if (process is null || process.HasExited)
            throw new InvalidOperationException("Product Host is not running.");
        if (documentScoped && !_projectionGate.IsAuthoritative)
            throw new InvalidOperationException("No authoritative Product Host document is attached.");
        if (mutating && _projectionStale)
            throw new InvalidOperationException("The Product Host projection must be refreshed before mutation.");

        var requestId = $"wpf-{Interlocked.Increment(ref _requestSequence)}";
        var request = new Dictionary<string, object?>
        {
            ["protocolVersion"] = ProtocolVersion,
            ["requestId"] = requestId,
            ["method"] = method,
            ["payload"] = payload,
        };
        if (documentScoped) request["documentToken"] = _projectionGate.DocumentToken;
        if (mutating) request["expectedRevision"] = expectedRevision ?? _projectionGate.Revision;

        var completion = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(requestId, completion))
            throw new InvalidOperationException("Duplicate request identifier.");
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(request);
            if (bytes.Length > MaximumFrameBytes)
                throw new InvalidOperationException("Product Host control frame is too large.");
            var header = new byte[4];
            BinaryPrimitives.WriteInt32BigEndian(header, bytes.Length);
            await _writeGate.WaitAsync(cancellationToken);
            try
            {
                await process.StandardInput.BaseStream.WriteAsync(header, cancellationToken);
                await process.StandardInput.BaseStream.WriteAsync(bytes, cancellationToken);
                await process.StandardInput.BaseStream.FlushAsync(cancellationToken);
            }
            finally
            {
                _writeGate.Release();
            }

            var root = await completion.Task.WaitAsync(cancellationToken);
            return ParseResponse(root, documentScoped && !replacingDocument, mutating, method);
        }
        catch (OperationCanceledException)
        {
            _logger?.Warn(method.StartsWith("mcp.", StringComparison.Ordinal) ? "mcp.transport" : "command.failure",
                "Operation cancelled",
                new Dictionary<string, object?> { ["method"] = method });
            throw;
        }
        catch (Exception error) when (error is not ProductHostException)
        {
            _logger?.Error(method.StartsWith("mcp.", StringComparison.Ordinal) ? "mcp.transport" : "command.failure",
                "Operation failed before a Product response was received", error,
                new Dictionary<string, object?> { ["method"] = method, ["mutating"] = mutating });
            throw;
        }
        finally
        {
            _pending.TryRemove(requestId, out _);
        }
    }

    private ProductHostResponse ParseResponse(JsonElement root, bool documentScoped, bool mutating, string method)
    {
        var requestId = root.GetProperty("requestId").GetString() ?? "";
        var documentToken = root.TryGetProperty("documentToken", out var tokenElement) &&
            tokenElement.ValueKind == JsonValueKind.String ? tokenElement.GetString() : null;
        long? revision = root.TryGetProperty("revision", out var revisionElement) &&
            revisionElement.ValueKind == JsonValueKind.Number ? revisionElement.GetInt64() : null;
        if (!root.GetProperty("ok").GetBoolean())
        {
            var error = root.GetProperty("error");
            if (documentScoped && documentToken is not null && revision is not null &&
                string.Equals(documentToken, _projectionGate.DocumentToken, StringComparison.Ordinal) &&
                revision.Value > _projectionGate.Revision)
            {
                _projectionGate.Accept(documentToken, revision.Value);
                _projectionStale = true;
            }
            var exception = new ProductHostException(
                error.GetProperty("message").GetString() ?? "Product Host operation failed.",
                error.GetProperty("code").GetString() ?? "product.operation_failed",
                error.TryGetProperty("details", out var details) ? details.Clone() : default,
                error.TryGetProperty("retryable", out var retryable) && retryable.GetBoolean());
            var category = method.StartsWith("mcp.", StringComparison.Ordinal)
                ? "mcp.session"
                : mutating ? "command.failure" : "command.failure";
            var properties = new Dictionary<string, object?>
            {
                ["method"] = method,
                ["code"] = exception.Code,
                ["revision"] = revision,
            };
            if (exception.Code == "revision.conflict")
                _logger?.Warn(category, "Revision conflict rejected", properties);
            else
                _logger?.Error(category, "Product operation failed", exception, properties);
            throw exception;
        }
        if (documentScoped)
        {
            if (documentToken is null || revision is null)
                throw new ProductHostException("Document response omitted authority tags.",
                    "protocol.authority_tags_missing", default, false);
            _projectionGate.Accept(documentToken, revision.Value);
            _projectionStale = false;
        }
        var payload = root.TryGetProperty("payload", out var payloadElement)
            ? payloadElement.Clone() : default;
        return new ProductHostResponse(requestId, documentToken, revision, payload);
    }

    private async Task ReadLoopAsync(Stream output, CancellationToken cancellationToken)
    {
        try
        {
            var header = new byte[4];
            while (!cancellationToken.IsCancellationRequested)
            {
                if (!await ReadExactlyAsync(output, header, cancellationToken))
                    throw new EndOfStreamException("Product Host control channel closed.");
                var length = BinaryPrimitives.ReadInt32BigEndian(header);
                if (length <= 0 || length > MaximumFrameBytes)
                    throw new InvalidDataException("Product Host emitted an invalid frame length.");
                var payload = new byte[length];
                if (!await ReadExactlyAsync(output, payload, cancellationToken))
                    throw new EndOfStreamException("Product Host frame was truncated.");
                using var document = JsonDocument.Parse(payload);
                var root = document.RootElement.Clone();
                var type = root.GetProperty("type").GetString();
                if (type == "response")
                {
                    var requestId = root.GetProperty("requestId").GetString();
                    if (requestId is not null && _pending.TryRemove(requestId, out var completion))
                        completion.TrySetResult(root);
                }
                else if (type == "event")
                {
                    ObserveEvent(root);
                }
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested || _shutdownRequested) { }
        catch (Exception error)
        {
            if (!_shutdownRequested) LoseAuthority("Product Host control channel failed.", error);
        }
    }

    private void ObserveEvent(JsonElement root)
    {
        var token = root.GetProperty("documentToken").GetString();
        var revision = root.GetProperty("revision").GetInt64();
        if (token is null) return;
        var previouslyAccepted = _projectionGate.Revision;
        try
        {
            _projectionGate.Accept(token, revision);
        }
        catch (StaleProjectionException)
        {
            return;
        }
        if (revision > previouslyAccepted) _projectionStale = true;
        var method = root.GetProperty("payload").GetProperty("method").GetString() ?? "";
        DocumentChanged?.Invoke(this, new DocumentChangedEventArgs(token, revision, method));
    }

    private async Task ReadDiagnosticsAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested &&
                await reader.ReadLineAsync(cancellationToken) is { } line)
            {
                if (!TryLogHostDiagnostic(line))
                    _logger?.Debug("app", "Product Host emitted an unstructured diagnostic");
                DiagnosticReceived?.Invoke(this, line);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private bool TryLogHostDiagnostic(string line)
    {
        const string prefix = "FLAMORIS_DIAGNOSTIC ";
        if (!line.StartsWith(prefix, StringComparison.Ordinal)) return false;
        try
        {
            using var document = JsonDocument.Parse(line[prefix.Length..]);
            var root = document.RootElement;
            var category = root.GetProperty("category").GetString() ?? "app";
            var message = root.GetProperty("message").GetString() ?? "Product Host diagnostic";
            var level = root.GetProperty("level").GetString() switch
            {
                "error" => LogLevel.Error,
                "warn" => LogLevel.Warn,
                "info" => LogLevel.Info,
                _ => LogLevel.Debug,
            };
            var properties = new Dictionary<string, object?>();
            if (root.TryGetProperty("properties", out var fields) && fields.ValueKind == JsonValueKind.Object)
            {
                foreach (var field in fields.EnumerateObject())
                {
                    properties[field.Name] = field.Value.ValueKind switch
                    {
                        JsonValueKind.String => field.Value.GetString(),
                        JsonValueKind.Number when field.Value.TryGetInt64(out var number) => number,
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        JsonValueKind.Null => null,
                        _ => field.Value.GetRawText(),
                    };
                }
            }
            _logger?.Log(level, category, message, properties);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private void LoseAuthority(string reason, Exception? error)
    {
        if (Interlocked.Exchange(ref _authorityLost, 1) != 0) return;
        _projectionGate.Invalidate();
        _projectionStale = false;
        var exception = error ?? new EndOfStreamException(reason);
        _logger?.Error("mcp.transport", "Product Host authority lost; live MCP access was revoked",
            exception, new Dictionary<string, object?> { ["reason"] = reason });
        foreach (var completion in _pending.Values) completion.TrySetException(exception);
        // The WPF control channel is the Native authority lease. If it is lost,
        // a still-running Host must not leave its live MCP capability behind.
        // Terminate before publishing AuthorityLost so observers cannot race an
        // old endpoint after the UI has declared the document detached.
        var process = _process;
        if (process is { HasExited: false })
        {
            try { process.StandardInput.Close(); } catch { }
            try { if (!process.HasExited) process.Kill(true); } catch { }
            try { process.WaitForExit(5000); } catch { }
        }
        AuthorityLost?.Invoke(this, new AuthorityLostEventArgs(reason, error));
    }

    private static async Task<bool> ReadExactlyAsync(
        Stream stream,
        Memory<byte> buffer,
        CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer[offset..], cancellationToken);
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    public async ValueTask DisposeAsync()
    {
        try { await ShutdownAsync(); } catch { }
        _lifetime.Cancel();
        _controlReader.Cancel();
        if (_readerTask is not null)
        {
            try { await _readerTask; } catch { }
        }
        if (_stderrTask is not null)
        {
            try { await _stderrTask; } catch { }
        }
        _process?.Dispose();
        _writeGate.Dispose();
        _controlReader.Dispose();
        _lifetime.Dispose();
    }
}
