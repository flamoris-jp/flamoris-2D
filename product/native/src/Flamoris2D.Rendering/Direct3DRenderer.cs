using System.Numerics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.D3DCompiler;
using Vortice.Mathematics;
using static Vortice.Direct3D11.D3D11;

namespace Flamoris.Flamoris2D.Rendering;

// Candidate D. No Project/evaluator references. GPU receives only canonical geometry, UVs and blend order.
public sealed class Direct3DRenderer : IDisposable
{
    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly ID3D11VertexShader _vertex;
    private readonly ID3D11PixelShader _pixel;
    private readonly ID3D11InputLayout _layout;
    private readonly ID3D11SamplerState _sampler;
    private readonly ID3D11RasterizerState _raster;
    private readonly ID3D11BlendState _over, _add;
    private readonly Dictionary<string,(RenderTexture Input, ID3D11Texture2D Texture, ID3D11ShaderResourceView View)> _textures = [];
    private readonly object _gate = new();
    private bool _disposed;
    public string Driver { get; }
    private readonly record struct Vertex(Vector2 Position, Vector2 Uv0, Vector2 Uv1, Vector4 Mix);
    private sealed class Surface : IDisposable
    {
        public readonly ID3D11Texture2D Texture;
        public readonly ID3D11RenderTargetView Target;
        public readonly ID3D11ShaderResourceView View;
        public Surface(ID3D11Device device,int width,int height)
        {
            Texture=device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm,(uint)width,(uint)height,
                mipLevels:1,bindFlags:BindFlags.RenderTarget|BindFlags.ShaderResource));
            Target=device.CreateRenderTargetView(Texture);View=device.CreateShaderResourceView(Texture);
        }
        public void Dispose(){View.Dispose();Target.Dispose();Texture.Dispose();}
    }
    private const string Shader = """
        Texture2D image0 : register(t0);
        Texture2D image1 : register(t1);
        Texture2D mask : register(t2);
        SamplerState linearClamp : register(s0);
        struct Input {float2 p:POSITION;float2 uv0:TEXCOORD0;float2 uv1:TEXCOORD1;float4 mix:TEXCOORD2;};
        struct Pixel {float4 p:SV_POSITION;float2 uv0:TEXCOORD0;float2 uv1:TEXCOORD1;float4 mix:TEXCOORD2;};
        Pixel VS(Input i){Pixel o;o.p=float4(i.p,0,1);o.uv0=i.uv0;o.uv1=i.uv1;o.mix=i.mix;return o;}
        float4 PS(Pixel i):SV_TARGET{
            float alpha=1;
            if(i.mix.w>0){uint w,h;mask.GetDimensions(w,h);alpha=mask.Sample(linearClamp,i.p.xy/float2(w,h)).a;}
            return (image0.Sample(linearClamp,i.uv0)*i.mix.x+image1.Sample(linearClamp,i.uv1)*i.mix.y)*i.mix.z*alpha;
        }
        """;
    public Direct3DRenderer(bool software = false)
    {
        var driver=software?DriverType.Warp:DriverType.Hardware;
        D3D11CreateDevice(IntPtr.Zero,driver,DeviceCreationFlags.BgraSupport,[FeatureLevel.Level_11_0],
            out _device,out var feature,out _context).CheckError();
        Driver=$"{driver}/{feature}";
        try
        {
            var vs=Compiler.Compile(Shader,"VS","native-composition","vs_5_0");
            var ps=Compiler.Compile(Shader,"PS","native-composition","ps_5_0");
            _vertex=_device.CreateVertexShader(vs.Span);_pixel=_device.CreatePixelShader(ps.Span);
            _layout=_device.CreateInputLayout([
                new InputElementDescription("POSITION",0,Format.R32G32_Float,0,0),
                new InputElementDescription("TEXCOORD",0,Format.R32G32_Float,8,0),
                new InputElementDescription("TEXCOORD",1,Format.R32G32_Float,16,0),
                new InputElementDescription("TEXCOORD",2,Format.R32G32B32A32_Float,24,0)],vs.Span);
            _sampler=_device.CreateSamplerState(SamplerDescription.LinearClamp);
            _raster=_device.CreateRasterizerState(RasterizerDescription.CullNone);
            _over=_device.CreateBlendState(new BlendDescription(Blend.One,Blend.InverseSourceAlpha));
            _add=_device.CreateBlendState(new BlendDescription(Blend.One,Blend.One));
        }
        catch {_context.Dispose();_device.Dispose();throw;}
    }
    private ID3D11ShaderResourceView Texture(string id,RenderTexture source)
    {
        if(_textures.TryGetValue(id,out var old))
        {
            if(ReferenceEquals(old.Input,source))return old.View;
            old.View.Dispose();old.Texture.Dispose();_textures.Remove(id);
        }
        if(source.Width<=0||source.Height<=0||source.StraightBgra.LongLength!=(long)source.Width*source.Height*4)
            throw new InvalidDataException("Incomplete render texture.");
        var bytes=(byte[])source.StraightBgra.Clone();
        for(var i=0;i<bytes.Length;i+=4)for(var c=0;c<3;c++)bytes[i+c]=(byte)((bytes[i+c]*bytes[i+3]+127)/255);
        var texture=_device.CreateTexture2D(bytes,Format.B8G8R8A8_UNorm,(uint)source.Width,(uint)source.Height);
        var view=_device.CreateShaderResourceView(texture);_textures[id]=(source,texture,view);return view;
    }
    public byte[] Render(JsonElement projection,IReadOnlyDictionary<string,RenderTexture> artwork,int width,int height,
        CancellationToken cancellationToken=default)
    {
        lock(_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed,this);
            if(width<=0||height<=0||width>4096||height>4096||(long)width*height>8_294_400)
                throw new InvalidDataException("Native GPU output budget exceeded.");
            var plan=projection.GetProperty("plan");
            if(plan.GetProperty("unsupportedReasons").GetArrayLength()!=0)throw new InvalidDataException("Unsupported evaluated render plan.");
            var batches=plan.GetProperty("batches").EnumerateArray().ToArray();
            var instances=batches.SelectMany(b=>b.GetProperty("renderInstances").EnumerateArray()).ToDictionary(i=>i.GetProperty("renderInstanceId").GetString()!);
            var maskIds=projection.GetProperty("maskSourceIds").EnumerateArray().Select(i=>i.GetString()!).ToArray();
            if((long)width*height*4*(maskIds.Length+4L)+artwork.Values.Sum(a=>a.StraightBgra.LongLength)>512L*1024*1024)
                throw new InvalidDataException("GPU artwork/composition memory budget exceeded.");
            foreach(var obsolete in _textures.Keys.Except(artwork.Keys).ToArray())
            {var t=_textures[obsolete];t.View.Dispose();t.Texture.Dispose();_textures.Remove(obsolete);}
            var sources=artwork.ToDictionary(a=>a.Key,a=>Texture(a.Key,a.Value));
            var surfaces=new List<Surface>();
            Surface NewSurface(){var s=new Surface(_device,width,height);surfaces.Add(s);_context.ClearRenderTargetView(s.Target,new Color4(0,0,0,0));return s;}
            try
            {
                _context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);_context.IASetInputLayout(_layout);
                _context.VSSetShader(_vertex);_context.PSSetShader(_pixel);_context.PSSetSampler(0,_sampler);
                _context.RSSetState(_raster);_context.RSSetViewport(new Viewport(width,height));
                var masks=new Dictionary<string,Surface>();
                foreach(var id in maskIds)
                {
                    cancellationToken.ThrowIfCancellationRequested();var surface=NewSurface();
                    Draw(instances[id],surface,sources,masks,width,height,projection.GetProperty("contributions").GetProperty(id).GetDouble(),false);
                    masks.Add(id,surface);
                }
                var output=NewSurface();Surface? accumulation=null;
                foreach(var batch in batches)
                {
                    cancellationToken.ThrowIfCancellationRequested();var members=batch.GetProperty("renderInstances").EnumerateArray().ToArray();
                    if(batch.GetProperty("kind").GetString()=="instance")
                    {foreach(var i in members)Draw(i,output,sources,masks,width,height,1,false);}
                    else
                    {
                        accumulation??=NewSurface();Unbind();_context.ClearRenderTargetView(accumulation.Target,new Color4(0,0,0,0));
                        var weight=members.Sum(i=>i.GetProperty("compositeWeight").GetDouble());
                        foreach(var i in members)Draw(i,accumulation,sources,masks,width,height,i.GetProperty("compositeWeight").GetDouble()/weight,true);
                        var mix=new Vector4(1,0,1,0);
                        Vertex[] quad=[new(new(-1,1),new(0,0),new(0,0),mix),new(new(1,1),new(1,0),new(1,0),mix),new(new(1,-1),new(1,1),new(1,1),mix),
                            new(new(-1,1),new(0,0),new(0,0),mix),new(new(1,-1),new(1,1),new(1,1),mix),new(new(-1,-1),new(0,1),new(0,1),mix)];
                        DrawVertices(quad,output,accumulation.View,accumulation.View,accumulation.View,false);
                    }
                }
                Unbind();
                using var staging=_device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm,(uint)width,(uint)height,
                    mipLevels:1,bindFlags:BindFlags.None,usage:ResourceUsage.Staging,cpuAccessFlags:CpuAccessFlags.Read));
                _context.CopyResource(staging,output.Texture);
                var mapped=_context.Map(staging,0,MapMode.Read);
                try
                {
                    var bytes=new byte[checked(width*height*4)];
                    for(var y=0;y<height;y++)Marshal.Copy(mapped.DataPointer+checked((int)(y*mapped.RowPitch)),bytes,y*width*4,width*4);
                    return bytes;
                }
                finally{_context.Unmap(staging,0);}
            }
            finally{Unbind();foreach(var surface in surfaces)surface.Dispose();}
        }
    }
    private static double[] Numbers(JsonElement e)=>e.EnumerateArray().Select(x=>x.GetDouble()).ToArray();
    private void Draw(JsonElement instance,Surface target,Dictionary<string,ID3D11ShaderResourceView> sources,
        Dictionary<string,Surface> masks,int width,int height,double contribution,bool additive)
    {
        var samples=instance.GetProperty("appearanceSamples").EnumerateArray().ToArray();
        var first=samples[0];var second=samples.Length>1?samples[1]:first;
        var uv0=Numbers(first.GetProperty("uvs"));var uv1=Numbers(second.GetProperty("uvs"));
        var positions=Numbers(instance.GetProperty("mesh").GetProperty("positions"));var transform=Numbers(instance.GetProperty("transform"));
        var weights=samples.Sum(s=>s.GetProperty("weight").GetDouble());
        var indices=instance.GetProperty("mesh").GetProperty("indices").EnumerateArray().Select(i=>i.GetInt32()).ToArray();
        if(indices.Length==0)return;
        var source0=sources[first.GetProperty("sourceNodeId").GetString()!];var source1=sources[second.GetProperty("sourceNodeId").GetString()!];
        var clipped=instance.TryGetProperty("clipping",out var clip)&&clip.ValueKind==JsonValueKind.Object;
        var mask=clipped?masks[clip.GetProperty("sourceRenderInstanceId").GetString()!].View:source0;
        var mix=new Vector4((float)(first.GetProperty("weight").GetDouble()/weights),samples.Length>1?(float)(second.GetProperty("weight").GetDouble()/weights):0,
            (float)(instance.GetProperty("opacity").GetDouble()*contribution),clipped?1:0);
        var vertices=new Vertex[indices.Length];
        for(var i=0;i<indices.Length;i++)
        {
            var n=indices[i]*2;var x=transform[0]*positions[n]+transform[2]*positions[n+1]+transform[4];
            var y=transform[1]*positions[n]+transform[3]*positions[n+1]+transform[5];
            vertices[i]=new(new((float)(x/width*2-1),(float)(1-y/height*2)),new((float)uv0[n],(float)uv0[n+1]),new((float)uv1[n],(float)uv1[n+1]),mix);
        }
        DrawVertices(vertices,target,source0,source1,mask,additive);
    }
    private void DrawVertices(Vertex[] vertices,Surface target,ID3D11ShaderResourceView image0,ID3D11ShaderResourceView image1,ID3D11ShaderResourceView mask,bool additive)
    {
        Unbind();_context.OMSetRenderTargets(target.Target);_context.OMSetBlendState(additive?_add:_over);
        _context.PSSetShaderResources(0,[image0,image1,mask]);
        using var buffer=_device.CreateBuffer(vertices,BindFlags.VertexBuffer);
        _context.IASetVertexBuffer(0,buffer,40);_context.Draw((uint)vertices.Length,0);
    }
    private void Unbind(){_context.PSSetShaderResources(0,new ID3D11ShaderResourceView[3]);_context.OMSetRenderTargets(Array.Empty<ID3D11RenderTargetView>());}
    public void Dispose()
    {
        lock(_gate)
        {
            if(_disposed)return;_disposed=true;_context.ClearState();
            foreach(var t in _textures.Values){t.View.Dispose();t.Texture.Dispose();}_textures.Clear();
            _add.Dispose();_over.Dispose();_raster.Dispose();_sampler.Dispose();_layout.Dispose();_pixel.Dispose();_vertex.Dispose();_context.Dispose();_device.Dispose();
        }
    }
}
