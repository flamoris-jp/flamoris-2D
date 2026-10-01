using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Source;

namespace Flamoris.Flamoris2D.Session;

public sealed class WorkspaceException(string code) : Exception(code) { public string Code { get; } = code; }
public sealed record WorkspaceSnapshot(string RuntimeId, string DocumentToken, long Revision, NativeSessionState State);
public sealed record WorkspaceChanged(WorkspaceSnapshot Snapshot, string Operation);
public sealed record SaveIdentity(string LineageId, string DocumentToken, long Revision, long EditorRevision, string SnapshotId, string Timestamp, string Name);
public sealed record SaveCandidate(string Id, string? ReceiptId, string Operation, SaveIdentity Identity, ReadOnlyMemory<byte> Bytes);
public sealed record SaveCleanup(string LineageId, string DocumentToken, long ThroughRevision, string? RestoredSnapshotId);
public sealed record WorkspaceArtwork(string Id, string NodeId, string Name, int Width, int Height, double Left, double Top, ReadOnlyMemory<byte> Rgba, JsonElement Record);

// The only owner of the editable native session. WPF and MCP use InvokeAsync on
// this same lane. The managed layer owns immutable raster/file capabilities;
// it never modifies a Project. Every edit/Undo/Redo commits in C++.
public sealed partial class NativeWorkspace : IAsyncDisposable
{
    private readonly SemaphoreSlim lane = new(1, 1);
    private readonly AsyncLocal<long?> invocation = new();
    private long invocationEpoch;
    private NativeSession? session;
    private bool disposed;
    private string documentToken = "", lineageId = "";
    private object createdAt = "", modifiedAt = "";
    private string? restoredSnapshotId;
    private long revision;
    private IReadOnlyDictionary<string, WorkspaceArtwork> artwork = EmptyArtwork();
    private JsonElement[] orphanRecords = [];
    private readonly Dictionary<long, IReadOnlyDictionary<string, WorkspaceArtwork>> artworkHistory = [];
    private readonly Dictionary<string, (SaveCandidate Candidate, object ModifiedAt, DateTimeOffset Expires)> saves = [];
    private static readonly UTF8Encoding Utf8 = new(false, true);
    public string RuntimeId { get; } = Guid.NewGuid().ToString();
    public event Action<WorkspaceChanged>? Changed;
    // Atomic callbacks are synchronous: no await, reentrant lane acquisition or
    // native handle escapes. Shared MCP Core holds its commit lock around these.
    public async Task<T> InvokeAsync<T>(Func<NativeWorkspace, T> action, CancellationToken token = default)
    {
        await lane.WaitAsync(token).ConfigureAwait(false);
        try
        {
            // WaitAsync can complete synchronously on WPF's dispatcher.
            // Explicitly move the entire atomic callback to a worker while
            // keeping the shared UI/MCP lane held until that work completes.
            return await Task.Run(() =>
            {
                try
                {
                    ObjectDisposedException.ThrowIf(disposed, this);
                    token.ThrowIfCancellationRequested();
                    invocation.Value = ++invocationEpoch;
                    return action(this);
                }
                finally { invocation.Value = null; ++invocationEpoch; }
            }).ConfigureAwait(false);
        }
        finally { lane.Release(); }
    }
    public WorkspaceSnapshot Snapshot => new(RuntimeId, documentToken, revision, Session.State());
    private void AssertLane() { if (invocation.Value != invocationEpoch) throw new InvalidOperationException("Native session access requires the shared workspace lane."); }
    private NativeSession Session { get { AssertLane(); return session ?? throw new WorkspaceException("document.required"); } }
    public JsonElement Project => Parse(Session.ProjectJson());
    public string LineageId { get { AssertLane(); return lineageId; } }
    public JsonElement History => Parse(Session.HistoryJson());
    public IReadOnlyDictionary<string, WorkspaceArtwork> Artwork { get { AssertLane(); return artwork; } }
    public JsonElement Query(string name, JsonElement input = default) => Session.Query(name, input);
    public JsonElement QueryPreview(JsonElement commands, string name, JsonElement input, CancellationToken token = default)
    {
        Check(Session.TryPrepare(JsonSerializer.SerializeToUtf8Bytes(commands), "Preview", out var prepared));
        using (prepared) { token.ThrowIfCancellationRequested(); var result = prepared!.Query(name, input); token.ThrowIfCancellationRequested(); return result; }
    }
    public JsonElement Render(string? keyArtId = null, string? transitionId = null, string? sequenceId = null, long timeTicks = 0, JsonElement previewCommands = default, CancellationToken token = default)
    {
        var input = JsonSerializer.SerializeToElement(new { keyArtId, transitionId, sequenceId, timeTicks, artwork = Artwork.Values.Select(a => new { id = a.Id, nodeId = a.NodeId, width = a.Width, height = a.Height, byteLength = a.Rgba.Length }) });
        return previewCommands.ValueKind == JsonValueKind.Array && previewCommands.GetArrayLength() > 0 ? QueryPreview(previewCommands, "native.render_frame", input, token) : Query("native.render_frame", input);
    }
    public void AssertCurrent(string token, long expectedRevision)
    {
        AssertLane(); if (token != documentToken) throw new WorkspaceException("document.conflict");
        if (expectedRevision != revision) throw new WorkspaceException("revision.conflict");
    }
    public JsonElement Execute(JsonElement commands, string label, CancellationToken cancellationToken = default, IReadOnlyDictionary<string, WorkspaceArtwork>? replacementArtwork = null)
    {
        if (commands.ValueKind != JsonValueKind.Array) throw new WorkspaceException("command.payload_invalid");
        long branchRevision = Session.State().CurrentRevision;
        var status = Session.TryPrepare(JsonSerializer.SerializeToUtf8Bytes(commands), label, out var prepared);
        Check(status);
        using (prepared) { cancellationToken.ThrowIfCancellationRequested(); Check(prepared!.Commit()); }
        if (replacementArtwork is not null) artwork = replacementArtwork;
        FinishEdit("execute", branchRevision: branchRevision); return MutationResult();
    }
    public JsonElement Undo(CancellationToken token = default) => HistoryEdit(true, token);
    public JsonElement Redo(CancellationToken token = default) => HistoryEdit(false, token);
    private JsonElement HistoryEdit(bool undo, CancellationToken token)
    {
        var status = undo ? Session.TryPrepareUndo(out var prepared) : Session.TryPrepareRedo(out prepared); Check(status);
        using (prepared) { token.ThrowIfCancellationRequested(); Check(prepared!.Commit()); }
        artwork = artworkHistory[Session.State().CurrentRevision]; FinishEdit(undo ? "undo" : "redo", retainArtwork: false); return MutationResult();
    }
    private void FinishEdit(string operation, bool retainArtwork = true, long? branchRevision = null)
    {
        revision = checked(revision + 1); sourceReview = null;
        if (branchRevision is { } parent) foreach (var key in artworkHistory.Keys.Where(k => k > parent).ToArray()) artworkHistory.Remove(key);
        if (retainArtwork) artworkHistory[Session.State().CurrentRevision] = artwork;
        // Native revision identities identify immutable asset snapshots. A new
        // edit clears native redo; asset snapshots newer than its parent follow
        // that same branch truncation. No managed undo/redo stack exists.
        Publish(operation);
    }
    private JsonElement MutationResult()
    {
        var s = Session.State(); return JsonSerializer.SerializeToElement(new { revision = s.CurrentRevision, canUndo = s.UndoDepth > 0, canRedo = s.RedoDepth > 0, isDirty = s.Dirty != 0 });
    }
    private void Publish(string operation)
    {
        var change = new WorkspaceChanged(Snapshot, operation);
        foreach (Action<WorkspaceChanged> listener in Changed?.GetInvocationList() ?? []) try { listener(change); } catch { /* A UI observer cannot invalidate a committed edit. */ }
    }
    private void Check(NativeStatus status)
    {
        if (status != NativeStatus.Ok) throw new WorkspaceException(session?.ErrorCode() is { Length: > 0 } code ? code : $"native.{status}");
    }
    public Task<WorkspaceSnapshot> NewAsync(string name, int width, int height, CancellationToken token = default, string? expectedToken = null, long? expectedRevision = null) => InvokeAsync(w =>
    {
        if (w.session is not null && (expectedToken is not null || expectedRevision is not null)) w.AssertCurrent(expectedToken ?? "", expectedRevision ?? w.revision);
        if (string.IsNullOrWhiteSpace(name) || width <= 0 || height <= 0) throw new WorkspaceException("document.canvas_invalid");
        var source = NativeDocument.SourceProject(JsonSerializer.SerializeToElement(new { kind = "blank", source = new { width, height }, options = new { projectName = name } }));
        w.Replace(source.GetProperty("project"), EmptyArtwork(), null, false, null, null, token); return w.Snapshot;
    }, token);
    public async Task<WorkspaceSnapshot> OpenAsync(byte[] bytes, string? expectedToken = null, long? expectedRevision = null, string? recoveryLineage = null, string? recoverySnapshot = null, CancellationToken token = default)
    {
        var guard = await InvokeAsync(w => w.session is null ? (Token: "", Revision: 0L) : (Token: w.documentToken, Revision: w.revision), token).ConfigureAwait(false);
        var parsed = await Task.Run(() => NativeDocument.Parse(bytes), token).ConfigureAwait(false);
        long liveBytes = await InvokeAsync(w => w.artworkHistory.Values.SelectMany(a => a.Values).DistinctBy(a => a.Id).Sum(a => (long)a.Rgba.Length), token).ConfigureAwait(false);
        var candidate = await Task.Run(() => ReadArtwork(parsed.GetProperty("project"), parsed.GetProperty("renderAssets"), liveBytes, token), token).ConfigureAwait(false);
        return await InvokeAsync(w =>
        {
            if (w.session is not null) w.AssertCurrent(expectedToken ?? guard.Token, expectedRevision ?? guard.Revision); w.Replace(parsed.GetProperty("project"), candidate, parsed.GetProperty("metadata"), recoveryLineage is not null, recoveryLineage, recoverySnapshot, token);
            var nodes = parsed.GetProperty("project").GetProperty("scene").GetProperty("nodes");
            w.orphanRecords = parsed.GetProperty("renderAssets").EnumerateArray().Where(r => r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("nodeId", out var id) || id.ValueKind != JsonValueKind.String || !nodes.TryGetProperty(id.GetString()!, out _)).Select(r => r.Clone()).ToArray();
            return w.Snapshot;
        }, token).ConfigureAwait(false);
    }
    public async Task<WorkspaceSnapshot> ImportAsync(byte[] bytes, string kind, string fileName, string? expectedToken = null, long? expectedRevision = null, CancellationToken token = default)
    {
        var guard = await InvokeAsync(w => w.session is null ? (Token: "", Revision: 0L) : (Token: w.documentToken, Revision: w.revision), token).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(fileName) || fileName.Length > 260) throw new WorkspaceException("source.filename_invalid");
        var decoded = await Task.Run(() => kind == "psd" ? PsdCodec.Decode(bytes, token) : kind == "flimg" ? FlimgCodec.Decode(bytes, token) : throw new WorkspaceException("source.kind_invalid"), token).ConfigureAwait(false);
        var converted = await Task.Run(() => NativeDocument.SourceProject(JsonSerializer.SerializeToElement(new { kind, source = decoded.Description, options = new { fileName, projectName = fileName, importedAt = Now() } })), token).ConfigureAwait(false);
        var project = converted.GetProperty("project"); var candidate = BuildSourceArtwork(project, converted.GetProperty("bindings"), decoded, kind, token);
        return await InvokeAsync(w => { if (w.session is not null) w.AssertCurrent(expectedToken ?? guard.Token, expectedRevision ?? guard.Revision); w.CheckArtworkBudget(candidate); w.Replace(project, candidate, null, true, null, null, token); w.IncludeSourceParts(CancellationToken.None); return w.Snapshot; }, token).ConfigureAwait(false);
    }
    private void IncludeSourceParts(CancellationToken token)
    {
        ExecutePlan(CompileKeyState(JsonSerializer.SerializeToElement(new { }), "source.include", JsonSerializer.SerializeToElement(new { })), token);
    }
    private void Replace(JsonElement project, IReadOnlyDictionary<string, WorkspaceArtwork> candidate, JsonElement? metadata, bool dirty, string? lineage, string? restored, CancellationToken token)
    {
        token.ThrowIfCancellationRequested(); var bytes = JsonSerializer.SerializeToUtf8Bytes(project);
        if (session is null) { Check(NativeSession.TryCreate(bytes, out var created)); session = created; if (dirty) Check(Session.Replace(bytes, false)); }
        else Check(Session.Replace(bytes, !dirty));
        proofOnly = false; documentToken = Guid.NewGuid().ToString(); revision = 0; lineageId = lineage ?? Guid.NewGuid().ToString(); restoredSnapshotId = restored;
        string now = Now(); createdAt = Metadata(metadata, "createdAt") ?? now; modifiedAt = Metadata(metadata, "modifiedAt") ?? now;
        artwork = candidate; sourceReview = null; orphanRecords = []; artworkHistory.Clear(); artworkHistory[0] = candidate; saves.Clear(); Publish("replace");
    }
    public SaveCandidate PrepareSave(string operation)
    {
        AssertLane(); if (proofOnly) throw new WorkspaceException("document.proof_only");
        if (operation is not ("save" or "saveAs" or "incremental" or "copy" or "recovery")) throw new WorkspaceException("document.receipt_invalid");
        foreach (var id in saves.Where(s => s.Value.Expires <= DateTimeOffset.UtcNow).Select(s => s.Key).ToArray()) saves.Remove(id);
        bool intentional = operation is not ("copy" or "recovery"); if (intentional && saves.Values.Any(s => s.Candidate.ReceiptId is not null)) throw new WorkspaceException("document.save_busy");
        string timestamp = Now(); object modified = operation == "recovery" ? modifiedAt : timestamp;
        var envelope = NativeDocument.Serialize(Session, JsonSerializer.SerializeToElement(new { now = timestamp, createdAt, modifiedAt = modified, renderAssets = artwork.Values.Select(a => a.Record).Concat(orphanRecords) }));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(envelope); if (bytes.LongLength > NativeDocument.MaximumBytes) throw new WorkspaceException("document.budget");
        var identity = new SaveIdentity(lineageId, documentToken, revision, Session.State().CurrentRevision, Guid.NewGuid().ToString(), timestamp, Project.GetProperty("displayName").GetString()!);
        var candidate = new SaveCandidate(Guid.NewGuid().ToString(), intentional ? Guid.NewGuid().ToString() : null, operation, identity, bytes); saves[candidate.Id] = (candidate, modified, DateTimeOffset.UtcNow.AddMinutes(1)); return candidate;
    }
    public SaveCleanup AcknowledgeSave(string receiptId)
    {
        AssertLane();
        var receipt = saves.Values.FirstOrDefault(s => s.Candidate.ReceiptId == receiptId);
        if (receipt.Candidate is null || receipt.Expires <= DateTimeOffset.UtcNow || receipt.Candidate.Identity.DocumentToken != documentToken) throw new WorkspaceException("document.receipt_invalid");
        Check(Session.MarkSaved(receipt.Candidate.Identity.EditorRevision)); modifiedAt = receipt.ModifiedAt; saves.Remove(receipt.Candidate.Id);
        var cleanup = new SaveCleanup(lineageId, documentToken, receipt.Candidate.Identity.Revision, restoredSnapshotId); restoredSnapshotId = null; return cleanup;
    }
    public SaveCandidate GetSave(string id, string token) { AssertLane(); if (token != documentToken || !saves.TryGetValue(id, out var entry) || entry.Expires <= DateTimeOffset.UtcNow) throw new WorkspaceException("document.receipt_invalid"); return entry.Candidate; }
    public void ReleaseSave(string id) { AssertLane(); saves.Remove(id); }
    private static string Now() => DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
    private static object? Metadata(JsonElement? value, string key) => value is { } m && m.ValueKind == JsonValueKind.Object && m.TryGetProperty(key, out var p) && p.ValueKind is JsonValueKind.String or JsonValueKind.Number ? p.Clone() : null;
    private static JsonElement Parse(string text) { using var doc = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 4096 }); return doc.RootElement.Clone(); }
    private static IReadOnlyDictionary<string, WorkspaceArtwork> EmptyArtwork() => new ReadOnlyDictionary<string, WorkspaceArtwork>(new Dictionary<string, WorkspaceArtwork>());
    private static IReadOnlyDictionary<string, WorkspaceArtwork> ReadArtwork(JsonElement project, JsonElement records, long liveBytes, CancellationToken token)
    {
        if (records.ValueKind != JsonValueKind.Array || records.GetArrayLength() > 4096) throw new WorkspaceException("document.artwork_invalid");
        var result = new Dictionary<string, WorkspaceArtwork>(); var nodes = project.GetProperty("scene").GetProperty("nodes"); long budget = liveBytes;
        foreach (var record in records.EnumerateArray())
        {
            token.ThrowIfCancellationRequested(); if (record.ValueKind != JsonValueKind.Object || !record.TryGetProperty("nodeId", out var id) || id.ValueKind != JsonValueKind.String || !nodes.TryGetProperty(id.GetString()!, out _)) continue; string nodeId = id.GetString()!;
            int width = record.GetProperty("width").GetInt32(), height = record.GetProperty("height").GetInt32(); RasterCodec.Dimensions(width, height);
            if ((budget += (long)width * height * 16) > 512L * 1024 * 1024 || result.ContainsKey(nodeId)) throw new WorkspaceException("document.artwork_invalid");
            string url = record.GetProperty("dataUrl").GetString()!; if (!Regex.IsMatch(url, "^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$")) throw new WorkspaceException("document.artwork_invalid");
            var rgba = RasterCodec.DecodePng(Convert.FromBase64String(url[22..]), width, height); double left = Bound(record, "left", 0), top = Bound(record, "top", 0); _ = Bound(record, "right", width); _ = Bound(record, "bottom", height);
            result.Add(nodeId, new(Guid.NewGuid().ToString(), nodeId, record.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString()! : nodeId, width, height, left, top, rgba, record.Clone()));
        }
        return new ReadOnlyDictionary<string, WorkspaceArtwork>(result);
    }
    private static double Bound(JsonElement v, string key, double fallback) { double n = v.TryGetProperty(key, out var p) ? p.GetDouble() : fallback; if (!double.IsFinite(n)) throw new WorkspaceException("document.artwork_invalid"); return n; }
    private void CheckArtworkBudget(IReadOnlyDictionary<string, WorkspaceArtwork> candidate)
    {
        AssertLane(); long retained = artworkHistory.Values.SelectMany(a => a.Values).DistinctBy(a => a.Id).Sum(a => (long)a.Rgba.Length);
        if (retained + candidate.Values.Sum(a => (long)a.Rgba.Length * 4) > 512L * 1024 * 1024) throw new WorkspaceException("document.artwork_invalid");
    }
    private static IReadOnlyDictionary<string, WorkspaceArtwork> BuildSourceArtwork(JsonElement project, JsonElement bindings, DecodedSource decoded, string kind, CancellationToken token)
    {
        var result = new Dictionary<string, WorkspaceArtwork>(); var nodes = project.GetProperty("scene").GetProperty("nodes");
        var clipping = new Dictionary<string, bool>();
        if (kind == "psd")
        {
            var pending = new Stack<JsonElement>(); pending.Push(decoded.Description);
            while (pending.TryPop(out var layer))
            {
                if (layer.TryGetProperty("children", out var children)) foreach (var child in children.EnumerateArray()) pending.Push(child);
                if (layer.TryGetProperty("image", out var image)) clipping[image.GetProperty("id").GetString()!] = layer.TryGetProperty("clipping", out var flag) && flag.ValueKind == JsonValueKind.True;
            }
        }
        foreach (var binding in bindings.EnumerateArray())
        {
            token.ThrowIfCancellationRequested(); string nodeId = binding.GetProperty("nodeId").GetString()!, imageId = binding.GetProperty(kind == "psd" ? "imageId" : "layerId").GetString()!; var image = decoded.Images[imageId]; var node = nodes.GetProperty(nodeId); double left = Bound(binding, "left", 0), top = Bound(binding, "top", 0);
            bool visible = node.GetProperty("visible").GetBoolean(); double opacity = node.GetProperty("opacity").GetDouble();
            var parent = node; while (parent.TryGetProperty("parentId", out var parentId) && parentId.ValueKind == JsonValueKind.String) { parent = nodes.GetProperty(parentId.GetString()!); visible &= parent.GetProperty("visible").GetBoolean(); opacity *= parent.GetProperty("opacity").GetDouble(); }
            var record = JsonSerializer.SerializeToElement(new { nodeId, name = node.GetProperty("displayName").GetString(), sourceKey = binding.GetProperty("sourceKey").GetString(), path = node.GetProperty("sourceRef").GetProperty("path").GetString(), hidden = !visible, opacity, blendMode = node.GetProperty("blendMode").GetString(), width = image.Width, height = image.Height, left, top, right = left + image.Width, bottom = top + image.Height, rasterFingerprint = node.GetProperty("sourceRef").TryGetProperty("rasterFingerprint", out var fingerprint) ? fingerprint : default(JsonElement?), dataUrl = "data:image/png;base64," + Convert.ToBase64String(RasterCodec.EncodePng(image)) });
            var fields = record.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value.Clone());
            if (kind == "psd") fields["clipping"] = clipping.GetValueOrDefault(imageId);
            else { var provenance = node.GetProperty("sourceRef").GetProperty("cutwork"); fields["cutworkLayerId"] = provenance.GetProperty("layerId"); fields["cutworkLayerKind"] = provenance.GetProperty("layerKind"); fields["semanticName"] = provenance.GetProperty("semanticName"); }
            record = JsonSerializer.SerializeToElement(fields);
            result.Add(nodeId, new(Guid.NewGuid().ToString(), nodeId, node.GetProperty("displayName").GetString()!, image.Width, image.Height, left, top, image.Rgba, record));
        }
        return new ReadOnlyDictionary<string, WorkspaceArtwork>(result);
    }
    public async ValueTask DisposeAsync()
    {
        await lane.WaitAsync().ConfigureAwait(false); try { if (disposed) return; disposed = true; session?.Dispose(); session = null; artwork = EmptyArtwork(); artworkHistory.Clear(); saves.Clear(); } finally { lane.Release(); }
    }
}
