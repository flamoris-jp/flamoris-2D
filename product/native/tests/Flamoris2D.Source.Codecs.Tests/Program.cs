using System.Text.Json;
using Flamoris.Flamoris2D.Source;

using var fixtures=JsonDocument.Parse(File.ReadAllBytes(args[0])); int count=0;
foreach(var fixture in fixtures.RootElement.EnumerateArray())
{
    var bytes=Convert.FromBase64String(fixture.GetProperty("archive").GetString()!); var decoded=FlimgCodec.Decode(bytes);
    var expected=fixture.GetProperty("images");
    if(decoded.Images.Count!=expected.EnumerateObject().Count()) throw new Exception("Image count mismatch.");
    foreach(var property in expected.EnumerateObject())
    {
        var raster=decoded.Images[property.Name]; var value=property.Value;
        if(raster.Width!=value.GetProperty("width").GetInt32() || raster.Height!=value.GetProperty("height").GetInt32() || !raster.Rgba.Span.SequenceEqual(value.GetProperty("rgba").EnumerateArray().Select(b=>b.GetByte()).ToArray())) throw new Exception("JS/.NET raster mismatch: "+fixture.GetProperty("name"));
        var encoded=RasterCodec.EncodePng(raster); if(!RasterCodec.DecodePng(encoded,raster.Width,raster.Height).AsSpan().SequenceEqual(raster.Rgba.Span)) throw new Exception("PNG round trip mismatch.");
        encoded[40]^=1; ExpectInvalid(()=>RasterCodec.DecodePng(encoded,raster.Width,raster.Height));
    }
    var corrupt=bytes.ToArray(); corrupt[40]^=1; ExpectInvalid(()=>FlimgCodec.Decode(corrupt));
    ExpectInvalid(()=>FlimgCodec.Decode(bytes[..^1]));
    using var cancelled=new CancellationTokenSource(); cancelled.Cancel(); try {FlimgCodec.Decode(bytes,cancelled.Token); throw new Exception("Cancellation was ignored.");} catch(OperationCanceledException) {}
    count++;
}
using var psdFixtures=JsonDocument.Parse(File.ReadAllBytes(args[1]));
foreach(var fixture in psdFixtures.RootElement.EnumerateArray())
{
    var bytes=Convert.FromBase64String(fixture.GetProperty("archive").GetString()!); var decoded=PsdCodec.Decode(bytes);
    CompareTree(fixture.GetProperty("children"),decoded.Description.GetProperty("children"),decoded);
    ExpectInvalid(()=>PsdCodec.Decode(bytes[..40]));
    using var cancelled=new CancellationTokenSource(); cancelled.Cancel(); try {PsdCodec.Decode(bytes,cancelled.Token);throw new Exception("PSD cancellation ignored.");} catch(OperationCanceledException) {}
    count++;
}
static void CompareTree(JsonElement expected,JsonElement actual,DecodedSource source)
{
    if(expected.GetArrayLength()!=actual.GetArrayLength()) throw new Exception("PSD tree length mismatch.");
    for(int i=0;i<expected.GetArrayLength();i++)
    {
        var e=expected[i];var a=actual[i];
        foreach(var p in e.EnumerateObject())
        {
            if(p.Name=="children") {CompareTree(p.Value,a.GetProperty("children"),source);continue;}
            if(p.Name is "rgba" or "width" or "height") continue;
            if(!a.TryGetProperty(p.Name,out var value) || !JsonElement.DeepEquals(p.Value,value)) throw new Exception("PSD property mismatch: "+p.Name+" expected "+p.Value+" actual "+value);
        }
        if(e.TryGetProperty("rgba",out var rgba)) {var image=source.Images[a.GetProperty("image").GetProperty("id").GetString()!];if(image.Width!=e.GetProperty("width").GetInt32() || image.Height!=e.GetProperty("height").GetInt32() || !image.Rgba.Span.SequenceEqual(rgba.EnumerateArray().Select(v=>v.GetByte()).ToArray())) throw new Exception("PSD pixel mismatch.");}
    }
}
Console.WriteLine($"Source codecs: {count} oracle archives, PNG round trips, CRC/truncation/cancellation passed.");
static void ExpectInvalid(Action action) {try {action();} catch(Exception e) when(e is IOException or InvalidDataException) {return;} throw new Exception("Invalid input accepted.");}
