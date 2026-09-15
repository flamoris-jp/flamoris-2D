using System.Text;
using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;

internal static class DocumentTests
{
    private static void Check(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
    public static async Task RunAsync(string hostPath)
    {
        var directory = Path.Combine(Path.GetTempPath(), "flamoris-document-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "shot.fl2d");
            await using var client = new ProductHostClient(); await client.StartAsync(hostPath);
            await client.CreateSessionAsync("保存テスト", 64, 64);
            var root = (await client.GetSceneTreeAsync()).Payload.GetProperty("id").GetString()!;
            await client.RenameNodeAsync(root, "saved state");
            var save = await client.PrepareDocumentAsync("save");
            await AtomicDocumentFile.WriteAsync(path, (s, ct) => client.DownloadDocumentAsync(save, s, ct));
            await client.RenameNodeAsync(root, "newer state");
            await client.AcknowledgeDocumentAsync(save);
            Check((await client.GetWorkspaceAsync()).Payload.GetProperty("isDirty").GetBoolean(), "Late save marked newer edits clean.");
            await client.UndoAsync();
            Check(!(await client.GetWorkspaceAsync()).Payload.GetProperty("isDirty").GetBoolean(), "Undo did not reach saved identity.");
            await client.RedoAsync();
            var original = await File.ReadAllBytesAsync(path);
            try
            {
                await AtomicDocumentFile.WriteAsync(path, async (s, ct) => { await s.WriteAsync(new byte[] { 1,2,3 }, ct); throw new IOException("injected failure"); });
                throw new InvalidOperationException("Failure should propagate.");
            }
            catch (IOException) { }
            Check(original.SequenceEqual(await File.ReadAllBytesAsync(path)), "Failed write changed the destination.");
            try
            {
                await AtomicDocumentFile.WriteAsync(path, (s, ct) => s.WriteAsync(original, ct).AsTask(), overwrite: false);
                throw new InvalidOperationException("Incremental overwrote an existing file.");
            }
            catch (IOException) { }
            using (var cancel = new CancellationTokenSource())
            {
                try { await AtomicDocumentFile.WriteAsync(path, async (s, ct) => { await s.WriteAsync(original, ct); cancel.Cancel(); }, cancellationToken: cancel.Token); }
                catch (OperationCanceledException) { }
            }
            Check(original.SequenceEqual(await File.ReadAllBytesAsync(path)), "Cancelled write changed the destination.");
            await using (var input = File.OpenRead(path)) await client.OpenDocumentAsync(input, input.Length);
            Check((await client.GetSceneTreeAsync()).Payload.GetProperty("displayName").GetString() == "saved state", "Reopen did not use saved bytes.");
            await client.RenameNodeAsync(root, "recover me");
            var store = new NativeRecoveryStore(Path.Combine(directory, "recovery"));
            var recovery = await client.PrepareDocumentAsync("recovery");
            await store.SaveAsync(recovery, path, (s, ct) => client.DownloadDocumentAsync(recovery, s, ct));
            await client.ReleaseDocumentAsync(recovery.Id, recovery.Identity.DocumentToken, recovery.Identity.Revision);
            Check(store.List().Count == 1 && store.List()[0].Metadata is not null, "Recovery is not durably readable.");
            var entry = store.List()[0];
            var (bytes, metadata) = await store.ReadAsync(entry);
            await using (bytes) await client.OpenDocumentAsync(bytes, bytes.Length, new RecoveryOrigin(metadata.Identity.LineageId, metadata.Identity.SnapshotId));
            Check((await client.GetWorkspaceAsync()).Payload.GetProperty("isDirty").GetBoolean(), "Recovered state must start dirty.");
            // Copy has no acknowledgement and leaves the recovered snapshot intact.
            var copy = await client.PrepareDocumentAsync("copy");
            await AtomicDocumentFile.WriteAsync(Path.Combine(directory, "copy.fl2d"), (s, ct) => client.DownloadDocumentAsync(copy, s, ct));
            await client.ReleaseDocumentAsync(copy.Id, copy.Identity.DocumentToken, copy.Identity.Revision);
            Check(copy.ReceiptId is null && store.List().Count == 1, "Copy must preserve Recovery.");
            await store.CleanupAsync(new RecoveryCleanup(Guid.NewGuid().ToString(), metadata.Identity.DocumentToken, long.MaxValue, null));
            Check(store.List().Count == 1, "Unrelated lineage was erased.");
            var finalSave = await client.PrepareDocumentAsync("saveAs");
            await AtomicDocumentFile.WriteAsync(path, (s, ct) => client.DownloadDocumentAsync(finalSave, s, ct));
            var ack = await client.AcknowledgeDocumentAsync(finalSave);
            var cleanup = ack.Payload.GetProperty("cleanup").Deserialize<RecoveryCleanup>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            await store.CleanupAsync(cleanup); Check(store.List().Count == 0, "Acknowledged restored origin was not cleaned up.");
            var corrupt = Path.Combine(directory, "recovery", Guid.NewGuid() + ".recovery");
            await File.WriteAllTextAsync(corrupt, "corrupt"); Check(store.List().Single().Error is not null, "Corrupt snapshot disappeared.");
            await store.CleanupAsync(cleanup); Check(File.Exists(corrupt), "Cleanup deleted corrupt bytes.");
            var quota = new NativeRecoveryStore(Path.Combine(directory, "quota"), maximumBytes: 1);
            var snapshot = await client.PrepareDocumentAsync("recovery");
            try { await quota.SaveAsync(snapshot, path, (s, ct) => client.DownloadDocumentAsync(snapshot, s, ct)); throw new InvalidOperationException("Quota was ignored."); }
            catch (IOException) { }
            await client.ReleaseDocumentAsync(snapshot.Id, snapshot.Identity.DocumentToken, snapshot.Identity.Revision);
            Check(!Directory.EnumerateFiles(directory, "*.tmp", SearchOption.AllDirectories).Any(), "Temporary files leaked.");
            Console.WriteLine("Document/recovery/atomic-write integration tests passed.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
