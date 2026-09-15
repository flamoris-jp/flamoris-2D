namespace Flamoris.Flamoris2D.ProductHost;

// OS storage adapter only. The bytes are produced/validated by Product Host.
public static class AtomicDocumentFile
{
    public static async Task WriteAsync(string path, Func<Stream, CancellationToken, Task> write,
        bool overwrite = true, CancellationToken cancellationToken = default)
    {
        var destination = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(destination)!;
        Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
                FileShare.None, 65536, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await write(stream, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (overwrite && File.Exists(destination)) File.Replace(temporary, destination, null);
            else File.Move(temporary, destination, overwrite: false);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
