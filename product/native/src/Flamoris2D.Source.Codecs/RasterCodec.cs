using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Flamoris.Flamoris2D.Source;

// Binary adapters own pixels only. They cannot create or edit a Project.
public sealed class SourceDecodeException(string code, string message) : IOException(message)
{
    public string Code { get; } = code;
}
public sealed record SourceRaster(int Width, int Height, ReadOnlyMemory<byte> Rgba);
public static class RasterCodec
{
    public const long MaximumWorkingBytes = 256L * 1024 * 1024;
    public static void Dimensions(int width, int height)
    {
        if (width < 1 || height < 1 || width > 16384 || height > 16384 || (long)width * height > 100000000)
            throw new SourceDecodeException("source.size_limit_exceeded", "Raster dimensions exceed the import limit.");
    }
    public static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        uint crc = uint.MaxValue;
        foreach (byte b in bytes) { crc ^= b; for (int i = 0; i < 8; i++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320u : 0); }
        return ~crc;
    }
    internal static byte[] Inflate(byte[] compressed, int length, bool raw = false)
    {
        if (length < 0 || length > MaximumWorkingBytes) throw new SourceDecodeException("source.size_limit_exceeded", "Inflated asset exceeds the working set.");
        using var source = new MemoryStream(compressed, false);
        using Stream inflater = raw ? new DeflateStream(source, CompressionMode.Decompress) : new ZLibStream(source, CompressionMode.Decompress);
        var output = new byte[length]; inflater.ReadExactly(output);
        if (inflater.ReadByte() != -1) throw new InvalidDataException("Inflated asset exceeds its declared length.");
        return output;
    }
    private static int Int32(ReadOnlySpan<byte> bytes) => checked((int)BinaryPrimitives.ReadUInt32BigEndian(bytes));
    public static byte[] DecodePng(byte[] bytes, int width, int height, int colorType = 6)
    {
        Dimensions(width, height);
        if (bytes.Length < 45 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10})) throw new InvalidDataException("PNG signature is invalid.");
        int cursor = 8, channels = colorType == 6 ? 4 : colorType == 0 ? 1 : throw new InvalidDataException("PNG color type is unsupported.");
        bool header = false, end = false; int interlace = 0;
        using var compressed = new MemoryStream();
        while (cursor < bytes.Length)
        {
            if (bytes.Length - cursor < 12) throw new InvalidDataException("PNG chunk is truncated.");
            int length = Int32(bytes.AsSpan(cursor, 4)); int data = checked(cursor + 8), next = checked(data + length + 4);
            if (next > bytes.Length || Crc32(bytes.AsSpan(cursor + 4, length + 4)) != BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(data + length, 4))) throw new InvalidDataException("PNG chunk checksum or bounds are invalid.");
            string type = Encoding.ASCII.GetString(bytes, cursor + 4, 4);
            if (!header)
            {
                if (type != "IHDR" || length != 13 || Int32(bytes.AsSpan(data,4)) != width || Int32(bytes.AsSpan(data+4,4)) != height || bytes[data+8] != 8 || bytes[data+9] != colorType || bytes[data+10] != 0 || bytes[data+11] != 0 || bytes[data+12] > 1) throw new InvalidDataException("PNG header does not match the asset.");
                interlace = bytes[data+12]; header = true;
            }
            else if (type == "IHDR") throw new InvalidDataException("Duplicate PNG header.");
            else if (type == "IDAT") compressed.Write(bytes, data, length);
            else if (type == "IEND") { if (length != 0) throw new InvalidDataException("Invalid PNG end."); end = true; cursor = next; break; }
            else if ((bytes[cursor+4] & 32) == 0) throw new InvalidDataException("Unsupported critical PNG chunk.");
            cursor = next;
        }
        if (!end || cursor != bytes.Length || compressed.Length == 0) throw new InvalidDataException("Incomplete PNG.");
        int[][] passes = interlace == 0 ? [[0,0,1,1]] : [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
        int PassSize(int size,int start,int step) => size <= start ? 0 : (size-start+step-1)/step;
        int expected = 0;
        foreach (var p in passes) { int w=PassSize(width,p[0],p[2]), h=PassSize(height,p[1],p[3]); if (w>0 && h>0) expected=checked(expected+(w*channels+1)*h); }
        if ((long)expected + (long)width*height*channels*2 > MaximumWorkingBytes) throw new SourceDecodeException("source.size_limit_exceeded", "PNG working set exceeds the limit.");
        var inflated = Inflate(compressed.ToArray(), expected); var output = new byte[checked(width*height*channels)]; int input=0;
        foreach (var p in passes)
        {
            int w=PassSize(width,p[0],p[2]), h=PassSize(height,p[1],p[3]); if (w==0 || h==0) continue;
            int rowBytes=w*channels; var previous=new byte[rowBytes]; var current=new byte[rowBytes];
            for (int y=0;y<h;y++)
            {
                int filter=inflated[input++]; if (filter>4) throw new InvalidDataException("Invalid PNG row filter.");
                for (int x=0;x<rowBytes;x++)
                {
                    int left=x>=channels?current[x-channels]:0, above=previous[x], upper=x>=channels?previous[x-channels]:0;
                    int predict=filter switch {0=>0,1=>left,2=>above,3=>(left+above)/2,_=>Paeth(left,above,upper)};
                    current[x]=unchecked((byte)(inflated[input++]+predict));
                }
                for(int x=0;x<w;x++) current.AsSpan(x*channels,channels).CopyTo(output.AsSpan(((p[1]+y*p[3])*width+p[0]+x*p[2])*channels,channels));
                (previous,current)=(current,previous);
            }
        }
        return output;
    }
    private static int Paeth(int a,int b,int c)
    {
        int p=a+b-c, pa=Math.Abs(p-a), pb=Math.Abs(p-b), pc=Math.Abs(p-c); return pa<=pb && pa<=pc ? a : pb<=pc ? b : c;
    }
    public static byte[] EncodePng(SourceRaster image)
    {
        Dimensions(image.Width,image.Height);
        if (image.Rgba.Length != checked(image.Width*image.Height*4)) throw new InvalidDataException("Raster length mismatch.");
        using var output = new MemoryStream(); output.Write(new byte[] {137,80,78,71,13,10,26,10});
        void Chunk(string type, byte[] data)
        {
            var number=new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(number,(uint)data.Length); output.Write(number);
            var payload=new byte[data.Length+4]; Encoding.ASCII.GetBytes(type,payload); data.CopyTo(payload,4); output.Write(payload);
            BinaryPrimitives.WriteUInt32BigEndian(number,Crc32(payload)); output.Write(number);
        }
        var header=new byte[13]; BinaryPrimitives.WriteUInt32BigEndian(header,(uint)image.Width); BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(4),(uint)image.Height); header[8]=8; header[9]=6; Chunk("IHDR",header);
        using var compressed=new MemoryStream();
        using(var zlib=new ZLibStream(compressed,CompressionLevel.Fastest,true)) for(int y=0;y<image.Height;y++) { zlib.WriteByte(0); zlib.Write(image.Rgba.Span.Slice(y*image.Width*4,image.Width*4)); }
        Chunk("IDAT",compressed.ToArray()); Chunk("IEND",[]); return output.ToArray();
    }
}
