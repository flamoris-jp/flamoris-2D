using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Flamoris.Flamoris2D.Rendering;

// Presentation/interop only. The native handle owns all D3D11 composition state.
public sealed class Direct3DRenderer : IDisposable
{
    private readonly RendererHandle _renderer;
    private readonly Dictionary<string, RenderTexture> _textures = [];
    private readonly object _gate = new();
    private bool _disposed;
    public string Driver { get; }

    private sealed class RendererHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public RendererHandle(IntPtr value) : base(true) => SetHandle(value);
        protected override bool ReleaseHandle() { Native.Destroy(handle); return true; }
    }

    private static class Native
    {
        private const string Library = "Flamoris2D.Renderer.Native";
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        internal delegate int Cancelled(IntPtr context);
        [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2dr_create")]
        internal static extern int Create(int software, out IntPtr result, byte[] error, uint capacity);
        [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2dr_destroy")]
        internal static extern void Destroy(IntPtr renderer);
        [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2dr_texture")]
        internal static extern int Texture(RendererHandle renderer, byte[] id, uint idLength,
            byte[] bytes, uint length, int width, int height, byte[] error, uint capacity);
        [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2dr_remove_texture")]
        internal static extern int Remove(RendererHandle renderer, byte[] id, uint length);
        [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "fl2dr_render")]
        internal static extern int Render(RendererHandle renderer, byte[] projection, uint length,
            int width, int height, [Out] byte[] output, uint capacity, Cancelled cancelled, IntPtr cancelContext,
            byte[] error, uint errorCapacity);
    }

    public Direct3DRenderer(bool software = false)
    {
        var error = new byte[1024];
        Check(Native.Create(software ? 1 : 0, out var handle, error, (uint)error.Length), error);
        _renderer = new RendererHandle(handle);
        Driver = software ? "Warp/Level_11_0" : "Hardware/Level_11_0";
    }

    private static void Check(int status, byte[] error, CancellationToken token = default)
    {
        if (status == 0) return;
        if (status == 4) throw new OperationCanceledException(token);
        var end = Array.IndexOf(error, (byte)0);
        var message = Encoding.UTF8.GetString(error, 0, end < 0 ? error.Length : end);
        if (status == 1) throw new InvalidDataException(message);
        if (status == 2) throw new OutOfMemoryException(message);
        throw new InvalidOperationException(message);
    }

    public byte[] Render(JsonElement projection, IReadOnlyDictionary<string, RenderTexture> artwork,
        int width, int height, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            cancellationToken.ThrowIfCancellationRequested();
            if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || (long)width*height > 8_294_400)
                throw new InvalidDataException("Native GPU output budget exceeded.");
            var masks = projection.GetProperty("maskSourceIds").GetArrayLength();
            if ((long)width*height*4*(masks+4L) + artwork.Values.Sum(a => a.StraightBgra.LongLength) > 512L*1024*1024)
                throw new InvalidDataException("GPU artwork/composition memory budget exceeded.");
            foreach (var obsolete in _textures.Keys.Except(artwork.Keys).ToArray())
            {
                var id = Encoding.UTF8.GetBytes(obsolete);
                Check(Native.Remove(_renderer, id, (uint)id.Length), []);
                _textures.Remove(obsolete);
            }
            var error = new byte[1024];
            foreach (var (name, source) in artwork)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (_textures.TryGetValue(name, out var cached) && ReferenceEquals(cached, source)) continue;
                if (source.Width <= 0 || source.Height <= 0 || source.StraightBgra.LongLength != (long)source.Width*source.Height*4)
                    throw new InvalidDataException("Incomplete render texture.");
                var id = Encoding.UTF8.GetBytes(name);
                Check(Native.Texture(_renderer, id, (uint)id.Length, source.StraightBgra,
                    (uint)source.StraightBgra.Length, source.Width, source.Height, error, (uint)error.Length), error);
                _textures[name] = source;
            }
            var input = Encoding.UTF8.GetBytes(projection.GetRawText());
            var bytes = new byte[checked(width*height*4)];
            Native.Cancelled cancelled = _ => cancellationToken.IsCancellationRequested ? 1 : 0;
            Check(Native.Render(_renderer, input, (uint)input.Length, width, height, bytes, (uint)bytes.Length,
                cancelled, IntPtr.Zero, error, (uint)error.Length), error, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            return bytes;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _textures.Clear();
            _renderer.Dispose();
        }
    }
}
