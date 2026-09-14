using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

public sealed record ProductHostHandshake(
    int ProtocolVersion,
    int ProductSchemaVersion,
    int McpSchemaVersion,
    string RuntimeVersion);

public sealed record ProductHostResponse(
    string RequestId,
    string? DocumentToken,
    long? Revision,
    JsonElement Payload);

public sealed record DocumentChangedEventArgs(
    string DocumentToken,
    long Revision,
    string Method);

public sealed record AuthorityLostEventArgs(string Reason, Exception? Error);

public sealed class ProductHostException : Exception
{
    public ProductHostException(string message, string code, JsonElement details, bool retryable)
        : base(message)
    {
        Code = code;
        Details = details;
        Retryable = retryable;
    }

    public string Code { get; }
    public JsonElement Details { get; }
    public bool Retryable { get; }
}

public sealed class StaleProjectionException : Exception
{
    public StaleProjectionException(long received, long accepted)
        : base($"Projection revision {received} is older than accepted revision {accepted}.")
    {
        ReceivedRevision = received;
        AcceptedRevision = accepted;
    }

    public long ReceivedRevision { get; }
    public long AcceptedRevision { get; }
}

public sealed class ProductCommand
{
    private ProductCommand(string type, object payload)
    {
        Type = type;
        Payload = payload;
    }

    public string Type { get; }
    public object Payload { get; }

    public static ProductCommand RenameNode(string nodeId, string displayName) =>
        new("scene.rename_node", new { nodeId, displayName });

    public static ProductCommand SetVisibility(string nodeId, bool visible) =>
        new("scene.set_visibility", new { nodeId, visible });

    public static ProductCommand SetLocked(string nodeId, bool locked) =>
        new("scene.set_locked", new { nodeId, locked });

    internal object ToWireValue() => new { type = Type, payload = Payload };
}
