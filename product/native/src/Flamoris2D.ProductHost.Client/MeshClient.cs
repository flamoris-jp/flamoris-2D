using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

// Closed set of semantic tool intents. Product controllers compile these to existing Commands.
public sealed class MeshEdit
{
    private MeshEdit(string context, string tool, object input) => (Context, Tool, Input) = (context, tool, input);
    internal string Context { get; }
    internal string Tool { get; }
    internal object Input { get; }
    public static MeshEdit Move(double[] positions) => new("layout", "deform.move", new { positions });
    public static MeshEdit Add(double x, double y, double u, double v) =>
        new("structure", "topology.add", new { position = new { x, y }, uv = new { x = u, y = v } });
    public static MeshEdit Remove(string vertexId) => new("structure", "topology.remove", new { vertexId });
    public static MeshEdit Triangle(string[] vertexIds) => new("structure", "topology.connect", new { vertexIds });
    public static MeshEdit Subdivide(string[] vertexIds) => new("structure", "topology.subdivide", new { vertexIds });
    public static MeshEdit Label(string vertexId, string semanticLabel) =>
        new("structure", "topology.set-label", new { vertexId, semanticLabel });
    public static MeshEdit ClearLabel(string vertexId) => new("structure", "topology.clear-label", new { vertexId });
    public static MeshEdit Generated(JsonElement candidate, bool replaceExisting) =>
        new("structure", "topology.automesh", new { candidate, replaceExisting });
}

public sealed partial class ProductHostClient
{
    private Uri? _bulkUrl;
    private string? _bulkSecret;
    // No ambient proxy, redirect, cookie or generic URL capability.
    private static readonly HttpClient RasterHttp = new(new HttpClientHandler
        { UseProxy = false, AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(35) };

    private void ConfigureBulk(JsonElement handshake)
    {
        if (!handshake.TryGetProperty("bulk", out var bulk) || bulk.ValueKind == JsonValueKind.Null) return;
        var uri = new Uri(bulk.GetProperty("url").GetString()!);
        if (uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.AbsolutePath != "/" ||
            uri.Query.Length != 0 || uri.UserInfo.Length != 0)
            throw new InvalidOperationException("Invalid local raster endpoint.");
        _bulkUrl = uri;
        _bulkSecret = bulk.GetProperty("secret").GetString();
    }
    private HttpRequestMessage RasterRequest(HttpMethod method, string id, string token, long revision)
    {
        if (_bulkUrl is null || !Guid.TryParse(id, out _)) throw new InvalidOperationException("Invalid raster handle.");
        var request = new HttpRequestMessage(method, new Uri(_bulkUrl, $"raster/{id}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bulkSecret);
        request.Headers.Add("X-Document-Token", token);
        request.Headers.Add("X-Revision", revision.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return request;
    }
    public void AssertCurrent(string token, long revision)
    {
        if (!HasAuthoritativeProjection || DocumentToken != token || Revision != revision)
            throw new StaleProjectionException(revision, Revision);
    }
    public async Task<string> UploadRasterAsync(int width, int height, string name, byte[] bgra,
        CancellationToken cancellationToken = default)
    {
        if (width <= 0 || height <= 0 || width > 4096 || height > 4096 ||
            (long)width * height > 4194304 || bgra.LongLength != (long)width * height * 4)
            throw new ArgumentException("Artwork exceeds the hands-on raster limit.");
        var token = DocumentToken ?? throw new InvalidOperationException("No document.");
        var revision = Revision;
        var reserved = await SendAsync("assets.reserve", new { width, height, name }, true, true, cancellationToken, revision);
        var id = reserved.Payload.GetProperty("id").GetString()!;
        try
        {
            using var request = RasterRequest(HttpMethod.Put, id, token, revision);
            request.Content = new ByteArrayContent(bgra);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            using var result = await RasterHttp.SendAsync(request, cancellationToken);
            result.EnsureSuccessStatusCode();
            AssertCurrent(token, revision);
            return id;
        }
        catch
        {
            await ReleaseRasterAsync(id, token, revision);
            throw;
        }
    }
    public async Task ReleaseRasterAsync(string id, string token, long revision)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using var request = RasterRequest(HttpMethod.Delete, id, token, revision);
            using var result = await RasterHttp.SendAsync(request, timeout.Token);
        }
        catch { /* Host expiry/replacement also releases abandoned reservations. */ }
    }
    public async Task<byte[]> DownloadRasterAsync(string id, int byteLength, string token, long revision,
        CancellationToken cancellationToken = default)
    {
        if (byteLength <= 0 || byteLength > 512 * 1024 * 1024) throw new ArgumentOutOfRangeException(nameof(byteLength));
        AssertCurrent(token, revision);
        using var request = RasterRequest(HttpMethod.Get, id, token, revision);
        using var result = await RasterHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        result.EnsureSuccessStatusCode();
        if (result.Content.Headers.ContentLength != byteLength ||
            !result.Headers.TryGetValues("X-Document-Token", out var tokens) || tokens.Single() != token ||
            !result.Headers.TryGetValues("X-Revision", out var revisions) || revisions.Single() != revision.ToString())
            throw new InvalidDataException("Raster authority tags/size do not match.");
        var bytes = new byte[byteLength];
        await using var stream = await result.Content.ReadAsStreamAsync(cancellationToken);
        await stream.ReadExactlyAsync(bytes, cancellationToken);
        AssertCurrent(token, revision);
        return bytes;
    }
    public async Task<ProductHostResponse> OpenHandsOnAsync(string[] assetIds, CancellationToken cancellationToken = default)
    {
        var response = await SendAsync("handsOn.open", new { assetIds }, true, true,
            cancellationToken, Revision, replacingDocument: true);
        AttachOpenedDocument(response);
        return response;
    }
    public Task<ProductHostResponse> GetMeshAsync(string? nodeId, string? keyformId = null,
        CancellationToken cancellationToken = default) =>
        SendAsync("mesh.projection", new { nodeId, keyformId }, false, true, cancellationToken);
    public Task<ProductHostResponse> EditMeshAsync(string nodeId, string? keyformId, MeshEdit edit,
        long revision, CancellationToken cancellationToken = default) =>
        SendAsync("mesh.tool", new { nodeId, keyformId, context = edit.Context, tool = edit.Tool, input = edit.Input },
            true, true, cancellationToken, revision);
    public async Task<ProductHostResponse> GenerateMeshAsync(string nodeId, bool contour, int columns, int rows,
        double alphaThreshold, double density, double cornerSensitivity, double interiorDensity,
        long revision, CancellationToken cancellationToken = default)
    {
        var previewId = Guid.NewGuid().ToString();
        try
        {
            return await SendAsync("mesh.generatePreview", new { nodeId, previewId, kind = contour ? "contour" : "grid", columns, rows,
                settings = new { alphaThreshold, density, cornerSensitivity, interiorDensity } },
                true, true, cancellationToken, revision);
        }
        catch (OperationCanceledException)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await SendAsync("mesh.cancelPreview", new { previewId }, false, true, timeout.Token);
            }
            catch { /* Worker also has a hard wall-time bound. */ }
            throw;
        }
    }
}
