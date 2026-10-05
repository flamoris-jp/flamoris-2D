using System.Text.Json;
using Flamoris.Flamoris2D.Session;

internal static class SaveLifecycleTests
{
    private sealed class ManualSaveClock : TimeProvider
    {
        private DateTimeOffset now = new(2026, 10, 5, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan elapsed) => now += elapsed;
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("Save lifecycle: " + message);
    }

    private static async Task RejectAsync<T>(NativeWorkspace workspace, Func<NativeWorkspace, T> action, string code)
    {
        try { await workspace.InvokeAsync(action); }
        catch (WorkspaceException error) when (error.Code == code) { return; }
        throw new InvalidOperationException("Save lifecycle: expected " + code);
    }

    private static Task<JsonElement> EditAsync(NativeWorkspace workspace, string name) => workspace.InvokeAsync(w =>
        w.Execute(JsonSerializer.SerializeToElement(new[]
        {
            new { type = "scene.rename_node", payload = new { nodeId = w.Project.GetProperty("scene").GetProperty("rootId").GetString()!, displayName = name } }
        }), name));

    public static async Task RunAsync()
    {
        await CandidateAdmissionAsync();
        await ReceiptLifetimeAsync();
        await TransferAdmissionAsync();
        await DocumentIdentityAsync();
        Console.WriteLine("Native save lifecycle: bounded copy/recovery and active-transfer handles, release, ten-minute expiry, stale receipts and revision-qualified cleanup passed.");
    }

    private static async Task CandidateAdmissionAsync()
    {
        await using var workspace = new NativeWorkspace();
        await workspace.NewAsync("save handles", 64, 64);
        await EditAsync(workspace, "unsaved edit");
        var initial = await workspace.InvokeAsync(w => w.Snapshot);
        var copy = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        var recovery = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        Check(copy.ReceiptId is null && recovery.ReceiptId is null, "copy/recovery acquired a save acknowledgement.");
        await RejectAsync(workspace, w => w.PrepareSave("copy"), "document.budget");
        await workspace.InvokeAsync(w =>
        {
            Check(w.Snapshot == initial, "failed admission changed the session.");
            Check(w.GetSave(copy.Id, copy.Identity.DocumentToken).Bytes.Span.SequenceEqual(copy.Bytes.Span), "failed admission invalidated the existing copy.");
            Check(w.GetSave(recovery.Id, recovery.Identity.DocumentToken).Bytes.Span.SequenceEqual(recovery.Bytes.Span), "failed admission invalidated Recovery.");
            w.ReleaseSave(copy.Id);
            return true;
        });
        var replacementCopy = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        await workspace.InvokeAsync(w =>
        {
            w.ReleaseSave(recovery.Id);
            w.ReleaseSave(replacementCopy.Id);
            Check(w.Snapshot == initial, "copy/Recovery release marked the session saved.");
            return true;
        });

        var save = await workspace.InvokeAsync(w => w.PrepareSave("saveAs"));
        await RejectAsync(workspace, w => w.PrepareSave("save"), "document.save_busy");
        var concurrentCopy = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        await RejectAsync(workspace, w => w.PrepareSave("recovery"), "document.budget");
        await workspace.InvokeAsync(w => { w.ReleaseSave(concurrentCopy.Id); return true; });
        var concurrentRecovery = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        await workspace.InvokeAsync(w =>
        {
            w.ReleaseSave(concurrentRecovery.Id);
            // Failed/cancelled filesystem writes use release, never acknowledge.
            w.ReleaseSave(save.Id);
            Check(w.Snapshot == initial, "abandoned save changed native history/dirty state.");
            return true;
        });
        await RejectAsync(workspace, w => w.AcknowledgeSave(save.ReceiptId!), "document.receipt_invalid");
        var retry = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        await workspace.InvokeAsync(w => w.AcknowledgeSave(retry.ReceiptId!));
        Check((await workspace.InvokeAsync(w => w.Snapshot)).State.Dirty == 0, "released save prevented a successful retry.");
        await RejectAsync(workspace, w => w.AcknowledgeSave(retry.ReceiptId!), "document.receipt_invalid");
    }

