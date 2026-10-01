using System.Text.Json;
namespace Flamoris.Flamoris2D.Session;
public sealed partial class NativeWorkspace
{
    public JsonElement ExportSettings()=>Query("native.export_settings",JsonSerializer.SerializeToElement(new {}));
    public JsonElement ExportPlan(JsonElement input)=>Query("native.export_plan",input);
    public JsonElement ExportFrame(JsonElement input)
    {
        var fields=input.EnumerateObject().ToDictionary(p=>p.Name,p=>(object)p.Value.Clone());
        fields["artwork"]=Artwork.Values.Select(a=>new {id=a.Id,nodeId=a.NodeId,width=a.Width,height=a.Height,byteLength=a.Rgba.Length});
        return Query("native.export_frame",JsonSerializer.SerializeToElement(fields));
    }
    public JsonElement Encoder(JsonElement input)=>Query("native.encoder",input);
}
