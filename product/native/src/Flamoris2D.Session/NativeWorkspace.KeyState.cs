using System.Text.Json;
namespace Flamoris.Flamoris2D.Session;
public sealed partial class NativeWorkspace
{
    public JsonElement KeyState(JsonElement context)=>Query("native.key_state",context);
    public JsonElement CompileKeyState(JsonElement context,string tool,JsonElement input)=>Query("native.key_state_tool",JsonSerializer.SerializeToElement(new {context,tool,input,idNamespace=Guid.NewGuid().ToString("N")}));
    public JsonElement Correspondence(JsonElement context,JsonElement input)=>Query("native.correspondence",JsonSerializer.SerializeToElement(new {context,input}));
}
