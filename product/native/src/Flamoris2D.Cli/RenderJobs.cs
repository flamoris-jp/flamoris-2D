using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Native.Client;
using Flamoris.Flamoris2D.Rendering;
using Flamoris.Flamoris2D.Session;

namespace Flamoris.Flamoris2D.Cli;

internal sealed record RenderReceipt(string JobId, string State, int CompletedFrames, int FrameCount,
    int Width, int Height, int FpsNumerator, int FpsDenominator, string DocumentToken, string Revision,
    string Directory, string? Error = null);

// A single offline export, not a second editing session or a queue. Receipts survive process exit.
internal sealed class RenderJobs(NativeWorkspace workspace, string? root) : IAsyncDisposable
{
    private const long MaximumOutputBytes = 512L * 1024 * 1024;
    private readonly object gate = new();
    private readonly CancellationTokenSource lifetime = new();
    private CancellationTokenSource? currentCancellation;
    private Task? currentTask;
    private RenderReceipt? current;
    private bool disposed;
    public Task Completion { get { lock (gate) return currentTask ?? Task.CompletedTask; } }
    public void AssertIdle() { lock (gate) if (currentTask is { IsCompleted: false }) throw new CliException("render.busy"); }
    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value, Program.JsonOptions);

    // Invoked only inside the workspace/Core commit lane.
    public JsonElement Start(ExportRequest request, CancellationToken token)
    {
        if (root is null) throw new CliException("workspace.required");
        token.ThrowIfCancellationRequested();
        var plan = workspace.ExportPlan(request.Wire());
        var count = plan.GetProperty("frameCount").GetInt32();
        if (count is < 1 or > 1800) throw new CliException("render.frame_limit");
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (currentTask is { IsCompleted: false }) throw new CliException("render.busy");
            WorkspaceFiles.RejectLink(root); Directory.CreateDirectory(root);
            var id = Guid.NewGuid().ToString("N");
            var directory = Path.Combine(root, id);
            Directory.CreateDirectory(directory);
            var state = workspace.Snapshot;
            var receipt = new RenderReceipt(id, "queued", 0, count, request.Width, request.Height,
                request.FpsNumerator, request.FpsDenominator, state.DocumentToken, state.Revision.ToString(), directory);
            try { WriteReceipt(receipt); }
            catch { Directory.Delete(directory); throw; }
            currentCancellation?.Dispose();
            currentCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            current = receipt;
            var jobToken = currentCancellation.Token;
            currentTask = Task.Run(() => RunAsync(receipt, request, state.Revision, jobToken));
            return Json(receipt);
        }
    }

    public JsonElement Status(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _) || root is null) throw new CliException("render.unknown_job");
        lock (gate)
        {
            if (current?.JobId == id) return Json(current);
            var path = Path.Combine(root, id, "job.json");
            if (!File.Exists(path)) throw new CliException("render.unknown_job");
            WorkspaceFiles.RejectLink(path);
            var receipt = JsonSerializer.Deserialize<RenderReceipt>(WorkspaceFiles.ReadBounded(path, 65536), Program.JsonOptions)
                ?? throw new CliException("render.invalid_receipt");
            if (receipt.JobId != id) throw new CliException("render.invalid_receipt");
            // A nonterminal receipt from another process cannot still be running here.
            if (receipt.State is "queued" or "running") receipt = receipt with { State = "interrupted", Error = "render.process_stopped" };
            return Json(receipt);
        }
    }

    public JsonElement Cancel(string id)
    {
        lock (gate)
        {
            if (current?.JobId != id) throw new CliException("render.unknown_job");
            currentCancellation?.Cancel();
            return Json(new { jobId = id, cancellationRequested = true });
        }
    }

    private void Progress(RenderReceipt receipt)
    {
        lock (gate) { WriteReceipt(receipt); current = receipt; }
    }
    private static void WriteReceipt(RenderReceipt receipt)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(receipt, Program.JsonOptions);
        var path = Path.Combine(receipt.Directory, "job.json");
        WorkspaceFiles.RejectLink(path);
        AtomicDocumentFile.WriteAsync(path, (s, ct) => s.WriteAsync(bytes, ct).AsTask()).GetAwaiter().GetResult();
    }

    private async Task RunAsync(RenderReceipt receipt, ExportRequest request, long revision, CancellationToken token)
    {
        long writtenBytes = 0;
        IReadOnlyDictionary<string, RenderTexture>? textures = null;
        try
        {
            receipt = receipt with { State = "running" }; Progress(receipt);
            for (var i = 0; i < receipt.FrameCount; i++)
            {
                token.ThrowIfCancellationRequested();
                var frame = await workspace.InvokeAsync(w => CpuFrames.Export(w, request, i, receipt.DocumentToken, revision, textures), token);
                textures = frame.Textures;
                var png = await CpuFrames.PngAsync(frame, token);
                if (writtenBytes + png.LongLength > MaximumOutputBytes) throw new CliException("render.output_limit");
                await workspace.InvokeAsync(w => { w.AssertCurrent(receipt.DocumentToken, revision); return true; }, token);
                var path = Path.Combine(receipt.Directory, $"frame_{i + 1:D6}.png");
                WorkspaceFiles.RejectLink(path);
                await AtomicDocumentFile.WriteAsync(path, (s, ct) => s.WriteAsync(png, ct).AsTask(), false, token);
                writtenBytes += png.LongLength;
                receipt = receipt with { CompletedFrames = i + 1 }; Progress(receipt);
            }
            await workspace.InvokeAsync(w => { w.AssertCurrent(receipt.DocumentToken, revision); return true; }, token);
            receipt = receipt with { State = "succeeded" };
        }
        catch (OperationCanceledException) { receipt = receipt with { State = "cancelled", Error = "cancelled" }; }
        catch (Exception error)
        {
            var code = error switch
            {
                CliException => error.Message, WorkspaceException e => e.Code,
                NativeQueryException => "render.invalid_plan", IOException => "render.io_error", _ => "render.failed"
            };
            receipt = receipt with { State = "failed", Error = code };
        }
        // Keep status observable even if durable receipt writing itself fails.
        try { Progress(receipt); }
        catch { lock (gate) current = receipt with { State = "failed", Error = "render.receipt_write_failed" }; }
    }

    public async ValueTask DisposeAsync()
    {
        Task? running;
        lock (gate) { disposed = true; lifetime.Cancel(); running = currentTask; }
        if (running is not null) await running;
        currentCancellation?.Dispose(); lifetime.Dispose();
    }
}

