namespace Flamoris.Flamoris2D.ProductHost;

public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> ProjectRenderAsync(string? keyArtId = null, string? transitionId = null,
        string? sequenceId = null, long timeTicks = 0, CancellationToken cancellationToken = default) =>
        SendAsync("render.project", new { keyArtId, transitionId, sequenceId, timeTicks }, false, true, cancellationToken);
}
