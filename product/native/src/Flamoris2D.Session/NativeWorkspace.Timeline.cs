using System.Text.Json;
namespace Flamoris.Flamoris2D.Session;
public sealed partial class NativeWorkspace
{
    public JsonElement Timeline(JsonElement context)=>Query("native.timeline_state",context);
    public JsonElement CompileTimeline(JsonElement context,string tool,JsonElement input)=>Query("native.timeline_tool",JsonSerializer.SerializeToElement(new {context,tool,input,idNamespace=Guid.NewGuid().ToString("N")}));
    public JsonElement Playback(JsonElement input)=>Query("native.playback_tick",input);
}
