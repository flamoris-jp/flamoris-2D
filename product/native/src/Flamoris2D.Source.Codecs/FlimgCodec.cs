using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Flamoris.Flamoris2D.Source;

public sealed record DecodedSource(JsonElement Description, IReadOnlyDictionary<string,SourceRaster> Images);
public static class FlimgCodec
{
    private static readonly UTF8Encoding Utf8=new(false,true);
    private static SourceDecodeException Error(string code) => new("flimg."+code, "The .flimg archive failed validation: "+code);
    private static ushort U16(byte[] b,int i) => BinaryPrimitives.ReadUInt16LittleEndian(Slice(b,i,2));
    private static uint U32(byte[] b,int i) => BinaryPrimitives.ReadUInt32LittleEndian(Slice(b,i,4));
    private static ReadOnlySpan<byte> Slice(byte[] b,int i,int n) { if(i<0 || n<0 || (long)i+n>b.Length) throw Error("archive_malformed"); return b.AsSpan(i,n); }
    private sealed record Entry(string Name,ushort Flags,ushort Method,uint Crc,int Compressed,int Length,int Offset);
    public static Dictionary<string,byte[]> ReadZip(byte[] bytes, CancellationToken cancellationToken=default)
    {
        if(bytes.Length>128*1024*1024) throw Error("size_limit_exceeded");
        int end=-1;
        for(int i=bytes.Length-22;i>=Math.Max(0,bytes.Length-22-65535);i--) if(U32(bytes,i)==0x06054b50 && i+22+U16(bytes,i+20)==bytes.Length) {end=i;break;}
        if(end<0 || U16(bytes,end+4)!=0 || U16(bytes,end+6)!=0 || U16(bytes,end+8)!=U16(bytes,end+10)) throw Error("archive_malformed");
        int count=U16(bytes,end+10); if(count==65535) throw Error("archive_malformed"); if(count>4096) throw Error("size_limit_exceeded");
        int directory=checked((int)U32(bytes,end+16)), size=checked((int)U32(bytes,end+12)); if((long)directory+size!=end) throw Error("archive_malformed");
        int cursor=directory; long total=0; var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase); var descriptors=new List<Entry>();
        for(int i=0;i<count;i++)
        {
            cancellationToken.ThrowIfCancellationRequested(); Slice(bytes,cursor,46);
            if(U32(bytes,cursor)!=0x02014b50) throw Error("archive_malformed");
            var flags=U16(bytes,cursor+8); var method=U16(bytes,cursor+10); int compressed=checked((int)U32(bytes,cursor+20)), length=checked((int)U32(bytes,cursor+24));
            int nameLength=U16(bytes,cursor+28), recordLength=46+nameLength+U16(bytes,cursor+30)+U16(bytes,cursor+32); Slice(bytes,cursor,recordLength);
            if((flags&~0x0808)!=0 || (method!=0 && method!=8)) throw Error("archive_malformed");
            if(length>512*1024*1024 || (total+=length)>1024L*1024*1024) throw Error("size_limit_exceeded");
            string name; try {name=Utf8.GetString(Slice(bytes,cursor+46,nameLength));} catch(DecoderFallbackException) {throw Error("archive_path_invalid");}
            ValidatePath(name); if(!names.Add(name)) throw Error("archive_entry_duplicate"); if(name=="manifest.json" && length>4*1024*1024) throw Error("size_limit_exceeded");
            descriptors.Add(new(name,flags,method,U32(bytes,cursor+16),compressed,length,checked((int)U32(bytes,cursor+42)))); cursor+=recordLength;
        }
        if(cursor!=end) throw Error("archive_malformed");
        // Reject overlap before allocating/decompressing. Compressed + decoded buffers are bounded too.
        var occupied=new List<(int Start,int End)>();
        foreach(var d in descriptors)
        {
            Slice(bytes,d.Offset,30); int n=U16(bytes,d.Offset+26), data=checked(d.Offset+30+n+U16(bytes,d.Offset+28));
            if(U32(bytes,d.Offset)!=0x04034b50 || U16(bytes,d.Offset+6)!=d.Flags || U16(bytes,d.Offset+8)!=d.Method || Utf8.GetString(Slice(bytes,d.Offset+30,n))!=d.Name || (long)data+d.Compressed>directory) throw Error("archive_malformed");
            if((d.Flags&8)==0 && (U32(bytes,d.Offset+14)!=d.Crc || U32(bytes,d.Offset+18)!=d.Compressed || U32(bytes,d.Offset+22)!=d.Length)) throw Error("archive_malformed");
            occupied.Add((d.Offset,checked(data+d.Compressed)));
        }
        occupied.Sort((a,b)=>a.Start.CompareTo(b.Start)); for(int i=1;i<occupied.Count;i++) if(occupied[i].Start<occupied[i-1].End) throw Error("archive_malformed");
        if(total+bytes.Length>RasterCodec.MaximumWorkingBytes) throw Error("size_limit_exceeded");
        var entries=new Dictionary<string,byte[]>(StringComparer.Ordinal);
        foreach(var d in descriptors)
        {
            cancellationToken.ThrowIfCancellationRequested(); int data=d.Offset+30+U16(bytes,d.Offset+26)+U16(bytes,d.Offset+28); var compressed=Slice(bytes,data,d.Compressed).ToArray(); byte[] content;
            try {content=d.Method==0?compressed:RasterCodec.Inflate(compressed,d.Length,true);} catch(InvalidDataException) {throw Error("archive_malformed");} catch(EndOfStreamException) {throw Error("archive_malformed");}
            if(content.Length!=d.Length || RasterCodec.Crc32(content)!=d.Crc) throw Error("archive_malformed"); entries.Add(d.Name,content);
        }
        return entries;
    }
    private static void ValidatePath(string path)
    {
        if(path.Length==0 || path!=path.Normalize(NormalizationForm.FormC) || path.Contains('\\') || path.Contains(':') || path.Any(c=>c<32 || c==127) || path.Split('/').Any(p=>p.Length==0 || p=="." || p=="..")) throw Error("archive_path_invalid");
    }
    private static void Keys(JsonElement v, params string[] expected)
    {
        if(v.ValueKind!=JsonValueKind.Object || !v.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal))) throw Error("manifest_malformed");
    }
    private static string Text(JsonElement v,string key) {var p=v.GetProperty(key); if(p.ValueKind!=JsonValueKind.String) throw Error("manifest_malformed"); return p.GetString()!;}
    private static int Integer(JsonElement v,string key) {if(!v.GetProperty(key).TryGetInt32(out int i)) throw Error("manifest_malformed"); return i;}
    private static double Number(JsonElement v,string key) {if(!v.GetProperty(key).TryGetDouble(out double n) || !double.IsFinite(n)) throw Error("manifest_malformed"); return n;}
    private static string Id(JsonElement v,string key) {string id=Text(v,key); if(!Regex.IsMatch(id,"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$") || id=="00000000-0000-0000-0000-000000000000") throw Error("identity_invalid"); return id;}
    private static void UniqueProperties(JsonElement element)
    {
        if(element.ValueKind==JsonValueKind.Object) {var names=new HashSet<string>(StringComparer.Ordinal); foreach(var p in element.EnumerateObject()) {if(!names.Add(p.Name)) throw Error("manifest_malformed"); UniqueProperties(p.Value);}}
        else if(element.ValueKind==JsonValueKind.Array) foreach(var v in element.EnumerateArray()) UniqueProperties(v);
    }
    public static DecodedSource Decode(byte[] bytes,CancellationToken cancellationToken=default)
    {
        try {return DecodeCore(bytes,cancellationToken);} catch(SourceDecodeException) {throw;} catch(Exception e) when(e is JsonException or KeyNotFoundException or InvalidOperationException or OverflowException or DecoderFallbackException or InvalidDataException or EndOfStreamException) {throw Error("manifest_malformed");}
    }
    private static DecodedSource DecodeCore(byte[] bytes,CancellationToken token)
    {
        var entries=ReadZip(bytes,token); if(!entries.TryGetValue("manifest.json",out var manifest)) throw Error("manifest_missing");
        using var doc=JsonDocument.Parse(Utf8.GetString(manifest)); var m=doc.RootElement; UniqueProperties(m);
        if(m.ValueKind!=JsonValueKind.Object || Text(m,"format")!="flamoris-cutwork") throw Error("format_invalid");
        int schema=Integer(m,"schemaVersion"); if(schema!=1 && schema!=2) throw Error("schema_unsupported"); Keys(m,"format","schemaVersion","documentId","canvas","original","layers");
        string documentId=Id(m,"documentId"); var canvas=m.GetProperty("canvas"); Keys(canvas,"width","height","colorSpace","pixelFormat"); int width=Integer(canvas,"width"), height=Integer(canvas,"height");
        try {RasterCodec.Dimensions(width,height);} catch(SourceDecodeException) {throw Error("canvas_invalid");}
        if(Text(canvas,"colorSpace")!="srgb8" || Text(canvas,"pixelFormat")!="straight-bgra32") throw Error("canvas_invalid");
        var original=m.GetProperty("original"); Keys(original,"asset","sha256","sourceName"); if(Text(original,"asset")!="assets/original.png" || string.IsNullOrWhiteSpace(Text(original,"sourceName"))) throw Error("manifest_malformed");
        var layers=m.GetProperty("layers"); if(layers.ValueKind!=JsonValueKind.Array) throw Error("manifest_malformed");
        var identities=new HashSet<string>{documentId}; var partIds=new HashSet<string>(); var orders=new HashSet<int>(); var referenced=new HashSet<string>{"manifest.json","assets/original.png"}; int baseIndex=-1,index=0; long working=(long)width*height*9;
        foreach(var layer in layers.EnumerateArray())
        {
            token.ThrowIfCancellationRequested(); string kind=Text(layer,"kind"); var keys=new List<string>{"id","kind","name","semanticName","visible","bounds"};
            if(kind!="base") keys.AddRange(["asset","sha256"]); if(kind=="patch") keys.AddRange(["transform","sourcePolygon"]); if(kind=="part" && schema==2) keys.Add("partOrder"); if(kind=="repair" && schema==2 && layer.TryGetProperty("ownerPartId",out _)) keys.Add("ownerPartId"); Keys(layer,keys.ToArray());
            string id=Id(layer,"id"); if(!identities.Add(id)) throw Error("identity_duplicate");
            _=Text(layer,"name"); var semantic=layer.GetProperty("semanticName"); if(semantic.ValueKind!=JsonValueKind.Null && (semantic.ValueKind!=JsonValueKind.String || string.IsNullOrWhiteSpace(semantic.GetString()))) throw Error("layer_invalid");
            if(layer.GetProperty("visible").ValueKind!=JsonValueKind.True && layer.GetProperty("visible").ValueKind!=JsonValueKind.False) throw Error("layer_invalid");
            var b=layer.GetProperty("bounds"); Keys(b,"x","y","width","height"); int x=Integer(b,"x"), y=Integer(b,"y"), w=Integer(b,"width"), h=Integer(b,"height"); if(x<0 || y<0 || w<=0 || h<=0 || (long)x+w>width || (long)y+h>height) throw Error("layer_bounds_invalid");
            if(kind=="base") {if(baseIndex>=0 || x!=0 || y!=0 || w!=width || h!=height) throw Error("base_invalid"); baseIndex=index;}
            else
            {
                if(kind!="part" && kind!="patch" && kind!="repair") throw Error("layer_invalid"); string asset=$"layers/{id.Replace("-", "")}/{(kind=="part"?"mask.png":"pixels.png")}"; if(Text(layer,"asset")!=asset) throw Error("layer_invalid"); referenced.Add(asset);
                working+=(long)w*h*(kind=="part"?5:8);
                if(kind=="part") {partIds.Add(id); if(schema==2) {int order=Integer(layer,"partOrder"); if(order<0 || order==int.MaxValue || !orders.Add(order)) throw Error("layer_invalid");}}
                if(kind=="patch") ValidatePatch(layer,w,h,width,height);
            }
            index++;
        }
        if(baseIndex<0) throw Error("layer_order_invalid"); index=0;
        foreach(var layer in layers.EnumerateArray()) {string kind=Text(layer,"kind"); if((index<baseIndex && kind!="part") || (index>baseIndex && kind!="patch" && kind!="repair")) throw Error("layer_order_invalid"); if(layer.TryGetProperty("ownerPartId",out _) && !partIds.Contains(Id(layer,"ownerPartId"))) throw Error("layer_invalid"); index++;}
        if(entries.Keys.Any(p=>!referenced.Contains(p))) throw Error("asset_unexpected");
        // Include live ZIP payloads and PNG decode scratch in the candidate budget.
        if(working+bytes.Length+entries.Values.Sum(v=>(long)v.Length)>RasterCodec.MaximumWorkingBytes) throw Error("size_limit_exceeded");
        byte[] Asset(JsonElement descriptor,int w,int h,int color)
        {
            token.ThrowIfCancellationRequested(); string path=Text(descriptor,"asset"), hash=Text(descriptor,"sha256"); if(!Regex.IsMatch(hash,"^[0-9a-f]{64}$")) throw Error("checksum_invalid"); if(!entries.TryGetValue(path,out var encoded)) throw Error("asset_missing"); if(Convert.ToHexStringLower(SHA256.HashData(encoded))!=hash) throw Error("checksum_mismatch");
            try {return RasterCodec.DecodePng(encoded,w,h,color);} catch(InvalidDataException) {throw Error("png_invalid");}
        }
        var rgba=Asset(original,width,height,6); var union=new byte[width*height]; var images=new Dictionary<string,SourceRaster>();
        foreach(var layer in layers.EnumerateArray())
        {
            if(Text(layer,"kind")!="part") continue; var b=layer.GetProperty("bounds"); int x=Integer(b,"x"), y=Integer(b,"y"), w=Integer(b,"width"), h=Integer(b,"height"); var mask=Asset(layer,w,h,0); var part=new byte[w*h*4];
            for(int yy=0;yy<h;yy++) {token.ThrowIfCancellationRequested(); for(int xx=0;xx<w;xx++) {int local=yy*w+xx, global=(y+yy)*width+x+xx; rgba.AsSpan(global*4,4).CopyTo(part.AsSpan(local*4,4)); part[local*4+3]=(byte)((rgba[global*4+3]*mask[local]+127)/255); union[global]=Math.Max(union[global],mask[local]);}}
            images.Add(Text(layer,"id"),new(w,h,part));
        }
        var basePixels=rgba.ToArray(); for(int i=0;i<union.Length;i++) basePixels[i*4+3]=(byte)((rgba[i*4+3]*(255-union[i])+127)/255);
        foreach(var layer in layers.EnumerateArray()) {string kind=Text(layer,"kind"); if(kind=="part") continue; var b=layer.GetProperty("bounds"); int w=Integer(b,"width"),h=Integer(b,"height"); images.Add(Text(layer,"id"),new(w,h,kind=="base"?basePixels:Asset(layer,w,h,6)));}
        return new(m.Clone(),images);
    }
    private static void ValidatePatch(JsonElement layer,int w,int h,int width,int height)
    {
        var t=layer.GetProperty("transform"); Keys(t,"centerX","centerY","scale","rotationDegrees"); double x=Number(t,"centerX"), y=Number(t,"centerY"), scale=Number(t,"scale"), rotation=Number(t,"rotationDegrees"); if(scale<.01 || scale>10 || rotation<=-180 || rotation>180) throw Error("patch_transform_invalid");
        double c=Math.Cos(rotation*Math.PI/180)*scale,s=Math.Sin(rotation*Math.PI/180)*scale; var points=new[]{(-w/2.0,-h/2.0),(w/2.0,-h/2.0),(w/2.0,h/2.0),(-w/2.0,h/2.0)}; var xs=points.Select(p=>x+p.Item1*c-p.Item2*s).ToArray(); var ys=points.Select(p=>y+p.Item1*s+p.Item2*c).ToArray(); if(Math.Floor(xs.Min())<0 || Math.Floor(ys.Min())<0 || Math.Ceiling(xs.Max())>width || Math.Ceiling(ys.Max())>height || Math.Ceiling(xs.Max())<=Math.Floor(xs.Min()) || Math.Ceiling(ys.Max())<=Math.Floor(ys.Min())) throw Error("patch_transform_invalid");
        var polygon=layer.GetProperty("sourcePolygon"); if(polygon.ValueKind!=JsonValueKind.Array || (polygon.GetArrayLength()>0 && polygon.GetArrayLength()<3)) throw Error("layer_invalid"); foreach(var p in polygon.EnumerateArray()) {Keys(p,"x","y"); double px=Number(p,"x"),py=Number(p,"y"); if(px<0 || py<0 || px>width || py>height) throw Error("layer_invalid");}
    }
}
