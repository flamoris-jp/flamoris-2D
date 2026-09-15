using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

public sealed record RecoveryMetadata(int Version, DocumentIdentity Identity, long ByteLength, string? SourcePath);
public sealed record RecoveryEntry(string Path, RecoveryMetadata? Metadata, string? Error)
{
    public string Label => Metadata is { } m ? $"{m.Identity.Name} — {m.Identity.Timestamp}" : $"読込不能: {System.IO.Path.GetFileName(Path)} ({Error})";
}

// Immutable storage envelopes, never an editable Project or another history stack.
public sealed class NativeRecoveryStore(string directory, long maximumBytes = 1024L * 1024 * 1024)
{
    private readonly string _directory = Path.GetFullPath(directory);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    public IReadOnlyList<RecoveryEntry> List()
    {
        if (!Directory.Exists(_directory)) return [];
        return Directory.EnumerateFiles(_directory, "*.recovery").Select(ReadEntry)
            .OrderByDescending(e => e.Metadata?.Identity.Timestamp, StringComparer.Ordinal).ToArray();
    }
    private static RecoveryEntry ReadEntry(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var metadata = ReadMetadata(stream);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[65536]; long remaining = metadata.ByteLength;
            while (remaining > 0)
            {
                var n = stream.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                if (n == 0) throw new EndOfStreamException();
                hash.AppendData(buffer, 0, n); remaining -= n;
            }
            var digest = new byte[32]; stream.ReadExactly(digest);
            if (!CryptographicOperations.FixedTimeEquals(digest, hash.GetHashAndReset())) throw new InvalidDataException("Checksum mismatch.");
            return new(path, metadata, null);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or ArgumentException or OverflowException)
        { return new(path, null, error.Message); }
    }
    private static RecoveryMetadata ReadMetadata(Stream stream)
    {
        Span<byte> header = stackalloc byte[4]; stream.ReadExactly(header);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length <= 0 || length > 65536) throw new InvalidDataException("Invalid Recovery metadata size.");
        var bytes = new byte[length]; stream.ReadExactly(bytes);
        var m = JsonSerializer.Deserialize<RecoveryMetadata>(bytes, Json) ?? throw new InvalidDataException("Missing Recovery metadata.");
        if (m.Version != 1 || m.Identity is null || !Guid.TryParse(m.Identity.LineageId, out _) ||
            !Guid.TryParse(m.Identity.SnapshotId, out _) || string.IsNullOrWhiteSpace(m.Identity.DocumentToken) ||
            m.Identity.Revision < 0 || m.Identity.EditorRevision < 0 ||
            !DateTimeOffset.TryParse(m.Identity.Timestamp, out _) || m.ByteLength <= 0 ||
            m.ByteLength > ProductHostClient.MaximumDocumentBytes || stream.Length != 4L + length + m.ByteLength + 32)
            throw new InvalidDataException("Unsupported or incomplete Recovery snapshot.");
        return m;
    }
    public async Task SaveAsync(PreparedDocument prepared, string? sourcePath,
        Func<Stream, CancellationToken, Task> write, CancellationToken cancellationToken = default)
    {
        if (prepared.Operation != "recovery" || prepared.ReceiptId is not null ||
            !Guid.TryParse(prepared.Identity.SnapshotId, out _) || !Guid.TryParse(prepared.Identity.LineageId, out _))
            throw new InvalidDataException("Recovery requires a Host-issued snapshot identity.");
        await _gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_directory);
            var metadata = JsonSerializer.SerializeToUtf8Bytes(new RecoveryMetadata(1, prepared.Identity, prepared.ByteLength, sourcePath));
            var used = Directory.EnumerateFiles(_directory).Sum(p => new FileInfo(p).Length);
            if (used + prepared.ByteLength + metadata.Length + 36 > maximumBytes)
                throw new IOException("復元用の空き容量が不足しています。以前の復元データは保持されています。");
            var path = Path.Combine(_directory, prepared.Identity.SnapshotId + ".recovery");
            await AtomicDocumentFile.WriteAsync(path, async (stream, ct) =>
            {
                var header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, metadata.Length);
                await stream.WriteAsync(header, ct); await stream.WriteAsync(metadata, ct);
                using var sha = SHA256.Create();
                var start = stream.Position;
                using (var hashing = new CryptoStream(stream, sha, CryptoStreamMode.Write, leaveOpen: true))
                {
                    await write(hashing, ct); hashing.FlushFinalBlock();
                }
                if (stream.Position - start != prepared.ByteLength) throw new InvalidDataException("Recovery transfer length mismatch.");
                await stream.WriteAsync(sha.Hash!, ct);
            }, overwrite: false, cancellationToken);
            // Only validated snapshots in THIS lineage, only after durable replacement.
            foreach (var old in List().Where(e => e.Metadata?.Identity.LineageId == prepared.Identity.LineageId).Skip(3))
                File.Delete(old.Path);
        }
        finally { _gate.Release(); }
    }
    public async Task CleanupAsync(RecoveryCleanup cleanup)
    {
        await _gate.WaitAsync();
        try
        {
            foreach (var e in List())
            {
                var m = e.Metadata;
                if (m?.Identity.LineageId == cleanup.LineageId &&
                    ((m.Identity.DocumentToken == cleanup.DocumentToken && m.Identity.Revision <= cleanup.ThroughRevision) ||
                     m.Identity.SnapshotId == cleanup.RestoredSnapshotId)) File.Delete(e.Path);
            }
        }
        finally { _gate.Release(); }
    }
    public async Task DiscardAsync(RecoveryEntry selected)
    {
        await _gate.WaitAsync();
        try
        {
            var path = Path.GetFullPath(selected.Path);
            if (Path.GetDirectoryName(path) != _directory || Path.GetExtension(path) != ".recovery")
                throw new InvalidDataException("Recovery selection is outside the store.");
            File.Delete(path);
        }
        finally { _gate.Release(); }
    }
    public async Task<(MemoryStream Bytes, RecoveryMetadata Metadata)> ReadAsync(RecoveryEntry selected)
    {
        await _gate.WaitAsync();
        try
        {
            var path = Path.GetFullPath(selected.Path);
            if (Path.GetDirectoryName(path) != _directory) throw new InvalidDataException("Recovery selection is outside the store.");
            using var stream = File.OpenRead(path); var metadata = ReadMetadata(stream);
            var bytes = new byte[checked((int)metadata.ByteLength)]; await stream.ReadExactlyAsync(bytes);
            var digest = new byte[32]; await stream.ReadExactlyAsync(digest);
            if (!CryptographicOperations.FixedTimeEquals(digest, SHA256.HashData(bytes)))
                throw new InvalidDataException("Recovery checksum mismatch.");
            return (new MemoryStream(bytes, writable: false), metadata);
        }
        finally { _gate.Release(); }
    }
}
