using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

public sealed class ProductHostClient : IAsyncDisposable
{
    public const int ProtocolVersion = 1;
    private const int MaximumFrameBytes = 8 * 1024 * 1024;

    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly StaleProjectionGate _projectionGate = new();
    private Process? _process;
    private Task? _readerTask;
    private Task? _stderrTask;
    private long _requestSequence;
    private int _authorityLost;
    private bool _shutdownRequested;
    private bool _projectionStale;

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
        _readerTask = ReadLoopAsync(_process.StandardOutput.BaseStream, _lifetime.Token);
        _stderrTask = ReadDiagnosticsAsync(_process.StandardError, _lifetime.Token);

        var response = await SendAsync("protocol.handshake", new { }, false, false, cancellationToken);
        var payload = response.Payload;
        var handshake = new ProductHostHandshake(
            payload.GetProperty("protocolVersion").GetInt32(),
            payload.GetProperty("productSchemaVersion").GetInt32(),
            payload.GetProperty("mcpSchemaVersion").GetInt32(),
            payload.GetProperty("runtime").GetProperty("actual").GetString() ?? "");
        if (handshake.ProtocolVersion != ProtocolVersion)
            throw new ProductHostException("Product Host protocol mismatch.", "protocol.version_unsupported", default, false);
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
        var response = await SendAsync("session.create", new { name, width, height }, false, false, cancellationToken);
        AttachOpenedDocument(response);
        return response;
    }

    public Task<ProductHostResponse> GetProjectSummaryAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.query", new { name = "project.get_summary", input = new { } },
            false, true, cancellationToken);

    public Task<ProductHostResponse> GetSceneTreeAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.query", new { name = "scene.get_tree", input = new { includeHidden = true } },
            false, true, cancellationToken);

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
            try
            {
                await SendAsync("host.shutdown", new { }, false, false, cancellationToken);
                await process.WaitForExitAsync(cancellationToken);
            }
            catch when (!cancellationToken.IsCancellationRequested)
            {
                if (!process.HasExited) process.Kill(true);
            }
        }
        _projectionGate.Invalidate();
        _projectionStale = false;
    }

    internal void TerminateHostForTesting()
    {
        if (_process is { HasExited: false } process) process.Kill(true);
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
        CancellationToken cancellationToken)
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
        if (mutating) request["expectedRevision"] = _projectionGate.Revision;

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
            return ParseResponse(root, documentScoped, mutating);
        }
        finally
        {
            _pending.TryRemove(requestId, out _);
        }
    }

    private ProductHostResponse ParseResponse(JsonElement root, bool documentScoped, bool mutating)
    {
        var requestId = root.GetProperty("requestId").GetString() ?? "";
        var documentToken = root.TryGetProperty("documentToken", out var tokenElement) &&
            tokenElement.ValueKind == JsonValueKind.String ? tokenElement.GetString() : null;
        var revision = root.TryGetProperty("revision", out var revisionElement) &&
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
            throw new ProductHostException(
                error.GetProperty("message").GetString() ?? "Product Host operation failed.",
                error.GetProperty("code").GetString() ?? "product.operation_failed",
                error.TryGetProperty("details", out var details) ? details.Clone() : default,
                error.TryGetProperty("retryable", out var retryable) && retryable.GetBoolean());
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
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
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
        try
        {
            _projectionGate.Accept(token, revision);
        }
        catch (StaleProjectionException)
        {
            return;
        }
        var method = root.GetProperty("payload").GetProperty("method").GetString() ?? "";
        DocumentChanged?.Invoke(this, new DocumentChangedEventArgs(token, revision, method));
    }

    private async Task ReadDiagnosticsAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested &&
                await reader.ReadLineAsync(cancellationToken) is { } line)
                DiagnosticReceived?.Invoke(this, line);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private void LoseAuthority(string reason, Exception? error)
    {
        if (Interlocked.Exchange(ref _authorityLost, 1) != 0) return;
        _projectionGate.Invalidate();
        _projectionStale = false;
        var exception = error ?? new EndOfStreamException(reason);
        foreach (var completion in _pending.Values) completion.TrySetException(exception);
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
        _lifetime.Dispose();
    }
}
