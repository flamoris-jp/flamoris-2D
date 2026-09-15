namespace Flamoris.Flamoris2D.ProductHost;

public sealed record LayoutRenderPreview(string KeyformId, double[] Positions);
public sealed record RigRenderPreview(RigContext Context,RigEdit Edit);

public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> ProjectRenderAsync(string? keyArtId = null, string? transitionId = null,
        string? sequenceId = null, long timeTicks = 0, CancellationToken cancellationToken = default,
        LayoutRenderPreview? layoutPreview = null, long? expectedRevision = null, PlaybackSample? playback = null, RigRenderPreview? rigPreview = null) =>
        SendAsync("render.project", new { keyArtId, transitionId, sequenceId, timeTicks,
            playback=playback is null?null:new {startTicks=playback.StartTicks,elapsedMilliseconds=playback.ElapsedMilliseconds,mode=playback.Loop?"loop":"once"},
            rigPreview=rigPreview is null?null:new {context=rigPreview.Context.Wire,tool=rigPreview.Edit.Tool,input=rigPreview.Edit.Input},
            layoutPreview = layoutPreview is null ? null : new { keyformId = layoutPreview.KeyformId, positions = layoutPreview.Positions } },
            layoutPreview is not null || rigPreview is not null, true, cancellationToken, expectedRevision);
}
