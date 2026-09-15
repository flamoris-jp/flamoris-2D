using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using Flamoris.Flamoris2D.Rendering;
using Flamoris.Flamoris2D.ProductHost;

internal static class ExportTests
{
    public static async Task RunAsync()
    {
        using var png=new MemoryStream();
        await PngFrameWriter.WriteAsync(png,3,1,[0,0,128,128,255,128,0,255,0,0,0,0]);
        var data=png.ToArray();if(!data.AsSpan(0,8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))throw new Exception("PNG signature invalid.");
        byte[]? pixels=null;var offset=8;
        while(offset<data.Length)
        {
            var length=BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(offset));var type=Encoding.ASCII.GetString(data,offset+4,4);
            if(type=="IDAT")
            {
                using var input=new MemoryStream(data,offset+8,length);using var zip=new ZLibStream(input,CompressionMode.Decompress);using var decoded=new MemoryStream();
                await zip.CopyToAsync(decoded);pixels=decoded.ToArray();
            }
            offset+=length+12;
        }
        if(pixels is null||!pixels.SequenceEqual(new byte[]{0,255,0,0,128,0,128,255,255,0,0,0,0}))
            throw new Exception("PNG row order/channel mapping/unpremultiply differs from Product contract.");
        using var cancel=new CancellationTokenSource();cancel.Cancel();
        try{await PngFrameWriter.WriteAsync(Stream.Null,1,1,[0,0,0,0],cancel.Token);throw new Exception("PNG cancellation ignored.");}catch(OperationCanceledException){}
        var folder=Path.Combine(Path.GetTempPath(),"native-frame-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);
        try
        {
            var path=Path.Combine(folder,"frame_000001.png");
            await AtomicDocumentFile.WriteAsync(path,(stream,ct)=>PngFrameWriter.WriteAsync(stream,3,1,[0,0,128,128,255,128,0,255,0,0,0,0],ct),false);
            var original=await File.ReadAllBytesAsync(path);
            try{await AtomicDocumentFile.WriteAsync(path,(stream,ct)=>PngFrameWriter.WriteAsync(stream,1,1,[0,0,0,0],ct),false);throw new Exception("Existing frame overwritten.");}catch(IOException){}
            if(!Enumerable.SequenceEqual(original,await File.ReadAllBytesAsync(path)))throw new Exception("Existing PNG changed.");
            if(Directory.GetFiles(folder).Length!=1)throw new Exception("Failed frame temporary file leaked.");
        }
        finally{Directory.Delete(folder,true);}
        Console.WriteLine("Native PNG export encoding, cancellation and no-overwrite passed.");
    }
}