    private static async Task ReceiptLifetimeAsync()
    {
        var clock = new ManualSaveClock();
        await using var workspace = new NativeWorkspace(clock);
        await workspace.NewAsync("save expiry", 64, 64);
        await EditAsync(workspace, "slow durable save");
        var save = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        clock.Advance(TimeSpan.FromMinutes(9) + TimeSpan.FromSeconds(59));
        await workspace.InvokeAsync(w =>
        {
            Check(w.GetSave(save.Id, save.Identity.DocumentToken).Id == save.Id, "save expired before the accepted ten-minute lifetime.");
            return w.AcknowledgeSave(save.ReceiptId!);
        });
        Check((await workspace.InvokeAsync(w => w.Snapshot)).State.Dirty == 0, "valid slow save did not acknowledge.");
        await EditAsync(workspace, "expired save");
        var expired = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        clock.Advance(TimeSpan.FromMinutes(10));
        await RejectAsync(workspace, w => w.GetSave(expired.Id, expired.Identity.DocumentToken), "document.receipt_invalid");
        await RejectAsync(workspace, w => w.AcknowledgeSave(expired.ReceiptId!), "document.receipt_invalid");
        Check((await workspace.InvokeAsync(w => w.Snapshot)).State.Dirty != 0, "expired save marked edits clean.");
        // Expiry releases the intentional-save slot as well as byte/handle admission.
        var replacement = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        await workspace.InvokeAsync(w => { w.ReleaseSave(replacement.Id); return true; });
        var copy = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        var recovery = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        clock.Advance(TimeSpan.FromMinutes(10));
        var newCopy = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        var newRecovery = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        Check(copy.Id != newCopy.Id && recovery.Id != newRecovery.Id, "expired handles were retained.");
    }

    private static async Task DocumentIdentityAsync()
    {
        await using var workspace = new NativeWorkspace();
        await workspace.NewAsync("original", 64, 64);
        await EditAsync(workspace, "captured original");
        var oldSave = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        var recovery = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        await workspace.OpenAsync(recovery.Bytes.ToArray(), recoveryLineage: recovery.Identity.LineageId, recoverySnapshot: recovery.Identity.SnapshotId);
        var restored = await workspace.InvokeAsync(w => w.Snapshot);
        Check(restored.DocumentToken != recovery.Identity.DocumentToken && restored.State.Dirty != 0, "restore reused authority or started clean.");
        await RejectAsync(workspace, w => w.AcknowledgeSave(oldSave.ReceiptId!), "document.receipt_invalid");
        await RejectAsync(workspace, w => w.GetSave(oldSave.Id, oldSave.Identity.DocumentToken), "document.receipt_invalid");

        var save = await workspace.InvokeAsync(w => w.PrepareSave("saveAs"));
        await EditAsync(workspace, "newer restored edit");
        var cleanup = await workspace.InvokeAsync(w => w.AcknowledgeSave(save.ReceiptId!));
        Check(cleanup.LineageId == recovery.Identity.LineageId && cleanup.DocumentToken == restored.DocumentToken &&
            cleanup.ThroughRevision == save.Identity.Revision && cleanup.RestoredSnapshotId == recovery.Identity.SnapshotId,
            "late acknowledgement widened the Recovery cleanup scope.");
        Check((await workspace.InvokeAsync(w => w.Snapshot)).State.Dirty != 0, "late acknowledgement marked newer edits clean.");
        await workspace.InvokeAsync(w => w.Undo());
        Check((await workspace.InvokeAsync(w => w.Snapshot)).State.Dirty == 0, "Undo did not reach the captured restored save point.");
        await workspace.InvokeAsync(w => w.Redo());
        var latest = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        var latestCleanup = await workspace.InvokeAsync(w => w.AcknowledgeSave(latest.ReceiptId!));
        Check(latestCleanup.RestoredSnapshotId is null, "restored origin was reused after its acknowledged save.");

        var replacedSave = await workspace.InvokeAsync(w => w.PrepareSave("save"));
        await workspace.NewAsync("unrelated", 64, 64);
        await RejectAsync(workspace, w => w.AcknowledgeSave(replacedSave.ReceiptId!), "document.receipt_invalid");
        Check((await workspace.InvokeAsync(w => w.LineageId)) != cleanup.LineageId, "New reused the previous Recovery lineage.");
    }

