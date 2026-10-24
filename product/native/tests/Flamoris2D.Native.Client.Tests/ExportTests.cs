using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using Flamoris.Flamoris2D.Rendering;
using Flamoris.Flamoris2D.Native.Client;

internal static class ExportTests
{
    public static async Task RunAsync()
    {
        await TestVideoSettingsAsync();
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
    private static async Task TestVideoSettingsAsync()
    {
        await using var client=new NativeSessionClient();
        await client.StartAsync();await client.CreateSessionAsync("Export quality",64,64);
        var raster=await client.UploadRasterAsync(2,2,"Part",Enumerable.Repeat((byte)255,16).ToArray());
        await client.OpenHandsOnAsync([raster]);
        var art=(await client.GetWorkspaceAsync()).Payload.GetProperty("keyArts")[0].GetProperty("id").GetString()!;
        await client.EditTimelineAsync(new(),TimelineEdit.CreateSequence("Shot",1,art),client.Revision);
        var sequence=(await client.GetWorkspaceAsync()).Payload.GetProperty("sequences")[0].GetProperty("id").GetString()!;
        var revision=client.Revision;
        var original=(await client.GetProjectSummaryAsync()).Payload.GetRawText();
        var history=(await client.GetHistoryAsync()).Payload.GetRawText();
        var settings=(await client.GetExportSettingsAsync()).Payload;
        if(settings.GetProperty("videoProfile").GetProperty("videoBitRate").GetInt64()!=20_000_000)
            throw new Exception("High quality must be the Product default.");
        foreach(var bitrate in new long[]{10_000_000,20_000_000,37_000_000})
        {
            var spec=new ExportSettings(sequence,null,64,64,60,1,true,bitrate);
            var plan=await client.PlanExportAsync(spec,revision);
            if(plan.Payload.GetProperty("frameCount").GetInt32()!=60)throw new Exception("Bitrate changed frame timing.");
            await client.ProjectExportFrameAsync(spec,0,revision);
            var response=await client.GetEncoderArgumentsAsync("C:/frames with spaces","C:/out.mp4",60,60,1,videoBitRate:spec.VideoBitRate);
            var args=response.Payload.GetProperty("args").EnumerateArray().Select(a=>a.GetString()).ToArray();
            if(args[Array.IndexOf(args,"-b:v")+1]!=bitrate.ToString(System.Globalization.CultureInfo.InvariantCulture)||
               args[Array.IndexOf(args,"-rate_control")+1]!="cbr")throw new Exception("Managed bitrate did not reach the native encoder contract.");
        }
        var defaults=await client.GetEncoderArgumentsAsync("frames","shot.mp4",60,60,1);
        if(defaults.Payload.GetProperty("profile").GetProperty("videoBitRate").GetInt64()!=20_000_000)
            throw new Exception("Existing callers lost the high-quality default.");
        try
        {
            await client.PlanExportAsync(new(sequence,null,64,64,60,1,true,0),revision);
            throw new Exception("Invalid video bitrate passed preflight.");
        }
        catch(NativeSessionException error) when(error.Message.Contains("Video bitrate")){}
        await client.PlanExportAsync(new(sequence,null,64,64,60,1,false,0),revision);
        if(client.Revision!=revision||(await client.GetProjectSummaryAsync()).Payload.GetRawText()!=original||
           (await client.GetHistoryAsync()).Payload.GetRawText()!=history)
            throw new Exception("Export quality changed the document or revision.");
        Console.WriteLine("Native export quality defaults, managed/native wiring, preflight and document isolation passed.");
    }
}
