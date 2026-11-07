using System.Security.Cryptography;
using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;
using Flamoris.Flamoris2D.Native.Client;
using Flamoris.Flamoris2D.Session;

namespace Flamoris.Flamoris2D.Cli;

internal sealed class CliException(string code) : Exception(code);

// Explicit startup file capabilities, not remotely supplied paths.
internal sealed class WorkspaceFiles : IDisposable
{
    private readonly FileStream? workspaceLock;
    private byte[]? savedHash;
    public string? ProjectPath { get; }
    public string? RenderRoot { get; }

    public WorkspaceFiles(string? directory)
    {
        if (directory is null) return;
        directory = Path.GetFullPath(directory);
        RejectLink(directory);
        Directory.CreateDirectory(directory);
        var lockPath = Path.Combine(directory, "workspace.lock");
        RejectLink(lockPath);
        try { workspaceLock = new(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new CliException("workspace.in_use"); }
        ProjectPath = Path.Combine(directory, "project.fl2d");
        RenderRoot = Path.Combine(directory, "renders");
        RejectLink(ProjectPath); RejectLink(RenderRoot);
    }

    public static void RejectLink(string path)
    {
        for (var current = Path.GetFullPath(path); current is not null; current = Path.GetDirectoryName(current))
        {
            try
            {
                if (File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint)) throw new CliException("workspace.link_rejected");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
    }

    public static byte[] ReadBounded(string path, int maximum = (int)NativeDocument.MaximumBytes)
    {
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length > maximum) throw new CliException("source.size_limit_exceeded");
        var bytes = new byte[checked((int)input.Length)];
        input.ReadExactly(bytes);
        if (input.ReadByte() != -1) throw new CliException("source.changed");
        return bytes;
    }

    public async Task LoadAsync(NativeWorkspace workspace, string input, bool initialize, CancellationToken token)
    {
        var source = Path.GetFullPath(input);
        if (string.Equals(ProjectPath, source, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new CliException("workspace.input_is_checkpoint");
        RejectLink(source);
        var resume = ProjectPath is not null && File.Exists(ProjectPath);
        var path = resume ? ProjectPath! : source;
        var bytes = ReadBounded(path);
        if (Path.GetExtension(path).Equals(".fl2d", StringComparison.OrdinalIgnoreCase))
            await workspace.OpenAsync(bytes, token: token);
        else
        {
            var kind = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".flimg" => "flimg", ".psd" or ".psb" => "psd", _ => throw new CliException("source.unsupported_format")
            };
            await workspace.ImportAsync(bytes, kind, Path.GetFileName(path), token: token);
        }
        if (resume) savedHash = SHA256.HashData(bytes);
        else if (initialize && ProjectPath is not null)
            await workspace.InvokeAsync(w => Save(w, token), token);
    }

    // Called on the workspace/Core commit lane; native save receipt is acknowledged after durable write.
    public JsonElement Save(NativeWorkspace workspace, CancellationToken token)
    {
        if (ProjectPath is null) throw new McpSaveException("workspace.required");
        RejectLink(ProjectPath);
        var exists = File.Exists(ProjectPath);
        if (exists != (savedHash is not null) || exists && !SHA256.HashData(ReadBounded(ProjectPath)).SequenceEqual(savedHash!))
            throw new McpSaveException("save.external_conflict");
        var candidate = workspace.PrepareSave("save");
        try
        {
            AtomicDocumentFile.WriteAsync(ProjectPath,
                (stream, ct) => stream.WriteAsync(candidate.Bytes, ct).AsTask(), exists, token).GetAwaiter().GetResult();
            savedHash = SHA256.HashData(candidate.Bytes.Span);
            workspace.AcknowledgeSave(candidate.ReceiptId!);
            return JsonSerializer.SerializeToElement(new { saved = true, revision = candidate.Identity.Revision.ToString(), file = ProjectPath });
        }
        finally { workspace.ReleaseSave(candidate.Id); }
    }

    public static async Task SaveNewAsync(NativeWorkspace workspace, string output, CancellationToken token)
    {
        RejectLink(output);
        await workspace.InvokeAsync(w =>
        {
            var candidate = w.PrepareSave("saveAs");
            try
            {
                AtomicDocumentFile.WriteAsync(output, (s, ct) => s.WriteAsync(candidate.Bytes, ct).AsTask(), false, token).GetAwaiter().GetResult();
                w.AcknowledgeSave(candidate.ReceiptId!);
                return true;
            }
            finally { w.ReleaseSave(candidate.Id); }
        }, token);
    }

    public void Dispose() => workspaceLock?.Dispose();
}

internal sealed class McpSaveException(string code) : Exception(code);
