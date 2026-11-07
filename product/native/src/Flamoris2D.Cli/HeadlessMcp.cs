using System.Text.Json;
using System.Text.Json.Serialization;
using Flamoris.Logging;
using Flamoris.Mcp.Core;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Session;

namespace Flamoris.Flamoris2D.Cli;

internal sealed record JobRequest(string JobId);

internal static class HeadlessMcp
{
    private static readonly JsonSerializerOptions DecodeOptions = new()
    {
        PropertyNameCaseInsensitive = false, PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private static T Decode<T>(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Object || input.EnumerateObject().Select(p => p.Name).Distinct().Count() != input.EnumerateObject().Count())
            throw new ArgumentException("Invalid input.");
        return JsonSerializer.Deserialize<T>(input, DecodeOptions) ?? throw new ArgumentException("Invalid input.");
    }
    internal static void ValidateExport(ExportRequest request)
    {
        if (new[] { request.SequenceId, request.TransitionId }.Count(x => !string.IsNullOrWhiteSpace(x)) != 1 ||
            request.Width is < 1 or > 4096 || request.Height is < 1 or > 4096 || (long)request.Width * request.Height > 8294400 ||
            request.FpsNumerator is < 1 or > 120000 || request.FpsDenominator is < 1 or > 120000)
            throw new CliException("render.invalid_request");
    }
    private static ExportRequest DecodeExport(JsonElement input)
    {
        var request = Decode<ExportRequest>(input);
        try { ValidateExport(request); } catch (CliException) { throw new ArgumentException("Invalid export."); }
        return request;
    }
    private static JsonElement Schema(string properties, string required = "[]") => JsonDocument.Parse(
        "{\"type\":\"object\",\"additionalProperties\":false,\"properties\":" + properties + ",\"required\":" + required + "}").RootElement.Clone();
    private static JsonElement Empty => Schema("{}");
    private static readonly JsonElement PreviewSchema = Schema("""
        {"keyArtId":{"type":"string","minLength":1},"sequenceId":{"type":"string","minLength":1},
         "transitionId":{"type":"string","minLength":1},"timeTicks":{"type":"string","pattern":"^[0-9]{1,16}$"},
         "width":{"type":"integer","minimum":1,"maximum":960}}
        """);
    private static readonly JsonElement RenderSchema = Schema("""
        {"sequenceId":{"type":"string","minLength":1},"transitionId":{"type":"string","minLength":1},
         "width":{"type":"integer","minimum":1,"maximum":4096},"height":{"type":"integer","minimum":1,"maximum":4096},
         "fpsNumerator":{"type":"integer","minimum":1,"maximum":120000},"fpsDenominator":{"type":"integer","minimum":1,"maximum":120000}}
        """, "[\"width\",\"height\"]");
    private static readonly JsonElement JobSchema = Schema("{\"jobId\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{32}$\"}}", "[\"jobId\"]");

