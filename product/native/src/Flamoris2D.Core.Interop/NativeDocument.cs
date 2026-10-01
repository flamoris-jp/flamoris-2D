using System.Text;
using System.Text.Json;

namespace Flamoris.Flamoris2D.Core.Interop;

public sealed class NativeDocumentException(string code, JsonElement details) : Exception(code)
{
    public string Code { get; } = code;
    public JsonElement Details { get; } = details;
}

// Immutable interchange projections. Project validation/migration/serialization
// stays in C++; this adapter never modifies a Project or owns a history.
public static class NativeDocument
{
    public const uint MaximumBytes = 128 * 1024 * 1024;
    private delegate NativeStatus ReadDocument(byte[]? output, uint capacity, out uint required);
    private static JsonElement Read(ReadDocument read)
    {
        var status = read(null, 0, out var length);
        if (status != NativeStatus.BufferTooSmall || length == 0 || length > MaximumBytes + 1)
            throw new InvalidDataException($"Native document sizing failed: {status}");
        var buffer = new byte[length];
        status = read(buffer, length, out var copied);
        if (status != NativeStatus.Ok || copied != length || buffer[^1] != 0)
            throw new InvalidDataException($"Native document read failed: {status}");
        using var json = JsonDocument.Parse(new UTF8Encoding(false, true).GetString(buffer, 0, buffer.Length - 1),
            new JsonDocumentOptions { MaxDepth = 4096 });
        if (json.RootElement.TryGetProperty("error", out var error))
            throw new NativeDocumentException(error.GetProperty("code").GetString()!, error.GetProperty("details").Clone());
        return json.RootElement.GetProperty("value").Clone();
    }
    public static JsonElement Parse(byte[] input)
    {
        ArgumentNullException.ThrowIfNull(input);
        return Read((byte[]? b, uint c, out uint r) => NativeMethods.DocumentParse(input, checked((uint)input.Length), b, c, out r));
    }
    public static JsonElement SourceProject(JsonElement request)
    {
        var input = JsonSerializer.SerializeToUtf8Bytes(request);
        return Read((byte[]? b, uint c, out uint r) => NativeMethods.SourceProject(input, checked((uint)input.Length), b, c, out r));
    }
    public static JsonElement Serialize(NativeSession session, JsonElement options)
    {
        ArgumentNullException.ThrowIfNull(session);
        if (session.IsClosed || session.IsInvalid) throw new ObjectDisposedException(nameof(NativeSession));
        if (options.ValueKind != JsonValueKind.Object) throw new ArgumentException("Document options must be an object.", nameof(options));
        var input = JsonSerializer.SerializeToUtf8Bytes(options);
        return Read((byte[]? b, uint c, out uint r) => NativeMethods.SessionDocument(session, input, checked((uint)input.Length), b, c, out r));
    }
}
