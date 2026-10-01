using System.Runtime.InteropServices;

namespace Flamoris.Flamoris2D.Core.Interop;

public enum NativeStatus : int
{
    Ok = 0,
    InvalidArgument = 1,
    OutOfMemory = 2,
    InternalError = 3,
    MalformedJson = 4,
    InvalidUtf8 = 5,
    InputTooLarge = 6,
    BufferTooSmall = 7,
    ProjectInvalid = 8,
    CommandInvalid = 9,
    CommandUnsupported = 10,
    TargetNotFound = 11,
    TransactionEmpty = 12,
    RevisionConflict = 13,
    SavedRevisionInvalid = 14,
    HistoryEmpty = 15,
    RevisionExhausted = 16,
    QueryUnsupported = 17,
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeFrameRate
{
    public long Numerator;
    public long Denominator;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeNodeState
{
    public double PositionX, PositionY, Rotation;
    public double ScaleX, ScaleY, PivotX, PivotY;
    public double Opacity;
    public int Visible;
}

internal static class NativeMethods
{
    private const string Library = "Flamoris2D.Core.Native";

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_abi_version")]
    internal static extern NativeStatus AbiVersion(out int major, out int minor);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_prepared_query_json")]
    internal static extern NativeStatus PreparedQuery(NativePrepared prepared, byte[] input, uint length,
        byte[]? buffer, uint capacity, out uint required);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_generate_mesh_json")]
    internal static extern NativeStatus GenerateMesh(uint width,uint height,byte[] rgba,uint byteLength,byte[] input,uint length,
        byte[]? buffer,uint capacity,out uint required);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_source_project_json")]
    internal static extern NativeStatus SourceProject(byte[] input, uint length,
        byte[]? buffer, uint capacity, out uint required);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_document_parse_json")]
    internal static extern NativeStatus DocumentParse(byte[] input, uint length,
        byte[]? buffer, uint capacity, out uint required);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_document_json")]
    internal static extern NativeStatus SessionDocument(NativeSession session, byte[] options, uint length,
        byte[]? buffer, uint capacity, out uint required);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_engine_create")]
    internal static extern NativeStatus Create(out IntPtr handle);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_engine_destroy")]
    internal static extern void Destroy(IntPtr handle);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_normalize_frame_rate")]
    internal static extern NativeStatus Normalize(NativeEngine handle, long numerator, long denominator,
        out NativeFrameRate result);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_create")]
    internal static extern NativeStatus SessionCreate(byte[] project, uint length, out IntPtr result);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_destroy")]
    internal static extern void SessionDestroy(IntPtr handle);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_replace")]
    internal static extern NativeStatus SessionReplace(NativeSession session, byte[] project, uint length, int saved);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_state_get")]
    internal static extern NativeStatus SessionState(NativeSession session, out NativeSessionState result);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_mark_saved")]
    internal static extern NativeStatus SessionMarkSaved(NativeSession session, long revision);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_node_string")]
    internal static extern NativeStatus SessionNodeString(NativeSession session,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string id, [MarshalAs(UnmanagedType.LPUTF8Str)] string field,
        byte[]? buffer, uint capacity, out uint required);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_node_state")]
    internal static extern NativeStatus SessionNodeState(NativeSession session,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string id, out NativeNodeState state);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_project_json")]
    internal static extern NativeStatus SessionProject(NativeSession session, byte[]? buffer, uint capacity, out uint required);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_history_json")]
    internal static extern NativeStatus SessionHistory(NativeSession session, byte[]? buffer, uint capacity, out uint required);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_error")]
    internal static extern NativeStatus SessionError(NativeSession session, byte[]? buffer, uint capacity, out uint required);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_query_json")]
    internal static extern NativeStatus SessionQuery(NativeSession session, byte[] request, uint length,
        byte[]? buffer, uint capacity, out uint required);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_prepare")]
    internal static extern NativeStatus SessionPrepare(NativeSession session, byte[] commands, uint length,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string label, out IntPtr result);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_prepare_undo")]
    internal static extern NativeStatus SessionPrepareUndo(NativeSession session, out IntPtr result);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_session_prepare_redo")]
    internal static extern NativeStatus SessionPrepareRedo(NativeSession session, out IntPtr result);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_prepared_commit")]
    internal static extern NativeStatus PreparedCommit(NativePrepared prepared);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_prepared_destroy")]
    internal static extern void PreparedDestroy(IntPtr handle);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_load")]
    internal static extern NativeStatus SnapshotLoad(byte[] bytes, uint length, out IntPtr result);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_destroy")]
    internal static extern void SnapshotDestroy(IntPtr handle);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_summary")]
    internal static extern NativeStatus SnapshotSummary(NativeSnapshot snapshot,
        out int schema, out double width, out double height, out uint nodes, out uint issues);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_string")]
    internal static extern NativeStatus SnapshotString(NativeSnapshot snapshot,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string field, byte[]? buffer, uint capacity, out uint required);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_node_string")]
    internal static extern NativeStatus SnapshotNodeString(NativeSnapshot snapshot,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string id, [MarshalAs(UnmanagedType.LPUTF8Str)] string field,
        byte[]? buffer, uint capacity, out uint required);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_node_state")]
    internal static extern NativeStatus SnapshotNodeState(NativeSnapshot snapshot,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string id, out NativeNodeState state);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_snapshot_issue_string")]
    internal static extern NativeStatus SnapshotIssueString(NativeSnapshot snapshot,
        uint index, [MarshalAs(UnmanagedType.LPUTF8Str)] string field, byte[]? buffer, uint capacity, out uint required);
}

public readonly record struct NativeProjectSummary(int Schema, double Width, double Height, uint NodeCount, uint IssueCount);
public readonly record struct NativeProjectIssue(string Code, string Path, string EntityId)
{
    public string Severity { get; init; } = "error";
}

public sealed class NativeSnapshot : SafeHandle
{
    public const int MaxBytes = 1_048_576;
    private NativeSnapshot() : base(IntPtr.Zero, true) { }
    public override bool IsInvalid => handle == IntPtr.Zero;
    protected override bool ReleaseHandle() { NativeMethods.SnapshotDestroy(handle); return true; }

    public static NativeStatus TryLoad(byte[] bytes, out NativeSnapshot? snapshot)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        var status = NativeMethods.SnapshotLoad(bytes, (uint)bytes.Length, out var pointer);
        snapshot = null;
        if (status != NativeStatus.Ok)
        {
            if (pointer != IntPtr.Zero) NativeMethods.SnapshotDestroy(pointer);
            return status;
        }
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Native snapshot returned a null handle.");
        snapshot = new NativeSnapshot();
        snapshot.SetHandle(pointer);
        return status;
    }

    private void EnsureOpen()
    {
        if (IsClosed || IsInvalid) throw new ObjectDisposedException(nameof(NativeSnapshot));
    }

    public NativeProjectSummary Summary()
    {
        EnsureOpen();
        var status = NativeMethods.SnapshotSummary(this, out var schema, out var width, out var height, out var nodes, out var issues);
        if (status != NativeStatus.Ok) throw new InvalidOperationException($"Native summary: {status}");
        return new(schema, width, height, nodes, issues);
    }

    private delegate NativeStatus StringQuery(byte[]? buffer, uint capacity, out uint required);
    private static string Read(StringQuery query)
    {
        var status = query(null, 0, out var length);
        if (status != NativeStatus.BufferTooSmall || length == 0 || length > MaxBytes)
            throw new InvalidOperationException($"Native string length: {status}");
        var buffer = new byte[length];
        status = query(buffer, length, out var copied);
        if (status != NativeStatus.Ok || copied != length || buffer[^1] != 0)
            throw new InvalidOperationException($"Native string read: {status}");
        return new System.Text.UTF8Encoding(false, true).GetString(buffer, 0, buffer.Length - 1);
    }

    public string Field(string field)
    {
        EnsureOpen();
        return Read((byte[]? buffer, uint capacity, out uint required) =>
            NativeMethods.SnapshotString(this, field, buffer, capacity, out required));
    }
    public string NodeField(string nodeId, string field)
    {
        EnsureOpen();
        return Read((byte[]? buffer, uint capacity, out uint required) =>
            NativeMethods.SnapshotNodeString(this, nodeId, field, buffer, capacity, out required));
    }
    public NativeNodeState NodeState(string nodeId)
    {
        EnsureOpen();
        var status = NativeMethods.SnapshotNodeState(this, nodeId, out var state);
        if (status != NativeStatus.Ok) throw new InvalidOperationException($"Native node state: {status}");
        return state;
    }
    public NativeProjectIssue Issue(uint index)
    {
        EnsureOpen();
        string Item(string field) => Read((byte[]? buffer, uint capacity, out uint required) =>
            NativeMethods.SnapshotIssueString(this, index, field, buffer, capacity, out required));
        return new(Item("code"), Item("path"), Item("entityId")) { Severity = Item("severity") };
    }
}

public sealed class NativeEngine : SafeHandle
{
    private NativeEngine() : base(IntPtr.Zero, true) { }

    public override bool IsInvalid => handle == IntPtr.Zero;

    protected override bool ReleaseHandle()
    {
        NativeMethods.Destroy(handle);
        return true;
    }

    public static (int Major, int Minor) Version()
    {
        var status = NativeMethods.AbiVersion(out var major, out var minor);
        if (status != NativeStatus.Ok) throw new InvalidOperationException($"Native ABI version: {status}");
        return (major, minor);
    }

    public static NativeEngine Create()
    {
        var status = NativeMethods.Create(out var pointer);
        if (status != NativeStatus.Ok) throw new InvalidOperationException($"Native engine creation: {status}");
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Native engine returned a null handle.");
        var result = new NativeEngine();
        result.SetHandle(pointer);
        return result;
    }

    public NativeStatus NormalizeFrameRate(long numerator, long denominator, out NativeFrameRate result)
    {
        if (IsClosed || IsInvalid) throw new ObjectDisposedException(nameof(NativeEngine));
        return NativeMethods.Normalize(this, numerator, denominator, out result);
    }
}
