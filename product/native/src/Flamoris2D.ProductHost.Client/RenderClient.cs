namespace Flamoris.Flamoris2D.ProductHost;

public sealed record LayoutRenderPreview(string KeyformId, double[] Positions);

public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> ProjectRenderAsync(string? keyArtId = null, string? transitionId = null,
        string? sequenceId = null, long timeTicks = 0, CancellationToken cancellationToken = default,
        LayoutRenderPreview? layoutPreview = null, long? expectedRevision = null) =>
        SendAsync("render.project", new { keyArtId, transitionId, sequenceId, timeTicks,
            layoutPreview = layoutPreview is null ? null : new { keyformId = layoutPreview.KeyformId, positions = layoutPreview.Positions } },
            layoutPreview is not null, true, cancellationToken, expectedRevision);
}
