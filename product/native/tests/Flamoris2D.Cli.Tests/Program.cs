using System.Buffers.Binary;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Flamoris.Flamoris2D.Session;
using Flamoris.Flamoris2D.Source;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

static void Check(bool value, string message) { if (!value) throw new Exception(message); }
static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
var cli = Path.GetFullPath(args[0]);
var fixture = Path.GetFullPath(args[1]);
var sourceHash = SHA256.HashData(File.ReadAllBytes(fixture));
var folder = Path.Combine(Path.GetTempPath(), "flamoris2d-cli-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
var source = Path.Combine(folder, "animated.fl2d");
var state = Path.Combine(folder, "workspace");
var dotnet = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? Environment.ProcessPath!;

async Task<(int Exit, string Output, string Error)> Run(params string[] arguments)
{
    var start = new ProcessStartInfo(dotnet) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
    start.ArgumentList.Add(cli); foreach (var arg in arguments) start.ArgumentList.Add(arg);
    using var p = Process.Start(start)!;
    p.StandardInput.Close();
    var stdout = p.StandardOutput.ReadToEndAsync(); var stderr = p.StandardError.ReadToEndAsync();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
    try { await p.WaitForExitAsync(timeout.Token); } catch { p.Kill(true); throw; }
    return (p.ExitCode, await stdout, await stderr);
}
Task<McpClient> Connect(string permission = "edit") => McpClient.CreateAsync(new StdioClientTransport(new()
{
    Command = dotnet, Arguments = [cli, "mcp", source, "--workspace", state, "--permission", permission],
    ShutdownTimeout = TimeSpan.FromSeconds(5)
}), new() { ProtocolVersion = "2026-07-28" }, cancellationToken: new CancellationTokenSource(TimeSpan.FromSeconds(20)).Token);
static async Task<JsonElement> Context(McpClient client) => (await client.CallToolAsync("mcp.context")).StructuredContent!.Value;
static Dictionary<string, object?> Input(object input, JsonElement? context = null) => context is { } c ? new()
{
    ["input"] = input, ["guard"] = new { runtimeId = c.GetProperty("runtimeId").GetString(),
        documentToken = c.GetProperty("documentToken").GetString(), expectedRevision = c.GetProperty("revision").GetString() }
} : new() { ["input"] = input };
static JsonElement Result(CallToolResult response)
{
    Check(response.IsError != true, response.StructuredContent?.GetRawText() ?? "MCP operation failed");
    return response.StructuredContent!.Value;
}
static byte[] Image(CallToolResult response)
{
    Result(response);
    var image = response.Content.OfType<ImageContentBlock>().Single();
    Check(image.MimeType == "image/png", "Preview is not a PNG");
    return image.DecodedData.ToArray();
}
static byte[] Pixels(byte[] png)
{
    var width = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16));
    var height = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20));
    return RasterCodec.DecodePng(png, width, height);
}

