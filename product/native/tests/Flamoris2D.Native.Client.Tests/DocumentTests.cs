using System.Text;
using System.Text.Json;
using Flamoris.Flamoris2D.Native.Client;
using Flamoris.Flamoris2D.Session;

internal static class DocumentTests
{
    private static void Check(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
    private sealed class PendingInput : MemoryStream
    {
        internal readonly TaskCompletionSource Started=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer,CancellationToken token=default)
        {
            Started.TrySetResult();await Task.Delay(Timeout.Infinite,token);return 0;
        }
    }
    private sealed class PendingOutput : MemoryStream
    {
        internal readonly TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource proceed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal void Complete() => proceed.TrySetResult();
        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken token = default)
        {
            Started.TrySetResult();
            await proceed.Task.WaitAsync(token);
            await base.WriteAsync(buffer, token);
        }
    }
    private sealed class DeferredCancellationOutput : MemoryStream
    {
        internal readonly TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource Cancelled = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource unwind = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal void AllowUnwind() => unwind.TrySetResult();
        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken token = default)
        {
            Started.TrySetResult();
            try { await Task.Delay(Timeout.Infinite, token); }
            catch (OperationCanceledException)
            {
                Cancelled.TrySetResult();
                await unwind.Task;
                throw;
            }
        }
    }
    private static async Task RejectTransferBudgetAsync(NativeSessionClient client)
    {
        try { await client.PrepareDocumentAsync("recovery"); }
        catch (WorkspaceException error) when (error.Code == "document.budget") { return; }
        throw new InvalidOperationException("Active document transfer released its handle budget early.");
    }
    private static Task ReleaseAsync(NativeSessionClient client, PreparedDocument document) =>
        client.ReleaseDocumentAsync(document.Id, document.Identity.DocumentToken, document.Identity.Revision);

    private static async Task TransfersBoundedAsync()
    {
        await using var client = new NativeSessionClient();
        await client.StartAsync();
        await client.CreateSessionAsync("transfer admission", 64, 64);
        // Releasing a prepared handle revokes future reads, but a blocked writer
        // still owns its bytes and must count against admission until completion.
        var released = await client.PrepareDocumentAsync("copy");
        using (var output = new PendingOutput())
        {
            var download = client.DownloadDocumentAsync(released, output);
            try
            {
                await output.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                await ReleaseAsync(client, released);
                var other = await client.PrepareDocumentAsync("copy");
                await RejectTransferBudgetAsync(client);
                output.Complete();
                await download.WaitAsync(TimeSpan.FromSeconds(5));
                Check(output.Length == released.ByteLength, "Released transfer lost its prepared bytes.");
                var afterCompletion = await client.PrepareDocumentAsync("recovery");
                await ReleaseAsync(client, other);
                await ReleaseAsync(client, afterCompletion);
            }
            finally { output.Complete(); await download.WaitAsync(TimeSpan.FromSeconds(5)); }
        }

        // Replacement clears the old document's receipts without reclaiming the
        // memory that an in-flight old-document writer still holds.
        var replaced = await client.PrepareDocumentAsync("copy");
        using (var output = new PendingOutput())
        {
            var download = client.DownloadDocumentAsync(replaced, output);
            try
            {
                await output.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                await client.CreateSessionAsync("replacement", 64, 64);
                var other = await client.PrepareDocumentAsync("copy");
                await RejectTransferBudgetAsync(client);
                output.Complete();
                try
                {
                    await download.WaitAsync(TimeSpan.FromSeconds(5));
                    throw new InvalidOperationException("Old document transfer passed the replacement guard.");
                }
                catch (WorkspaceException error) when (error.Code == "document.conflict") { }
                var afterConflict = await client.PrepareDocumentAsync("recovery");
                await ReleaseAsync(client, other);
                await ReleaseAsync(client, afterConflict);
            }
            finally
            {
                output.Complete();
                try { await download.WaitAsync(TimeSpan.FromSeconds(5)); }
                catch (WorkspaceException error) when (error.Code == "document.conflict") { }
            }
        }

        // The transfer's finally must release its reservation even when the
        // destination is cancelled while waiting for an asynchronous write.
        var cancelled = await client.PrepareDocumentAsync("copy");
        using (var output = new PendingOutput())
        using (var cancellation = new CancellationTokenSource())
        {
            var download = client.DownloadDocumentAsync(cancelled, output, cancellation.Token);
            try
            {
                await output.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                await ReleaseAsync(client, cancelled);
                var other = await client.PrepareDocumentAsync("copy");
                await RejectTransferBudgetAsync(client);
                cancellation.Cancel();
                try
                {
                    await download.WaitAsync(TimeSpan.FromSeconds(5));
                    throw new InvalidOperationException("Blocked transfer ignored cancellation.");
                }
                catch (OperationCanceledException) { }
                var afterCancellation = await client.PrepareDocumentAsync("recovery");
                await ReleaseAsync(client, other);
                await ReleaseAsync(client, afterCancellation);
            }
            finally
            {
                cancellation.Cancel();
                try { await download.WaitAsync(TimeSpan.FromSeconds(5)); }
                catch (OperationCanceledException) { }
            }
        }
        // Dispose clears the workspace after cancelling downloads. If a stream
        // observes cancellation later, lease cleanup must preserve that result.
        var disposing = await client.PrepareDocumentAsync("copy");
        using (var output = new DeferredCancellationOutput())
        {
            var download = client.DownloadDocumentAsync(disposing, output);
            try
            {
                await output.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                var disposal = client.DisposeAsync().AsTask();
                await output.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
                await disposal.WaitAsync(TimeSpan.FromSeconds(5));
                output.AllowUnwind();
                try
                {
                    await download.WaitAsync(TimeSpan.FromSeconds(5));
                    throw new InvalidOperationException("Dispose left a document transfer running.");
                }
                catch (OperationCanceledException) { }
            }
            finally
            {
                output.AllowUnwind();
                try { await download.WaitAsync(TimeSpan.FromSeconds(5)); }
                catch (OperationCanceledException) { }
            }
        }
        Console.WriteLine("Document transfers: release/replacement retain admission; completion/cancellation release it; disposal preserves cancellation.");
    }
    public static async Task RunAsync(string hostPath)
    {
        await TransfersBoundedAsync();
        var directory = Path.Combine(Path.GetTempPath(), "flamoris-document-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "shot.fl2d");
            await using var client = new NativeSessionClient(); await client.StartAsync();
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
            Check(Enumerable.SequenceEqual(original, await File.ReadAllBytesAsync(path)), "Failed write changed the destination.");
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
            Check(Enumerable.SequenceEqual(original, await File.ReadAllBytesAsync(path)), "Cancelled write changed the destination.");
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
            var legacy = System.Text.Json.Nodes.JsonNode.Parse(original)!.AsObject(); legacy["createdAt"] = 1;
            var legacyBytes = Encoding.UTF8.GetBytes(legacy.ToJsonString());
            using(var source = new MemoryStream(legacyBytes)) await client.OpenDocumentAsync(source, source.Length);
            var normalized = await client.SerializeAsync();
            using(var document = JsonDocument.Parse(normalized.Payload.GetProperty("document").GetString()!))
                Check(document.RootElement.GetProperty("createdAt").GetString() == "1970-01-01T00:00:00.001Z", "Legacy timestamp lost through the desktop adapter.");
            using(var pending = new PendingInput())
            {
                var open = client.OpenDocumentAsync(pending, 16); await pending.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                await client.ShutdownAsync();
                try { await open.WaitAsync(TimeSpan.FromSeconds(5)); throw new Exception("Shutdown left a pending document read alive."); }
                catch(OperationCanceledException) { }
            }
            Console.WriteLine("Document/recovery/atomic-write integration tests passed.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
