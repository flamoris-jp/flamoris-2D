using System.Text;
using System.Text.Json;
using Flamoris.Logging;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Session;
namespace Flamoris.Flamoris2D.Native.Client;

// Typed desktop adapter over one native workspace. No IPC or editable Project mirror.
public sealed partial class NativeSessionClient : IAsyncDisposable
{
    public const int ProtocolVersion = 1;
    private readonly NativeWorkspace _workspace = new();
    private readonly StaleProjectionGate _projectionGate = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly FlamorisLogger? _logger;
    private volatile bool _projectionStale;
    private bool _running, _disposed;
    private long _requestSequence;
    public NativeSessionClient(FlamorisLogger? logger = null) { _logger = logger; _workspace.Changed += WorkspaceChanged; }
    public event EventHandler<DocumentChangedEventArgs>? DocumentChanged;
    public event EventHandler<AuthorityLostEventArgs>? AuthorityLost;
    public bool IsRunning => _running && !_disposed;
    public bool HasAuthoritativeProjection => IsRunning && _projectionGate.IsAuthoritative && !_projectionStale;
    public string? DocumentToken => _projectionGate.DocumentToken;
    public long Revision => _projectionGate.Revision;
    public Task<NativeSessionHandshake> StartAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this); cancellationToken.ThrowIfCancellationRequested(); if (_running) throw new InvalidOperationException("Native workspace already started.");
        var abi = NativeEngine.Version(); if (abi.Major != 1 || abi.Minor < 5) throw new InvalidOperationException("Native authority ABI mismatch.");
        _running = true; _logger?.Info("app.startup", "Native editing authority ready"); return Task.FromResult(new NativeSessionHandshake(ProtocolVersion, 15, 1, $"native/{abi.Major}.{abi.Minor}"));
    }
    private void WorkspaceChanged(WorkspaceChanged change)
    {
        var s = change.Snapshot;
        if (change.Operation == "replace") { _projectionGate.Attach(s.DocumentToken, s.Revision); _uploaded.Clear(); }
        else _projectionGate.Accept(s.DocumentToken, s.Revision);
        _projectionStale = true;
        foreach (EventHandler<DocumentChangedEventArgs> listener in DocumentChanged?.GetInvocationList() ?? []) try { listener(this, new(s.DocumentToken, s.Revision, change.Operation)); } catch { }
    }
    private NativeSessionResponse Response(NativeWorkspace workspace, string id, JsonElement value, bool refresh = true)
    {
        var s = workspace.Snapshot; _projectionGate.Accept(s.DocumentToken, s.Revision); if (refresh) _projectionStale = false; return new(id, s.DocumentToken, s.Revision, value);
    }
    private static JsonElement Json(object? value) => JsonSerializer.SerializeToElement(value);
    private static JsonElement Field(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var item) ? item : default;
    private static string? Text(JsonElement value, string name) => Field(value, name).ValueKind == JsonValueKind.String ? Field(value, name).GetString() : null;
    private static long Integer(JsonElement value, string name, long fallback = 0) => Field(value, name).ValueKind == JsonValueKind.Number ? Field(value, name).GetInt64() : fallback;
    private static JsonElement Object(JsonElement value) => value.ValueKind == JsonValueKind.Object ? value : Json(new { });
    private void EnsureReady(bool document = true)
    {
        if (!IsRunning) throw new InvalidOperationException("Native editing authority is unavailable."); if (document && !_projectionGate.IsAuthoritative) throw new InvalidOperationException("No native document is attached.");
    }
    public async Task<NativeSessionResponse> HealthAsync(CancellationToken cancellationToken = default) =>
        await SendAsync("host.health", new { }, false, false, cancellationToken);

    public async Task<NativeSessionResponse> CreateSessionAsync(
        string name = "名称未設定",
        int width = 1920,
        int height = 1080,
        CancellationToken cancellationToken = default)
    {
        var replacing = DocumentToken is not null;
        cancellationToken.ThrowIfCancellationRequested();
        var response = await SendAsync(replacing ? "document.new" : "session.create", new { name, width, height },
            replacing, replacing, cancellationToken, replacingDocument: replacing);
        return response;
    }

    public Task<NativeSessionResponse> GetProjectSummaryAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.query", new { name = "project.get_summary", input = new { } },
            false, true, cancellationToken);

    public Task<NativeSessionResponse> GetSceneTreeAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.query", new { name = "scene.get_tree", input = new { includeHidden = true } },
            false, true, cancellationToken);

    public Task<NativeSessionResponse> GetWorkspaceAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.workspace", new { }, false, true, cancellationToken);

    public Task<NativeSessionResponse> ApplyTargetPropertiesAsync(
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

    public Task<NativeSessionResponse> SetTargetVisibilityAsync(
        string nodeId, bool visible, long expectedRevision,
        CancellationToken cancellationToken = default) =>
        SendAsync("session.execute", new
        {
            command = ProductCommand.SetVisibility(nodeId, visible).ToWireValue(),
            label = "対象の表示を変更",
        }, true, true, cancellationToken, expectedRevision);

    public Task<NativeSessionResponse> SetTargetLockedAsync(
        string nodeId, bool locked, long expectedRevision,
        CancellationToken cancellationToken = default) =>
        SendAsync("session.execute", new
        {
            command = ProductCommand.SetLocked(nodeId, locked).ToWireValue(),
            label = "対象のロックを変更",
        }, true, true, cancellationToken, expectedRevision);

    public Task<NativeSessionResponse> RenameNodeAsync(
        string nodeId,
        string displayName,
        string label = "Rename node",
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(ProductCommand.RenameNode(nodeId, displayName), label, cancellationToken);

    public Task<NativeSessionResponse> SetNodeVisibilityAsync(
        string nodeId,
        bool visible,
        string label = "Set visibility",
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(ProductCommand.SetVisibility(nodeId, visible), label, cancellationToken);

    public Task<NativeSessionResponse> ExecuteTransactionAsync(
        IReadOnlyList<ProductCommand> commands,
        string label,
        CancellationToken cancellationToken = default)
    {
        if (commands.Count == 0) throw new ArgumentException("A transaction needs commands.", nameof(commands));
        return SendAsync("session.executeTransaction",
            new { commands = commands.Select(command => command.ToWireValue()).ToArray(), label },
            true, true, cancellationToken);
    }

    public Task<NativeSessionResponse> UndoAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.undo", new { }, true, true, cancellationToken);

    public Task<NativeSessionResponse> RedoAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.redo", new { }, true, true, cancellationToken);

    public Task<NativeSessionResponse> GetHistoryAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.history", new { }, false, true, cancellationToken);

    public Task<NativeSessionResponse> SerializeAsync(CancellationToken cancellationToken = default) =>
        SendAsync("session.serialize", new { spacing = 2 }, false, true, cancellationToken);


    public async Task ShutdownAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed) return; cancellationToken.ThrowIfCancellationRequested(); await _workspace.InvokeAsync(w => { RevokeLocalMcp(); _running = false; _lifetime.Cancel(); _projectionGate.Invalidate(); _uploaded.Clear(); return true; }); await DisableMcpAsync(); _logger?.Info("app.shutdown", "Native editing authority stopped");
    }
    private Task<NativeSessionResponse> ExecuteAsync(ProductCommand command, string label, CancellationToken token) => SendAsync("session.execute", new { command = command.ToWireValue(), label }, true, true, token);
    private async Task<NativeSessionResponse> SendAsync(string method, object payload, bool mutating, bool documentScoped, CancellationToken cancellationToken, long? expectedRevision = null, bool replacingDocument = false)
    {
        EnsureReady(documentScoped); if (mutating && _projectionStale) throw new StaleProjectionException(expectedRevision ?? Revision, Revision);
        var expectedToken = DocumentToken; var revision = expectedRevision ?? Revision; var id = $"wpf-{Interlocked.Increment(ref _requestSequence)}"; var input = Json(payload);
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); var token = bounded.Token;
        try
        {
            if (method is "session.create" or "document.new")
            {
                var opened = await _workspace.NewAsync(Text(input, "name")!, checked((int)Integer(input, "width")), checked((int)Integer(input, "height")), token, expectedToken, revision);
                return await ReplacementResponse(opened, id);
            }
            if (method == "host.health") return new(id, DocumentToken, Revision, Json(new { ok = true, runtime = "native" }));
            if (method == "mesh.generatePreview")
            {
                var generated = await _workspace.GenerateMeshAsync(Text(input, "nodeId")!, Text(input, "kind")!, checked((int)Integer(input, "columns")), checked((int)Integer(input, "rows")), Object(Field(input, "settings")), expectedToken!, revision, token);
                return await _workspace.InvokeAsync(w => { w.AssertCurrent(expectedToken!, revision); return Response(w, id, generated); }, token);
            }
            return await _workspace.InvokeAsync(w =>
            {
                EnsureReady(documentScoped);
                if (documentScoped && (mutating || replacingDocument)) w.AssertCurrent(expectedToken!, revision);
                token.ThrowIfCancellationRequested(); JsonElement value;
                switch (method)
                {
                    case "session.workspace": value = NativeMcpHost.WorkspaceProjection(w); break;
                    case "session.query": value = w.Query(Text(input, "name")!, Object(Field(input, "input"))); break;
                    case "session.execute": value = w.Execute(Json(new[] { Field(input, "command") }), Text(input, "label") ?? "Edit", token); break;
                    case "session.executeTransaction": value = w.Execute(Field(input, "commands"), Text(input, "label") ?? "Edit", token); break;
                    case "session.undo": value = w.Undo(token); break;
                    case "session.redo": value = w.Redo(token); break;
                    case "session.history": var state = w.Snapshot.State; value = Json(new { entries = w.History, canUndo = state.UndoDepth > 0, canRedo = state.RedoDepth > 0, editorRevision = state.CurrentRevision }); break;
                    case "session.serialize": var save = w.PrepareSave("copy"); try { value = Json(new { document = Encoding.UTF8.GetString(save.Bytes.Span) }); } finally { w.ReleaseSave(save.Id); } break;
                    case "mesh.projection": value = w.Mesh(Text(input, "nodeId"), Text(input, "keyformId"), Text(input, "keyArtId")); break;
                    case "mesh.tool": value = w.ExecutePlan(w.CompileMesh(Text(input, "nodeId")!, Text(input, "keyformId"), Text(input, "keyArtId"), Text(input, "context")!, Text(input, "tool")!, Object(Field(input, "input"))), token); break;
                    case "rig.projection": value = w.Rig(input); break;
                    case "rig.tool": value = w.ExecutePlan(w.CompileRig(Object(Field(input, "context")), Text(input, "tool")!, Object(Field(input, "input"))), token); break;
                    case "keyState.projection": value = w.KeyState(input); break;
                    case "keyState.tool": value = w.ExecutePlan(w.CompileKeyState(Object(Field(input, "context")), Text(input, "tool")!, Object(Field(input, "input"))), token); break;
                    case "keyState.correspondence": value = w.Correspondence(Object(Field(input, "context")), Object(Field(input, "input"))); break;
                    case "timeline.projection": value = w.Timeline(input); break;
                    case "timeline.tool": value = w.ExecutePlan(w.CompileTimeline(Object(Field(input, "context")), Text(input, "tool")!, Object(Field(input, "input"))), token); break;
                    case "source.changeReview": value = w.ChangeSourceReview(Text(input, "id")!, Text(input, "rowId")!, Text(input, "action")!, Text(input, "importedNodeId")); break;
                    case "source.applyReview": value = w.ApplySourceReview(Text(input, "id")!, token); break;
                    case "source.discardReview": w.DiscardSourceReview(Text(input, "id")!); value = Json(new { discarded = true }); break;
                    case "export.settings": value = w.ExportSettings(); break;
                    case "export.plan": value = w.ExportPlan(input); break;
                    case "export.frame": value = w.ExportFrame(input); break;
                    case "export.encoder": value = w.Encoder(input); break;
                    case "render.project": value = Render(w, input, token); break;
                    case "native.preferences": value = Preferences(Object(Field(input, "preferences"))); break;
                    case "document.incrementalName": value = Json(new { fileName = IncrementalName(input) }); break;
                    default: throw new InvalidOperationException("Unknown native desktop operation.");
                }
                return Response(w, id, value, method == "session.workspace" || mutating);
            }, token);
        }
        catch (WorkspaceException e) { throw new NativeSessionException(e.Message, e.Code, Json(new { }), e.Code is "revision.conflict" or "document.conflict"); }
        catch (NativeQueryException e) { throw new NativeSessionException(e.Message, e.ProductName.StartsWith("VIDEO_", StringComparison.Ordinal) ? e.ProductName : "query.failed", Json(new { name = e.ProductName }), false); }
    }
    private Task<NativeSessionResponse> ReplacementResponse(WorkspaceSnapshot committed, string id) => _workspace.InvokeAsync(w =>
    {
        EnsureReady(); w.AssertCurrent(committed.DocumentToken, committed.Revision); return Response(w, id, Opened(w));
    }, CancellationToken.None);
    private static JsonElement Opened(NativeWorkspace w) => Json(new { documentToken = w.Snapshot.DocumentToken, revision = w.Snapshot.Revision, proofOnly = w.ProofOnly, summary = w.Query("project.get_summary") });
    private static JsonElement Render(NativeWorkspace w, JsonElement input, CancellationToken token)
    {
        string? art = Text(input, "keyArtId"), transition = Text(input, "transitionId"), sequence = Text(input, "sequenceId"); long ticks = Integer(input, "timeTicks"); var layout = Field(input, "layoutPreview"); var rig = Field(input, "rigPreview"); var playback = Field(input, "playback"); JsonElement commands = default, clock = default;
        if (rig.ValueKind == JsonValueKind.Object) { if (art is null || Text(Field(rig, "context"), "keyArtId") != art || layout.ValueKind == JsonValueKind.Object) throw new NativeSessionException("Rig preview Key Art mismatch.", "preview.context_invalid", Json(new { }), false); commands = w.CompileRig(Field(rig, "context"), Text(rig, "tool")!, Object(Field(rig, "input"))).GetProperty("commands"); }
        if (layout.ValueKind == JsonValueKind.Object) { if (art is null) throw new NativeSessionException("Layout preview requires a Key Art.", "preview.context_invalid", Json(new { }), false); var form = w.Query("mesh.get_keyform", Json(new { keyformId = Text(layout, "keyformId") })); if (Text(form, "keyArtId") != art) throw new NativeSessionException("Layout preview Key Art mismatch.", "preview.context_invalid", Json(new { }), false); commands = Json(new[] { new { type = "mesh_keyform.move_vertices", payload = layout } }); }
        if (playback.ValueKind == JsonValueKind.Object) { clock = w.Playback(input); ticks = clock.GetProperty("timeTicks").GetInt64(); }
        var result = w.Render(art, transition, sequence, ticks, commands, token); if (clock.ValueKind == JsonValueKind.Object) { var fields = result.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()); fields["playing"] = clock.GetProperty("playing"); result = Json(fields); }
        return result;
    }
    internal void InvalidateAuthorityForTesting() => LoseAuthority("Native authority invalidated.", null);
    private void LoseAuthority(string reason, Exception? error)
    {
        _running = false; _projectionGate.Invalidate(); RevokeLocalMcp(); foreach (EventHandler<AuthorityLostEventArgs> listener in AuthorityLost?.GetInvocationList() ?? []) try { listener(this, new(reason, error)); } catch { }
    }
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return; await ShutdownAsync(); _disposed = true; _workspace.Changed -= WorkspaceChanged; await _workspace.DisposeAsync(); _lifetime.Dispose(); _mcpLifecycle.Dispose();
    }
}
