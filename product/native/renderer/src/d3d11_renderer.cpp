#include "flamoris2d_renderer.h"
#include <stdexcept>
#define PICOJSON_ASSERT(e) do { if (!(e)) throw std::invalid_argument("Incomplete render projection."); } while (false)
#include "picojson.h"
#include <d3d11.h>
#include <d3dcompiler.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
namespace {
using Value = picojson::value;
using Array = picojson::array;
using Object = picojson::object;
constexpr uint64_t budget = 512ull*1024*1024;
struct Cancelled {};
const Value& field(const Value& v,const char* name) { return v.get<Object>().at(name); }
double number(const Value& v) {
    const double n = v.get<double>();
    if (!std::isfinite(n)) throw std::invalid_argument("Non-finite render value.");
    return n;
}
std::vector<double> numbers(const Value& v) {
    std::vector<double> out; for (const auto& x : v.get<Array>()) out.push_back(number(x)); return out;
}
void check(HRESULT hr) {
    if (FAILED(hr)) throw std::runtime_error("D3D11 operation failed: "+std::to_string(static_cast<int64_t>(hr)));
}
void message(char* out,uint32_t capacity,const char* text) {
    if (!out || !capacity) return;
    const size_t n = std::min(std::strlen(text),static_cast<size_t>(capacity-1));
    std::memcpy(out,text,n); out[n] = 0;
}
template<typename Fn> int32_t boundary(char* error,uint32_t capacity,Fn fn) noexcept {
    message(error,capacity,"");
    try { fn(); return 0; }
    catch (const Cancelled&) { message(error,capacity,"Render cancelled."); return 4; }
    catch (const std::bad_alloc&) { message(error,capacity,"Renderer allocation failed."); return 2; }
    catch (const std::invalid_argument& e) { message(error,capacity,e.what()); return 1; }
    catch (const std::exception& e) { message(error,capacity,e.what()); return 3; }
    catch (...) { message(error,capacity,"Renderer failed."); return 3; }
}
struct Vertex { float x,y,u0,v0,u1,v1,w0,w1,opacity,clipped; };
static_assert(sizeof(Vertex) == 40,"Vertex shader ABI changed");
struct Surface {
    ComPtr<ID3D11Texture2D> texture;
    ComPtr<ID3D11RenderTargetView> target;
    ComPtr<ID3D11ShaderResourceView> view;
};
struct Texture { ComPtr<ID3D11Texture2D> texture; ComPtr<ID3D11ShaderResourceView> view; uint64_t bytes; };
constexpr char shader[] = R"(
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
})";
}

struct fl2dr_renderer {
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    ComPtr<ID3D11VertexShader> vertex;
    ComPtr<ID3D11PixelShader> pixel;
    ComPtr<ID3D11InputLayout> layout;
    ComPtr<ID3D11SamplerState> sampler;
    ComPtr<ID3D11RasterizerState> raster;
    ComPtr<ID3D11BlendState> over,add;
    std::map<std::string,Texture> textures;

