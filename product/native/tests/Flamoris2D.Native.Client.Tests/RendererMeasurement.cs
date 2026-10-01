using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Flamoris.Flamoris2D.Rendering;

internal static class RendererMeasurement
{
    // Test-only tessellation of already evaluated triangles: same positions/UV interpolation, denser GPU workload.
    private static JsonElement Dense(JsonElement projection)
    {
        var result=JsonNode.Parse(projection.GetRawText())!;
        foreach(var batch in result["plan"]!["batches"]!.AsArray())
            foreach(var instance in batch!["renderInstances"]!.AsArray())
            {
                var source=instance!["mesh"]!["positions"]!.AsArray().Select(n=>n!.GetValue<double>()).ToArray();
                var triangles=instance["mesh"]!["indices"]!.AsArray().Select(n=>n!.GetValue<int>()).ToArray();
                var samples=instance["appearanceSamples"]!.AsArray();
                var uv=samples.Select(s=>s!["uvs"]!.AsArray().Select(n=>n!.GetValue<double>()).ToArray()).ToArray();
                var positions=new List<double>();var indices=new List<int>();var uvs=uv.Select(_=>new List<double>()).ToArray();
                const int divisions=12;
                for(var triangle=0;triangle<triangles.Length;triangle+=3)
                {
                    var a=triangles[triangle]*2;var b=triangles[triangle+1]*2;var c=triangles[triangle+2]*2;
                    void Vertex(int i,int j)
                    {
                        var wb=(double)i/divisions;var wc=(double)j/divisions;var wa=1-wb-wc;
                        indices.Add(positions.Count/2);
                        for(var axis=0;axis<2;axis++)positions.Add(source[a+axis]*wa+source[b+axis]*wb+source[c+axis]*wc);
                        for(var sample=0;sample<uv.Length;sample++)for(var axis=0;axis<2;axis++)
                            uvs[sample].Add(uv[sample][a+axis]*wa+uv[sample][b+axis]*wb+uv[sample][c+axis]*wc);
                    }
                    for(var i=0;i<divisions;i++)for(var j=0;j<divisions-i;j++)
                    {
                        Vertex(i,j);Vertex(i+1,j);Vertex(i,j+1);
                        if(i+j<divisions-1){Vertex(i+1,j);Vertex(i+1,j+1);Vertex(i,j+1);}
                    }
                }
                instance["mesh"]!["positions"]=JsonSerializer.SerializeToNode(positions);
                instance["mesh"]!["indices"]=JsonSerializer.SerializeToNode(indices);
                for(var i=0;i<uvs.Length;i++)samples[i]!["uvs"]=JsonSerializer.SerializeToNode(uvs[i]);
            }
        return JsonSerializer.SerializeToElement(result);
    }
    public static void Run(JsonElement fixture,IReadOnlyDictionary<string,RenderTexture> textures,Direct3DRenderer warp)
    {
        var original=fixture.EnumerateArray().ElementAt(2);
        var projection=RenderView.Map(Dense(original),1920d/64,1080d/64);
        var large=textures.ToDictionary(a=>a.Key,a=>
        {
            const int size=512;var bytes=new byte[size*size*4];
            for(var y=0;y<size;y++)for(var x=0;x<size;x++)for(var c=0;c<4;c++)
                bytes[(y*size+x)*4+c]=a.Value.StraightBgra[((y*a.Value.Height/size)*a.Value.Width+x*a.Value.Width/size)*4+c];
            return new RenderTexture(size,size,bytes);
        });
        var triangles=projection.GetProperty("plan").GetProperty("batches").EnumerateArray().SelectMany(b=>b.GetProperty("renderInstances").EnumerateArray())
            .Sum(i=>i.GetProperty("mesh").GetProperty("indices").GetArrayLength()/3);
        Console.WriteLine($"Representative renderer comparison: 1920x1080; {triangles} evaluated triangles; {large.Count} 512x512 textures; nested Warp, Bone, correction, animation, dual appearances, clipping and camera. Test-only uniform triangle subdivision.");
        var timer=Stopwatch.StartNew();var reference=EvaluatedRasterizer.Render(projection,large,1920,1080);
        Console.WriteLine($"Representative S: {timer.Elapsed.TotalMilliseconds:F2} ms; allocated={GC.GetTotalMemory(false)/1048576d:F1} MiB managed live estimate (not process peak).");
        void Measure(Direct3DRenderer renderer)
        {
            renderer.Render(projection,large,1920,1080);var times=new List<double>();byte[] pixels=[];
            for(var i=0;i<5;i++){timer.Restart();pixels=renderer.Render(projection,large,1920,1080);times.Add(timer.Elapsed.TotalMilliseconds);}
            long sum=0;var max=0;var aboveTwo=0;
            for(var i=0;i<pixels.Length;i++){var delta=Math.Abs(pixels[i]-reference[i]);sum+=delta;max=Math.Max(max,delta);if(delta>2)aboveTwo++;}
            var mean=(double)sum/pixels.Length;
            Console.WriteLine($"Representative {renderer.Driver}: median={times.Order().ElementAt(2):F2} ms; max={times.Max():F2} ms including readback; channel mean={mean:F4}, max={max}, >2={100d*aboveTwo/pixels.Length:F4}%; process working set={Environment.WorkingSet/1048576d:F1} MiB.");
            if(mean>1||aboveTwo>pixels.Length*.01)throw new InvalidOperationException("Representative renderer image comparison failed.");
        }
        Measure(warp);
        Direct3DRenderer? hardware=null;
        try{hardware=new Direct3DRenderer();}catch(Exception error){Console.WriteLine($"Hardware measurement unavailable: {error.Message}");}
        using(hardware){if(hardware is not null)Measure(hardware);}
    }
}
