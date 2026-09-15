using System.Text.Json;
using System.Text.Json.Nodes;

namespace Flamoris.Flamoris2D.Rendering;

// Presentation mapping only, after Product camera/evaluation. Used for output resolution and viewport DPI.
public static class RenderView
{
    public static JsonElement Map(JsonElement projection, double scaleX, double scaleY, double x = 0, double y = 0)
    {
        if (!double.IsFinite(scaleX) || !double.IsFinite(scaleY) || scaleX <= 0 || scaleY <= 0 ||
            !double.IsFinite(x) || !double.IsFinite(y)) throw new ArgumentOutOfRangeException(nameof(scaleX));
        var result = JsonNode.Parse(projection.GetRawText())!;
        foreach (var batch in result["plan"]!["batches"]!.AsArray())
            foreach (var instance in batch!["renderInstances"]!.AsArray())
            {
                var m = instance!["transform"]!.AsArray().Select(n => n!.GetValue<double>()).ToArray();
                instance["transform"] = JsonSerializer.SerializeToNode(new[] { m[0]*scaleX,m[1]*scaleY,m[2]*scaleX,m[3]*scaleY,m[4]*scaleX+x,m[5]*scaleY+y });
            }
        return JsonSerializer.SerializeToElement(result);
    }
}