    private const string UploadIdProperty = "\"uploadId\":{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\"}";
    private const string HashProperty = "{\"type\":\"string\",\"pattern\":\"^[0-9a-f]{64}$\"}";
    private static readonly JsonElement UploadBeginSchema = Schema("{" + UploadIdProperty + "," +
        "\"fileName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":260}," +
        "\"sizeBytes\":{\"type\":\"string\",\"pattern\":\"^[1-9][0-9]{0,7}$\"},\"sha256\":" + HashProperty + "}",
        "[\"uploadId\",\"fileName\",\"sizeBytes\",\"sha256\"]");
    private static readonly JsonElement UploadWriteSchema = Schema("{" + UploadIdProperty + "," +
        "\"offset\":{\"type\":\"string\",\"pattern\":\"^(0|[1-9][0-9]{0,7})$\"}," +
        "\"dataBase64\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":174764},\"chunkSha256\":" + HashProperty + "}",
        "[\"uploadId\",\"offset\",\"dataBase64\",\"chunkSha256\"]");
    private static readonly JsonElement UploadIdSchema = Schema("{" + UploadIdProperty + "}", "[\"uploadId\"]");
    private static readonly JsonElement UploadFinishSchema = Schema("{" + UploadIdProperty + ",\"replaceCurrent\":{\"type\":\"boolean\",\"const\":true}}",
        "[\"uploadId\",\"replaceCurrent\"]");

    private static JsonElement Translate(Func<JsonElement> action)
    {
        try { return action(); }
        catch (CliException e) { throw new McpFault(e.Message); }
        catch (McpSaveException e) { throw new McpFault(e.Message); }
        catch (WorkspaceException e) { throw new McpFault(e.Code); }
        catch (NativeQueryException) { throw new McpFault(McpErrors.InvalidRequest); }
        catch (IOException) { throw new McpFault("workspace.io_error"); }
    }

    public static IEnumerable<HostTool> ExtraTools(NativeWorkspace workspace, WorkspaceFiles files, RenderJobs jobs, SourceUploads uploads)
    {
        yield return new HostImageTool<FrameSelection>("cli.preview_frame", "Render a bounded transparent PNG through the offline CPU backend. Default target is the first Key Art; 120000 ticks/second.",
            PreviewSchema, Decode<FrameSelection>, async (context, input, token) =>
            {
                CpuFrame? frame = null;
                await context.ReadAsync(() => Translate(() =>
                {
                    frame = CpuFrames.Preview(workspace, input);
                    return JsonSerializer.SerializeToElement(new { });
                }));
                var png = await CpuFrames.PngAsync(frame!, token);
                if (png.Length > McpImage.MaximumBytes) throw new McpFault("preview.image_too_large");
                await context.BindDisclosureAsync(() => Translate(() =>
                {
                    workspace.AssertCurrent(frame!.DocumentToken, frame.Revision);
                    return JsonSerializer.SerializeToElement(new { });
                }));
                return new McpResult(JsonSerializer.SerializeToElement(new
                {
                    width = frame!.Width, height = frame.Height, backend = "cpu-offline", documentToken = frame.DocumentToken,
                    revision = frame.Revision.ToString(), timeTicks = input.TimeTicks
                })) { Image = new McpImage("image/png", png) };
            });
        yield return new HostTool<SourceUploadBegin>("cli.source_upload_begin", "Begin one bounded source upload (.flimg/PSD/PSB, max 64 MiB). Binds the current document/revision. No paths or URLs.",
            UploadBeginSchema, OperationKind.Mutation, Decode<SourceUploadBegin>, (context, input, _) => context.CommitAsync(() => Translate(() => uploads.Begin(input, workspace, files))));
        yield return new HostTool<SourceUploadWrite>("cli.source_upload_write", "Append a checked source chunk, max 128 KiB decoded. Retry the identical last chunk safely; offsets are decimal strings.",
            UploadWriteSchema, OperationKind.Mutation, Decode<SourceUploadWrite>, (context, input, _) => context.CommitAsync(() => Translate(() => uploads.Write(input, workspace))));
        yield return new HostTool<SourceUploadId>("cli.source_upload_cancel", "Discard the unfinished source upload. Does not edit the document or delete import backups.",
            UploadIdSchema, OperationKind.Mutation, Decode<SourceUploadId>, (context, input, _) => context.CommitAsync(() => Translate(() => uploads.Cancel(input.UploadId))));
        yield return new HostTool<SourceUploadFinish>("cli.source_upload_finish", "Validate uploaded artwork and replace the current document. Requires replaceCurrent=true, a clean checkpoint and no render JOB. Preserves the previous checkpoint in import-backups. Save explicitly after import; fetch mcp.context for the new guard.",
            UploadFinishSchema, OperationKind.Mutation, Decode<SourceUploadFinish>, (context, input, token) => uploads.FinishAsync(input, context, workspace, files, jobs, token));
        yield return new HostTool<JsonElement>("cli.project_save", "Atomically checkpoint this service's fixed working project, preserving the startup source. Edit permission and current guard required.",
            Empty, OperationKind.Mutation, DecodeEmpty, (context, _, token) => context.CommitAsync(() => Translate(() => files.Save(workspace, token))));
        yield return new HostTool<ExportRequest>("cli.render_start", "Start one revision-bound offline PNG export JOB into the configured workspace. Maximum 1800 frames and 512 MiB. Returns immediately.",
            RenderSchema, OperationKind.Mutation, DecodeExport, (context, input, token) => context.CommitAsync(() => Translate(() => jobs.Start(input, token))));
        yield return new HostTool<JobRequest>("cli.render_status", "Read a persisted render JOB receipt. A previous process's unfinished job is reported as interrupted.",
            JobSchema, OperationKind.Query, Decode<JobRequest>, (context, input, _) => context.ReadAsync(() => Translate(() => jobs.Status(input.JobId))), foreground: false);
        yield return new HostTool<JobRequest>("cli.render_cancel", "Request cancellation of this process's current render JOB, retaining completed PNGs.",
            JobSchema, OperationKind.Mutation, Decode<JobRequest>, (context, input, _) => context.CommitAsync(() => Translate(() => jobs.Cancel(input.JobId))));
    }

    private static JsonElement DecodeEmpty(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Object || input.EnumerateObject().Any()) throw new ArgumentException("Expected an empty object.");
        return input.Clone();
    }

    public static McpBoundary Boundary(NativeMcpHost host, IEnumerable<HostTool> additional) => new(host,
        host.Tools().Concat(additional), new McpOptions { RequestTimeoutMs = 30000, ApplicationLifetime = true },
        new McpDiagnostics(FlamorisLogger.Create(new LoggingOptions { Level = "error" })));

    public static async Task ServeAsync(NativeMcpHost host, McpBoundary boundary, McpPermission permission, string? endpoint, CancellationToken token)
    {
        var grant = await boundary.EnableAsync(permission, token);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(token);
        try
        {
            if (endpoint is not null)
            {
                var secret = Environment.GetEnvironmentVariable("FLAMORIS_HUB_CREDENTIAL");
                Environment.SetEnvironmentVariable("FLAMORIS_HUB_CREDENTIAL", null);
                if (string.IsNullOrWhiteSpace(secret)) throw new CliException("hub.credential_required");
                var provider = new HubConnectionProvider(new HubConnectionSettings(new Uri(endpoint)), boundary, grant,
                    _ => ValueTask.FromResult(secret));
                try
                {
                    await provider.StartAsync(lifetime.Token);
                    Console.WriteLine(JsonSerializer.Serialize(new { status = "started", hubConnected = false }));
                    // Match Kachinco's resident host: preserve the workspace/grant
                    // and refresh the shared provider after its bounded retry budget.
                    int elapsed = 0;
                    bool? connected = null;
                    while (true)
                    {
                        await Task.Delay(1000, lifetime.Token);
                        var status = boundary.Status.Current;
                        if (connected != status.IsGreen)
                        {
                            connected = status.IsGreen;
                            Console.WriteLine(JsonSerializer.Serialize(new { status = "connection", hubConnected = status.IsGreen, error = status.LastError }));
                        }
                        if (++elapsed >= 60)
                        {
                            elapsed = 0;
                            if (status.LastError is not null) await provider.RefreshAsync(lifetime.Token);
                        }
                    }
                }
                finally { await provider.StopAsync(CancellationToken.None); }
            }
            else
            {
                await StdioHost.RunAsync(host, boundary, grant, lifetime.Token);
            }
        }
        finally { boundary.Disable(); }
    }
}

