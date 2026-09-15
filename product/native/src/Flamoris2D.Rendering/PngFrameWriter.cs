using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Flamoris.Flamoris2D.Rendering;

// Native lossless encoding adapter. Same straight-alpha conversion as Product png-frame-encoder.js.
public static class PngFrameWriter
{
    private static readonly uint[] CrcTable=Enumerable.Range(0,256).Select(i=>
    {uint c=(uint)i;for(var bit=0;bit<8;bit++)c=(c&1)!=0?0xedb88320u^(c>>1):c>>1;return c;}).ToArray();
    private static async Task Chunk(Stream output,string type,byte[] data,CancellationToken cancellationToken)
    {
        var header=new byte[8];BinaryPrimitives.WriteInt32BigEndian(header,data.Length);Encoding.ASCII.GetBytes(type).CopyTo(header,4);
        uint crc=0xffffffff;foreach(var b in header.AsSpan(4))crc=CrcTable[(crc^b)&255]^(crc>>8);
        foreach(var b in data)crc=CrcTable[(crc^b)&255]^(crc>>8);
        var trailer=new byte[4];BinaryPrimitives.WriteUInt32BigEndian(trailer,crc^0xffffffff);
        await output.WriteAsync(header,cancellationToken);await output.WriteAsync(data,cancellationToken);await output.WriteAsync(trailer,cancellationToken);
    }
    public static async Task WriteAsync(Stream output,int width,int height,byte[] premultipliedBgra,CancellationToken cancellationToken=default)
    {
        if(width<=0||height<=0||(long)width*height>8_294_400||premultipliedBgra.LongLength!=(long)width*height*4)
            throw new ArgumentException("PNG requires a complete bounded PBGRA frame.");
        cancellationToken.ThrowIfCancellationRequested();
        await output.WriteAsync(new byte[]{137,80,78,71,13,10,26,10},cancellationToken);
        var ihdr=new byte[13];BinaryPrimitives.WriteInt32BigEndian(ihdr,width);BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4),height);ihdr[8]=8;ihdr[9]=6;
        await Chunk(output,"IHDR",ihdr,cancellationToken);
        using var compressed=new MemoryStream();
        using(var zip=new ZLibStream(compressed,CompressionLevel.Fastest,leaveOpen:true))
        {
            var row=new byte[checked(width*4+1)];
            for(var y=0;y<height;y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                for(var x=0;x<width;x++)
                {
                    var source=(y*width+x)*4;var target=1+x*4;var alpha=premultipliedBgra[source+3];row[target+3]=alpha;
                    for(var c=0;c<3;c++)row[target+c]=alpha==0?(byte)0:(byte)Math.Min(255,(premultipliedBgra[source+2-c]*255+alpha/2)/alpha);
                }
                await zip.WriteAsync(row,cancellationToken);
            }
        }
        await Chunk(output,"IDAT",compressed.ToArray(),cancellationToken);await Chunk(output,"IEND",[],cancellationToken);
    }
}
