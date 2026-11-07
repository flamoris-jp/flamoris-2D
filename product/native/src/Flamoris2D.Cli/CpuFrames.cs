using System.Text.Json;
using Flamoris.Flamoris2D.Rendering;
using Flamoris.Flamoris2D.Session;

namespace Flamoris.Flamoris2D.Cli;

internal sealed record FrameSelection(string? KeyArtId = null, string? SequenceId = null,
    string? TransitionId = null, string TimeTicks = "0", int Width = 640);
internal sealed record ExportRequest(string? SequenceId, string? TransitionId, int Width, int Height,
    int FpsNumerator = 30, int FpsDenominator = 1)
{
    public JsonElement Wire(int? frameIndex = null) => JsonSerializer.SerializeToElement(new
    {
        sequenceId = SequenceId, transitionId = TransitionId, width = Width, height = Height,
        frameRate = new { numerator = FpsNumerator, denominator = FpsDenominator }, video = false, frameIndex
    });
}

internal sealed record CpuFrame(JsonElement Projection, IReadOnlyDictionary<string, RenderTexture> Textures,
    string DocumentToken, long Revision, int Width, int Height);

internal static class CpuFrames
{
    private static IReadOnlyDictionary<string, RenderTexture> Textures(NativeWorkspace workspace, JsonElement projection)
    {
        var result = new Dictionary<string, RenderTexture>();
        foreach (var image in projection.GetProperty("artwork").EnumerateArray())
        {
            var nodeId = image.GetProperty("nodeId").GetString()!;
            var asset = workspace.Artwork[nodeId];
            var bgra = asset.Rgba.ToArray();
            for (var i = 0; i < bgra.Length; i += 4) (bgra[i], bgra[i + 2]) = (bgra[i + 2], bgra[i]);
            result.Add(nodeId, new(asset.Width, asset.Height, bgra));
        }
        return result;
    }

    // All geometry, camera and alpha/clipping dependencies have already been evaluated by C++.
    public static CpuFrame Preview(NativeWorkspace workspace, FrameSelection selection)
    {
        if (selection.Width is < 1 or > 960 || !long.TryParse(selection.TimeTicks, out var ticks) || ticks is < 0 or > 9007199254740991)
            throw new CliException("preview.invalid_request");
        var count = new[] { selection.KeyArtId, selection.SequenceId, selection.TransitionId }.Count(x => x is not null);
        if (count > 1) throw new CliException("preview.invalid_target");
        var keyArt = selection.KeyArtId;
        if (count == 0)
        {
            var arts = workspace.Project.GetProperty("keyArts");
            if (arts.GetArrayLength() == 0) throw new CliException("preview.target_required");
            keyArt = arts[0].GetProperty("id").GetString();
        }
        var projection = workspace.Render(keyArt, selection.TransitionId, selection.SequenceId, ticks);
        var canvas = projection.GetProperty("canvas");
        double width = canvas.GetProperty("width").GetDouble(), height = canvas.GetProperty("height").GetDouble();
        var scale = Math.Min(selection.Width / width, 960 / height);
        var outputWidth = Math.Max(1, (int)Math.Round(width * scale));
        var outputHeight = Math.Max(1, (int)Math.Round(height * scale));
        var state = workspace.Snapshot;
        return new(RenderView.Map(projection, outputWidth / width, outputHeight / height), Textures(workspace, projection),
            state.DocumentToken, state.Revision, outputWidth, outputHeight);
    }

    public static CpuFrame Export(NativeWorkspace workspace, ExportRequest request, int index,
        string documentToken, long revision, IReadOnlyDictionary<string, RenderTexture>? textures = null)
    {
        workspace.AssertCurrent(documentToken, revision);
        var projection = workspace.ExportFrame(request.Wire(index));
        var scale = projection.GetProperty("target").GetProperty("scale").GetDouble();
        var currentTextures = textures is null ? Textures(workspace, projection) : new Dictionary<string, RenderTexture>(textures);
        if (textures is not null && projection.GetProperty("artwork").EnumerateArray().Any(a => !textures.ContainsKey(a.GetProperty("nodeId").GetString()!)))
        {
            var merged = new Dictionary<string, RenderTexture>(currentTextures);
            foreach (var (id, texture) in Textures(workspace, projection)) merged.TryAdd(id, texture);
            currentTextures = merged;
        }
        return new(RenderView.Map(projection, scale, scale), currentTextures,
            documentToken, revision, request.Width, request.Height);
    }

    public static async Task<byte[]> PngAsync(CpuFrame frame, CancellationToken token)
    {
        var pixels = await Task.Run(() => EvaluatedRasterizer.Render(frame.Projection, frame.Textures, frame.Width, frame.Height, token), token);
        using var output = new MemoryStream();
        await PngFrameWriter.WriteAsync(output, frame.Width, frame.Height, pixels, token);
        return output.ToArray();
    }
}
