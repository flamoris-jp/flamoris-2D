using System.Buffers.Binary;
using System.IO.Compression;
using Flamoris.Cutwork.Core;

namespace Flamoris.Cutwork.Imaging.Persistence;

// Test-only adapter for a Linux-generated seed fixture. Archive/model code remains
// Cutwork's unmodified source. Windows runs use Cutwork's actual WPF PNG codec.
internal static class PngAssetCodec
{
    internal static byte[] EncodeBgra32(PixelSize size, ReadOnlySpan<byte> pixels, bool premultiplied = false)
    {
        if (premultiplied) throw new NotSupportedException("Seed fixtures use straight BGRA only.");
        if (pixels.Length != checked(size.Width * size.Height * 4)) throw new ArgumentException(nameof(pixels));
        var rgba = pixels.ToArray();
        for (var offset = 0; offset < rgba.Length; offset += 4)
            (rgba[offset], rgba[offset + 2]) = (rgba[offset + 2], rgba[offset]);
        return Encode(size, rgba, 4, 6);
    }

    internal static byte[] EncodeGray8(PixelSize size, ReadOnlySpan<byte> pixels)
    {
        if (pixels.Length != checked(size.Width * size.Height)) throw new ArgumentException(nameof(pixels));
        return Encode(size, pixels, 1, 0);
    }

    internal static byte[] DecodeBgra32(ReadOnlySpan<byte> png, PixelSize expected) =>
        throw new NotSupportedException("The portable fixture adapter is write-only; use Windows for current Cutwork reader coverage.");

    internal static byte[] DecodeGray8(ReadOnlySpan<byte> png, PixelSize expected) =>
        throw new NotSupportedException("The portable fixture adapter is write-only; use Windows for current Cutwork reader coverage.");

    private static byte[] Encode(PixelSize size, ReadOnlySpan<byte> pixels, int channels, byte colorType)
    {
        using var output = new MemoryStream();
        output.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, size.Width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), size.Height);
        header[8] = 8;
        header[9] = colorType;
        WriteChunk(output, "IHDR"u8, header);
        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            for (var row = 0; row < size.Height; row++)
            {
                zlib.WriteByte(0); // No filtering; deterministic seed data, no palette/interlace.
                zlib.Write(pixels.Slice(row * size.Width * channels, size.Width * channels));
            }
        }
        WriteChunk(output, "IDAT"u8, compressed.ToArray());
        WriteChunk(output, "IEND"u8, []);
        return output.ToArray();
    }

    private static void WriteChunk(Stream output, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> number = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(number, data.Length);
        output.Write(number);
        output.Write(type);
        output.Write(data);
        var crc = uint.MaxValue;
        foreach (var value in type) crc = UpdateCrc(crc, value);
        foreach (var value in data) crc = UpdateCrc(crc, value);
        BinaryPrimitives.WriteUInt32BigEndian(number, ~crc);
        output.Write(number);
    }

    private static uint UpdateCrc(uint crc, byte value)
    {
        crc ^= value;
        for (var bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0u : 0xedb88320u);
        return crc;
    }
}