    private static async Task TransferAdmissionAsync()
    {
        var clock = new ManualSaveClock();
        await using var workspace = new NativeWorkspace(clock);
        await workspace.NewAsync("transfer release", 64, 64);
        var copy = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        await workspace.InvokeAsync(w =>
        {
            w.BeginSaveTransfer(copy.Id, copy.Identity.DocumentToken);
            w.BeginSaveTransfer(copy.Id, copy.Identity.DocumentToken);
            w.ReleaseSave(copy.Id);
            return true;
        });
        await RejectAsync(workspace, w => w.GetSave(copy.Id, copy.Identity.DocumentToken), "document.receipt_invalid");
        var other = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        await RejectAsync(workspace, w => w.PrepareSave("copy"), "document.budget");
        await workspace.InvokeAsync(w => { w.EndSaveTransfer(copy.Id); return true; });
        await RejectAsync(workspace, w => w.PrepareSave("copy"), "document.budget");
        await workspace.InvokeAsync(w => { w.EndSaveTransfer(copy.Id); return true; });
        var freeSlot = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        await workspace.InvokeAsync(w => { w.ReleaseSave(other.Id); w.ReleaseSave(freeSlot.Id); return true; });
        await RejectAsync(workspace, w => { w.EndSaveTransfer(copy.Id); return true; }, "document.receipt_invalid");

        var expiring = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        await workspace.InvokeAsync(w => w.BeginSaveTransfer(expiring.Id, expiring.Identity.DocumentToken));
        clock.Advance(TimeSpan.FromMinutes(10));
        await RejectAsync(workspace, w => w.BeginSaveTransfer(expiring.Id, expiring.Identity.DocumentToken), "document.receipt_invalid");
        var afterExpiry = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        await RejectAsync(workspace, w => w.PrepareSave("recovery"), "document.budget");
        await workspace.InvokeAsync(w => { w.EndSaveTransfer(expiring.Id); return true; });
        var freedExpiry = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        await workspace.InvokeAsync(w => { w.ReleaseSave(afterExpiry.Id); w.ReleaseSave(freedExpiry.Id); return true; });

        var replaced = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        var transferred = await workspace.InvokeAsync(w => w.BeginSaveTransfer(replaced.Id, replaced.Identity.DocumentToken));
        await workspace.NewAsync("replacement during transfer", 64, 64);
        await RejectAsync(workspace, w => w.GetSave(replaced.Id, replaced.Identity.DocumentToken), "document.receipt_invalid");
        Check(transferred.Bytes.Span.SequenceEqual(replaced.Bytes.Span), "replacement changed active transfer bytes.");
        var afterReplacement = await workspace.InvokeAsync(w => w.PrepareSave("copy"));
        await RejectAsync(workspace, w => w.PrepareSave("recovery"), "document.budget");
        await workspace.InvokeAsync(w => { w.EndSaveTransfer(replaced.Id); return true; });
        var freedReplacement = await workspace.InvokeAsync(w => w.PrepareSave("recovery"));
        await workspace.InvokeAsync(w => { w.ReleaseSave(afterReplacement.Id); w.ReleaseSave(freedReplacement.Id); return true; });
    }
}
