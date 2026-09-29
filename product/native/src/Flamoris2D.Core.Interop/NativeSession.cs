using System.Runtime.InteropServices;
using System.Text;

namespace Flamoris.Flamoris2D.Core.Interop;

[StructLayout(LayoutKind.Sequential)]
public struct NativeSessionState
{
    public long RevisionCounter, CurrentRevision, SavedRevision;
    public uint UndoDepth, RedoDepth, HistoryDepth, Dirty;
}

public sealed class NativePrepared : SafeHandle
{
    private NativePrepared() : base(IntPtr.Zero, true) { }
    public override bool IsInvalid => handle == IntPtr.Zero;
    protected override bool ReleaseHandle() { NativeMethods.PreparedDestroy(handle); return true; }
    internal static NativePrepared Own(IntPtr pointer)
    {
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Native prepared edit returned null.");
        var result = new NativePrepared(); result.SetHandle(pointer); return result;
    }
    public NativeStatus Commit()
    {
        if (IsClosed || IsInvalid) throw new ObjectDisposedException(nameof(NativePrepared));
        return NativeMethods.PreparedCommit(this);
    }
}

public sealed class NativeSession : SafeHandle
{
    private NativeSession() : base(IntPtr.Zero, true) { }
    public override bool IsInvalid => handle == IntPtr.Zero;
    protected override bool ReleaseHandle() { NativeMethods.SessionDestroy(handle); return true; }
    public static NativeStatus TryCreate(byte[] project, out NativeSession? session)
    {
        ArgumentNullException.ThrowIfNull(project);
        var status = NativeMethods.SessionCreate(project, (uint)project.Length, out var pointer);
        session = status == NativeStatus.Ok ? Own(pointer) : null;
        if (status != NativeStatus.Ok && pointer != IntPtr.Zero) NativeMethods.SessionDestroy(pointer);
        return status;
    }
    private static NativeSession Own(IntPtr pointer)
    {
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Native session returned null.");
        var result = new NativeSession(); result.SetHandle(pointer); return result;
    }
    private void EnsureOpen()
    {
        if (IsClosed || IsInvalid) throw new ObjectDisposedException(nameof(NativeSession));
    }
    public NativeStatus Replace(byte[] project, bool saved = true)
    {
        EnsureOpen(); ArgumentNullException.ThrowIfNull(project);
        return NativeMethods.SessionReplace(this, project, (uint)project.Length, saved ? 1 : 0);
    }
    public NativeSessionState State()
    {
        EnsureOpen(); var status = NativeMethods.SessionState(this, out var result);
        if (status != NativeStatus.Ok) throw new InvalidOperationException($"Native state: {status}");
        return result;
    }
    public NativeStatus MarkSaved(long revision) { EnsureOpen(); return NativeMethods.SessionMarkSaved(this, revision); }
    private delegate NativeStatus Query(byte[]? buffer, uint capacity, out uint required);
    private static string Read(Query query)
    {
        var status = query(null, 0, out var length);
        if (status != NativeStatus.BufferTooSmall || length == 0 || length > NativeSnapshot.MaxBytes + 1)
            throw new InvalidOperationException($"Native query length: {status}");
        var buffer = new byte[length];
        status = query(buffer, length, out var actual);
        if (status != NativeStatus.Ok || actual != length || buffer[^1] != 0)
            throw new InvalidOperationException($"Native query: {status}");
        return new UTF8Encoding(false, true).GetString(buffer, 0, buffer.Length - 1);
    }
    public string ProjectJson() { EnsureOpen(); return Read((byte[]? b, uint c, out uint r) => NativeMethods.SessionProject(this, b, c, out r)); }
    public string HistoryJson() { EnsureOpen(); return Read((byte[]? b, uint c, out uint r) => NativeMethods.SessionHistory(this, b, c, out r)); }
    public string ErrorCode() { EnsureOpen(); return Read((byte[]? b, uint c, out uint r) => NativeMethods.SessionError(this, b, c, out r)); }
    public string NodeField(string id, string field)
    {
        EnsureOpen(); return Read((byte[]? b, uint c, out uint r) => NativeMethods.SessionNodeString(this, id, field, b, c, out r));
    }
    public NativeNodeState NodeState(string id)
    {
        EnsureOpen(); var status = NativeMethods.SessionNodeState(this, id, out var result);
        if (status != NativeStatus.Ok) throw new InvalidOperationException($"Native node: {status}");
        return result;
    }
    public NativeStatus TryPrepare(byte[] commands, string label, out NativePrepared? prepared)
    {
        EnsureOpen(); ArgumentNullException.ThrowIfNull(commands); ArgumentNullException.ThrowIfNull(label);
        var status = NativeMethods.SessionPrepare(this, commands, (uint)commands.Length, label, out var pointer);
        prepared = status == NativeStatus.Ok ? NativePrepared.Own(pointer) : null;
        if (status != NativeStatus.Ok && pointer != IntPtr.Zero) NativeMethods.PreparedDestroy(pointer);
        return status;
    }
    public NativeStatus TryPrepareUndo(out NativePrepared? prepared) => PrepareHistory(true, out prepared);
    public NativeStatus TryPrepareRedo(out NativePrepared? prepared) => PrepareHistory(false, out prepared);
    private NativeStatus PrepareHistory(bool undo, out NativePrepared? prepared)
    {
        EnsureOpen();
        var status = undo ? NativeMethods.SessionPrepareUndo(this, out var pointer) : NativeMethods.SessionPrepareRedo(this, out pointer);
        prepared = status == NativeStatus.Ok ? NativePrepared.Own(pointer) : null;
        if (status != NativeStatus.Ok && pointer != IntPtr.Zero) NativeMethods.PreparedDestroy(pointer);
        return status;
    }
}
