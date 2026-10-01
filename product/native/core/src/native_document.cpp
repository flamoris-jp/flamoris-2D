#include "native_document.h"
#include "native_commands.h"
#include "native_math.h"
#include "native_locale.h"
#include "js_text.h"
#include "flamoris2d_core.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <numeric>
#include <regex>
#include <set>

namespace fl2d_document {
using namespace fl2d_commands;
static void fail(const char* code, Value details = Value()) { throw Failure{code, std::move(details)}; }
static bool has(const Value& v, const char* key) { return v.is<Object>() && v.get<Object>().count(key); }
static std::string str(const Value& v) { return v.is<std::string>() ? v.get<std::string>() : ""; }
static bool finite(const Value& v) { return v.is<double>() && std::isfinite(v.get<double>()); }
static bool truthy(const Value& v) {
    return !v.is<picojson::null>() && (!v.is<bool>() || v.get<bool>()) &&
        (!v.is<double>() || v.get<double>() != 0) && (!v.is<std::string>() || !v.get<std::string>().empty());
}
static bool nonblank(const Value& v) {
    if (!v.is<std::string>()) return false;
    const auto units = fl2d_text::utf16(v.get<std::string>());
    return std::any_of(units.begin(), units.end(), [](uint16_t u) {
        return !((u >= 9 && u <= 13) || u == 32 || u == 160 || u == 0x1680 ||
            (u >= 0x2000 && u <= 0x200a) || u == 0x2028 || u == 0x2029 || u == 0x202f ||
            u == 0x205f || u == 0x3000 || u == 0xfeff);
    });
}
static Array array(const Value& v) { return v.is<Array>() ? v.get<Array>() : Array{}; }
static Object object(const Value& v) { return v.is<Object>() ? v.get<Object>() : Object{}; }
static Value& member(Value& v, const char* key) {
    if (!v.is<Object>()) fail("project.schema_invalid");
    return v.get<Object>()[key];
}
// All documents written by Product use ISO timestamps. Identity admission also
// permits finite ECMAScript epoch values. Metadata is retained verbatim on open.
static bool timestamp(const Value& v) {
    if (v.is<double>()) return std::isfinite(v.get<double>()) && std::abs(v.get<double>()) <= 8640000000000000.0;
    if (!v.is<std::string>()) return false;
    static const std::regex iso(R"(^([0-9]{4}|[+-][0-9]{6})(-([0-9]{2})(-([0-9]{2})(T([0-9]{2}):([0-9]{2})(:([0-9]{2})(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})?)?)?)?$)");
    std::smatch match; const auto text = v.get<std::string>();
    if (!std::regex_match(text, match, iso)) return false;
    auto number = [&](size_t i, int fallback) { return match[i].matched ? std::stoi(match[i].str()) : fallback; };
    const auto month = number(3, 1), day = number(5, 1), hour = number(7, 0), minute = number(8, 0), second = number(10, 0);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 24 && minute <= 59 && second <= 59 &&
        (hour != 24 || (minute == 0 && second == 0));
}
static void validate(const Value& project) {
    const auto json = project.serialize();
    if (json.size() > FL2D_SNAPSHOT_MAX_BYTES) fail("input.too_large");
    fl2d_session* raw = nullptr;
    const auto status = fl2d_session_create(reinterpret_cast<const uint8_t*>(json.data()), static_cast<uint32_t>(json.size()), &raw);
    std::unique_ptr<fl2d_session, decltype(&fl2d_session_destroy)> candidate(raw, fl2d_session_destroy);
    if (status == FL2D_OUT_OF_MEMORY) throw std::bad_alloc();
    if (status != FL2D_OK) fail("transaction.validation_failed");
}
static void reject_schema14(const Value& p) {
    std::set<std::string> owners;
    for (const auto& transition : array(field(p,"transitions"))) owners.insert(str(field(transition,"temporalProgramId")));
    struct Conflict { std::string program, track, channel, reason, kind, path; };
    std::vector<Conflict> conflicts;
    const auto programs = array(field(p,"temporalPrograms"));
    for (size_t pi = 0; pi < programs.size(); ++pi) {
        const auto& program = programs[pi]; const auto tracks = array(field(program,"tracks"));
        for (size_t ti = 0; ti < tracks.size(); ++ti) {
            const auto& track = tracks[ti]; const auto kind = str(field(track,"kind"));
            auto add = [&](const std::string& channel, const char* reason) {
                conflicts.push_back({str(field(program,"id")), str(field(track,"trackId")), channel, reason, kind,
                    "temporalPrograms."+std::to_string(pi)+".tracks."+std::to_string(ti)+(channel.empty()?"":".channels."+channel)});
            };
            if (kind == "MeshDeformationTrack") add("","reserved-mesh-deformation-track");
            if (kind == "TransformTrack" && owners.count(str(field(program,"id")))) add("","transition-owned-reusable-track");
            if (kind != "TransformTrack" && kind != "CameraTrack") continue;
            const auto& channels = field(track,"channels");
            for (const auto& channel : kind == "TransformTrack" ? std::vector<std::string>{"scaleX","scaleY"} : std::vector<std::string>{"scale"}) {
                for (const auto& key : array(field(field(channels,channel),"keyframes"))) {
                    if (finite(field(key,"value")) && field(key,"value").get<double>() <= 0) add(channel,"non-positive-scale-value");
                    const auto& curve = field(key,"interpolationToNext");
                    if (str(field(curve,"kind")) == "bezier") for (const auto name : {"y1","y2"}) {
                        const auto& y = field(curve,name);
                        if (finite(y) && (y.get<double>() < 0 || y.get<double>() > 1)) add(channel,"scale-bezier-outside-positive-domain");
                    }
                }
            }
            auto rotation = array(field(field(channels,"rotation"),"keyframes"));
            const fl2d_locale::Collator collator;
            std::stable_sort(rotation.begin(),rotation.end(),[&](const Value& a,const Value& b) {
                const auto& x = field(a,"timeTicks"), &y = field(b,"timeTicks");
                return finite(x) && finite(y) && x.get<double>() != y.get<double>() ? x.get<double>() < y.get<double>() : collator.less(str(field(a,"id")),str(field(b,"id")));
            });
            for (size_t i = 0; i+1 < rotation.size(); ++i) {
                const auto& a = rotation[i]; const auto& b = rotation[i+1];
                if (str(field(field(a,"interpolationToNext"),"kind")) == "step" || !finite(field(a,"value")) || !finite(field(b,"value"))) continue;
                const double delta = field(b,"value").get<double>() - field(a,"value").get<double>();
                if (([](double from, double to) { constexpr double tau = 6.28318530717958647692; double delta = std::fmod(to-from,tau); if (delta < -tau/2) delta += tau; else if (delta > tau/2) delta -= tau; return delta; })(field(a,"value").get<double>(),field(b,"value").get<double>()) != delta) add("rotation","scalar-to-shortest-arc-change");
            }
        }
    }
    if (conflicts.empty()) return;
    const fl2d_locale::Collator collator;
    std::stable_sort(conflicts.begin(),conflicts.end(),[&](const Conflict& a,const Conflict& b) {
        for (const auto& pair : {std::pair{a.program,b.program},std::pair{a.track,b.track},std::pair{a.channel,b.channel},std::pair{a.reason,b.reason}}) {
            if (collator.less(pair.first,pair.second)) return true;
            if (collator.less(pair.second,pair.first)) return false;
        } return false;
    });
    const auto& c = conflicts.front();
    fail("project.schema_track_semantics_incompatible",Value(Object{{"schemaVersion",Value(14.0)}, {"programId",Value(c.program)},
        {"trackId",Value(c.track)}, {"channel",Value(c.channel)}, {"path",Value(c.path)}, {"trackKind",Value(c.kind)}, {"reason",Value(c.reason)}}));
}
static Value migrate(Value p) {
    auto schema = [&]() { const auto& v=field(p,"schemaVersion");return finite(v) ? v.get<double>() : 0.0; };
    if (schema() == 1) {
        const auto settings=object(field(p,"renderSettings")); const auto& fps=field(field(p,"renderSettings"),"fps");
        double n=30,d=1;
        if (finite(fps) && fps.get<double>()>0) {
            const double v=fps.get<double>();
            if (v==23.976) { n=24000;d=1001; } else if(v==29.97) { n=30000;d=1001; }
            else if(v==59.94) { n=60000;d=1001; } else {
                n=std::floor(v*1000000+0.5);d=1000000;
                if (!std::isfinite(n) || n<=0 || n>9007199254740991.0) fail("project.schema_invalid");
                const auto gcd=std::gcd(static_cast<int64_t>(n),static_cast<int64_t>(d));n/=static_cast<double>(gcd);d/=static_cast<double>(gcd);
            }
        }
        const auto duration=settings.find("duration");const double seconds=duration!=settings.end() && finite(duration->second)?duration->second.get<double>():8;
        member(p,"timebaseTicksPerSecond")=Value(120000.0);
        member(p,"renderSettings")=Value(Object{{"frameRate",Value(Object{{"numerator",Value(n)},{"denominator",Value(d)}})},
            {"durationTicks",Value(std::floor(seconds*120000+0.5))},{"alpha",Value(!(field(field(p,"renderSettings"),"alpha").is<bool>() && !field(field(p,"renderSettings"),"alpha").get<bool>()))}});
        member(p,"temporalPrograms")=Value(Array{});member(p,"schemaVersion")=Value(2.0);
    }
    if (schema()==2) {
        for (const auto collection : {"keyArts","semanticSlots"}) {
            auto entries=array(field(p,collection));
            for(auto& entry:entries) {
                const auto nested=std::string(collection)=="keyArts"?"members":"mappings";
                member(entry,nested)=Value(array(field(entry,nested)));
                if (!field(entry,"metadata").is<Object>() && !field(entry,"metadata").is<Array>()) member(entry,"metadata")=Value(Object{});
            } member(p,collection)=Value(entries);
        }
        member(p,"meshTopologies")=Value(Array{});member(p,"meshKeyforms")=Value(Array{});
        member(p,"transitions")=Value(array(field(p,"transitions")));member(p,"schemaVersion")=Value(3.0);
    }
    if(schema()==3) {
        auto entries=array(field(p,"meshTopologies"));
        for(auto& topology:entries) {
            member(topology,"vertexMetadata")=Value(object(field(topology,"vertexMetadata")));
            double next=1;for(const auto& id:array(field(topology,"vertexIds"))) {
                const auto text=str(id);if(text.size()>4 && text.substr(0,4)=="vtx_" && text.find_first_not_of("0123456789",4)==std::string::npos)
                    next=std::max(next,std::stod(text.substr(4))+1);
            } member(topology,"nextVertexSequence")=Value(next);
        } member(p,"meshTopologies")=Value(entries);member(p,"schemaVersion")=Value(4.0);
    }
    if(schema()==4) { member(p,"clippingBindings")=Value(array(field(p,"clippingBindings")));member(p,"schemaVersion")=Value(5.0); }
    if(schema()==5) {
        member(p,"rig")=Value(object(field(p,"rig")));auto& r=member(p,"rig");
        for(const auto key:{"deformers","warpControlPoints","warpDeformerKeyforms"})member(r,key)=Value(Array{});
        for(const auto key:{"bones","constraints"})member(r,key)=Value(array(field(r,key)));
        member(p,"schemaVersion")=Value(6.0);
    }
    if(schema()==6) {
        member(p,"rig")=Value(object(field(p,"rig")));auto& r=member(p,"rig");
        member(r,"bones")=Value(Array{});member(r,"bonePoseKeyforms")=Value(Array{});member(r,"constraints")=Value(array(field(r,"constraints")));member(p,"schemaVersion")=Value(7.0);
    }
    if(schema()==7) { member(p,"rig")=Value(object(field(p,"rig")));member(member(p,"rig"),"rigidBoneBindings")=Value(Array{});member(p,"schemaVersion")=Value(8.0); }
    if(schema()==8) { member(p,"rig")=Value(object(field(p,"rig")));member(member(p,"rig"),"skinBindings")=Value(Array{});member(p,"schemaVersion")=Value(9.0); }
    if(schema()==9) { member(p,"meshFormCorrectionKeyforms")=Value(Array{});member(p,"schemaVersion")=Value(10.0); }
    if(schema()==10) { member(member(p,"rig"),"boneRotationConstraints")=Value(Array{});member(p,"schemaVersion")=Value(11.0); }
    if(schema()==11) { member(member(p,"rig"),"twoBoneIkConstraints")=Value(Array{});member(p,"schemaVersion")=Value(12.0); }
    if(schema()==12) {
        member(p,"animation")=Value(Object{{"clips",Value(Array{})},{"deformationSamples",Value(Array{})}});member(p,"sequences")=Value(Array{});
        p.get<Object>().erase("sequence");if(field(p,"renderSettings").is<Object>())member(p,"renderSettings").get<Object>().erase("durationTicks");member(p,"schemaVersion")=Value(13.0);
    }
    if(schema()==13) {
        if(!field(p,"sequences").is<Array>())fail("project.schema_invalid",Value(Object{{"schemaVersion",Value(13.0)},{"path",Value("sequences")}}));
        member(p,"animation")=Value(Object{{"clips",Value(Array{})},{"deformationSamples",Value(Array{})}});
        for(auto& sequence:member(p,"sequences").get<Array>()) { member(sequence,"clipInstances")=Value(Array{}); }
        member(p,"schemaVersion")=Value(14.0);
    }
    if(schema()==14) {
        reject_schema14(p);const auto& samples=field(field(p,"animation"),"deformationSamples");
        if(!samples.is<Array>() || !samples.get<Array>().empty())fail("project.schema_invalid",Value(Object{{"schemaVersion",Value(14.0)},{"path",Value("animation.deformationSamples")}}));
        member(p,"schemaVersion")=Value(15.0);
    }
    if(schema()!=15)fail("project.schema_unsupported",Value(Object{{"schemaVersion",field(p,"schemaVersion")}}));
    return p;
}
Value parse(const Value& source) {
    const auto format=field(source,"format");
    if(!truthy(format)) {
        if(!truthy(field(source,"schemaVersion")) || !truthy(field(source,"scene")))fail("project.format_invalid");
        auto p=migrate(source);validate(p);
        return Value(Object{{"project",p},{"renderAssets",Value(Array{})},{"metadata",Value(Object{{"format",Value("flamoris-2d-project")},
            {"formatVersion",Value(1.0)},{"projectId",field(p,"id")},{"name",field(p,"displayName")},{"createdAt",Value()},{"modifiedAt",Value()},{"migratedFrom",Value(0.0)}})}});
    }
    if(str(format)!="flamoris-2d-project")fail("project.format_invalid");
    const auto version=field(source,"formatVersion");
    if(!finite(version) || std::floor(version.get<double>())!=version.get<double>())fail("project.format_version_invalid");
    if(version.get<double>()>1)fail("project.format_newer",Value(Object{{"formatVersion",version}}));
    if(version.get<double>()<1) {
        auto legacy = truthy(field(source,"project")) ? field(source,"project") : source;
        if (legacy.is<Object>()) legacy.get<Object>().erase("format");
        return parse(legacy);
    }
    if(!nonblank(field(source,"projectId")) || !nonblank(field(source,"name")) ||
        !truthy(field(source,"createdAt")) || !timestamp(field(source,"createdAt")) ||
        !truthy(field(source,"modifiedAt")) || !timestamp(field(source,"modifiedAt")))fail("project.identity_invalid");
    auto project=Value(object(field(source,"project")));member(project,"id")=field(source,"projectId");member(project,"displayName")=field(source,"name");
    project=migrate(project);validate(project);
    Object metadata;for(const auto key:{"format","formatVersion","projectId","name","createdAt","modifiedAt"})metadata[key]=field(source,key);
    return Value(Object{{"project",project},{"renderAssets",Value(array(field(source,"renderAssets")))},{"metadata",Value(metadata)}});
}
static bool text_less(const Value& a,const Value& b,const char* key) { return fl2d_text::less(str(field(a,key)),str(field(b,key))); }
static void sort(Value& v, const char* key="id") {
    auto& entries=v.get<Array>();std::stable_sort(entries.begin(),entries.end(),[&](const Value& a,const Value& b){return text_less(a,b,key);});
}
static void sort_time(Value& v,std::initializer_list<const char*> keys,const char* id="id") {
    auto& entries=v.get<Array>();std::stable_sort(entries.begin(),entries.end(),[&](const Value& a,const Value& b){
        for(const auto key:keys){const auto& x=field(a,key),&y=field(b,key);if(x.is<double>() && y.is<double>() && x.get<double>()!=y.get<double>())return x.get<double>()<y.get<double>();}
        return text_less(a,b,id);
    });
}
static void canonicalize(Value& p) {
    for(const auto key:{"temporalPrograms","keyArts","semanticSlots","meshTopologies","meshKeyforms","meshFormCorrectionKeyforms","clippingBindings","transitions","sequences"})sort(member(p,key));
    for(auto& program:member(p,"temporalPrograms").get<Array>()) {
        sort(member(program,"tracks"),"trackId");
        for(auto& track:member(program,"tracks").get<Array>()) {
            Object channels;auto& original=member(track,"channels").get<Object>();auto names=original.keys();
            std::sort(names.begin(),names.end(),fl2d_text::less);
            for(const auto& name:names){auto channel=original.at(name);sort_time(member(channel,"keyframes"),{"timeTicks"});channels[name]=std::move(channel);}member(track,"channels")=Value(channels);
        }
        sort_time(member(program,"events"),{"timeTicks"});sort_time(member(program,"regions"),{"startTicks","endTicks"});
    }
    for(auto& keyart:member(p,"keyArts").get<Array>())sort(member(keyart,"members"),"nodeId");
    for(auto& slot:member(p,"semanticSlots").get<Array>()) {
        auto& mappings=member(slot,"mappings").get<Array>();std::stable_sort(mappings.begin(),mappings.end(),[](const Value& a,const Value& b){
            if(str(field(a,"keyArtId"))!=str(field(b,"keyArtId")))return text_less(a,b,"keyArtId");
            return text_less(a,b,"nodeId");});
    }
    for(auto& topology:member(p,"meshTopologies").get<Array>())if(has(topology,"vertexMetadata")) {
        Object metadata;for(const auto& id:array(field(topology,"vertexIds")))if(truthy(field(field(topology,"vertexMetadata"),str(id))))metadata[str(id)]=field(field(topology,"vertexMetadata"),str(id));member(topology,"vertexMetadata")=Value(metadata);
    }
    for(auto& k:member(p,"meshFormCorrectionKeyforms").get<Array>())sort(member(k,"vertexOffsets"),"vertexId");
    auto& rig=member(p,"rig");for(const auto key:{"deformers","warpControlPoints","bones","rigidBoneBindings","skinBindings","boneRotationConstraints","twoBoneIkConstraints"})sort(member(rig,key));
    for(const auto& pair:{std::pair{"warpDeformerKeyforms","deformerId"},std::pair{"bonePoseKeyforms","boneId"}}) {
        auto& values=member(rig,pair.first).get<Array>();std::stable_sort(values.begin(),values.end(),[&](const Value& a,const Value& b){
            if(str(field(a,pair.second))!=str(field(b,pair.second)))return text_less(a,b,pair.second);
            return text_less(a,b,"keyArtId");});
    }
    for(auto& keyform:member(rig,"warpDeformerKeyforms").get<Array>()) {
        std::map<std::string,size_t> order;for(const auto& deformer:member(rig,"deformers").get<Array>())if(field(deformer,"id")==field(keyform,"deformerId")){
            const auto ids=array(field(deformer,"controlPointIds"));for(size_t i=0;i<ids.size();++i)order[str(ids[i])]=i;
        }
        auto& controls=member(keyform,"controlPoints").get<Array>();std::stable_sort(controls.begin(),controls.end(),[&](const Value& a,const Value& b){
            auto position=[&](const Value& v){auto it=order.find(str(field(v,"controlPointId")));return it==order.end()?std::numeric_limits<size_t>::max():it->second;};
            if(position(a)!=position(b))return position(a)<position(b);
            return text_less(a,b,"controlPointId");});
    }
    for(auto& binding:member(rig,"skinBindings").get<Array>()) {
        sort(member(binding,"vertexWeights"),"vertexId");for(auto& weights:member(binding,"vertexWeights").get<Array>())sort(member(weights,"influences"),"boneId");
    }
    for(auto& transition:member(p,"transitions").get<Array>()) {sort(member(transition,"partTransitions"));sort(member(transition,"diagnosticOverrides"),"key");}
    auto& animation=member(p,"animation");sort(member(animation,"clips"));sort(member(animation,"deformationSamples"));
    for(auto& sample:member(animation,"deformationSamples").get<Array>()) {
        auto offsets=array(field(sample,"offsets"));offsets.erase(std::remove_if(offsets.begin(),offsets.end(),[](const Value& v){return field(v,"dx")==Value(0.0) && field(v,"dy")==Value(0.0);}),offsets.end());
        member(sample,"offsets")=Value(offsets);sort(member(sample,"offsets"),"vertexId");
    }
    for(auto& sequence:member(p,"sequences").get<Array>()) {sort_time(member(sequence,"viewLaneItems"),{"startTicks","endTicks"});sort_time(member(sequence,"clipInstances"),{"startTicks","endTicks","layer"});}
}
Value serialize(const Value& source,const Value& options) {
    validate(source);auto project=source;canonicalize(project);
    const auto now=field(options,"now");if(!timestamp(now) || !now.is<std::string>())fail("project.identity_invalid");
    auto timestamp_or=[&](const char* key){const auto& t=field(options,key);return truthy(t) && timestamp(t)?t:now;};
    project.get<Object>().erase("id");project.get<Object>().erase("displayName");
    return Value(Object{{"format",Value("flamoris-2d-project")},{"formatVersion",Value(1.0)},
        {"projectId",field(source,"id")},{"name",field(source,"displayName")},{"createdAt",timestamp_or("createdAt")},
        {"modifiedAt",timestamp_or("modifiedAt")},{"project",project},{"renderAssets",Value(array(field(options,"renderAssets")))}});
}
} // namespace fl2d_document