    explicit fl2dr_renderer(bool software) {
        const D3D_FEATURE_LEVEL feature = D3D_FEATURE_LEVEL_11_0;
        check(D3D11CreateDevice(nullptr,software ? D3D_DRIVER_TYPE_WARP : D3D_DRIVER_TYPE_HARDWARE,
            nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,&feature,1,D3D11_SDK_VERSION,&device,nullptr,&context));
        ComPtr<ID3DBlob> vs,ps,diagnostics;
        check(D3DCompile(shader,sizeof(shader)-1,"native-composition",nullptr,nullptr,"VS","vs_5_0",0,0,&vs,&diagnostics));
        check(D3DCompile(shader,sizeof(shader)-1,"native-composition",nullptr,nullptr,"PS","ps_5_0",0,0,&ps,&diagnostics));
        check(device->CreateVertexShader(vs->GetBufferPointer(),vs->GetBufferSize(),nullptr,&vertex));
        check(device->CreatePixelShader(ps->GetBufferPointer(),ps->GetBufferSize(),nullptr,&pixel));
        const D3D11_INPUT_ELEMENT_DESC elements[] = {
            {"POSITION",0,DXGI_FORMAT_R32G32_FLOAT,0,0,D3D11_INPUT_PER_VERTEX_DATA,0},
            {"TEXCOORD",0,DXGI_FORMAT_R32G32_FLOAT,0,8,D3D11_INPUT_PER_VERTEX_DATA,0},
            {"TEXCOORD",1,DXGI_FORMAT_R32G32_FLOAT,0,16,D3D11_INPUT_PER_VERTEX_DATA,0},
            {"TEXCOORD",2,DXGI_FORMAT_R32G32B32A32_FLOAT,0,24,D3D11_INPUT_PER_VERTEX_DATA,0}};
        check(device->CreateInputLayout(elements,4,vs->GetBufferPointer(),vs->GetBufferSize(),&layout));
        D3D11_SAMPLER_DESC s{}; s.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
        s.AddressU = s.AddressV = s.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
        s.ComparisonFunc = D3D11_COMPARISON_NEVER; s.MaxLOD = D3D11_FLOAT32_MAX;
        check(device->CreateSamplerState(&s,&sampler));
        D3D11_RASTERIZER_DESC r{}; r.FillMode = D3D11_FILL_SOLID; r.CullMode = D3D11_CULL_NONE; r.DepthClipEnable = TRUE;
        check(device->CreateRasterizerState(&r,&raster));
        auto blend = [&](D3D11_BLEND destination,ComPtr<ID3D11BlendState>& result) {
            D3D11_BLEND_DESC d{}; auto& t = d.RenderTarget[0]; t.BlendEnable = TRUE;
            t.SrcBlend = t.SrcBlendAlpha = D3D11_BLEND_ONE;
            t.DestBlend = t.DestBlendAlpha = destination;
            t.BlendOp = t.BlendOpAlpha = D3D11_BLEND_OP_ADD; t.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
            check(device->CreateBlendState(&d,&result));
        };
        blend(D3D11_BLEND_INV_SRC_ALPHA,over); blend(D3D11_BLEND_ONE,add);
    }
    ~fl2dr_renderer() { if (context) context->ClearState(); }
    void unbind() noexcept {
        ID3D11ShaderResourceView* empty[3]{}; context->PSSetShaderResources(0,3,empty); context->OMSetRenderTargets(0,nullptr,nullptr);
    }
    Surface surface(int width,int height) {
        Surface s; D3D11_TEXTURE2D_DESC d{}; d.Width = static_cast<UINT>(width); d.Height = static_cast<UINT>(height);
        d.MipLevels = d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
        d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
        check(device->CreateTexture2D(&d,nullptr,&s.texture));
        check(device->CreateRenderTargetView(s.texture.Get(),nullptr,&s.target));
        check(device->CreateShaderResourceView(s.texture.Get(),nullptr,&s.view));
        const float zero[4]{}; context->ClearRenderTargetView(s.target.Get(),zero); return s;
    }
    void draw_vertices(const std::vector<Vertex>& vertices,const Surface& target,
        ID3D11ShaderResourceView* a,ID3D11ShaderResourceView* b,ID3D11ShaderResourceView* mask,bool additive) {
        if (vertices.empty()) return;
        if (vertices.size() > std::numeric_limits<UINT>::max()/sizeof(Vertex)) throw std::invalid_argument("Vertex buffer exceeded.");
        unbind(); ID3D11RenderTargetView* rt = target.target.Get(); context->OMSetRenderTargets(1,&rt,nullptr);
        context->OMSetBlendState(additive ? add.Get() : over.Get(),nullptr,0xffffffffu);
        ID3D11ShaderResourceView* views[] = {a,b,mask}; context->PSSetShaderResources(0,3,views);
        D3D11_BUFFER_DESC d{}; d.ByteWidth = static_cast<UINT>(vertices.size()*sizeof(Vertex)); d.BindFlags = D3D11_BIND_VERTEX_BUFFER;
        D3D11_SUBRESOURCE_DATA data{}; data.pSysMem = vertices.data(); ComPtr<ID3D11Buffer> buffer;
        check(device->CreateBuffer(&d,&data,&buffer)); ID3D11Buffer* input = buffer.Get(); const UINT stride = sizeof(Vertex), offset = 0;
        context->IASetVertexBuffers(0,1,&input,&stride,&offset); context->Draw(static_cast<UINT>(vertices.size()),0);
    }
    void draw(const Value& instance,const Surface& target,const std::map<std::string,Surface>& masks,
        int width,int height,double contribution,bool additive) {
        const auto& samples = field(instance,"appearanceSamples").get<Array>();
        if (samples.empty() || samples.size() > 2) throw std::invalid_argument("Unsupported appearance count.");
        const auto& first = samples.front(); const auto& second = samples.size() > 1 ? samples[1] : first;
        const auto uv0 = numbers(field(first,"uvs")), uv1 = numbers(field(second,"uvs"));
        const auto positions = numbers(field(field(instance,"mesh"),"positions")), transform = numbers(field(instance,"transform"));
        const auto& indices = field(field(instance,"mesh"),"indices").get<Array>(); if (indices.empty()) return;
        if (transform.size() != 6 || positions.size()%2 || uv0.size() != positions.size() || uv1.size() != positions.size() || indices.size()%3)
            throw std::invalid_argument("Incomplete render geometry.");
        double weights = 0; for (const auto& s : samples) weights += number(field(s,"weight"));
        if (!(weights > 0) || !std::isfinite(weights)) throw std::invalid_argument("Invalid appearance weights.");
        auto* a = textures.at(field(first,"sourceNodeId").get<std::string>()).view.Get();
        auto* b = textures.at(field(second,"sourceNodeId").get<std::string>()).view.Get();
        const auto& clip = field(instance,"clipping"); const bool clipped = clip.is<Object>();
        auto* mask = clipped ? masks.at(field(clip,"sourceRenderInstanceId").get<std::string>()).view.Get() : a;
        const float w0 = static_cast<float>(number(field(first,"weight"))/weights);
        const float w1 = samples.size() > 1 ? static_cast<float>(number(field(second,"weight"))/weights) : 0;
        const float opacity = static_cast<float>(number(field(instance,"opacity"))*contribution);
        std::vector<Vertex> vertices; vertices.reserve(indices.size());
        for (const auto& index : indices) {
            const double n = number(index);
            if (n < 0 || std::floor(n) != n || n >= static_cast<double>(positions.size()/2)) throw std::invalid_argument("Invalid triangle index.");
            const size_t i = static_cast<size_t>(n)*2;
            const double x = transform[0]*positions[i]+transform[2]*positions[i+1]+transform[4];
            const double y = transform[1]*positions[i]+transform[3]*positions[i+1]+transform[5];
            vertices.push_back({static_cast<float>(x/width*2-1),static_cast<float>(1-y/height*2),
                static_cast<float>(uv0[i]),static_cast<float>(uv0[i+1]),static_cast<float>(uv1[i]),static_cast<float>(uv1[i+1]),
                w0,w1,opacity,clipped ? 1.0f : 0.0f});
        }
        draw_vertices(vertices,target,a,b,mask,additive);
    }
    void render(const Value& projection,int width,int height,uint8_t* output,fl2dr_cancel cancelled,void* cancel_context) {
        struct Cleanup { fl2dr_renderer* r; ~Cleanup() { r->unbind(); r->context->ClearState(); } } cleanup{this};
        auto cancellation = [&] { if (cancelled && cancelled(cancel_context)) throw Cancelled{}; };
        const auto& plan = field(projection,"plan");
        if (!field(plan,"unsupportedReasons").get<Array>().empty()) throw std::invalid_argument("Unsupported evaluated render plan.");
        const auto& batches = field(plan,"batches").get<Array>(); const auto& mask_ids = field(projection,"maskSourceIds").get<Array>();
        uint64_t total = static_cast<uint64_t>(width)*height*4*(static_cast<uint64_t>(mask_ids.size())+4);
        for (const auto& t : textures) total += t.second.bytes;
        if (total > budget) throw std::invalid_argument("GPU artwork/composition memory budget exceeded.");
        std::map<std::string,const Value*> instances;
        for (const auto& batch : batches) for (const auto& i : field(batch,"renderInstances").get<Array>())
            if (!instances.emplace(field(i,"renderInstanceId").get<std::string>(),&i).second) throw std::invalid_argument("Duplicate render identity.");
        context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST); context->IASetInputLayout(layout.Get());
        context->VSSetShader(vertex.Get(),nullptr,0); context->PSSetShader(pixel.Get(),nullptr,0);
        ID3D11SamplerState* s = sampler.Get(); context->PSSetSamplers(0,1,&s); context->RSSetState(raster.Get());
        const D3D11_VIEWPORT viewport{0,0,static_cast<float>(width),static_cast<float>(height),0,1}; context->RSSetViewports(1,&viewport);
        std::map<std::string,Surface> masks;
        for (const auto& id_value : mask_ids) {
            cancellation(); const auto& id = id_value.get<std::string>(); auto target = surface(width,height);
            draw(*instances.at(id),target,masks,width,height,number(field(projection,"contributions").get<Object>().at(id)),false);
            if (!masks.emplace(id,std::move(target)).second) throw std::invalid_argument("Duplicate mask identity.");
        }
        auto result = surface(width,height); std::unique_ptr<Surface> accumulation;
        for (const auto& batch : batches) {
            cancellation(); const auto& members = field(batch,"renderInstances").get<Array>();
            if (field(batch,"kind") == Value("instance")) for (const auto& i : members) { cancellation(); draw(i,result,masks,width,height,1,false); }
            else {
                if (!accumulation) accumulation = std::make_unique<Surface>(surface(width,height));
                unbind(); const float zero[4]{}; context->ClearRenderTargetView(accumulation->target.Get(),zero);
                double weight = 0; for (const auto& i : members) weight += number(field(i,"compositeWeight"));
                if (!(weight > 0) || !std::isfinite(weight)) throw std::invalid_argument("Invalid composite weights.");
                for (const auto& i : members) { cancellation(); draw(i,*accumulation,masks,width,height,number(field(i,"compositeWeight"))/weight,true); }
                const std::vector<Vertex> quad{{-1,1,0,0,0,0,1,0,1,0},{1,1,1,0,1,0,1,0,1,0},{1,-1,1,1,1,1,1,0,1,0},
                    {-1,1,0,0,0,0,1,0,1,0},{1,-1,1,1,1,1,1,0,1,0},{-1,-1,0,1,0,1,1,0,1,0}};
                draw_vertices(quad,result,accumulation->view.Get(),accumulation->view.Get(),accumulation->view.Get(),false);
            }
        }
        cancellation(); unbind(); D3D11_TEXTURE2D_DESC d{}; result.texture->GetDesc(&d);
        d.BindFlags = 0; d.Usage = D3D11_USAGE_STAGING; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        ComPtr<ID3D11Texture2D> staging; check(device->CreateTexture2D(&d,nullptr,&staging)); context->CopyResource(staging.Get(),result.texture.Get());
        D3D11_MAPPED_SUBRESOURCE mapped{}; check(context->Map(staging.Get(),0,D3D11_MAP_READ,0,&mapped));
        for (int y = 0; y < height; ++y) std::memcpy(output+static_cast<size_t>(y)*width*4,
            static_cast<const uint8_t*>(mapped.pData)+static_cast<size_t>(y)*mapped.RowPitch,static_cast<size_t>(width)*4);
        context->Unmap(staging.Get(),0);
    }
};

