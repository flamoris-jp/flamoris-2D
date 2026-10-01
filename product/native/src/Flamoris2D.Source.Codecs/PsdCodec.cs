using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Flamoris.Flamoris2D.Source;

public static class PsdCodec
{
    private sealed class Reader(byte[] bytes,int start=0,int? end=null)
    {
        public int Position=start;
        public readonly int End=end??bytes.Length;
        public int Remaining=>End-Position;
        public ReadOnlySpan<byte> Read(int n) {if(n<0 || (long)Position+n>End) throw new InvalidDataException("PSD section is truncated."); var value=bytes.AsSpan(Position,n); Position+=n; return value;}
        public byte Byte()=>Read(1)[0];
        public ushort U16()=>BinaryPrimitives.ReadUInt16BigEndian(Read(2));
        public short I16()=>BinaryPrimitives.ReadInt16BigEndian(Read(2));
        public uint U32()=>BinaryPrimitives.ReadUInt32BigEndian(Read(4));
        public int I32()=>BinaryPrimitives.ReadInt32BigEndian(Read(4));
        public int Length(bool large=false) {if(large && U32()!=0) throw new InvalidDataException("PSD section exceeds 4 GiB."); return checked((int)U32());}
        public string Signature()=>Encoding.ASCII.GetString(Read(4));
        public Reader Section(bool large=false) {int length=Length(large),start=Position; Read(length); return new(bytes,start,Position);}
        public bool IsSignature() => Remaining>=4 && (bytes.AsSpan(Position,4).SequenceEqual("8BIM"u8) || bytes.AsSpan(Position,4).SequenceEqual("8B64"u8));
    }
    private sealed class Layer
    {
        public readonly JsonObject Description=new();
        public readonly List<(short Id,int Length)> Channels=[];
        public int Divider,Left,Top,Right,Bottom;
        public string? DividerBlend;
    }
    private static readonly IReadOnlyDictionary<string,string> Blends=new Dictionary<string,string>
    {
        ["pass"]="pass through",["norm"]="normal",["diss"]="dissolve",["dark"]="darken",["mul "]="multiply",["idiv"]="color burn",["lbrn"]="linear burn",["dkCl"]="darker color",["lite"]="lighten",["scrn"]="screen",["div "]="color dodge",["lddg"]="linear dodge",["lgCl"]="lighter color",["over"]="overlay",["sLit"]="soft light",["hLit"]="hard light",["vLit"]="vivid light",["lLit"]="linear light",["pLit"]="pin light",["hMix"]="hard mix",["diff"]="difference",["smud"]="exclusion",["fsub"]="subtract",["fdiv"]="divide",["hue "]="hue",["sat "]="saturation",["colr"]="color",["lum "]="luminosity"
    };
    private static readonly HashSet<string> LargeKeys=["LMsk","Lr16","Lr32","Layr","Mt16","Mt32","Mtrn","Alph","FMsk","lnk2","FEid","FXid","PxSD"];
    public static DecodedSource Decode(byte[] bytes,CancellationToken cancellationToken=default)
    {
        try {return DecodeCore(bytes,cancellationToken);} catch(SourceDecodeException) {throw;} catch(Exception e) when(e is InvalidDataException or EndOfStreamException or OverflowException or ArgumentException or IndexOutOfRangeException) {throw new SourceDecodeException("source.psd_invalid",e.Message);}
    }
    private static DecodedSource DecodeCore(byte[] bytes,CancellationToken token)
    {
        if(bytes.Length>128*1024*1024) throw new SourceDecodeException("source.size_limit_exceeded","PSD exceeds the file limit.");
        var reader=new Reader(bytes); if(reader.Signature()!="8BPS") throw new InvalidDataException("PSD signature is invalid."); int version=reader.U16(); bool large=version==2; if(version!=1 && version!=2) throw new InvalidDataException("Unsupported PSD version.");
        if(reader.Read(6).ContainsAnyExcept((byte)0)) throw new InvalidDataException("PSD reserved bytes are invalid."); int channelCount=reader.U16(); if(channelCount<1 || channelCount>56) throw new InvalidDataException("PSD channel count is invalid.");
        int height=checked((int)reader.U32()),width=checked((int)reader.U32()),depth=reader.U16(),mode=reader.U16(); RasterCodec.Dimensions(width,height);
        if((depth!=8 && depth!=16 && depth!=32) || (mode!=0 && mode!=1 && mode!=2 && mode!=3)) throw new InvalidDataException("Unsupported PSD depth or color mode.");
        reader.Section(); reader.Section(); var layerMask=reader.Section(large); var images=new Dictionary<string,SourceRaster>(); var children=new JsonArray(); long working=bytes.Length*2L;
        if(layerMask.Remaining>0)
        {
            var info=layerMask.Section(large); if(info.Remaining>0) children=ReadLayers(info,large,depth,mode,images,ref working,token);
            if(layerMask.Remaining>=4) layerMask.Section();
            while(layerMask.Remaining>=12)
            {
                while(layerMask.Remaining>0 && !layerMask.IsSignature()) layerMask.Read(1);
                if(layerMask.Remaining<12) break; string sig=layerMask.Signature(),key=layerMask.Signature(); var block=layerMask.Section(sig=="8B64" || (large && LargeKeys.Contains(key)));
                if(key=="Lr16" || key=="Lr32" || key=="Layr") {images.Clear(); working=bytes.Length*2L; children=ReadLayers(block,large,key=="Lr16"?16:key=="Lr32"?32:depth,mode,images,ref working,token);}
                if((block.End&1)!=0 && layerMask.Remaining>0) layerMask.Read(1);
            }
        }
        if(images.Count==0) throw new InvalidDataException("No raster PSD layers were found.");
        var description=new JsonObject{{"width",width},{"height",height},{"children",children}};
        return new(JsonSerializer.SerializeToElement(description),images);
    }
    private static JsonArray ReadLayers(Reader reader,bool large,int depth,int mode,Dictionary<string,SourceRaster> images,ref long working,CancellationToken token)
    {
        int count=Math.Abs((int)reader.I16()); if(count>4096) throw new SourceDecodeException("source.size_limit_exceeded","PSD has too many layers."); var layers=new List<Layer>();
        for(int i=0;i<count;i++)
        {
            token.ThrowIfCancellationRequested(); var l=new Layer {Top=reader.I32(),Left=reader.I32(),Bottom=reader.I32(),Right=reader.I32()};
            int w=checked(l.Right-l.Left),h=checked(l.Bottom-l.Top); if(w<0 || h<0 || w>16384 || h>16384 || (long)w*h>100000000) throw new InvalidDataException("PSD layer bounds are invalid.");
            int channels=reader.U16(); if(channels>56) throw new InvalidDataException("PSD layer has too many channels."); for(int c=0;c<channels;c++) l.Channels.Add((reader.I16(),reader.Length(large)));
            if(reader.Signature()!="8BIM") throw new InvalidDataException("PSD blend signature is invalid."); string blend=reader.Signature(); if(!Blends.TryGetValue(blend,out var blendName)) throw new InvalidDataException("PSD blend mode is invalid.");
            l.Description["blendMode"]=blendName; l.Description["opacity"]=reader.Byte()/255.0; l.Description["clipping"]=reader.Byte()==1; l.Description["hidden"]=(reader.Byte()&2)!=0; reader.Byte();
            l.Description["left"]=l.Left;l.Description["top"]=l.Top;l.Description["right"]=l.Right;l.Description["bottom"]=l.Bottom;
            var extra=reader.Section(); extra.Section(); extra.Section(); l.Description["name"]=Encoding.Latin1.GetString(extra.Read(extra.Byte()));
            while(extra.Remaining>4 && !extra.IsSignature()) extra.Read(1);
            while(extra.Remaining>=12)
            {
                if(!extra.IsSignature()) break; string sig=extra.Signature(),key=extra.Signature(); var block=extra.Section(sig=="8B64" || (large && LargeKeys.Contains(key)));
                if(key=="luni" && block.Remaining>=4) {int n=checked((int)block.U32()); l.Description["name"]=Encoding.BigEndianUnicode.GetString(block.Read(checked(n*2))).TrimEnd('\0');}
                if(key=="lyid" && block.Remaining>=4) l.Description["id"]=block.U32();
                if((key=="lsct" || key=="lsdk") && block.Remaining>=4) {l.Divider=checked((int)block.U32()); if(block.Remaining>=8 && block.Signature()=="8BIM" && Blends.TryGetValue(block.Signature(),out var b)) l.DividerBlend=b;}
                // PSD additional-info records are padded to an even byte length.
                if((block.End&1)!=0 && extra.Remaining>0) extra.Read(1);
                while(extra.Remaining>4 && !extra.IsSignature()) extra.Read(1);
            }
            layers.Add(l);
        }
        foreach(var l in layers)
        {
            token.ThrowIfCancellationRequested(); int w=l.Right-l.Left,h=l.Bottom-l.Top,pixels=checked(w*h),stride=depth/8; byte[]? rgba=null; uint[]? fingerprintPixels=null;
            if(pixels>0) {long live=working+(long)pixels*(4+stride*2+(depth==8?0:16)); if(live>RasterCodec.MaximumWorkingBytes) throw new SourceDecodeException("source.size_limit_exceeded","PSD raster working set exceeds the limit."); rgba=new byte[pixels*4]; if(depth!=8) fingerprintPixels=new uint[pixels*4]; for(int p=0;p<pixels;p++) {rgba[p*4+3]=depth==32?(byte)1:(byte)255; if(fingerprintPixels is not null) fingerprintPixels[p*4+3]=depth==32?1u:65535u;} working+=rgba.Length+(fingerprintPixels?.LongLength??0)*4;}
            foreach(var (id,length) in l.Channels)
            {
                var channel=new Reader(reader.Read(length).ToArray()); if(length==0) continue; if(length<2) throw new InvalidDataException("Invalid PSD channel length."); int compression=channel.U16(); if(compression>3) throw new InvalidDataException("Invalid PSD compression.");
                // Masks and extra channels do not become the original importer's layer pixels.
                if(rgba is null || id<-1 || id>2 || l.Divider==1 || l.Divider==2) continue;
                byte[] data=DecodeChannel(channel,compression,w,h,depth,large,token); int component=id==-1?3:id;
                for(int p=0;p<pixels;p++)
                {
                    // Preserve the existing Node adapter's Uint8Array conversion (including HDR/16-bit truncation).
                    uint decoded=depth==8?data[p]:depth==16?BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(p*2,2)):JsInt(BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(p*4,4)))); byte value=unchecked((byte)decoded); rgba[p*4+component]=value; if(fingerprintPixels is not null) fingerprintPixels[p*4+component]=decoded;
                    if(mode==1 && component==0) {rgba[p*4+1]=value;rgba[p*4+2]=value;if(fingerprintPixels is not null) {fingerprintPixels[p*4+1]=decoded;fingerprintPixels[p*4+2]=decoded;}}
                }
            }
            if(rgba is not null && l.Divider!=1 && l.Divider!=2 && l.Divider!=3)
            {
                string imageId="psd-image-"+images.Count; images.Add(imageId,new(w,h,rgba)); l.Description["image"]=new JsonObject{{"id",imageId},{"width",w},{"height",h}};
                l.Description["rasterFingerprint"]=Fingerprint(w,h,rgba,fingerprintPixels);
            }
        }
        var root=new JsonArray(); var stack=new Stack<JsonArray>(); stack.Push(root);
        for(int i=layers.Count-1;i>=0;i--)
        {
            var l=layers[i]; if(l.Divider==3) {if(stack.Count<=1) throw new InvalidDataException("PSD group terminator is unmatched.");stack.Pop();}
            else {stack.Peek().Insert(0,l.Description); if(l.Divider==1 || l.Divider==2) {var child=new JsonArray();l.Description["children"]=child;if(l.DividerBlend is not null) l.Description["blendMode"]=l.DividerBlend;stack.Push(child);}}
        }
        if(stack.Count!=1) throw new InvalidDataException("PSD group is unclosed."); return root;
    }
    private static uint JsInt(float value) {if(!float.IsFinite(value)) return 0; return unchecked((uint)(long)(Math.Truncate((double)value)%4294967296.0));}
    private static string Fingerprint(int width,int height,byte[] rgba,uint[]? fullDepth)
    {
        uint hash=0x811c9dc5; void Mix(uint value) {hash=unchecked((hash^value)*0x01000193);}
        Mix((uint)width&255);Mix((uint)(width>>8)&255);Mix((uint)height&255);Mix((uint)(height>>8)&255);if(fullDepth is null) foreach(byte b in rgba) Mix(b);else foreach(uint v in fullDepth) Mix(v);return $"fnv1a32:{width}x{height}:{hash:x8}";
    }
    private static byte[] DecodeChannel(Reader channel,int compression,int width,int height,int depth,bool large,CancellationToken token)
    {
        int rowBytes=checked(width*(depth/8)),length=checked(rowBytes*height); byte[] data;
        if(compression==0) {data=channel.Read(length).ToArray(); if(channel.Remaining!=0) throw new InvalidDataException("PSD raw channel length mismatch.");}
        else if(compression==1)
        {
            var lengths=new int[height]; for(int y=0;y<height;y++) lengths[y]=large?channel.Length():channel.U16(); data=new byte[length];
            for(int y=0;y<height;y++)
            {
                token.ThrowIfCancellationRequested(); var row=new Reader(channel.Read(lengths[y]).ToArray()); int offset=y*rowBytes,end=offset+rowBytes;
                while(row.Remaining>0) {int n=unchecked((sbyte)row.Byte()); if(n>=0) {int bytes=n+1;if(offset+bytes>end) throw new InvalidDataException("PSD RLE row overflow.");row.Read(bytes).CopyTo(data.AsSpan(offset,bytes));offset+=bytes;} else if(n!=-128) {int bytes=1-n; byte b=row.Byte();if(offset+bytes>end) throw new InvalidDataException("PSD RLE row overflow.");data.AsSpan(offset,bytes).Fill(b);offset+=bytes;}}
                if(offset!=end) throw new InvalidDataException("PSD RLE row is truncated.");
            }
            if(channel.Remaining!=0) throw new InvalidDataException("PSD RLE has trailing bytes.");
        }
        else
        {
            data=RasterCodec.Inflate(channel.Read(channel.Remaining).ToArray(),length);
            if(compression==3) for(int y=0;y<height;y++) {token.ThrowIfCancellationRequested(); if(depth==16) {for(int x=1;x<width;x++) {int i=y*rowBytes+x*2; ushort v=unchecked((ushort)(BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(i,2))+BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(i-2,2))));BinaryPrimitives.WriteUInt16BigEndian(data.AsSpan(i,2),v);}} else {for(int x=1;x<rowBytes;x++) data[y*rowBytes+x]=unchecked((byte)(data[y*rowBytes+x]+data[y*rowBytes+x-1]));}}
            if(depth==32) {var reordered=new byte[length];for(int y=0;y<height;y++) for(int x=0;x<width;x++) for(int b=0;b<4;b++) reordered[y*rowBytes+x*4+b]=data[y*rowBytes+b*width+x];data=reordered;}
        }
        return data;
    }
}
