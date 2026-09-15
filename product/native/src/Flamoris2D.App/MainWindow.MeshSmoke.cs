using System.Diagnostics;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private async Task RunMeshSmokeAsync()
    {
        var client = _client!;
        // Procedural smoke input only; never used as bootstrap or advertised as real artwork.
        var pixels = Enumerable.Repeat((byte)255, 64 * 32 * 4).ToArray();
        var id = await client.UploadRasterAsync(64, 32, "Smoke eye", pixels);
        await client.OpenHandsOnAsync([id]);
        AttachDocumentWorkspace(client.DocumentToken!);
        await RefreshProjectionAsync();
        TargetList.SelectedItem = _targets.Targets.First(t => t.Kind == "part");
        await RefreshProjectionAsync();
        SwitchContext(EditingContext.Mesh, false);
        MeshCanvas.Fit();
        if (MeshCanvas.ActualWidth <= 0 || MeshCanvas.ActualHeight <= 0)
            throw new InvalidOperationException("WPF smoke must show and arrange the real viewport.");
        if (MeshCanvas.Artwork.Count != 1 || MeshCanvas.VertexIds.Length != 9)
            throw new InvalidOperationException("WPF artwork/initial mesh projection is missing.");
        var nodeId = MeshCanvas.NodeId;
        var positions = (double[])MeshCanvas.Positions.Clone();
        MeshCanvas.Structure = false; ConfigureMeshContext();
        if (!MeshCanvas.OverlayVisible || !MeshCanvas.MeshEnabled || GenerateOptions.Visibility != Visibility.Collapsed)
            throw new InvalidOperationException("Layout switch hid the mesh or exposed Structure generation.");
        var moved = (double[])positions.Clone(); moved[0] += 4;
        await CommitMeshAsync(MeshEdit.Move(moved), MeshCanvas.Revision);
        await client.UndoAsync(); await RefreshProjectionAsync();
        if (!MeshCanvas.Positions.SequenceEqual(positions)) throw new InvalidOperationException("Native Mesh Undo failed.");
        await client.RedoAsync(); await RefreshProjectionAsync();
        if (!MeshCanvas.Positions.SequenceEqual(moved)) throw new InvalidOperationException("Native Mesh Redo failed.");
        foreach (var context in EditingContextCatalog.All)
        {
            SwitchContext(context.Context, false);
            if (MeshCanvas.NodeId != nodeId) throw new InvalidOperationException("Workflow changed mesh target.");
        }
        SwitchContext(EditingContext.Mesh, false);
        MeshCanvas.Structure = true; ConfigureMeshContext();
        var preview = await client.GenerateMeshAsync(nodeId!, false, 3, 3, .1, .45, .65, .3, client.Revision);
        await CommitMeshAsync(MeshEdit.Generated(preview.Payload.GetProperty("candidate"), true), client.Revision);
        if (MeshCanvas.VertexIds.Length != 16) throw new InvalidOperationException("Native Grid apply failed.");
        // Diagnostic-only software render measurement. No backend decision or visual parity assertion.
        var watch = Stopwatch.StartNew();
        var bitmap = new RenderTargetBitmap(640, 360, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(MeshCanvas);
        watch.Stop();
        Console.WriteLine($"Provisional WPF smoke render: {watch.Elapsed.TotalMilliseconds:F2} ms; tier={RenderCapability.Tier >> 16}; not a renderer benchmark.");
    }
}
