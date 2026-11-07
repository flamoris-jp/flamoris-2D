using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Flamoris.Mcp.Core;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Session;
using Flamoris.Flamoris2D.Source;

namespace Flamoris.Flamoris2D.Cli;

internal sealed record SourceUploadBegin(string UploadId, string FileName, string SizeBytes, string Sha256);
internal sealed record SourceUploadWrite(string UploadId, string Offset, string DataBase64, string ChunkSha256);
internal sealed record SourceUploadId(string UploadId);
internal sealed record SourceUploadFinish(string UploadId, bool ReplaceCurrent);

// One bounded, process-local source transfer. All mutable access uses the
// workspace/Core lane. Preparation has no effect on the target document.
internal sealed class SourceUploads : IDisposable
{
    private const int MaximumBytes = 64 * 1024 * 1024;
    private const int MaximumChunk = 128 * 1024;
    private sealed class Upload(SourceUploadBegin request, string kind, int size, WorkspaceSnapshot snapshot) : IDisposable
    {
        public SourceUploadBegin Request { get; } = request;
        public string Kind { get; } = kind;
        public int Size { get; } = size;
        public WorkspaceSnapshot Snapshot { get; } = snapshot;
        public MemoryStream Bytes { get; } = new();
        public bool Finishing { get; set; }
        public int LastOffset { get; set; } = -1;
        public int LastLength { get; set; }
        public string? LastHash { get; set; }
        public void Dispose() => Bytes.Dispose();
    }
    private Upload? pending;
    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value, Program.JsonOptions);
    private static void Id(string id)
    {
        if (!Guid.TryParseExact(id, "D", out var guid) || guid.ToString("D") != id) throw new CliException("source.invalid_upload_id");
    }
    private static bool Hash(string? value) => value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static int Number(string? text, int maximum)
    {
        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n < 0 || n > maximum || n.ToString(CultureInfo.InvariantCulture) != text)
            throw new CliException("source.invalid_size_or_offset");
        return n;
    }
    private Upload Get(string id)
    {
        Id(id);
        if (pending is null || pending.Request.UploadId != id) throw new CliException("source.unknown_upload");
        return pending;
    }
    private static JsonElement Status(Upload upload) => Json(new { uploadId = upload.Request.UploadId, receivedBytes = upload.Bytes.Length.ToString(CultureInfo.InvariantCulture), sizeBytes = upload.Request.SizeBytes });

    public JsonElement Begin(SourceUploadBegin request, NativeWorkspace workspace, WorkspaceFiles files)
    {
        Id(request.UploadId);
        if (files.ProjectPath is null) throw new CliException("workspace.required");
        var size = Number(request.SizeBytes, MaximumBytes);
        if (size == 0 || !Hash(request.Sha256)) throw new CliException("source.invalid_upload");
        if (string.IsNullOrWhiteSpace(request.FileName) || request.FileName.Length > 260 || request.FileName.Any(c => c < 32 || c == 127 || c is '/' or '\\' or ':'))
            throw new CliException("source.filename_invalid");
        var kind = Path.GetExtension(request.FileName).ToLowerInvariant() switch
        {
            ".flimg" => "flimg", ".psd" or ".psb" => "psd", _ => throw new CliException("source.unsupported_format")
        };
        if (pending is { } existing)
        {
            if (existing.Request != request) throw new CliException("source.upload_busy");
            workspace.AssertCurrent(existing.Snapshot.DocumentToken, existing.Snapshot.Revision);
            if (existing.Finishing) throw new CliException("source.upload_busy");
            return Status(existing);
        }
        pending = new(request, kind, size, workspace.Snapshot);
        return Status(pending);
    }

    public JsonElement Write(SourceUploadWrite request, NativeWorkspace workspace)
    {
        var upload = Get(request.UploadId);
        workspace.AssertCurrent(upload.Snapshot.DocumentToken, upload.Snapshot.Revision);
        if (upload.Finishing) throw new CliException("source.upload_busy");
        var offset = Number(request.Offset, MaximumBytes);
        if (!Hash(request.ChunkSha256) || request.DataBase64 is not { Length: > 0 and <= 174764 }) throw new CliException("source.invalid_chunk");
        byte[] chunk;
        try { chunk = Convert.FromBase64String(request.DataBase64); }
        catch (FormatException) { throw new CliException("source.invalid_chunk"); }
        if (chunk.Length is < 1 or > MaximumChunk || Convert.ToHexStringLower(SHA256.HashData(chunk)) != request.ChunkSha256)
            throw new CliException("source.chunk_checksum_mismatch");
        if (offset == upload.LastOffset && chunk.Length == upload.LastLength && request.ChunkSha256 == upload.LastHash) return Status(upload);
        if (offset != upload.Bytes.Length || (long)offset + chunk.Length > upload.Size) throw new CliException("source.offset_mismatch");
        upload.Bytes.Write(chunk);
        upload.LastOffset = offset; upload.LastLength = chunk.Length; upload.LastHash = request.ChunkSha256;
        return Status(upload);
    }

    public JsonElement Cancel(string id)
    {
        var upload = Get(id);
        if (upload.Finishing) throw new CliException("source.upload_busy");
        pending = null; upload.Dispose();
        return Json(new { uploadId = id, cancelled = true });
    }

    public async Task<JsonElement> FinishAsync(SourceUploadFinish request, RequestContext context, NativeWorkspace workspace, WorkspaceFiles files, RenderJobs jobs, CancellationToken token)
    {
        Upload? upload = null;
        byte[]? bytes = null;
        await context.ReadAsync(() => Translate(() =>
        {
            var selected = Get(request.UploadId);
            if (!request.ReplaceCurrent) throw new CliException("source.replacement_required");
            workspace.AssertCurrent(selected.Snapshot.DocumentToken, selected.Snapshot.Revision);
            jobs.AssertIdle();
            if (workspace.Snapshot.State.Dirty != 0) throw new CliException("source.unsaved_changes");
            if (selected.Finishing) throw new CliException("source.upload_busy");
            if (selected.Bytes.Length != selected.Size) throw new CliException("source.incomplete_upload");
            var buffer = selected.Bytes.GetBuffer().AsSpan(0, selected.Size);
            if (Convert.ToHexStringLower(SHA256.HashData(buffer)) != selected.Request.Sha256) throw new CliException("source.checksum_mismatch");
            bytes = selected.Bytes.ToArray(); selected.Finishing = true; upload = selected;
            return Status(selected);
        }));
        try
        {
            SourceImportCandidate candidate;
            try { candidate = await NativeWorkspace.PrepareSourceImportAsync(bytes!, upload!.Kind, upload.Request.FileName, token); }
            catch (SourceDecodeException e) { throw new McpFault(e.Code); }
            catch (WorkspaceException e) { throw new McpFault(e.Code); }
            catch (NativeQueryException) { throw new McpFault("source.invalid_project"); }
            return await context.CommitAsync(() => Translate(() =>
            {
                workspace.AssertCurrent(upload!.Snapshot.DocumentToken, upload.Snapshot.Revision);
                jobs.AssertIdle();
                var backup = files.BackupForImport(workspace, upload.Request.UploadId, token);
                var snapshot = workspace.CommitSourceImport(candidate, upload.Snapshot.DocumentToken, upload.Snapshot.Revision, token);
                pending = null; upload.Dispose();
                return Json(new { imported = true, uploadId = request.UploadId, fileName = upload.Request.FileName,
                    documentToken = snapshot.DocumentToken, revision = snapshot.Revision.ToString(CultureInfo.InvariantCulture), backupFile = backup, checkpointRequired = true });
            }));
        }
        finally
        {
            // Only release this transfer's in-flight marker. Native document state
            // is never changed outside the guarded commit above.
            await workspace.InvokeAsync(_ => { if (ReferenceEquals(pending, upload)) upload!.Finishing = false; return true; });
        }
    }

    private static JsonElement Translate(Func<JsonElement> action)
    {
        try { return action(); }
        catch (CliException e) { throw new McpFault(e.Message); }
        catch (McpSaveException e) { throw new McpFault(e.Message); }
        catch (WorkspaceException e) { throw new McpFault(e.Code); }
        catch (IOException) { throw new McpFault("workspace.io_error"); }
        catch (UnauthorizedAccessException) { throw new McpFault("workspace.access_denied"); }
    }
    public void Dispose() { pending?.Dispose(); pending = null; }
}
