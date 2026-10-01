#include "flamoris2d_core.h"
#include "native_commands.h"
#include "native_source_review.h"
#include "native_locale.h"
#include <algorithm>
#include <cstring>
#include <functional>
#include <iomanip>
#include <memory>
#include <sstream>

namespace {
using namespace fl2d_commands;
std::string text(const Value& v) {return v.is<std::string>()?v.get<std::string>():"";}
double number(const Value& v,double fallback=0) {return v.is<double>()?v.get<double>():fallback;}
bool boolean(const Value& v,bool fallback=false) {return v.is<bool>()?v.get<bool>():fallback;}
Value transform() {return Value(Object{{"position",Value(Object{{"x",Value(0.0)},{"y",Value(0.0)}})},
    {"rotation",Value(0.0)},{"scale",Value(Object{{"x",Value(1.0)},{"y",Value(1.0)}})},
    {"pivot",Value(Object{{"x",Value(0.0)},{"y",Value(0.0)}})}});}
struct Ids {
    std::string name; unsigned sequence=0;
    std::string next(const char* kind) {std::ostringstream s;s<<kind<<'_'<<name<<'_'<<std::setw(4)<<std::setfill('0')<<++sequence;return s.str();}
};
Value project(const std::string& name,double width,double height,Ids& ids) {
    const auto id=ids.next("project"),root=ids.next("node");
    Object rig;for(const auto key:{"deformers","warpControlPoints","warpDeformerKeyforms","bones","bonePoseKeyforms","rigidBoneBindings","skinBindings","boneRotationConstraints","twoBoneIkConstraints","constraints"})rig[key]=Value(Array{});
    Value root_node(Object{{"id",Value(root)},{"kind",Value("group")},{"displayName",Value(name)},{"sourceRef",Value()},
        {"parentId",Value()},{"children",Value(Array{})},{"visible",Value(true)},{"locked",Value(false)},
        {"opacity",Value(1.0)},{"blendMode",Value("normal")},{"transform",transform()}});
    Object result{{"schemaVersion",Value(15.0)},{"timebaseTicksPerSecond",Value(120000.0)},
        {"id",Value(id)},{"displayName",Value(name)},{"canvas",Value(Object{{"width",Value(width)},{"height",Value(height)}})},
        {"scene",Value(Object{{"rootId",Value(root)},{"nodes",Value(Object{{root,root_node}})}})},
        {"rig",Value(rig)},{"animation",Value(Object{{"clips",Value(Array{})},{"deformationSamples",Value(Array{})}})},
        {"renderSettings",Value(Object{{"frameRate",Value(Object{{"numerator",Value(30.0)},{"denominator",Value(1.0)}})},{"alpha",Value(true)}})}};
    for(const auto key:{"sourceAssets","semanticSlots","keyArts","meshes","meshTopologies","meshKeyforms","meshFormCorrectionKeyforms","clippingBindings","transitions","temporalPrograms","sequences"})result[key]=Value(Array{});
    return Value(result);
}
Value node(const std::string& id,const std::string& name,const std::string& parent,bool group,const Value& source,bool visible,double opacity,const std::string& blend,const Value& bounds) {
    Object result{{"id",Value(id)},{"kind",Value(group?"group":"part")},{"displayName",Value(name)},
        {"sourceRef",source},{"parentId",Value(parent)},{"children",Value(Array{})},{"visible",Value(visible)},
        {"locked",Value(false)},{"opacity",Value(opacity)},{"blendMode",Value(blend)},{"transform",transform()}};
    if(!group)result["bounds"]=bounds;
    return Value(result);
}
std::string encoded(const std::string& input) {
    static const char hex[]="0123456789ABCDEF";std::string out;
    for(const auto c:input) {const auto u=static_cast<unsigned char>(c);
        if((u>='a'&&u<='z')||(u>='A'&&u<='Z')||(u>='0'&&u<='9')||std::strchr("-_.!~*'()",u))out+=c;
        else {out+='%';out+=hex[u>>4];out+=hex[u&15];}
    }return out;
}
std::string js_identity(const Value& v) {return v.is<std::string>()?v.get<std::string>():v.serialize();}
Value psd(const Value& request) {
    const auto& source=field(request,"source"),&options=field(request,"options");
    const auto file=field(options,"fileName").is<std::string>()?text(field(options,"fileName")):"source.psd";
    const auto name=field(options,"projectName").is<std::string>()?text(field(options,"projectName")):file;
    Ids ids{"psd"};auto p=project(name,number(field(source,"width")),number(field(source,"height")),ids);
    const auto source_id=ids.next("source"),art_id=ids.next("keyart");
    p.get<Object>()["sourceAssets"]=Value(Array{Value(Object{{"id",Value(source_id)},{"kind",Value("psd")},
        {"fileName",Value(file)},{"displayLabel",Value(file)},{"importedAt",field(options,"importedAt")}})});
    const auto root=text(field(field(p,"scene"),"rootId"));auto& nodes=p.get<Object>().at("scene").get<Object>().at("nodes").get<Object>();
    Array members,bindings;double order=0;
    std::function<void(const Value&,const std::string&,const std::string&,const std::string&,bool)> walk;
    walk=[&](const Value& children,const std::string& parent,const std::string& path,const std::string& identity,bool inherited_order){
        if(!children.is<Array>())return;
        std::map<std::string,unsigned> counts,occurrences;
        for(const auto& layer:children.get<Array>()){const auto n=text(field(layer,"name"));++counts[n.empty()?"(unnamed)":n];}
        for(const auto& layer:children.get<Array>()) {
            auto layer_name=text(field(layer,"name"));if(layer_name.empty())layer_name="(unnamed)";
            const auto occurrence=++occurrences[layer_name];const auto& native=field(layer,"id").is<picojson::null>()?field(layer,"layerId"):field(layer,"id");
            const bool has_native=!native.is<picojson::null>();
            const auto segment=has_native?"id:"+encoded(js_identity(native)):"name:"+encoded(layer_name)+"["+std::to_string(occurrence)+"]";
            const auto identity_path=identity.empty()?segment:identity+"/"+segment;
            const auto full_path=path.empty()?layer_name:path+"/"+layer_name;
            const bool dependent=!has_native && (inherited_order || counts[layer_name]>1);
            const bool group=field(layer,"children").is<Array>();const auto id=ids.next("node");
            const double left=number(field(layer,"left")),top=number(field(layer,"top"));
            const double right=number(field(layer,"right"),left+number(field(field(layer,"image"),"width")));
            const double bottom=number(field(layer,"bottom"),top+number(field(field(layer,"image"),"height")));
            const auto key=has_native?"layer:"+js_identity(native):"path:"+identity_path;
            const Value ref(Object{{"sourceAssetId",Value(source_id)},{"sourceKey",Value(key)},{"path",Value(full_path)},
                {"identityPath",Value(identity_path)},{"identityKind",Value(has_native?"native":"fallback")},
                {"orderDependent",Value(dependent)},{"rasterFingerprint",group?Value():field(layer,"rasterFingerprint")}});
            const bool visible=!boolean(field(layer,"hidden"));const double opacity=number(field(layer,"opacity"),1);
            auto blend=text(field(layer,"blendMode"));if(blend.empty())blend="normal";
            const Value bounds(Object{{"left",Value(left)},{"top",Value(top)},{"right",Value(right)},{"bottom",Value(bottom)}});
            nodes[id]=node(id,layer_name,parent,group,ref,visible,opacity,blend,bounds);
            nodes[parent].get<Object>().at("children").get<Array>().emplace_back(id);
            if(group)walk(field(layer,"children"),id,full_path,identity_path,dependent);
            else {
                members.emplace_back(Object{{"nodeId",Value(id)},{"appearanceId",Value(source_id+":"+key)},
                    {"opacity",Value(opacity)},{"presence",Value(visible?"present":"absent")},
                    {"drawOrder",Value(order++)},{"clipping",Value(Object{{"sourceNodeId",Value()}})}});
                if(field(layer,"image").is<Object>())bindings.emplace_back(Object{{"nodeId",Value(id)},{"sourceKey",Value(key)},
                    {"imageId",field(field(layer,"image"),"id")},{"left",Value(left)},{"top",Value(top)}});
            }
        }
    };
    walk(field(source,"children"),root,"","",false);
    p.get<Object>()["keyArts"]=Value(Array{Value(Object{{"id",Value(art_id)},{"displayName",Value(name)},
        {"sourceAssetId",Value(source_id)},{"rootNodeId",Value(root)},{"members",Value(members)},{"metadata",Value(Object{})}})});
    return Value(Object{{"project",p},{"bindings",Value(bindings)}});
}
Value cutwork(const Value& request) {
    const auto& source=field(request,"source"),&options=field(request,"options"),&canvas=field(source,"canvas");
    auto file=text(field(options,"fileName"));if(file.empty())file=text(field(field(source,"original"),"sourceName"));if(file.empty())file="source.flimg";
    const auto name=field(options,"projectName").is<std::string>()?text(field(options,"projectName")):file;
    Ids ids{"cutwork"};auto p=project(name,number(field(canvas,"width")),number(field(canvas,"height")),ids);
    const auto source_id=ids.next("source"),art_id=ids.next("keyart"),root=text(field(field(p,"scene"),"rootId"));
    const auto document_id=field(source,"documentId"),schema=field(source,"schemaVersion");
    auto original=field(source,"original");original.get<Object>().erase("pixels");original.get<Object>()["colorSpace"]=field(canvas,"colorSpace");original.get<Object>()["pixelFormat"]=field(canvas,"pixelFormat");
    p.get<Object>()["sourceAssets"]=Value(Array{Value(Object{{"id",Value(source_id)},{"kind",Value("cutwork-flimg")},
        {"fileName",Value(file)},{"displayLabel",Value(file)},{"importedAt",field(options,"importedAt")},
        {"metadata",Value(Object{{"format",field(source,"format")},{"schemaVersion",schema},{"documentId",document_id},{"original",original}})}})});
    const Value metadata(Object{{"importedFrom",Value("cutwork-flimg")},{"cutworkDocumentId",document_id},{"cutworkSchemaVersion",schema}});
    Array members,bindings,node_ids,slots;auto& nodes=p.get<Object>().at("scene").get<Object>().at("nodes").get<Object>();
    const auto& layers=field(source,"layers").get<Array>();
    for(size_t i=0;i<layers.size();++i) {
        const auto& layer=layers[i],&bounds=field(layer,"bounds");const auto kind=text(field(layer,"kind")),layer_id=text(field(layer,"id"));
        auto layer_name=text(field(layer,"name"));if(layer_name.find_first_not_of(" \t\r\n")==std::string::npos)layer_name=kind=="base"?"Base":kind=="part"?"Part":kind=="patch"?"Patch":"Repair";
        const auto id=ids.next("node"),key="layer:"+layer_id;const double width=number(field(bounds,"width")),height=number(field(bounds,"height"));
        const bool patch=kind=="patch";const double x=patch?0:number(field(bounds,"x")),y=patch?0:number(field(bounds,"y"));
        const Value local(Object{{"left",Value(x)},{"top",Value(y)},{"right",Value(x+width)},{"bottom",Value(y+height)}});
        Object provenance{{"documentId",document_id},{"layerId",field(layer,"id")},{"layerKind",field(layer,"kind")},{"semanticName",field(layer,"semanticName")},
            {"manifestIndex",Value(static_cast<double>(i))},{"authoredBounds",bounds}};
        for(const auto key_name:{"partOrder","ownerPartId","asset","sha256","transform","sourcePolygon"}) if(!field(layer,key_name).is<picojson::null>()) provenance[key_name]=field(layer,key_name);
        const Value ref(Object{{"sourceAssetId",Value(source_id)},{"sourceKey",Value(key)},{"identityKind",Value("native")},{"orderDependent",Value(false)},
            {"path",Value(layer_name)},{"cutwork",Value(provenance)}});
        auto item=node(id,layer_name,root,false,ref,boolean(field(layer,"visible")),1,"normal",local);
        if(patch) {
            const auto& t=field(layer,"transform");const double scale=number(field(t,"scale"));
            item.get<Object>()["transform"]=Value(Object{{"position",Value(Object{{"x",Value(number(field(t,"centerX"))-width/2)},{"y",Value(number(field(t,"centerY"))-height/2)}})},
                {"rotation",Value(number(field(t,"rotationDegrees"))*3.14159265358979323846/180)},
                {"scale",Value(Object{{"x",Value(scale)},{"y",Value(scale)}})},
                {"pivot",Value(Object{{"x",Value(width/2)},{"y",Value(height/2)}})}});
        }
        nodes[id]=item;nodes[root].get<Object>().at("children").get<Array>().emplace_back(id);node_ids.emplace_back(id);
        members.emplace_back(Object{{"nodeId",Value(id)},{"appearanceId",Value(source_id+":"+key)},{"opacity",Value(1.0)},
            {"presence",Value(boolean(field(layer,"visible"))?"present":"absent")},{"drawOrder",Value(static_cast<double>(layers.size()-i-1))},{"clipping",Value(Object{{"sourceNodeId",Value()}})}});
        if(!text(field(layer,"semanticName")).empty())slots.emplace_back(Object{{"id",Value(ids.next("semantic"))},{"displayName",Value(layer_name)},
            {"role",field(layer,"semanticName")},{"mappings",Value(Array{Value(Object{{"keyArtId",Value(art_id)},{"nodeId",Value(id)}})})},
            {"metadata",Value(Object{{"importedFrom",Value("cutwork-flimg")},{"cutworkDocumentId",document_id},{"cutworkLayerId",field(layer,"id")}})}});
        bindings.emplace_back(Object{{"nodeId",Value(id)},{"layerId",field(layer,"id")},{"sourceKey",Value(key)},
            {"left",Value(x)},{"top",Value(y)},{"width",Value(width)},{"height",Value(height)}});
    }
    p.get<Object>()["semanticSlots"]=Value(slots);
    p.get<Object>()["keyArts"]=Value(Array{Value(Object{{"id",Value(art_id)},{"displayName",Value(name)},{"sourceAssetId",Value(source_id)},
        {"rootNodeId",Value(root)},{"members",Value(members)},{"metadata",metadata}})});
    std::reverse(bindings.begin(),bindings.end());
    return Value(Object{{"project",p},{"bindings",Value(bindings)},{"result",Value(Object{{"projectId",field(p,"id")},{"keyArtId",Value(art_id)},
        {"sceneNodeIds",Value(node_ids)},{"diagnostics",Value(Array{})}})}});
}
}

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_source_project_json(const uint8_t* bytes,uint32_t length,char* buffer,uint32_t capacity,uint32_t* required) {
    if(!bytes || !length || !required)return FL2D_INVALID_ARGUMENT;
    *required=0;if(length>FL2D_DOCUMENT_MAX_BYTES)return FL2D_INPUT_TOO_LARGE;
    try {
        const std::string source(reinterpret_cast<const char*>(bytes),length);
        try{(void)fl2d_locale::utf16(source);}catch(const std::bad_alloc&){throw;}catch(...){return FL2D_INVALID_UTF8;}
        Value request;std::string error;const auto end=picojson::parse(request,source.begin(),source.end(),&error);
        if(!error.empty() || end!=source.end())return FL2D_MALFORMED_JSON;
        const auto kind=text(field(request,"kind"));if(kind!="psd" && kind!="flimg" && kind!="blank" && kind!="psd-review")return FL2D_INVALID_ARGUMENT;
        Ids blank_ids{"project"};
        const auto candidate=kind=="psd-review"?fl2d_sources::review(request):kind=="blank"?Value(Object{{"project",project(text(field(field(request,"options"),"projectName")),number(field(field(request,"source"),"width")),number(field(field(request,"source"),"height")),blank_ids)},{"bindings",Value(Array{})}}):kind=="psd"?psd(request):cutwork(request);
        const auto json=field(candidate,"project").serialize();fl2d_session* raw=nullptr;
        const auto status=field(candidate,"project").is<picojson::null>()?FL2D_OK:fl2d_session_create(reinterpret_cast<const uint8_t*>(json.data()),static_cast<uint32_t>(json.size()),&raw);
        const std::unique_ptr<fl2d_session,decltype(&fl2d_session_destroy)> session(raw,fl2d_session_destroy);
        if(status!=FL2D_OK)return status;
        const auto output=Value(Object{{"value",candidate}}).serialize();if(output.size()>=FL2D_DOCUMENT_MAX_BYTES)return FL2D_INPUT_TOO_LARGE;
        *required=static_cast<uint32_t>(output.size()+1);if(!buffer || capacity<*required)return FL2D_BUFFER_TOO_SMALL;
        std::memcpy(buffer,output.c_str(),*required);return FL2D_OK;
    }catch(const std::bad_alloc&){return FL2D_OUT_OF_MEMORY;}catch(...){return FL2D_INVALID_ARGUMENT;}
}