static fl2d_status copy_document(const std::string& value,char* buffer,uint32_t capacity,uint32_t* required) {
    if(!required)return FL2D_INVALID_ARGUMENT;
    if(value.size()>=UINT32_MAX)return FL2D_INPUT_TOO_LARGE;
    *required=static_cast<uint32_t>(value.size()+1);
    if(!buffer || capacity<*required)return FL2D_BUFFER_TOO_SMALL;
    std::memcpy(buffer,value.c_str(),*required);return FL2D_OK;
}
static fl2d_status document_json(const uint8_t* bytes,uint32_t length,picojson::value& v) {
    if(!bytes || !length)return FL2D_INVALID_ARGUMENT;
    if(length>FL2D_DOCUMENT_MAX_BYTES)return FL2D_INPUT_TOO_LARGE;
    // ICU conversion provides the same strict UTF-8 admission as other ABI input.
    try { (void)fl2d_locale::utf16(std::string(reinterpret_cast<const char*>(bytes),length)); }
    catch(const std::bad_alloc&){throw;}catch(...){return FL2D_INVALID_UTF8;}
    std::string text(reinterpret_cast<const char*>(bytes),length),error;
    auto end=picojson::parse(v,text.begin(),text.end(),&error);
    return error.empty() && end==text.end()?FL2D_OK:FL2D_MALFORMED_JSON;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_document_parse_json(const uint8_t* bytes,uint32_t length,char* buffer,uint32_t capacity,uint32_t* required) {
    if(!required)return FL2D_INVALID_ARGUMENT;
    *required=0;
    try {
        picojson::value value;const auto status=document_json(bytes,length,value);if(status!=FL2D_OK)return status;
        try { return copy_document(picojson::value(picojson::object{{"value",fl2d_document::parse(value)}}).serialize(),buffer,capacity,required); }
        catch(const fl2d_document::Failure& failure) { return copy_document(picojson::value(picojson::object{{"error",picojson::value(picojson::object{{"code",picojson::value(failure.code)},{"details",failure.details}})}}).serialize(),buffer,capacity,required); }
    }catch(const std::bad_alloc&){return FL2D_OUT_OF_MEMORY;}catch(...){return FL2D_INTERNAL_ERROR;}
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_document_json(const fl2d_session* session,const uint8_t* options,uint32_t length,char* buffer,uint32_t capacity,uint32_t* required) {
    if(!session || !required)return FL2D_INVALID_ARGUMENT;
    *required=0;
    try {
        picojson::value metadata;auto status=document_json(options,length,metadata);if(status!=FL2D_OK)return status;
        uint32_t size=0;status=fl2d_session_project_json(session,nullptr,0,&size);if(status!=FL2D_BUFFER_TOO_SMALL)return status;
        std::vector<char> bytes(size);status=fl2d_session_project_json(session,bytes.data(),size,&size);if(status!=FL2D_OK)return status;
        picojson::value project;const auto error=picojson::parse(project,std::string(bytes.data(),size-1));if(!error.empty())return FL2D_INTERNAL_ERROR;
        try {return copy_document(picojson::value(picojson::object{{"value",fl2d_document::serialize(project,metadata)}}).serialize(),buffer,capacity,required);}
        catch(const fl2d_document::Failure& failure) {return copy_document(picojson::value(picojson::object{{"error",picojson::value(picojson::object{{"code",picojson::value(failure.code)},{"details",failure.details}})}}).serialize(),buffer,capacity,required);}
    }catch(const std::bad_alloc&){return FL2D_OUT_OF_MEMORY;}catch(...){return FL2D_INTERNAL_ERROR;}
}
