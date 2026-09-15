using System.Text.Json;

namespace Flamoris.Flamoris2D.Rendering;

public sealed record RenderTexture(int Width, int Height, byte[] StraightBgra);

// Candidate S. Rendering only: all geometry, camera, order and clipping dependencies are Product projections.
public static class EvaluatedRasterizer
{
    private sealed record Sample(RenderTexture Texture, double Weight, double[] Uvs);
    private sealed record Instance(string Id, double[] Positions, int[] Indices, double[] Transform,
        Sample[] Samples, double Opacity, string? ClipSource);
    private static double[] Numbers(JsonElement e) => e.EnumerateArray().Select(x => x.GetDouble()).ToArray();
    public static byte[] Render(JsonElement projection, IReadOnlyDictionary<string, RenderTexture> textures,
        int width, int height, CancellationToken cancellationToken = default)
    {
        var pixels = checked(width * height);
        if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || pixels > 8_294_400)
            throw new InvalidDataException("Native renderer candidate output budget exceeded.");
        var plan = projection.GetProperty("plan");
        if (plan.GetProperty("unsupportedReasons").GetArrayLength() != 0) throw new InvalidDataException("Unsupported render plan.");
        var batches = plan.GetProperty("batches").EnumerateArray().ToArray();
        var instances = new Dictionary<string, Instance>();
        foreach (var i in batches.SelectMany(b => b.GetProperty("renderInstances").EnumerateArray()))
        {
            var id = i.GetProperty("renderInstanceId").GetString()!;
            var samples = i.GetProperty("appearanceSamples").EnumerateArray().Select(s => new Sample(
                textures[s.GetProperty("sourceNodeId").GetString()!], s.GetProperty("weight").GetDouble(), Numbers(s.GetProperty("uvs")))).ToArray();
            instances.Add(id, new(id, Numbers(i.GetProperty("mesh").GetProperty("positions")),
                i.GetProperty("mesh").GetProperty("indices").EnumerateArray().Select(n => n.GetInt32()).ToArray(),
                Numbers(i.GetProperty("transform")), samples, i.GetProperty("opacity").GetDouble(),
                i.TryGetProperty("clipping", out var clip) && clip.ValueKind == JsonValueKind.Object
                    ? clip.GetProperty("sourceRenderInstanceId").GetString() : null));
        }
        var maskIds = projection.GetProperty("maskSourceIds").EnumerateArray().Select(s => s.GetString()!).ToArray();
        // Output + one group/instance surface + masks; fail before allocating unbounded clip surfaces.
        if ((long)pixels * (32L + maskIds.Length * 4L) > 512L * 1024 * 1024)
            throw new InvalidDataException("Native renderer candidate mask memory budget exceeded.");
        var masks = new Dictionary<string, float[]>();
        var scratch = new float[checked(pixels * 4)];
        foreach (var id in maskIds)
        {
            cancellationToken.ThrowIfCancellationRequested(); Array.Clear(scratch);
            var contribution = projection.GetProperty("contributions").GetProperty(id).GetDouble();
            Raster(instances[id], scratch, width, height, masks, contribution, false, cancellationToken);
            var alpha = new float[pixels]; for (var i = 0; i < pixels; i++) alpha[i] = scratch[i * 4 + 3];
            masks.Add(id, alpha);
        }
        var output = new float[checked(pixels * 4)];
        foreach (var batch in batches)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var members = batch.GetProperty("renderInstances").EnumerateArray().ToArray();
            if (batch.GetProperty("kind").GetString() == "instance")
            {
                foreach (var member in members) Raster(instances[member.GetProperty("renderInstanceId").GetString()!],
                    output, width, height, masks, 1, false, cancellationToken);
            }
            else
            {
                Array.Clear(scratch);
                var weight = members.Sum(m => m.GetProperty("compositeWeight").GetDouble());
                foreach (var member in members) Raster(instances[member.GetProperty("renderInstanceId").GetString()!],
                    scratch, width, height, masks, member.GetProperty("compositeWeight").GetDouble() / weight, true, cancellationToken);
                for (var i = 0; i < pixels * 4; i += 4)
                {
                    var inverse = 1 - Math.Clamp(scratch[i + 3], 0, 1);
                    for (var c = 0; c < 4; c++) output[i + c] = Math.Clamp(scratch[i + c], 0, 1) + output[i + c] * inverse;
                }
            }
        }
        var result = new byte[checked(pixels * 4)];
        for (var i = 0; i < result.Length; i++) result[i] = (byte)Math.Clamp((int)Math.Floor(output[i] * 255 + .5), 0, 255);
        return result;
    }
    private static double Edge(double ax, double ay, double bx, double by, double x, double y) => (bx-ax)*(y-ay)-(by-ay)*(x-ax);
    private static bool Inclusive(double ax, double ay, double bx, double by) => by < ay || by == ay && bx > ax;
    private static bool Inside(double edge, bool inclusive) => edge > 0 || edge == 0 && inclusive;
    private static void Raster(Instance instance, float[] destination, int width, int height,
        IReadOnlyDictionary<string, float[]> masks, double contribution, bool additive, CancellationToken cancellation)
    {
        var vertices = instance.Positions; var m = instance.Transform;
        var transformed = new double[vertices.Length];
        for (var i = 0; i < vertices.Length; i += 2)
        { transformed[i] = m[0]*vertices[i]+m[2]*vertices[i+1]+m[4]; transformed[i+1] = m[1]*vertices[i]+m[3]*vertices[i+1]+m[5]; }
        var weightSum = instance.Samples.Sum(s => s.Weight);
        var mask = instance.ClipSource is null ? null : masks[instance.ClipSource];
        Span<double> colour = stackalloc double[4]; Span<double> sampleColour = stackalloc double[4];
        for (var triangle = 0; triangle < instance.Indices.Length; triangle += 3)
        {
            cancellation.ThrowIfCancellationRequested();
            var a = instance.Indices[triangle]*2; var b = instance.Indices[triangle+1]*2; var c = instance.Indices[triangle+2]*2;
            var area = Edge(transformed[a],transformed[a+1],transformed[b],transformed[b+1],transformed[c],transformed[c+1]);
            if (Math.Abs(area) < 1e-12) continue;
            if (area < 0) { (b,c)=(c,b); area = -area; }
            var minX = (int)Math.Clamp(Math.Ceiling(Math.Min(transformed[a],Math.Min(transformed[b],transformed[c]))-.5),0,width);
            var maxX = (int)Math.Clamp(Math.Floor(Math.Max(transformed[a],Math.Max(transformed[b],transformed[c]))-.5),-1,width-1);
            var minY = (int)Math.Clamp(Math.Ceiling(Math.Min(transformed[a+1],Math.Min(transformed[b+1],transformed[c+1]))-.5),0,height);
            var maxY = (int)Math.Clamp(Math.Floor(Math.Max(transformed[a+1],Math.Max(transformed[b+1],transformed[c+1]))-.5),-1,height-1);
            var ab = Inclusive(transformed[a],transformed[a+1],transformed[b],transformed[b+1]);
            var bc = Inclusive(transformed[b],transformed[b+1],transformed[c],transformed[c+1]);
            var ca = Inclusive(transformed[c],transformed[c+1],transformed[a],transformed[a+1]);
            for (var y = minY; y <= maxY; y++)
            {
                cancellation.ThrowIfCancellationRequested();
                for (var x = minX; x <= maxX; x++)
                {
                    var wa = Edge(transformed[b],transformed[b+1],transformed[c],transformed[c+1],x+.5,y+.5);
                    var wb = Edge(transformed[c],transformed[c+1],transformed[a],transformed[a+1],x+.5,y+.5);
                    var wc = Edge(transformed[a],transformed[a+1],transformed[b],transformed[b+1],x+.5,y+.5);
                    if (!Inside(wa,bc)||!Inside(wb,ca)||!Inside(wc,ab)) continue;
                    wa/=area; wb/=area; wc/=area; colour.Clear();
                    foreach (var sample in instance.Samples)
                    {
                        var uv = sample.Uvs;
                        Bilinear(sample.Texture, wa*uv[a]+wb*uv[b]+wc*uv[c], wa*uv[a+1]+wb*uv[b+1]+wc*uv[c+1], sampleColour);
                        var weight = sample.Weight/weightSum;
                        for (var channel = 0; channel < 3; channel++) colour[channel] += sampleColour[channel]*weight;
                        colour[3] += sampleColour[3]*weight;
                    }
                    var pixel = y*width+x; var opacity = instance.Opacity*contribution*(mask?[pixel]??1);
                    for(var channel=0;channel<4;channel++) colour[channel]*=opacity;
                    var inverse = additive ? 1 : 1-colour[3];
                    for(var channel=0;channel<4;channel++) destination[pixel*4+channel]=(float)Math.Clamp(colour[channel]+destination[pixel*4+channel]*inverse,0,1);
                }
            }
        }
    }
    private static void Bilinear(RenderTexture texture, double u, double v, Span<double> colour)
    {
        var x = Math.Clamp(u*texture.Width-.5,0,texture.Width-1); var y = Math.Clamp(v*texture.Height-.5,0,texture.Height-1);
        var x0=(int)Math.Floor(x); var y0=(int)Math.Floor(y); var x1=Math.Min(x0+1,texture.Width-1); var y1=Math.Min(y0+1,texture.Height-1);
        var dx=x-x0; var dy=y-y0; var bytes=texture.StraightBgra;
        double Component(int px, int py, int channel)
        {
            var index=(py*texture.Width+px)*4;
            return channel == 3 ? bytes[index+3]/255.0 : bytes[index+channel]*bytes[index+3]/65025.0;
        }
        // Product uploads premultiplied texture pixels BEFORE linear interpolation.
        for(var c=0;c<4;c++) colour[c] = (Component(x0,y0,c)*(1-dx)+Component(x1,y0,c)*dx)*(1-dy)
            +(Component(x0,y1,c)*(1-dx)+Component(x1,y1,c)*dx)*dy;
    }
}
