using System.Text.Json;
using Flamoris.Flamoris2D.Session;

namespace Flamoris.Flamoris2D.Native.Client;

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

public sealed partial class NativeSessionClient
{
    private sealed record UploadedRaster(HandsOnArtwork Image, string Token, long Revision, DateTimeOffset Expires);
    private readonly Dictionary<string, UploadedRaster> _uploaded = [];
    public void AssertCurrent(string token, long revision)
    {
        if (!HasAuthoritativeProjection || DocumentToken != token || Revision != revision) throw new StaleProjectionException(revision, Revision);
    }
    public async Task<string> UploadRasterAsync(int width, int height, string name, byte[] bgra, CancellationToken cancellationToken = default)
    {
        EnsureReady(); using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); cancellationToken = bounded.Token; if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || (long)width * height > 4194304 || bgra.LongLength != (long)width * height * 4) throw new ArgumentException("Artwork exceeds the hands-on raster limit.");
        var token = DocumentToken!; var revision = Revision; var rgba = bgra.ToArray(); for (int i = 0; i < rgba.Length; i += 4) (rgba[i], rgba[i + 2]) = (rgba[i + 2], rgba[i]);
        return await _workspace.InvokeAsync(w =>
        {
            EnsureReady(); w.AssertCurrent(token, revision); foreach (var id in _uploaded.Where(x => x.Value.Expires <= DateTimeOffset.UtcNow).Select(x => x.Key).ToArray()) _uploaded.Remove(id);
            if (_uploaded.Count >= 16 || _uploaded.Values.Sum(a => (long)a.Image.Rgba.Length) + rgba.Length > 256L * 1024 * 1024) throw new ArgumentException("Artwork upload budget exceeded.");
            var asset = Guid.NewGuid().ToString(); _uploaded[asset] = new(new(asset, name, width, height, rgba), token, revision, DateTimeOffset.UtcNow.AddMinutes(2)); return asset;
        }, cancellationToken);
    }
    public async Task ReleaseRasterAsync(string id, string token, long revision)
    {
        if (!IsRunning) return; await _workspace.InvokeAsync(w => { if (_uploaded.TryGetValue(id, out var upload) && upload.Token == token && upload.Revision == revision) _uploaded.Remove(id); return true; });
    }
    public async Task<byte[]> DownloadRasterAsync(string id, int byteLength, string token, long revision, CancellationToken cancellationToken = default)
    {
        EnsureReady(); using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); cancellationToken = bounded.Token; if (byteLength <= 0 || byteLength > 512 * 1024 * 1024) throw new ArgumentOutOfRangeException(nameof(byteLength));
        var rgba = await _workspace.InvokeAsync(w => { w.AssertCurrent(token, revision); var image = w.Artwork.Values.FirstOrDefault(a => a.Id == id) ?? throw new WorkspaceException("asset.required"); if (image.Rgba.Length != byteLength) throw new InvalidDataException("Raster size differs."); return image.Rgba; }, cancellationToken);
        var bgra = rgba.ToArray(); for (int i = 0; i < bgra.Length; i += 4) (bgra[i], bgra[i + 2]) = (bgra[i + 2], bgra[i]);
        await _workspace.InvokeAsync(w => { w.AssertCurrent(token, revision); return true; }, cancellationToken); return bgra;
    }
    public async Task<NativeSessionResponse> OpenHandsOnAsync(string[] assetIds, CancellationToken cancellationToken = default)
    {
        EnsureReady(); using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token); cancellationToken = bounded.Token; var token = DocumentToken!; var revision = Revision;
        var images = await _workspace.InvokeAsync(w => { w.AssertCurrent(token, revision); if (assetIds.Length is < 1 or > 16 || assetIds.Distinct(StringComparer.Ordinal).Count() != assetIds.Length) throw new ArgumentException("Invalid artwork selection."); return assetIds.Select(id => _uploaded.TryGetValue(id, out var a) && a.Token == token && a.Revision == revision && a.Expires > DateTimeOffset.UtcNow ? a.Image : throw new WorkspaceException("asset.required")).ToArray(); }, cancellationToken);
        var committed = await _workspace.HandsOnAsync(images, token, revision, cancellationToken); return await ReplacementResponse(committed, "hands-on");
    }
    public Task<NativeSessionResponse> GetMeshAsync(string? nodeId, string? keyformId = null,
        CancellationToken cancellationToken = default, string? keyArtId = null) =>
        SendAsync("mesh.projection", new { nodeId, keyformId, keyArtId }, false, true, cancellationToken);
    public Task<NativeSessionResponse> EditMeshAsync(string nodeId, string? keyformId, MeshEdit edit,
        long revision, CancellationToken cancellationToken = default, string? keyArtId = null) =>
        SendAsync("mesh.tool", new { nodeId, keyformId, keyArtId, context = edit.Context, tool = edit.Tool, input = edit.Input },
            true, true, cancellationToken, revision);
    public async Task<NativeSessionResponse> GenerateMeshAsync(string nodeId, bool contour, int columns, int rows,
        double alphaThreshold, double density, double cornerSensitivity, double interiorDensity,
        long revision, CancellationToken cancellationToken = default)
    {
        var previewId = Guid.NewGuid().ToString();
        return await SendAsync("mesh.generatePreview", new { nodeId, previewId, kind = contour ? "contour" : "grid", columns, rows, settings = new { alphaThreshold, density, cornerSensitivity, interiorDensity } }, true, true, cancellationToken, revision);
    }
}