try
{
    // Ordinary native authoring builds a moving, source-independent fixture; no test-only Product behavior.
    string sequence;
    await using (var workspace = new NativeWorkspace())
    {
        await workspace.ImportAsync(File.ReadAllBytes(fixture), "flimg", "cutwork-current-v3.flimg");
        sequence = await workspace.InvokeAsync(w =>
        {
            var art = w.Project.GetProperty("keyArts")[0].GetProperty("id").GetString()!;
            var node = w.Artwork.Values.First(a => w.Query("scene.get_node", Json(new { nodeId = a.NodeId })).GetProperty("effectiveVisible").GetBoolean()).NodeId;
            var created = w.ExecutePlan(w.CompileTimeline(Json(new { }), "sequence.create", Json(new { displayName = "CPU motion", durationSeconds = 2, keyArtId = art })));
            var id = created.GetProperty("sequenceId").GetString()!;
            var clip = w.ExecutePlan(w.CompileTimeline(Json(new { }), "clip.create", Json(new { displayName = "Move", durationSeconds = 2, defaultLoopMode = "once" }))).GetProperty("clipId").GetString()!;
            var track = w.ExecutePlan(w.CompileTimeline(Json(new { clipId = clip }), "track.add", Json(new { kind = "TransformTrack", target = new { nodeId = node, coordinateSpace = "node-local" } }))).GetProperty("trackId").GetString()!;
            foreach (var (ticks, value) in new[] { (0, 0), (240000, 3) })
                w.ExecutePlan(w.CompileTimeline(Json(new { clipId = clip, trackId = track, channel = "positionX" }), "key.add", Json(new { trackId = track, channel = "positionX", timeTicks = ticks, value })));
            w.ExecutePlan(w.CompileTimeline(Json(new { sequenceId = id, clipId = clip }), "instance.add", Json(new { clipId = clip, startTicks = 0, endTicks = 240000, loopMode = "once" })));
            var saved = w.PrepareSave("copy"); File.WriteAllBytes(source, saved.Bytes.ToArray()); w.ReleaseSave(saved.Id);
            return id;
        });
    }
    var blank = Path.Combine(folder, "blank.fl2d");
    Check((await Run("new", "--output", blank)).Exit == 0, "Native blank creation failed");
    Check((await Run("inspect", blank)).Exit == 0, "Native blank reopen failed");
    Check((await Run("new", "--output", blank)).Exit != 0, "Native blank creation overwrote a file");
    var import = await Run("import", fixture, "--output", Path.Combine(folder, "imported.fl2d"));
    Check(import.Exit == 0, "Headless .flimg import failed: " + import.Error);
    Check((await Run("import", fixture, "--output", Path.Combine(folder, "imported.fl2d"))).Exit != 0, "Import overwrote an existing project");
    var inspected = await Run("inspect", Path.Combine(folder, "imported.fl2d"));
    Check(inspected.Exit == 0 && JsonDocument.Parse(inspected.Output).RootElement.GetProperty("keyArts").GetArrayLength() > 0, "Source-independent reopen failed");
    Check((await Run("inspect", source, "--unknown", "x")).Exit != 0, "Unknown CLI argument accepted");
    Check((await Run("mcp", source)).Exit == 0, "Stdio EOF did not shut down cleanly");
    var catalog = await Run("mcp-catalog");
    var tools = JsonDocument.Parse(catalog.Output).RootElement.GetProperty("tools");
    Check(catalog.Exit == 0 && tools.EnumerateArray().Any(t => t.GetProperty("name").GetString() == "cli.preview_frame"), "Hub catalog missing image tool");
    Check(tools.EnumerateArray().All(t => t.TryGetProperty("annotations", out _)), "Hub effects annotations missing");
    await using (var client = await Connect("read-only"))
    {
        var listed = await client.ListToolsAsync();
        Check(listed.Any(t => t.Name == "cli.preview_frame") && !listed.Any(t => t.Name == "cli.project_save" || t.Name.StartsWith("command.")), "Read-only discovery exposes edits");
        Check((await client.CallToolAsync("cli.project_save", Input(new { }, await Context(client)))).IsError == true, "Read-only checkpoint accepted");
        Image(await client.CallToolAsync("cli.preview_frame", Input(new { width = 64 })));
    }
    Check(!File.Exists(Path.Combine(state, "project.fl2d")), "Read-only service initialized a project");
    byte[] beforePreview;
    string jobId;
    await using (var client = await Connect())
    {
        var context = await Context(client);
        var tree = Result(await client.CallToolAsync("query.scene.get_tree", Input(new { input = new { includeHidden = true } }))).GetProperty("result");
        var node = tree.GetProperty("id").GetString()!;
        var stale = context;
        Result(await client.CallToolAsync("command.scene.rename_node", Input(new { payload = new { nodeId = node, displayName = "Saved through MCP" } }, context)));
        Check((await client.CallToolAsync("command.scene.rename_node", Input(new { payload = new { nodeId = node, displayName = "stale" } }, stale))).IsError == true, "Stale edit accepted");
        Result(await client.CallToolAsync("live.undo", Input(new { }, await Context(client))));
        Result(await client.CallToolAsync("live.redo", Input(new { }, await Context(client))));
        Check((await client.CallToolAsync("cli.preview_frame", Input(new { width = 64, path = "/etc/passwd" }))).IsError == true, "Unknown preview field accepted");
        Check((await client.CallToolAsync("cli.project_save", Input(new { path = "elsewhere" }, await Context(client)))).IsError == true, "Remote output path accepted");
        beforePreview = Image(await client.CallToolAsync("cli.preview_frame", Input(new { sequenceId = sequence, timeTicks = "0", width = 64 })));
        var later = Image(await client.CallToolAsync("cli.preview_frame", Input(new { sequenceId = sequence, timeTicks = "120000", width = 64 })));
        Check(!Pixels(beforePreview).SequenceEqual(Pixels(later)), "Animation frames are identical");
        Check(Pixels(beforePreview).Where((_, i) => i % 4 == 3).Any(a => a < 255), "Preview lost transparency");
        Result(await client.CallToolAsync("cli.project_save", Input(new { }, await Context(client))));
        var begin = Result(await client.CallToolAsync("cli.render_start", Input(new { sequenceId = sequence, width = 8, height = 6, fpsNumerator = 3, fpsDenominator = 1 }, await Context(client))));
        jobId = begin.GetProperty("jobId").GetString()!;
        JsonElement status;
        var stop = Stopwatch.StartNew();
        do
        {
            await Task.Delay(20);
            status = Result(await client.CallToolAsync("cli.render_status", Input(new { jobId })));
            Check(stop.Elapsed < TimeSpan.FromSeconds(20), "Export JOB timed out");
        } while (status.GetProperty("state").GetString() is "queued" or "running");
        Check(status.GetProperty("state").GetString() == "succeeded" && status.GetProperty("completedFrames").GetInt32() == 6, status.GetRawText());
        var directory = status.GetProperty("directory").GetString()!;
        var frames = Directory.GetFiles(directory, "frame_*.png").Order().ToArray();
        Check(frames.Length == 6 && !File.ReadAllBytes(frames.First()).SequenceEqual(File.ReadAllBytes(frames.Last())), "Exported frames do not animate");
        await Task.Delay(30);
        var busy = Result(await client.CallToolAsync("cli.render_start", Input(new { sequenceId = sequence, width = 1200, height = 900, fpsNumerator = 30 }, await Context(client)))).GetProperty("jobId").GetString()!;
        Check((await client.CallToolAsync("cli.render_start", Input(new { sequenceId = sequence, width = 8, height = 6 }, await Context(client)))).IsError == true, "Concurrent export was admitted");
        Result(await client.CallToolAsync("cli.render_cancel", Input(new { jobId = busy }, await Context(client))));
        stop.Restart();
        do { await Task.Delay(20); status = Result(await client.CallToolAsync("cli.render_status", Input(new { jobId = busy }))); Check(stop.Elapsed < TimeSpan.FromSeconds(20), "Cancellation timed out"); }
        while (status.GetProperty("state").GetString() is "queued" or "running");
        Check(status.GetProperty("state").GetString() == "cancelled", "Cancellation failed: " + status.GetRawText());
        var foreign = Path.Combine(state, "project.fl2d");
        var original = File.ReadAllBytes(foreign); File.AppendAllText(foreign, " ");
        Check((await client.CallToolAsync("cli.project_save", Input(new { }, await Context(client)))).IsError == true, "External writer conflict accepted");
        File.WriteAllBytes(foreign, original);
    }
    var interruptedId = Guid.NewGuid().ToString("N");
    var prior = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(state, "renders", jobId, "job.json")))!;
    prior["jobId"] = interruptedId; prior["state"] = "running";
    Directory.CreateDirectory(Path.Combine(state, "renders", interruptedId));
    File.WriteAllText(Path.Combine(state, "renders", interruptedId, "job.json"), prior.ToJsonString());
    await using (var client = await Connect())
    {
        var tree = Result(await client.CallToolAsync("query.scene.get_tree", Input(new { input = new { includeHidden = true } }))).GetProperty("result");
        Check(tree.GetProperty("displayName").GetString() == "Saved through MCP", "Checkpoint was not resumed");
        Check(Pixels(Image(await client.CallToolAsync("cli.preview_frame", Input(new { sequenceId = sequence, timeTicks = "0", width = 64 })))).SequenceEqual(Pixels(beforePreview)), "Restart changed rendered artwork");
        Check(Result(await client.CallToolAsync("cli.render_status", Input(new { jobId }))).GetProperty("state").GetString() == "succeeded", "Completed JOB receipt lost on restart");
        Check(Result(await client.CallToolAsync("cli.render_status", Input(new { jobId = interruptedId }))).GetProperty("state").GetString() == "interrupted", "Abandoned JOB reported as running or successful");
    }
    var preview = Path.Combine(folder, "one.png");
    Check((await Run("preview", source, "--output", preview, "--width", "64")).Exit == 0, "One-shot preview failed");
    Check((await Run("preview", source, "--output", preview)).Exit != 0, "Preview overwrote output");
    Check(SHA256.HashData(File.ReadAllBytes(fixture)).SequenceEqual(sourceHash), "Original Cutwork source changed");
    Console.WriteLine("PASS: Linux CLI import/reopen, animated RGBA PNG, official-client MCP, permissions, guards, Undo/Redo, checkpoint/restart/conflict, bounded render JOB/cancel/receipts and source preservation.");
}
finally { Directory.Delete(folder, true); }

