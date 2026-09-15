using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

public enum NativeSourceKind { Psd, Cutwork }

public sealed record DocumentIdentity(string LineageId, string DocumentToken, long Revision,
    long EditorRevision, string SnapshotId, string Timestamp, string Name);
public sealed record PreparedDocument(string Id, long ByteLength, string? ReceiptId,
    string Operation, DocumentIdentity Identity);
public sealed record RecoveryOrigin(string LineageId, string SnapshotId);
public sealed record RecoveryCleanup(string LineageId, string DocumentToken, long ThroughRevision, string? RestoredSnapshotId);

public sealed partial class ProductHostClient
{
    public const long MaximumDocumentBytes = 128L * 1024 * 1024;
    public Task<ProductHostResponse> NormalizePreferencesAsync(JsonElement preferences)=>SendAsync("native.preferences",new {preferences},false,true,CancellationToken.None);
    public Task<ProductHostResponse> IncrementalNameAsync(string fileName,string[] existingFileNames,JsonElement preferences)=>SendAsync("document.incrementalName",new {fileName,existingFileNames,preferences},false,true,CancellationToken.None);
    private static readonly JsonSerializerOptions DocumentJson = new() { PropertyNameCaseInsensitive = true };
    private HttpRequestMessage DocumentRequest(HttpMethod method, string id, string token, long revision)
    {
        if (_bulkUrl is null || !Guid.TryParse(id, out _)) throw new InvalidOperationException("Invalid document handle.");
        var request = new HttpRequestMessage(method, new Uri(_bulkUrl, $"document/{id}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bulkSecret);
        request.Headers.Add("X-Document-Token", token);
        request.Headers.Add("X-Revision", revision.ToString(CultureInfo.InvariantCulture));
        return request;
    }
    public async Task<PreparedDocument> PrepareDocumentAsync(string operation, CancellationToken cancellationToken = default)
    {
        var r = await SendAsync("document.prepareSave", new { operation }, true, true, cancellationToken);
        return r.Payload.Deserialize<PreparedDocument>(DocumentJson) ?? throw new InvalidDataException("Invalid save receipt.");
    }
    public async Task DownloadDocumentAsync(PreparedDocument document, Stream destination, CancellationToken cancellationToken = default)
    {
        if (document.ByteLength <= 0 || document.ByteLength > MaximumDocumentBytes) throw new InvalidDataException("Document limit exceeded.");
        if (DocumentToken != document.Identity.DocumentToken) throw new InvalidOperationException("The document was replaced.");
        using var request = DocumentRequest(HttpMethod.Get, document.Id, document.Identity.DocumentToken, document.Identity.Revision);
        using var result = await RasterHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        result.EnsureSuccessStatusCode();
        if (result.Content.Headers.ContentLength != document.ByteLength ||
            !result.Headers.TryGetValues("X-Document-Token", out var tokens) || tokens.Single() != document.Identity.DocumentToken ||
            !result.Headers.TryGetValues("X-Revision", out var revisions) ||
            revisions.Single() != document.Identity.Revision.ToString(CultureInfo.InvariantCulture))
            throw new InvalidDataException("Document size or authority tags do not match.");
        await using var input = await result.Content.ReadAsStreamAsync(cancellationToken);
        var buffer = new byte[65536]; long remaining = document.ByteLength;
        while (remaining > 0)
        {
            var n = await input.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), cancellationToken);
            if (n == 0) throw new EndOfStreamException("Document transfer was truncated.");
            await destination.WriteAsync(buffer.AsMemory(0, n), cancellationToken); remaining -= n;
        }
        if (DocumentToken != document.Identity.DocumentToken) throw new InvalidOperationException("The document was replaced while saving.");
    }
    public Task<ProductHostResponse> OpenDocumentAsync(Stream source, long byteLength,
        RecoveryOrigin? recovery = null, CancellationToken cancellationToken = default) =>
        ReplaceFromStreamAsync(source, byteLength, recovery, null, null, cancellationToken);
    public Task<ProductHostResponse> ImportSourceAsync(Stream source, long byteLength, NativeSourceKind kind,
        string fileName, CancellationToken cancellationToken = default) =>
        ReplaceFromStreamAsync(source, byteLength, null, kind == NativeSourceKind.Psd ? "psd" : "flimg", fileName, cancellationToken);
    public Task<ProductHostResponse> AnalyzeReimportAsync(Stream source, long byteLength, string fileName, CancellationToken cancellationToken = default) =>
        ReplaceFromStreamAsync(source, byteLength, null, "psd", fileName, cancellationToken, reimport: true);
    public Task<ProductHostResponse> ChangeSourceReviewAsync(string id,string rowId,string action,string? importedNodeId,long revision) =>
        SendAsync("source.changeReview",new {id,rowId,action,importedNodeId},true,true,CancellationToken.None,revision);
    public Task<ProductHostResponse> ApplySourceReviewAsync(string id,long revision) =>
        SendAsync("source.applyReview",new {id},true,true,CancellationToken.None,revision);
    public Task<ProductHostResponse> DiscardSourceReviewAsync(string id) =>
        SendAsync("source.discardReview",new {id},false,true,CancellationToken.None);
    private async Task<ProductHostResponse> ReplaceFromStreamAsync(Stream source, long byteLength,
        RecoveryOrigin? recovery, string? kind, string? fileName, CancellationToken cancellationToken, bool reimport = false)
    {
        if (byteLength <= 0 || byteLength > MaximumDocumentBytes) throw new InvalidDataException("ファイルは128 MiB以下にしてください。");
        var token = DocumentToken ?? throw new InvalidOperationException("No document."); var revision = Revision;
        var reserve = await SendAsync("document.reserve", new { byteLength }, true, true, cancellationToken, revision);
        var id = reserve.Payload.GetProperty("id").GetString()!;
        try
        {
            using var request = DocumentRequest(HttpMethod.Put, id, token, revision);
            // StreamContent owns source after this operation. File/recovery callers provide a dedicated stream.
            request.Content = new StreamContent(source); request.Content.Headers.ContentLength = byteLength;
            using var result = await RasterHttp.SendAsync(request, cancellationToken); result.EnsureSuccessStatusCode();
            AssertCurrent(token, revision); cancellationToken.ThrowIfCancellationRequested();
            // Replacement cannot be abandoned after dispatch: wait for its authoritative acknowledgement.
            var jobId = Guid.NewGuid().ToString();
            using var cancellation = cancellationToken.Register(() => { if (kind is not null) _ = CancelImportAsync(jobId); });
            var response = await SendAsync(reimport ? "source.analyzeReimport" : kind is null ? "document.open" : "source.import", new { id, kind, fileName, jobId,
                recovery = recovery is null ? null : new { lineageId = recovery.LineageId, snapshotId = recovery.SnapshotId } },
                true, true, CancellationToken.None, revision, replacingDocument: !reimport);
            if (!reimport) AttachOpenedDocument(response); return response;
        }
        finally { await ReleaseDocumentAsync(id, token, revision); }
    }
    private async Task CancelImportAsync(string jobId)
    {
        try { await SendAsync("source.cancel", new { jobId }, false, true, CancellationToken.None); }
        catch { /* Cancellation also has a bounded worker lifetime. */ }
    }
    public Task<ProductHostResponse> AcknowledgeDocumentAsync(PreparedDocument document) =>
        SendAsync("document.acknowledgeSave", new { receiptId = document.ReceiptId }, false, true, CancellationToken.None);
    public async Task ReleaseDocumentAsync(string id, string token, long revision)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using var request = DocumentRequest(HttpMethod.Delete, id, token, revision);
            using var result = await RasterHttp.SendAsync(request, timeout.Token);
        }
        catch { /* The host also clears handles on replacement, timeout and exit. */ }
    }
}