int32_t FL2DR_CALL fl2dr_create(int32_t software,fl2dr_renderer** result,char* error,uint32_t capacity) {
    if (result) *result = nullptr;
    return boundary(error,capacity,[&] { if (!result || (software != 0 && software != 1)) throw std::invalid_argument("Invalid renderer creation.");
        *result = new fl2dr_renderer(software != 0); });
}
void FL2DR_CALL fl2dr_destroy(fl2dr_renderer* renderer) { delete renderer; }
int32_t FL2DR_CALL fl2dr_texture(fl2dr_renderer* renderer,const uint8_t* id,uint32_t id_length,
    const uint8_t* bytes,uint32_t length,int32_t width,int32_t height,char* error,uint32_t capacity) {
    return boundary(error,capacity,[&] {
        const uint64_t expected = width > 0 && height > 0 ? static_cast<uint64_t>(width)*height*4 : 0;
        if (!renderer || !id || !id_length || id_length > 1048576 || !bytes || !expected || expected != length || expected > budget)
            throw std::invalid_argument("Incomplete render texture.");
        std::string name(reinterpret_cast<const char*>(id),id_length); uint64_t total = expected;
        for (const auto& item : renderer->textures) if (item.first != name) total += item.second.bytes;
        if (total > budget) throw std::invalid_argument("GPU artwork memory budget exceeded.");
        std::vector<uint8_t> premultiplied(bytes,bytes+length);
        for (size_t i = 0; i < premultiplied.size(); i += 4) for (size_t c = 0; c < 3; ++c)
            premultiplied[i+c] = static_cast<uint8_t>((premultiplied[i+c]*premultiplied[i+3]+127)/255);
        D3D11_TEXTURE2D_DESC d{}; d.Width = static_cast<UINT>(width); d.Height = static_cast<UINT>(height);
        d.MipLevels = d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1; d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
        D3D11_SUBRESOURCE_DATA data{}; data.pSysMem = premultiplied.data(); data.SysMemPitch = static_cast<UINT>(width)*4;
        Texture texture{}; texture.bytes = expected;
        check(renderer->device->CreateTexture2D(&d,&data,&texture.texture));
        check(renderer->device->CreateShaderResourceView(texture.texture.Get(),nullptr,&texture.view));
        renderer->textures[name] = std::move(texture);
    });
}
int32_t FL2DR_CALL fl2dr_remove_texture(fl2dr_renderer* renderer,const uint8_t* id,uint32_t length) {
    return boundary(nullptr,0,[&] { if (!renderer || !id || !length || length > 1048576) throw std::invalid_argument("Invalid texture identity.");
        renderer->textures.erase(std::string(reinterpret_cast<const char*>(id),length)); });
}
int32_t FL2DR_CALL fl2dr_render(fl2dr_renderer* renderer,const uint8_t* projection,uint32_t length,
    int32_t width,int32_t height,uint8_t* output,uint32_t capacity,fl2dr_cancel cancelled,void* cancel_context,char* error,uint32_t error_capacity) {
    return boundary(error,error_capacity,[&] {
        const uint64_t bytes = width > 0 && height > 0 ? static_cast<uint64_t>(width)*height*4 : 0;
        if (!renderer || !projection || !length || length > 32u*1024*1024 || !output || !bytes || width > 4096 || height > 4096 || bytes > 8294400ull*4 || bytes > capacity)
            throw std::invalid_argument("Native GPU output/input budget exceeded.");
        Value parsed; std::string parse_error;
        const auto* first = reinterpret_cast<const char*>(projection);
        const auto* last = first+length;
        auto end = picojson::parse(parsed,first,last,&parse_error);
        while (end != last && (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n')) ++end;
        if (!parse_error.empty() || end != last) throw std::invalid_argument("Malformed render projection.");
        renderer->render(parsed,width,height,output,cancelled,cancel_context);
    });
}
