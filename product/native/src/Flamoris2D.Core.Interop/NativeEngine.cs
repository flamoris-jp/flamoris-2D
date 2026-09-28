using System.Runtime.InteropServices;

namespace Flamoris.Flamoris2D.Core.Interop;

public enum NativeStatus : int
{
    Ok = 0,
    InvalidArgument = 1,
    OutOfMemory = 2,
    InternalError = 3,
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeFrameRate
{
    public long Numerator;
    public long Denominator;
}

internal static class NativeMethods
{
    private const string Library = "Flamoris2D.Core.Native";

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_abi_version")]
    internal static extern NativeStatus AbiVersion(out int major, out int minor);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_engine_create")]
    internal static extern NativeStatus Create(out IntPtr handle);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_engine_destroy")]
    internal static extern void Destroy(IntPtr handle);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2d_normalize_frame_rate")]
    internal static extern NativeStatus Normalize(NativeEngine handle, long numerator, long denominator,
        out NativeFrameRate result);
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
