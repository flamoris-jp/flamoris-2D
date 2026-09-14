using System.Buffers.Binary;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Flamoris.Flamoris2D.App;

public static class ArtworkLoader
{
    public static (int Width, int Height) InspectPng(string path)
    {
        using var file = File.OpenRead(path);
        return InspectStream(file);
    }
    private static (int Width, int Height) InspectStream(Stream file)
    {
        if (file.Length < 33 || file.Length > 32 * 1024 * 1024)
            throw new InvalidDataException("PNGは32 MiB以下にしてください。");
        file.Position = 0;
        Span<byte> header = stackalloc byte[24];
        file.ReadExactly(header);
        ReadOnlySpan<byte> signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (!header[..8].SequenceEqual(signature) || BinaryPrimitives.ReadUInt32BigEndian(header[8..]) != 13 ||
            !header.Slice(12, 4).SequenceEqual("IHDR"u8)) throw new InvalidDataException("PNG形式ではありません。");
        var width = BinaryPrimitives.ReadUInt32BigEndian(header[16..]);
        var height = BinaryPrimitives.ReadUInt32BigEndian(header[20..]);
        if (width == 0 || height == 0 || width > 4096 || height > 4096 || (long)width * height > 4194304)
            throw new InvalidDataException("PNGは各辺4096以下・合計419万画素以下にしてください。");
        return ((int)width, (int)height);
    }
    public static byte[] DecodePng(string path, int width, int height, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var file = File.OpenRead(path);
        // Validate the same locked stream that the decoder consumes, not a reopened path.
        if (InspectStream(file) != (width, height)) throw new IOException("読み込み中にPNGが変更されました。");
        file.Position = 0;
        var decoder = new PngBitmapDecoder(file, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        var frame = decoder.Frames[0];
        if (frame.PixelWidth != width || frame.PixelHeight != height)
            throw new InvalidDataException("PNGの寸法が一致しません。");
        var converted = new FormatConvertedBitmap(frame, PixelFormats.Bgra32, null, 0);
        var bytes = new byte[checked(width * height * 4)];
        converted.CopyPixels(bytes, width * 4, 0);
        cancellationToken.ThrowIfCancellationRequested();
        return bytes;
    }
}
