using System.Text.Json;
using Flamoris.Flamoris2D.Session;

namespace Flamoris.Flamoris2D.Native.Client;

public enum NativeSourceKind { Psd, Cutwork }

public sealed record DocumentIdentity(string LineageId, string DocumentToken, long Revision,
    long EditorRevision, string SnapshotId, string Timestamp, string Name);
public sealed record PreparedDocument(string Id, long ByteLength, string? ReceiptId,
    string Operation, DocumentIdentity Identity);
public sealed record RecoveryOrigin(string LineageId, string SnapshotId);
public sealed record RecoveryCleanup(string LineageId, string DocumentToken, long ThroughRevision, string? RestoredSnapshotId);

public sealed partial class NativeSessionClient
{
    public const long MaximumDocumentBytes = 128L * 1024 * 1024;
    public Task<NativeSessionResponse> NormalizePreferencesAsync(JsonElement preferences) => SendAsync("native.preferences", new { preferences }, false, true, CancellationToken.None);
    public Task<NativeSessionResponse> IncrementalNameAsync(string fileName, string[] existingFileNames, JsonElement preferences) => SendAsync("document.incrementalName", new { fileName, existingFileNames, preferences }, false, true, CancellationToken.None);
    public async Task<PreparedDocument> PrepareDocumentAsync(string operation, CancellationToken cancellationToken = default)
    {
        EnsureReady(); using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); cancellationToken = bounded.Token; var token = DocumentToken!; var revision = Revision;
        return await _workspace.InvokeAsync(w => { w.AssertCurrent(token, revision); var c = w.PrepareSave(operation); var i = c.Identity; return new PreparedDocument(c.Id, c.Bytes.Length, c.ReceiptId, c.Operation, new(i.LineageId, i.DocumentToken, i.Revision, i.EditorRevision, i.SnapshotId, i.Timestamp, i.Name)); }, cancellationToken);
    }
    public async Task DownloadDocumentAsync(PreparedDocument document, Stream destination, CancellationToken cancellationToken = default)
    {
        EnsureReady(); using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); cancellationToken = bounded.Token; if (document.ByteLength <= 0 || document.ByteLength > MaximumDocumentBytes) throw new InvalidDataException("Document limit exceeded.");
        var bytes = await _workspace.InvokeAsync(w => { var c = w.GetSave(document.Id, document.Identity.DocumentToken); if (c.Bytes.Length != document.ByteLength || c.Identity.Revision != document.Identity.Revision || c.ReceiptId != document.ReceiptId) throw new WorkspaceException("document.receipt_invalid"); return c.Bytes; }, cancellationToken);
        await destination.WriteAsync(bytes, cancellationToken); await _workspace.InvokeAsync(w => { if (w.Snapshot.DocumentToken != document.Identity.DocumentToken) throw new WorkspaceException("document.conflict"); return true; }, cancellationToken);
    }
    public Task<NativeSessionResponse> OpenDocumentAsync(Stream source, long byteLength, RecoveryOrigin? recovery = null, CancellationToken cancellationToken = default) => ReplaceFromStreamAsync(source, byteLength, recovery, null, null, cancellationToken);
    public Task<NativeSessionResponse> ImportSourceAsync(Stream source, long byteLength, NativeSourceKind kind, string fileName, CancellationToken cancellationToken = default) => ReplaceFromStreamAsync(source, byteLength, null, kind == NativeSourceKind.Psd ? "psd" : "flimg", fileName, cancellationToken);
    public Task<NativeSessionResponse> AnalyzeReimportAsync(Stream source, long byteLength, string fileName, CancellationToken cancellationToken = default) => ReplaceFromStreamAsync(source, byteLength, null, "psd", fileName, cancellationToken, true);
    public Task<NativeSessionResponse> ChangeSourceReviewAsync(string id, string rowId, string action, string? importedNodeId, long revision) => SendAsync("source.changeReview", new { id, rowId, action, importedNodeId }, true, true, CancellationToken.None, revision);
    public Task<NativeSessionResponse> ApplySourceReviewAsync(string id, long revision) => SendAsync("source.applyReview", new { id }, true, true, CancellationToken.None, revision);
    public Task<NativeSessionResponse> DiscardSourceReviewAsync(string id) => SendAsync("source.discardReview", new { id }, false, true, CancellationToken.None);
    private async Task<NativeSessionResponse> ReplaceFromStreamAsync(Stream source, long byteLength, RecoveryOrigin? recovery, string? kind, string? fileName, CancellationToken cancellationToken, bool reimport = false)
    {
        EnsureReady(); using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); cancellationToken = bounded.Token; if (byteLength <= 0 || byteLength > MaximumDocumentBytes) throw new InvalidDataException("ファイルは128 MiB以下にしてください。");
        var token = DocumentToken!; var revision = Revision; var bytes = new byte[checked((int)byteLength)]; await source.ReadExactlyAsync(bytes, cancellationToken);
        try
        {
            if (reimport) { await _workspace.InvokeAsync(w => { w.AssertCurrent(token, revision); return true; }, cancellationToken); var review = await _workspace.AnalyzeSourceAsync(bytes, fileName!, cancellationToken); return await _workspace.InvokeAsync(w => { w.AssertCurrent(token, revision); return Response(w, "source-review", review); }, cancellationToken); }
            WorkspaceSnapshot committed;
            if (kind is null) committed = await _workspace.OpenAsync(bytes, token, revision, recovery?.LineageId, recovery?.SnapshotId, cancellationToken);
            else committed = await _workspace.ImportAsync(bytes, kind, fileName!, token, revision, cancellationToken);
            return await ReplacementResponse(committed, "document-open");
        }
        catch (WorkspaceException e) { throw new NativeSessionException(e.Message, e.Code, Json(new { }), e.Code is "revision.conflict" or "document.conflict"); }
    }
    public async Task<NativeSessionResponse> AcknowledgeDocumentAsync(PreparedDocument document)
    {
        EnsureReady(); return await _workspace.InvokeAsync(w => { var c = w.AcknowledgeSave(document.ReceiptId ?? throw new WorkspaceException("document.receipt_invalid")); return Response(w, "document-saved", Json(new { cleanup = new { lineageId = c.LineageId, documentToken = c.DocumentToken, throughRevision = c.ThroughRevision, restoredSnapshotId = c.RestoredSnapshotId } })); });
    }
    public async Task ReleaseDocumentAsync(string id, string token, long revision)
    {
        if (!IsRunning) return; await _workspace.InvokeAsync(w => { if (w.Snapshot.DocumentToken == token) w.ReleaseSave(id); return true; });
    }
}
