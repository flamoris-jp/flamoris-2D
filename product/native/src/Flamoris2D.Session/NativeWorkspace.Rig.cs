using System.Text.Json;
namespace Flamoris.Flamoris2D.Session;
public sealed partial class NativeWorkspace
{
    public JsonElement Rig(JsonElement context)=>Query("native.rig_state",context);
    public JsonElement CompileRig(JsonElement context,string tool,JsonElement input)=>Query("native.rig_tool",JsonSerializer.SerializeToElement(new {context,tool,input,idNamespace=Guid.NewGuid().ToString("N")}));
}
