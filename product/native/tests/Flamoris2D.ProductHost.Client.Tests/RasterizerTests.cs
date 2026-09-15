using System.Diagnostics;
using System.Text.Json;
using Flamoris.Flamoris2D.Rendering;

internal static class RasterizerTests
{
    private static JsonElement Projection(int size, double opacity = 1, bool dual = false, bool clip = false)
    {
        object Instance(string id, double alpha, string? mask = null) => new {
            renderInstanceId = id, opacity = alpha, transform = new double[] {1,0,0,1,0,0},
            mesh = new { positions = new double[] {0,0,size,0,size,size,0,size}, indices = new[] {0,1,2,0,2,3} },
            appearanceSamples = dual ? new object[] {
                new { sourceNodeId="red",weight=.25,uvs=new double[]{0,0,1,0,1,1,0,1} },
                new { sourceNodeId="blue",weight=.75,uvs=new double[]{0,0,1,0,1,1,0,1} } }
                : new object[] { new { sourceNodeId="red",weight=1.0,uvs=new double[]{0,0,1,0,1,1,0,1} } },
            clipping = mask is null ? null : new {sourceRenderInstanceId=mask, mode="inside"}
        };
        return JsonSerializer.SerializeToElement(new {
            plan = new { unsupportedReasons = Array.Empty<string>(), batches = clip
                ? new[] { new {kind="instance",renderInstances=new[]{Instance("mask",.5)}}, new {kind="instance",renderInstances=new[]{Instance("part",opacity,"mask")}} }
                : new[] { new {kind="instance",renderInstances=new[]{Instance("part",opacity)}} } },
            maskSourceIds = clip ? new[]{"mask"} : [], contributions = new Dictionary<string,double>{{"mask",1},{"part",1}}
        });
    }
    public static void Run()
    {
        var textures = new Dictionary<string,RenderTexture> {
            ["red"] = new(1,1,[0,0,255,255]), ["blue"] = new(1,1,[255,0,0,128]) };
        var pixels = EvaluatedRasterizer.Render(Projection(4,.5), textures,4,4);
        for(var i=0;i<16;i++) if(pixels[i*4+2]!=128||pixels[i*4+3]!=128)
            throw new InvalidOperationException("Shared triangle edge double-covered or left a crack.");
        var dual = EvaluatedRasterizer.Render(Projection(4,1,true),textures,4,4);
        if(Math.Abs(dual[0]-96)>1||Math.Abs(dual[2]-64)>1||Math.Abs(dual[3]-160)>1)
            throw new InvalidOperationException("Weighted premultiplied appearance mixture differs from Product contract.");
        var clipped = EvaluatedRasterizer.Render(Projection(4,1,false,true),textures,4,4);
        if(Math.Abs(clipped[3]-191)>1) throw new InvalidOperationException("Clipping alpha/source-over differs from canonical contract.");
        using(var cancellation=new CancellationTokenSource())
        {
            cancellation.Cancel();
            try { EvaluatedRasterizer.Render(Projection(4),textures,4,4,cancellation.Token); throw new InvalidOperationException("Cancellation ignored."); }
            catch(OperationCanceledException) { }
        }
        using var direct = new Direct3DRenderer(software:true);
        foreach(var projection in new[]{Projection(4,.5),Projection(4,1,true),Projection(4,1,false,true)})
        {
            var reference=EvaluatedRasterizer.Render(projection,textures,4,4);var gpu=direct.Render(projection,textures,4,4);
            if(reference.Zip(gpu).Any(p=>Math.Abs(p.First-p.Second)>2))throw new InvalidOperationException("D3D11/software canonical fixture differs.");
        }
        Console.WriteLine($"Direct3D candidate device: {direct.Driver}");
        try { using var hardware=new Direct3DRenderer();Console.WriteLine($"Direct3D hardware available: {hardware.Driver}"); }
        catch(Exception error){Console.WriteLine($"Direct3D hardware unavailable on runner: {error.Message}");}
        foreach(var size in new[]{256,1080})
        {
            var projection=Projection(size,1,true,true);
            EvaluatedRasterizer.Render(projection,textures,size,size);
            var times=new List<double>();
            for(var i=0;i<3;i++) {var watch=Stopwatch.StartNew();EvaluatedRasterizer.Render(projection,textures,size,size);times.Add(watch.Elapsed.TotalMilliseconds);}
            var gpuTimes=new List<double>();direct.Render(projection,textures,size,size);
            for(var i=0;i<3;i++){var watch=Stopwatch.StartNew();direct.Render(projection,textures,size,size);gpuTimes.Add(watch.Elapsed.TotalMilliseconds);}
            Console.WriteLine($"Renderer candidate D ({direct.Driver}): {size}x{size}; two appearances + clipping; median={gpuTimes.Order().ElementAt(1):F2} ms including readback.");
            Console.WriteLine($"Renderer candidate S: {size}x{size}; two appearances + clipping; median={times.Order().ElementAt(1):F2} ms; candidate only, no backend acceptance.");
        }
        var fixtureDirectory=Environment.GetEnvironmentVariable("FLAMORIS_RENDER_FIXTURE_DIR");
        if(fixtureDirectory is not null)
        {
            using var fixture=JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtureDirectory,"production-render-projections.json")));
            using var assets=JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtureDirectory,"production-render-textures.json")));
            var realTextures=assets.RootElement.EnumerateArray().ToDictionary(a=>a.GetProperty("nodeId").GetString()!,a=>new RenderTexture(
                a.GetProperty("width").GetInt32(),a.GetProperty("height").GetInt32(),a.GetProperty("bgra").EnumerateArray().Select(b=>b.GetByte()).ToArray()));
            RendererMeasurement.Run(fixture.RootElement,realTextures,direct);
            foreach(var projection in fixture.RootElement.EnumerateArray())
            {
                var reference=EvaluatedRasterizer.Render(projection,realTextures,64,64);var gpu=direct.Render(projection,realTextures,64,64);
                var differences=reference.Zip(gpu).Select(p=>Math.Abs(p.First-p.Second)).ToArray();
                Console.WriteLine($"Production evaluated frame: tick={projection.GetProperty("timeTicks")}; max channel delta={differences.Max()}; mean={differences.Average():F4}");
                if(differences.Average()>1)throw new InvalidOperationException("Production render mean error exceeds candidate comparison tolerance.");
            }
        }
    }
}
