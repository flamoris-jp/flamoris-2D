using System.Globalization;
using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Native.Client;
using Flamoris.Flamoris2D.Session;
using Flamoris.Mcp.Core;
using McpPermission = Flamoris.Mcp.Core.McpPermission;

namespace Flamoris.Flamoris2D.Cli;

internal static class Program
{
    internal static readonly JsonSerializerOptions JsonOptions = new()
    { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private static void Print(object value) => Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions));

    public static async Task<int> Main(string[] args)
    {
        using var lifetime = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; lifetime.Cancel(); };
        using var term = OperatingSystem.IsLinux()
            ? System.Runtime.InteropServices.PosixSignalRegistration.Create(System.Runtime.InteropServices.PosixSignal.SIGTERM,
                context => { context.Cancel = true; lifetime.Cancel(); }) : null;
        try { return await RunAsync(args, lifetime.Token); }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { return 0; }
        catch (Exception error)
        {
            var code = error switch
            {
                CliException => error.Message, WorkspaceException e => e.Code, NativeQueryException => "product.invalid_request", McpFault e => e.Code,
                DllNotFoundException => "native.library_missing", IOException => "file.io_error",
                UnauthorizedAccessException => "file.access_denied", _ => "cli.failed"
            };
            Console.Error.WriteLine(JsonSerializer.Serialize(new { error = code, exception = error.GetType().Name, stackTrace = error.StackTrace }));
            return 1;
        }
    }

    private static async Task<int> RunAsync(string[] args, CancellationToken token)
    {
        if (args.Length == 0 || args[0] is "--help" or "help")
        {
            Console.WriteLine("""
                FLAMORIS 2D headless CLI 0.1.1 (.NET 10 / CPU offline)
                new --output NEW.fl2d
                import INPUT --output NEW.fl2d
                inspect INPUT
                preview INPUT --output NEW.png [--key-art ID | --sequence ID | --transition ID] [--time-ticks 0] [--width 640]
                render INPUT (--sequence ID | --transition ID) --output-dir NEWDIR --width W --height H [--fps 30] [--fps-denominator 1]
                mcp INPUT [--workspace DIR] [--permission read-only|edit] [--hub wss://HOST/desktop/flamoris2d-lime]
                mcp-catalog

                MCP uses stdio by default. Hub secret: FLAMORIS_HUB_CREDENTIAL (never an argument).
                Workspace resumes project.fl2d; save is explicit. Input artwork is never overwritten.
                """);
            return 0;
        }
        var command = args[0];
        var accepted = command switch
        {
            "import" or "new" => new[] { "output" }, "inspect" or "mcp-catalog" => [],
            "preview" => ["output", "key-art", "sequence", "transition", "time-ticks", "width"],
            "render" => ["output-dir", "sequence", "transition", "width", "height", "fps", "fps-denominator"],
            "mcp" => ["workspace", "permission", "hub"], _ => throw new CliException("cli.unknown_command")
        };
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        string? input = null;
        for (var i = 1; i < args.Length; i++)
        {
            var arg = args[i];
            if (!arg.StartsWith("--", StringComparison.Ordinal))
            {
                if (input is not null || command is "mcp-catalog" or "new") throw new CliException("cli.invalid_arguments");
                input = arg; continue;
            }
            var name = arg[2..];
            if (!accepted.Contains(name) || ++i >= args.Length || args[i].StartsWith("--", StringComparison.Ordinal) || !values.TryAdd(name, args[i]))
                throw new CliException("cli.invalid_arguments");
        }
        string Required(string name) => values.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value : throw new CliException("cli.required_" + name);
        string? Optional(string name) => values.GetValueOrDefault(name);
        int Number(string name, int fallback) => !values.ContainsKey(name) ? fallback :
            int.TryParse(values[name], NumberStyles.None, CultureInfo.InvariantCulture, out var value) ? value : throw new CliException("cli.invalid_" + name);
        if (command is not ("mcp-catalog" or "new") && input is null) throw new CliException("cli.input_required");
        var permission = (Optional("permission") ?? "read-only") switch
        {
            "read-only" => McpPermission.ReadOnly, "edit" => McpPermission.Edit, _ => throw new CliException("cli.invalid_permission")
        };
        await using var workspace = new NativeWorkspace();
        using var files = new WorkspaceFiles(Optional("workspace"));
        await using var jobs = new RenderJobs(workspace, files.RenderRoot);
        using var uploads = new SourceUploads();
        if (command == "mcp-catalog")
        {
            using var catalogHost = new NativeMcpHost(workspace, applicationLifetime: true);
            using var catalogBoundary = HeadlessMcp.Boundary(catalogHost, HeadlessMcp.ExtraTools(workspace, files, jobs, uploads));
            var kinds = catalogHost.Tools().Concat(HeadlessMcp.ExtraTools(workspace, files, jobs, uploads)).ToDictionary(t => t.Name, t => t.Kind);
            var descriptors = catalogBoundary.DescribeCatalog().EnumerateArray().Select(t => new
            {
                name = t.GetProperty("name").GetString(), description = t.GetProperty("description").GetString(),
                input_schema = t.GetProperty("input_schema"),
                annotations = new
                {
                    readOnlyHint = t.GetProperty("name").GetString() == "mcp.context" || kinds[t.GetProperty("name").GetString()!] == OperationKind.Query,
                    destructiveHint = t.GetProperty("name").GetString() == "cli.project_save" || t.GetProperty("name").GetString() == "cli.render_cancel" || kinds.GetValueOrDefault(t.GetProperty("name").GetString()!) != OperationKind.Query,
                    openWorldHint = false
                }
            }).ToArray();
            Print(new { id = "flamoris2d-lime", @namespace = "flamoris2d_lime", transport = "reverse-websocket", product_id = "flamoris.2d", connector_token_env = "FLAMORIS2D_LIME_CONNECTOR_TOKEN", tools = descriptors }); return 0;
        }
        var version = NativeEngine.Version();
        if (version.Major != 1 || version.Minor < 5) throw new CliException("native.abi_mismatch");
        if (command == "new")
        {
            await workspace.NewAsync("LIME 2D", 1920, 1080, token);
            await WorkspaceFiles.SaveNewAsync(workspace, Required("output"), token);
            Print(new { saved = true, file = Path.GetFullPath(Required("output")) }); return 0;
        }
        await files.LoadAsync(workspace, input!, command == "mcp" && permission == McpPermission.Edit, token);
        switch (command)
        {
            case "import":
                await WorkspaceFiles.SaveNewAsync(workspace, Required("output"), token);
                Print(new { saved = true, file = Path.GetFullPath(Required("output")) }); return 0;
            case "inspect":
                Print(await workspace.InvokeAsync(NativeMcpHost.WorkspaceProjection, token)); return 0;
            case "preview":
                var selection = new FrameSelection(Optional("key-art"), Optional("sequence"), Optional("transition"), Optional("time-ticks") ?? "0", Number("width", 640));
                var frame = await workspace.InvokeAsync(w => CpuFrames.Preview(w, selection), token);
                var png = await CpuFrames.PngAsync(frame, token);
                var output = Required("output");
                WorkspaceFiles.RejectLink(output);
                await AtomicDocumentFile.WriteAsync(output, (s, ct) => s.WriteAsync(png, ct).AsTask(), false, token);
                Print(new { file = Path.GetFullPath(output), frame.Width, frame.Height, backend = "cpu-offline" }); return 0;
            case "render":
                var outputDirectory = Path.GetFullPath(Required("output-dir"));
                if (Path.Exists(outputDirectory)) throw new CliException("render.output_exists");
                await using (var render = new RenderJobs(workspace, outputDirectory))
                {
                    var request = new ExportRequest(Optional("sequence"), Optional("transition"), Number("width", 0), Number("height", 0), Number("fps", 30), Number("fps-denominator", 1));
                    HeadlessMcp.ValidateExport(request);
                    var started = await workspace.InvokeAsync(w => render.Start(request, token), token);
                    using var registration = token.Register(() => render.Cancel(started.GetProperty("jobId").GetString()!));
                    await render.Completion;
                    var status = render.Status(started.GetProperty("jobId").GetString()!);
                    Print(status); return status.GetProperty("state").GetString() == "succeeded" ? 0 : 1;
                }
            case "mcp":
                using (var host = new NativeMcpHost(workspace, permission: permission, applicationLifetime: true))
                using (var boundary = HeadlessMcp.Boundary(host, HeadlessMcp.ExtraTools(workspace, files, jobs, uploads)))
                    await HeadlessMcp.ServeAsync(host, boundary, permission, Optional("hub"), token);
                return 0;
        }
        throw new CliException("cli.unknown_command");
    }
}

