#include "native_frame_evaluation.h"
#include "native_rig_evaluation.h"
#include "native_temporal_evaluation.h"
#include "native_queries.h"
#include "js_text.h"
#include <algorithm>
#include <limits>
#include <functional>

namespace fl2d_evaluation {
namespace {
using fl2d_commands::field;
using fl2d_math::Affine;
constexpr double pi = 3.14159265358979323846;
bool has(const Value& v) { return !v.is<picojson::null>(); }
std::string text(const Value& v) { return v.is<std::string>() ? v.get<std::string>() : ""; }
double number(const Value& v) { return v.is<double>() ? v.get<double>() : std::numeric_limits<double>::quiet_NaN(); }
Value numeric(double n) { return std::isfinite(n) ? Value(n) : Value(); }
Value find(const Value& collection, const Value& id, const char* key = "id") {
    for (const auto& v : collection.get<Array>()) if (field(v,key) == id) return v;
    return Value();
}
Value binding(const Value& p, const char* name, const Value& node_id) {
    for (const auto& b : field(field(p,"rig"),name).get<Array>()) if (field(b,"targetNodeId") == node_id && field(b,"enabled") == Value(true)) return b;
    return Value();
}
Value topology(const Value& p, const Value& mesh) { return find(field(p,"meshTopologies"),field(mesh,"topologyId")); }
Array sorted(Array values,const char* key = "id") {
    std::stable_sort(values.begin(),values.end(),[&](const Value& a,const Value& b){return fl2d_text::less(text(field(a,key)),text(field(b,key)));}); return values;
}
Value fallback(const Value& node) {
    const auto& b = field(node,"bounds"); const double left = has(b) ? number(field(b,"left")) : 0, top = has(b) ? number(field(b,"top")) : 0;
    const double right = has(b) ? number(field(b,"right")) : 1, bottom = has(b) ? number(field(b,"bottom")) : 1;
    return Value(Object{{"positions",Value(Array{Value(left),Value(top),Value(right),Value(top),Value(right),Value(bottom),Value(left),Value(bottom)})},
        {"indices",Value(Array{Value(0.0),Value(1.0),Value(2.0),Value(0.0),Value(2.0),Value(3.0)})},
        {"uvs",Value(Array{Value(0.0),Value(0.0),Value(1.0),Value(0.0),Value(1.0),Value(1.0),Value(0.0),Value(1.0)})}});
}
Value mesh_for(const Value& p, const Value& id, const Value& node) {
    if (!has(id)) return fallback(node);
    const auto k = find(field(p,"meshKeyforms"),id), t = find(field(p,"meshTopologies"),field(k,"topologyId"));
    return Value(Object{{"topologyId",field(t,"id")},{"positions",field(k,"positions")},{"indices",field(t,"indices")},{"uvs",field(k,"uvs")}});
}
struct State { Value node, member; Affine base{}, world{}; bool valid = false; };
State state(const Value& p, const Value& art, const Value& slot, FrameAnimation* animation) {
    const auto mapping = find(field(slot,"mappings"),field(art,"id"),"keyArtId"); State result;
    if (!has(mapping)) return result;
    const auto& nodes = field(field(p,"scene"),"nodes").get<Object>(); auto node = nodes.find(text(field(mapping,"nodeId")));
    result.member = find(field(art,"members"),field(mapping,"nodeId"),"nodeId");
    if (node == nodes.end() || !has(result.member)) return result;
    result.node = node->second; result.base = fl2d_math::world(p,text(field(result.node,"id")));
    result.world = animation ? fl2d_math::world(p,text(field(result.node,"id")),animation->transforms) : result.base; result.valid = true; return result;
}
Value sampled(const Value& sample, const char* kind, const char* channel, const Value& slot, const Value& node = Value()) {
    Value chosen; int priority = 0; std::string track_id;
    for (const auto& track : field(sample,"tracks").get<Array>()) {
        if (field(track,"kind") != Value(kind) || !has(field(field(track,"values"),channel))) continue;
        const auto& target = field(track,"target");
        const int current = field(target,"semanticSlotId") == slot ? 3 : has(node) && field(target,"nodeId") == node ? 2 : field(target,"transitionDefault") == Value(true) ? 1 : 0;
        if (current > priority || (current > 0 && current == priority && fl2d_text::less(text(field(track,"trackId")),track_id))) {
            priority = current; track_id = text(field(track,"trackId")); chosen = field(field(track,"values"),channel);
        }
    }
    return chosen;
}
Value coalesce(const Value& a,const Value& b) { return has(a) ? a : b; }
Value clipping(const Value& p, const State& s, const Value& sample, const Value& slot) {
    Value b; for (const auto& entry : field(p,"clippingBindings").get<Array>()) if (s.valid && field(entry,"targetNodeId") == field(s.node,"id")) { b = entry; break; }
    const auto mode = has(b) ? field(b,"mode") : Value("inside"); Value source;
    if (has(b) && field(b,"enabled") == Value(false)) return Value(Object{{"sourceNodeId",Value()},{"mode",mode}});
    if (has(sample)) source = field(sampled(sample,"ClippingTrack","clipping",slot,field(s.node,"id")),"sourceNodeId");
    const auto authored = has(sample) ? sampled(sample,"ClippingTrack","clipping",slot,field(s.node,"id")) : Value();
    if (!has(authored)) source = coalesce(field(field(s.member,"clipping"),"sourceNodeId"),field(b,"sourceNodeId"));
    return Value(Object{{"sourceNodeId",source},{"mode",mode}});
}
Value discrete(FrameAnimation* animation,const char* kind,const char* channel,const Value& base,const State& s) {
    if (!animation) return base;
    const auto key = std::string(kind)+'\0'+channel+'\0'+text(field(s.node,"id")); const auto it = animation->discrete.find(key);
    if (it == animation->discrete.end()) return base;
    if (std::string(kind) == "ClippingTrack") { Value result = base; for (const auto& item : it->second.get<Object>()) result.get<Object>()[item.first] = item.second; return result; }
    return it->second;
}
double opacity(FrameAnimation* animation,double value,const State& s) {
    const auto id = text(field(s.node,"id")); return std::clamp(value*(animation && animation->opacity.count(id) ? animation->opacity.at(id) : 1),0.0,1.0);
}
std::map<std::string,Value> rig_poses(const Value& p,const Value& art,const Value& morph,FrameAnimation* animation) {
    std::map<std::string,Value> out;
    for (const auto& bone : field(field(p,"rig"),"bones").get<Array>()) {
        const auto id = text(field(bone,"id")); Value d(Object{{"x",Value(0.0)},{"y",Value(0.0)},{"rotation",Value(0.0)}});
        if (has(morph)) d = field(field(morph,"poses"),id);
        else for (const auto& k : field(field(p,"rig"),"bonePoseKeyforms").get<Array>()) if (field(k,"boneId") == field(bone,"id") && field(k,"keyArtId") == art) { d = field(k,"localDelta"); break; }
        if (animation && animation->bone_deltas.count(id)) {
            const auto& add = animation->bone_deltas.at(id); size_t i = 0;
            for (const auto key : {"x","y","rotation"}) d.get<Object>()[key] = numeric(number(field(d,key))+add[i++]);
        }
        out[id] = d;
    }
    return out;
}
std::map<std::string,Value> rig_warps(const Value& p,const Value& art,const Value& morph,FrameAnimation* animation) {
    std::map<std::string,Value> out;
    if (has(morph)) for (const auto& item : field(morph,"warps").get<Object>()) out[item.first] = item.second;
    else for (const auto& k : field(field(p,"rig"),"warpDeformerKeyforms").get<Array>()) if (field(k,"keyArtId") == art) out[text(field(k,"deformerId"))] = k;
    if (animation) for (auto& [id,keyform] : out) for (auto& point : keyform.get<Object>().at("controlPoints").get<Array>()) {
        const auto key = id+'\0'+text(field(point,"controlPointId"));
        if (animation->warp_deltas.count(key)) { const auto& add = animation->warp_deltas.at(key); point.get<Object>()["x"] = numeric(number(field(point,"x"))+add[0]); point.get<Object>()["y"] = numeric(number(field(point,"y"))+add[1]); }
    }
    return out;
}
void collect(Array& issues,const Value& result,const Value& slot) {
    for (const auto& d : field(result,"diagnostics").get<Array>()) {
        Object details{{"boneId",field(d,"boneId")},{"bindingId",field(d,"bindingId")}};
        if (field(d,"details").is<Object>()) for (const auto& item : field(d,"details").get<Object>()) details[item.first] = item.second;
        details["reason"] = field(d,"message"); issues.emplace_back(Object{{"code",field(d,"code")},{"semanticSlotId",slot},{"details",Value(details)}});
    }
}
Value correction(const Value& p,const Value& mesh,const Value& art,const Value& slot) {
    for (const auto& k : field(p,"meshFormCorrectionKeyforms").get<Array>())
        if (field(k,"topologyId") == field(mesh,"topologyId") && field(k,"keyArtId") == art && field(k,"semanticSlotId") == slot) return k;
    return Value();
}
Value apply_mesh(const Value& p,Value mesh,FrameAnimation* animation) {
    if (!animation) return mesh;
    if (has(field(mesh,"topologyId"))) animation->active_topologies.insert(text(field(mesh,"topologyId")));
    for (const auto& entry : animation->mesh_entries) {
        const auto sample = find(field(field(p,"animation"),"deformationSamples"),field(field(entry,"value"),"deformationSampleId"));
        if (!has(sample) || field(sample,"meshId") != field(field(entry,"target"),"meshId") || !has(field(mesh,"topologyId")) || field(sample,"topologyId") != field(mesh,"topologyId")) continue;
        const auto t = topology(p,mesh); if (!has(t)) continue;
        animation->applied_mesh_entries.insert(text(field(entry,"clipInstanceId"))+'\0'+text(field(entry,"trackId"))+'\0'+text(field(entry,"channel")));
        auto& positions = mesh.get<Object>().at("positions").get<Array>(); const auto& ids = field(t,"vertexIds").get<Array>();
        const double weight = number(field(field(entry,"value"),"weight"))*number(field(entry,"weight"));
        for (const auto& offset : field(sample,"offsets").get<Array>()) {
            const auto it = std::find(ids.begin(),ids.end(),field(offset,"vertexId")); if (it == ids.end()) continue;
            const size_t i = static_cast<size_t>(it-ids.begin())*2;
            positions[i] = numeric(number(positions[i])+number(field(offset,"dx"))*weight); positions[i+1] = numeric(number(positions[i+1])+number(field(offset,"dy"))*weight);
        }
    }
    return mesh;
}
Value deform(const Value& p,Value mesh,const State& s,const Value& art,const Value& slot,Array& warp_issues,Array& rig_issues,Array& correction_issues,
    FrameAnimation* animation,const Value& morph = Value(),const State* to = nullptr,double weight = 0) {
    const auto warps = rig_warps(p,art,morph,animation); const auto poses = rig_poses(p,art,morph,animation);
    const auto warped = warp_mesh(p,field(s.node,"id"),art,field(mesh,"positions"),s.base,warps,to ? field(to->node,"id") : Value(),field(morph,"toKeyArtId"),animation ? &animation->active_warps : nullptr);
    for (const auto& d : field(warped,"diagnostics").get<Array>()) {
        if (!has(morph) && field(d,"code") == Value("DEFORMER_KEYFORM_MISSING") && !has(field(d,"details"))) {
            warp_issues.emplace_back(Object{{"code",field(d,"code")},{"semanticSlotId",slot},{"details",d}}); continue;
        }
        Object details = has(morph) ? Object{{"fromNodeId",field(s.node,"id")},{"toNodeId",field(to->node,"id")},{"fromKeyArtId",art},{"toKeyArtId",field(morph,"toKeyArtId")}} : Object{{"nodeId",field(s.node,"id")},{"keyArtId",art}};
        if (field(d,"details").is<Object>()) for (const auto& item : field(d,"details").get<Object>()) if (item.first != "boneId") details[item.first] = item.second;
        details["reason"] = field(d,"message"); warp_issues.emplace_back(Object{{"code",field(d,"code")},{"semanticSlotId",slot},{"details",Value(details)}});
    }
    mesh.get<Object>()["positions"] = field(field(warped,"mesh"),"positions");
    const auto skin_binding = binding(p,"skinBindings",field(s.node,"id")), rigid_binding = binding(p,"rigidBoneBindings",field(s.node,"id"));
    if (has(skin_binding) || has(rigid_binding) || (to && (has(binding(p,"skinBindings",field(to->node,"id"))) || has(binding(p,"rigidBoneBindings",field(to->node,"id")))))) {
        const auto fk = bone_fk(p,art,true,poses,warps,field(morph,"toKeyArtId"),animation ? &animation->active_warps : nullptr); const auto t = topology(p,mesh); Value evaluated;
        if (has(skin_binding) || (to && has(binding(p,"skinBindings",field(to->node,"id"))))) {
            const auto tb = to ? binding(p,"skinBindings",field(to->node,"id")) : skin_binding;
            if (to && (!has(skin_binding) || !has(tb) || field(skin_binding,"topologyId") != field(tb,"topologyId") || field(skin_binding,"vertexWeights").serialize() != field(tb,"vertexWeights").serialize() || field(skin_binding,"topologyId") != field(t,"id"))) {
                evaluated = Value(Object{{"mesh",mesh},{"diagnostics",Value(Array{Value(Object{{"code",Value("SKIN_TRANSITION_INCOMPATIBLE")},{"message",Value("Morph endpoints must use compatible enabled SkinBindings.")},
                    {"bindingId",coalesce(field(skin_binding,"id"),field(tb,"id"))},{"topologyId",field(t,"id")},{"details",Value(Object{{"fromBindingId",field(skin_binding,"id")},{"toBindingId",field(tb,"id")},{"fromTopologyId",field(skin_binding,"topologyId")},{"toTopologyId",field(tb,"topologyId")}})}})})}});
            } else if (!field(fk,"diagnostics").get<Array>().empty()) {
                auto diagnostics = field(fk,"diagnostics").get<Array>(); for (auto& d : diagnostics) { d.get<Object>()["bindingId"] = field(skin_binding,"id"); d.get<Object>()["topologyId"] = field(skin_binding,"topologyId"); }
                evaluated = Value(Object{{"mesh",mesh},{"diagnostics",Value(diagnostics)}});
            } else evaluated = skin_mesh(skin_binding,t,fk,field(mesh,"positions"),s.base);
        } else {
            Array diagnostics = field(fk,"diagnostics").get<Array>();
            const auto tb = to ? binding(p,"rigidBoneBindings",field(to->node,"id")) : rigid_binding;
            if (to && (!has(rigid_binding) || !has(tb) || field(rigid_binding,"boneId") != field(tb,"boneId")))
                diagnostics = {Value(Object{{"code",Value("BONE_TRANSITION_INCOMPATIBLE")},{"boneId",Value()},{"bindingId",Value()},{"message",Value("Morph endpoints must use compatible enabled rigid Bone bindings.")},
                    {"details",Value(Object{{"fromBindingId",field(rigid_binding,"id")},{"toBindingId",field(tb,"id")},{"fromBoneId",field(rigid_binding,"boneId")},{"toBoneId",field(tb,"boneId")}})}})};
            else if (!diagnostics.empty()) for (auto& d : diagnostics) { if (!has(field(d,"boneId"))) d.get<Object>()["boneId"] = field(rigid_binding,"boneId"); d.get<Object>()["bindingId"] = field(rigid_binding,"id"); }
            else {
                const auto pose = find(field(fk,"poses"),field(rigid_binding,"boneId"),"boneId");
                if (!has(pose)) diagnostics.emplace_back(Object{{"code",Value("BONE_NODE_MISSING")},{"boneId",field(rigid_binding,"boneId")},{"bindingId",field(rigid_binding,"id")},
                    {"message",Value("Rigid binding Bone was not produced by FK evaluation.")},{"details",Value(Object{{"boneId",field(rigid_binding,"boneId")}})}});
                else {
                    const auto& matrix = field(pose,"skinMatrix").get<Array>(); Affine skin_matrix{};
                    for (size_t i = 0; i < 6; ++i) skin_matrix[i] = number(matrix[i]);
                    const double det = s.base[0]*s.base[3]-s.base[1]*s.base[2];
                    if (!std::isfinite(det) || std::abs(det) < 1e-12) throw fl2d_queries::Error{"Error","Affine transform is not invertible."};
                    const double inv = 1/det, a = s.base[3]*inv, b = -s.base[1]*inv, c = -s.base[2]*inv, d = s.base[0]*inv;
                    const Affine inverse{a,b,c,d,-(a*s.base[4]+c*s.base[5]),-(b*s.base[4]+d*s.base[5])};
                    const auto local_matrix = fl2d_math::multiply(fl2d_math::multiply(inverse,skin_matrix),s.base); Array positions;
                    const auto& input = field(mesh,"positions").get<Array>();
                    for (size_t i = 0; i < input.size(); i += 2) {
                        positions.push_back(numeric(local_matrix[0]*number(input[i])+local_matrix[2]*number(input[i+1])+local_matrix[4]));
                        positions.push_back(numeric(local_matrix[1]*number(input[i])+local_matrix[3]*number(input[i+1])+local_matrix[5]));
                    }
                    evaluated = Value(Object{{"mesh",Value(Object{{"positions",Value(positions)}})},{"diagnostics",Value(Array{})}});
                }
            }
            if (!diagnostics.empty()) evaluated = Value(Object{{"mesh",mesh},{"diagnostics",Value(diagnostics)}});
        }
        collect(rig_issues,evaluated,slot); mesh.get<Object>()["positions"] = field(field(evaluated,"mesh"),"positions");
    }
    if (has(field(mesh,"topologyId"))) {
        const auto t = topology(p,mesh); auto k = correction(p,mesh,art,slot);
        Value corrected;
        if (has(morph)) {
            const auto tk = correction(p,mesh,field(morph,"toKeyArtId"),slot); Array incompatible;
            for (const auto& other : field(p,"meshFormCorrectionKeyforms").get<Array>())
                if ((field(other,"keyArtId") == art || field(other,"keyArtId") == field(morph,"toKeyArtId")) && field(other,"semanticSlotId") == slot && field(other,"topologyId") != field(t,"id")) incompatible.push_back(field(other,"id"));
            if ((!has(k) || !has(tk)) && !incompatible.empty()) {
                std::sort(incompatible.begin(),incompatible.end(),[](const Value& a,const Value& b){return fl2d_text::less(text(a),text(b));});
                correction_issues.emplace_back(Object{{"code",Value("MESH_FORM_CORRECTION_TRANSITION_INCOMPATIBLE")},{"semanticSlotId",slot},
                    {"details",Value(Object{{"topologyId",field(t,"id")},{"correctionIds",Value(incompatible)},{"reason",Value("Morph endpoint form correction uses an incompatible topology.")}})}});
            } else if (has(k) || has(tk)) {
                // Validate authored sparse forms before interpolating offsets. A finite
                // authored pair may overflow during interpolation; JS returns JSON null.
                corrected = form(t,has(k) ? k : tk,field(mesh,"positions"));
                if (field(corrected,"diagnostics").get<Array>().empty()) {
                    auto positions = field(mesh,"positions").get<Array>(); const auto& ids = field(t,"vertexIds").get<Array>();
                    for (size_t i = 0; i < ids.size(); ++i) {
                        const auto a = has(k) ? find(field(k,"vertexOffsets"),ids[i],"vertexId") : Value(), b = has(tk) ? find(field(tk,"vertexOffsets"),ids[i],"vertexId") : Value();
                        const double ax = has(a) ? number(field(a,"x")) : 0, ay = has(a) ? number(field(a,"y")) : 0;
                        const double bx = has(b) ? number(field(b,"x")) : 0, by = has(b) ? number(field(b,"y")) : 0;
                        positions[i*2] = numeric(number(positions[i*2])+(ax+(bx-ax)*weight)); positions[i*2+1] = numeric(number(positions[i*2+1])+(ay+(by-ay)*weight));
                    }
                    corrected.get<Object>().at("mesh").get<Object>()["positions"] = Value(positions);
                }
            }
        } else corrected = form(t,k,field(mesh,"positions"));
        if (has(corrected)) { collect(correction_issues,corrected,slot); mesh.get<Object>()["positions"] = field(field(corrected,"mesh"),"positions"); }
    }
    return apply_mesh(p,std::move(mesh),animation);
}
Value appearances(const Value& weights,const State& from,const State& to,const Value& fm,const Value& tm) {
    std::vector<std::pair<std::string,double>> sorted_weights;
    if (weights.is<Object>()) for (const auto& item : weights.get<Object>()) if (item.second.is<double>() && number(item.second) > 0) sorted_weights.emplace_back(item.first,number(item.second));
    std::sort(sorted_weights.begin(),sorted_weights.end(),[](const auto& a,const auto& b){return fl2d_text::less(a.first,b.first);});
    double sum = 0; for (const auto& w : sorted_weights) sum += w.second; Array output;
    for (const auto& w : sorted_weights) {
        const State* s = from.valid && field(from.member,"appearanceId") == Value(w.first) ? &from : to.valid && field(to.member,"appearanceId") == Value(w.first) ? &to : nullptr;
        const auto mesh = s == &from ? fm : tm;
        output.emplace_back(Object{{"appearanceId",Value(w.first)},{"sourceNodeId",s ? field(s->node,"id") : Value()},
            {"uvs",s ? field(mesh,"uvs") : Value(Array{})},{"weight",numeric(w.second/sum)}});
    }
    return Value(output);
}
Value instance(const std::string& id,const State& s,const Value& mesh,const Value& appearance,double alpha,const Value& order,const Value& clip) {
    return Value(Object{{"renderInstanceId",Value(id)},{"sourceNodeId",field(s.node,"id")},{"transform",fl2d_math::json(s.world)},
        {"mesh",Value(Object{{"positions",field(mesh,"positions")},{"indices",field(mesh,"indices")}})},{"appearanceSamples",appearance},
        {"opacity",numeric(alpha)},{"drawOrder",order},{"clipping",clip}});
}
Value part_result(const Value& slot,const Value& presence,Array instances = {}) { return Value(Object{{"semanticSlotId",slot},{"presence",presence},{"renderInstances",Value(instances)}}); }
Affine blend_transform(const Affine& a,const Affine& b,double weight) {
    const double sx = std::hypot(a[0],a[1]), tx = std::hypot(b[0],b[1]);
    if (!(sx > 1e-12) || !(tx > 1e-12)) throw fl2d_queries::Error{"Error","Cannot interpolate a singular affine transform."};
    const double ar = std::atan2(a[1],a[0]), br = std::atan2(b[1],b[0]);
    const double rotation = ar+(std::fmod(std::fmod(br-ar+pi,2*pi)+2*pi,2*pi)-pi)*weight;
    const double cosine = std::cos(rotation), sine = std::sin(rotation), scale = sx+(tx-sx)*weight;
    const double asy = (a[0]*a[3]-a[1]*a[2])/sx, bsy = (b[0]*b[3]-b[1]*b[2])/tx;
    const double ash = (a[0]*a[2]+a[1]*a[3])/sx, bsh = (b[0]*b[2]+b[1]*b[3])/tx;
    const double sy = asy+(bsy-asy)*weight, shear = ash+(bsh-ash)*weight;
    return {cosine*scale,sine*scale,cosine*shear-sine*sy,sine*shear+cosine*sy,a[4]+(b[4]-a[4])*weight,a[5]+(b[5]-a[5])*weight};
}

Value endpoint(const Value& p,const Value& owner,const Value& part,const Value& slot,const State& s,const Value& art,const char* end,
    Array& warp,Array& rig,Array& corrections,FrameAnimation* animation) {
    const auto presence = discrete(animation,"PresenceTrack","presence",s.valid ? field(s.member,"presence") : Value("absent"),s);
    const auto id = field(slot,"id");
    if (!s.valid || presence != Value("present")) return part_result(id,presence);
    auto mesh = deform(p,mesh_for(p,field(part,std::string(end) == "from" ? "fromKeyformId" : "toKeyformId"),s.node),s,art,id,warp,rig,corrections,animation);
    const State empty; const Value weights(Object{{text(field(s.member,"appearanceId")),Value(1.0)}});
    return part_result(id,presence,{instance(text(owner)+":"+text(id)+":"+end,s,mesh,
        appearances(weights,std::string(end) == "from" ? s : empty,std::string(end) == "to" ? s : empty,mesh,mesh),
        opacity(animation,number(field(s.member,"opacity")),s),discrete(animation,"DrawOrderTrack","drawOrder",field(s.member,"drawOrder"),s),
        discrete(animation,"ClippingTrack","clipping",clipping(p,s,Value(),id),s))});
}
Value endpoint_weights(const State& from,const State& to,double u) {
    Object weights; if (from.valid) weights[text(field(from.member,"appearanceId"))] = Value(1-u);
    if (to.valid) { const auto id = text(field(to.member,"appearanceId")); weights[id] = Value((weights.count(id) ? number(weights[id]) : 0)+u); }
    return Value(weights);
}
Value single(const Value& p,const Value& owner,const Value& part,const Value& slot,const State& s,const Value& art,const char* end,const Value& raw,
    const Value& sample,double alpha,const Value& presence,Array& warp,Array& rig,Array& corrections,FrameAnimation* animation) {
    const auto id = field(slot,"id"), node = field(s.node,"id");
    const auto resolved = discrete(animation,"PresenceTrack","presence",coalesce(sampled(sample,"PresenceTrack","presence",id,node),presence),s);
    if (!s.valid || resolved != Value("present")) return part_result(id,resolved);
    const auto mesh = deform(p,raw,s,art,id,warp,rig,corrections,animation); const State empty;
    return part_result(id,resolved,{instance(text(owner)+":"+text(id)+":"+text(field(part,"mode")),s,mesh,
        appearances(Value(Object{{text(field(s.member,"appearanceId")),Value(1.0)}}),std::string(end) == "from" ? s : empty,std::string(end) == "to" ? s : empty,raw,raw),
        opacity(animation,number(coalesce(sampled(sample,"OpacityTrack","opacity",id,node),Value(alpha))),s),
        discrete(animation,"DrawOrderTrack","drawOrder",coalesce(sampled(sample,"DrawOrderTrack","drawOrder",id,node),field(s.member,"drawOrder")),s),
        discrete(animation,"ClippingTrack","clipping",clipping(p,s,sample,id),s))});
}
Value interior(const Value& p,const Value& transition,const Value& part,const Value& slot,const State& from,const State& to,const Value& sample,double u,
    Array& warp,Array& rig,Array& corrections,FrameAnimation* animation) {
    const auto owner = field(transition,"id"), id = field(slot,"id"), fa = field(transition,"fromKeyArtId"), ta = field(transition,"toKeyArtId");
    const auto fm = from.valid ? mesh_for(p,field(part,"fromKeyformId"),from.node) : Value(), tm = to.valid ? mesh_for(p,field(part,"toKeyformId"),to.node) : Value();
    const auto mode = text(field(part,"mode")); const auto& selected = u < 0.5 ? from : to;
    if (mode == "morph") {
        const double weight = std::clamp(number(coalesce(sampled(sample,"GeometryBlendTrack","geometryWeight",id),Value(u))),0.0,1.0);
        const auto presence = discrete(animation,"PresenceTrack","presence",coalesce(sampled(sample,"PresenceTrack","presence",id),selected.valid ? field(selected.member,"presence") : Value("absent")),selected);
        if (presence != Value("present")) return part_result(id,presence);
        const auto t = find(field(p,"meshTopologies"),field(part,"topologyId")); Array positions;
        const auto& a = field(fm,"positions").get<Array>(); const auto& b = field(tm,"positions").get<Array>();
        for (size_t i = 0; i < a.size(); ++i) positions.push_back(numeric(number(a[i])+(number(b[i])-number(a[i]))*weight));
        Value mesh(Object{{"topologyId",field(t,"id")},{"positions",Value(positions)},{"indices",field(t,"indices")}});
        State blended = weight < 1 ? from : to; blended.base = blend_transform(from.base,to.base,weight); blended.world = blend_transform(from.world,to.world,weight);
        auto morph = morph_rig(p,fa,ta,weight); morph.get<Object>()["toKeyArtId"] = ta;
        // Geometry starts in the common interpolated frame; authored references still use the from endpoint.
        State geometry = from; geometry.base = blended.base; geometry.world = blended.world;
        mesh = deform(p,mesh,geometry,fa,id,warp,rig,corrections,animation,morph,&to,weight);
        const double alpha = (from.valid ? number(field(from.member,"opacity")) : 0)+((to.valid ? number(field(to.member,"opacity")) : 0)-(from.valid ? number(field(from.member,"opacity")) : 0))*u;
        return part_result(id,presence,{instance(text(owner)+":"+text(id)+":morph",blended,mesh,
            appearances(coalesce(sampled(sample,"AppearanceTrack","appearance",id),endpoint_weights(from,to,u)),from,to,fm,tm),
            opacity(animation,number(coalesce(sampled(sample,"OpacityTrack","opacity",id),Value(alpha))),selected),
            discrete(animation,"DrawOrderTrack","drawOrder",coalesce(sampled(sample,"DrawOrderTrack","drawOrder",id),selected.valid ? field(selected.member,"drawOrder") : Value(0.0)),selected),
            discrete(animation,"ClippingTrack","clipping",clipping(p,selected,sample,id),selected))});
    }
    if (mode == "replace") {
        const auto weighted = appearances(coalesce(sampled(sample,"AppearanceTrack","appearance",id),endpoint_weights(from,to,u)),from,to,fm,tm);
        const auto group = field(field(part,"configuration"),"compositeGroupId"); Array instances;
        for (int i = 0; i < 2; ++i) {
            const auto& s = i == 0 ? from : to; if (!s.valid) continue; double weight = 0;
            for (const auto& w : weighted.get<Array>()) if (field(w,"appearanceId") == field(s.member,"appearanceId")) { weight = number(field(w,"weight")); break; }
            if (!(weight > 0) || discrete(animation,"PresenceTrack","presence",field(s.member,"presence"),s) != Value("present")) continue;
            const auto raw = i == 0 ? fm : tm; const auto mesh = deform(p,raw,s,i == 0 ? fa : ta,id,warp,rig,corrections,animation); const State empty;
            auto render = instance(text(owner)+":"+text(id)+(i == 0 ? ":from" : ":to"),s,mesh,
                appearances(Value(Object{{text(field(s.member,"appearanceId")),Value(1.0)}}),i == 0 ? s : empty,i == 1 ? s : empty,raw,raw),
                opacity(animation,number(field(s.member,"opacity"))*(has(group) && !text(group).empty() ? 1 : weight)*number(coalesce(sampled(sample,"OpacityTrack","opacity",id,field(s.node,"id")),Value(1.0))),s),
                discrete(animation,"DrawOrderTrack","drawOrder",coalesce(sampled(sample,"DrawOrderTrack","drawOrder",id,field(s.node,"id")),field(s.member,"drawOrder")),s),
                discrete(animation,"ClippingTrack","clipping",clipping(p,s,sample,id),s));
            if (has(group) && !text(group).empty()) { render.get<Object>()["compositeGroupId"] = group; render.get<Object>()["compositeWeight"] = Value(weight); }
            instances.push_back(render);
        }
        const auto presence = discrete(animation,"PresenceTrack","presence",coalesce(sampled(sample,"PresenceTrack","presence",id),Value(instances.empty() ? "absent" : "present")),selected);
        return part_result(id,presence,presence == Value("present") ? instances : Array{});
    }
    if (mode == "hold") {
        const bool hold_to = field(field(part,"configuration"),"holdEndpoint") == Value("to"), use_to = hold_to || !from.valid;
        const auto& s = use_to ? to : from;
        return single(p,owner,part,slot,s,use_to ? ta : fa,use_to ? "to" : "from",use_to ? tm : fm,sample,
            s.valid ? number(field(s.member,"opacity")) : 0,s.valid ? field(s.member,"presence") : Value("absent"),warp,rig,corrections,animation);
    }
    const bool appear = mode == "appear"; const auto& s = appear ? to : from;
    const auto presence = mode == "occlusion" ? (u < 0.5 ? coalesce(field(from.member,"presence"),Value("present")) : Value("occluded")) : Value("present");
    const double alpha = (s.valid ? number(field(s.member,"opacity")) : 0)*(appear ? u : mode == "disappear" ? 1-u : 1);
    return single(p,owner,part,slot,s,appear ? ta : fa,appear ? "to" : "from",appear ? tm : fm,sample,alpha,presence,warp,rig,corrections,animation);
}
Array groups(const Array& parts) {
    std::map<std::string,Array> members;
    for (const auto& part : parts) for (const auto& v : field(part,"renderInstances").get<Array>()) if (has(field(v,"compositeGroupId")))
        members[text(field(v,"compositeGroupId"))].emplace_back(Object{{"renderInstanceId",field(v,"renderInstanceId")},{"weight",field(v,"compositeWeight")}});
    Array output; for (auto& [id,values] : members) output.emplace_back(Object{{"compositeGroupId",Value(id)},{"mode",Value("weighted-premultiplied")},{"members",Value(sorted(values,"renderInstanceId"))}});
    return sorted(output,"compositeGroupId");
}
void resolve_clipping(const Value& p,Array& parts,Array& issues) {
    struct Entry { Value slot, authored; Value* render; }; std::vector<Entry> entries;
    for (auto& part : parts) for (auto& render : part.get<Object>().at("renderInstances").get<Array>()) entries.push_back({field(part,"semanticSlotId"),field(render,"clipping"),&render});
    std::sort(entries.begin(),entries.end(),[](const Entry& a,const Entry& b){return fl2d_text::less(text(field(*a.render,"renderInstanceId")),text(field(*b.render,"renderInstanceId")));});
    const auto& nodes = field(field(p,"scene"),"nodes").get<Object>();
    auto issue = [&](const char* code,const Entry& e,Object extra) {
        Object details{{"renderInstanceId",field(*e.render,"renderInstanceId")},{"targetNodeId",field(*e.render,"sourceNodeId")},{"sourceNodeId",field(e.authored,"sourceNodeId")}};
        for (const auto& item : extra) details[item.first] = item.second;
        issues.emplace_back(Object{{"code",Value(code)},{"semanticSlotId",e.slot},{"details",Value(details)}});
    };
    for (auto& e : entries) {
        e.render->get<Object>()["clipping"] = Value(); const auto source = field(e.authored,"sourceNodeId"); if (!has(source) || text(source).empty()) continue;
        const auto node = nodes.find(text(source));
        if (node == nodes.end()) { issue("CLIPPING_SOURCE_MISSING",e,{}); continue; }
        if (field(node->second,"kind") != Value("part")) { issue("CLIPPING_SOURCE_NOT_RENDERABLE",e,{{"reason",Value("source-node-kind")},{"sourceNodeKind",field(node->second,"kind")}}); continue; }
        std::vector<const Entry*> candidates;
        for (const auto& other : entries) if (field(*other.render,"sourceNodeId") == source) candidates.push_back(&other);
        if (candidates.empty()) for (const auto& other : entries) {
            bool matched = false;
            for (const auto& slot : field(p,"semanticSlots").get<Array>()) if (field(slot,"id") == other.slot)
                for (const auto& mapping : field(slot,"mappings").get<Array>()) if (field(mapping,"nodeId") == source) matched = true;
            if (matched) candidates.push_back(&other);
        }
        if (candidates.size() != 1) {
            Array ids; for (const auto* other : candidates) ids.push_back(field(*other->render,"renderInstanceId"));
            issue("CLIPPING_SOURCE_NOT_RENDERABLE",e,{{"reason",Value(candidates.empty() ? "source-not-evaluated" : "ambiguous-evaluated-source")},{"candidateRenderInstanceIds",Value(ids)}}); continue;
        }
        e.render->get<Object>()["clipping"] = Value(Object{{"sourceRenderInstanceId",field(*candidates.front()->render,"renderInstanceId")},{"mode",coalesce(field(e.authored,"mode"),Value("inside"))}});
    }
    std::map<std::string,size_t> index; for (size_t i = 0; i < entries.size(); ++i) index[text(field(*entries[i].render,"renderInstanceId"))] = i;
    std::vector<int> visited(entries.size()); std::vector<size_t> stack; std::map<std::string,std::vector<size_t>> cycles;
    std::function<void(size_t)> visit = [&](size_t i) {
        visited[i] = 1; stack.push_back(i); const auto next = text(field(field(*entries[i].render,"clipping"),"sourceRenderInstanceId"));
        if (index.count(next)) {
            const size_t j = index.at(next);
            if (visited[j] == 1) {
                std::vector<size_t> cycle(std::find(stack.begin(),stack.end(),j),stack.end());
                std::rotate(cycle.begin(),std::min_element(cycle.begin(),cycle.end()),cycle.end()); std::string key;
                for (const auto k : cycle) { key += text(field(*entries[k].render,"renderInstanceId")); key += '\0'; } cycles[key] = cycle;
            } else if (visited[j] == 0) visit(j);
        }
        stack.pop_back(); visited[i] = 2;
    };
    for (size_t i = 0; i < entries.size(); ++i) if (!visited[i]) visit(i);
    for (const auto& [key,cycle] : cycles) {
        (void)key; Array ids; for (const auto i : cycle) ids.push_back(field(*entries[i].render,"renderInstanceId"));
        issue("CLIPPING_CYCLE",entries[cycle.front()],{{"renderInstanceIds",Value(ids)}});
        for (const auto i : cycle) entries[i].render->get<Object>()["clipping"] = Value();
    }
}
void derive(const Value& owner,bool key_art,const Value& ticks,const Array& issues,Array& diagnostics) {
    for (const auto& d : issues) diagnostics.push_back(frame_diagnostic(owner,key_art,text(field(d,"code")).c_str(),"error",field(d,"semanticSlotId"),ticks,field(d,"details").get<Object>()));
}
}
Value transition_frame(const Value& p,const Value& transition,double ticks,FrameAnimation* animation) {
    const auto program = find(field(p,"temporalPrograms"),field(transition,"temporalProgramId"));
    const double duration = number(field(program,"durationTicks")), time = std::clamp(ticks,0.0,duration), u = time/duration;
    const auto sample = sample_program(program,Value(time)), fa = find(field(p,"keyArts"),field(transition,"fromKeyArtId")), ta = find(field(p,"keyArts"),field(transition,"toKeyArtId"));
    Array parts,warp,rig,corrections,clipping_issues;
    for (const auto& slot : sorted(field(p,"semanticSlots").get<Array>())) {
        const auto id = field(slot,"id"), part = find(field(transition,"partTransitions"),id,"semanticSlotId");
        if (!has(part) && !has(find(field(slot,"mappings"),field(fa,"id"),"keyArtId")) && !has(find(field(slot,"mappings"),field(ta,"id"),"keyArtId"))) continue;
        const auto from = state(p,fa,slot,animation), to = state(p,ta,slot,animation);
        if (time == 0 || time == duration) parts.push_back(endpoint(p,field(transition,"id"),part,slot,time == 0 ? from : to,time == 0 ? field(fa,"id") : field(ta,"id"),time == 0 ? "from" : "to",warp,rig,corrections,animation));
        else if (!has(part)) parts.push_back(part_result(id,Value("absent")));
        else parts.push_back(interior(p,transition,part,slot,from,to,sample,u,warp,rig,corrections,animation));
    }
    resolve_clipping(p,parts,clipping_issues); Array diagnostics = transition_diagnostics(p,transition).get<Array>();
    struct OrderEntry { Value id, group; }; std::map<double,std::vector<OrderEntry>> by_order;
    for (const auto& part : parts) for (const auto& v : field(part,"renderInstances").get<Array>()) by_order[number(field(v,"drawOrder"))].push_back({field(v,"renderInstanceId"),field(v,"compositeGroupId")});
    for (const auto& [order,entries] : by_order) if (entries.size() > 1) {
        bool same = has(entries.front().group); for (const auto& e : entries) if (e.group != entries.front().group) same = false;
        if (!same) { Array ids; for (const auto& e : entries) ids.push_back(e.id); std::sort(ids.begin(),ids.end(),[](const Value& a,const Value& b){return fl2d_text::less(text(a),text(b));});
            diagnostics.push_back(frame_diagnostic(field(transition,"id"),false,"TRANSITION_DRAW_ORDER_CONFLICT","error",Value(),Value(time),{{"drawOrder",Value(order)},{"renderInstanceIds",Value(ids)}})); }
    }
    for (const auto* issues : {&clipping_issues,&warp,&rig,&corrections}) derive(field(transition,"id"),false,Value(time),*issues,diagnostics);
    acknowledge(diagnostics,transition); order_diagnostics(diagnostics);
    return Value(Object{{"transitionId",field(transition,"id")},{"timeTicks",Value(time)},{"normalizedTime",Value(u)},{"evaluatedParts",Value(parts)},{"compositeGroups",Value(groups(parts))},{"diagnostics",Value(diagnostics)}});
}
Value keyart_frame(const Value& p,const Value& art,const Value& evaluation_id,FrameAnimation* animation) {
    Array parts,selections,diagnostics,warp,rig,corrections,clipping_issues;
    for (const auto& slot : sorted(field(p,"semanticSlots").get<Array>())) {
        if (!has(find(field(slot,"mappings"),field(art,"id"),"keyArtId"))) continue;
        Array candidates; for (const auto& k : field(p,"meshKeyforms").get<Array>()) if (field(k,"keyArtId") == field(art,"id") && field(k,"semanticSlotId") == field(slot,"id")) candidates.push_back(k);
        candidates = sorted(candidates); const auto k = candidates.size() == 1 ? candidates.front() : Value();
        selections.emplace_back(Object{{"semanticSlotId",field(slot,"id")},{"keyformId",field(k,"id")},{"topologyId",field(k,"topologyId")}});
        if (candidates.size() > 1) { Array ids; for (const auto& c : candidates) ids.push_back(field(c,"id")); diagnostics.push_back(frame_diagnostic(field(art,"id"),true,"SEQUENCE_KEYART_BASE_AMBIGUOUS","error",field(slot,"id"),Value(),{{"keyformIds",Value(ids)}})); }
        parts.push_back(endpoint(p,evaluation_id,Value(Object{{"fromKeyformId",field(k,"id")}}),slot,state(p,art,slot,animation),field(art,"id"),"from",warp,rig,corrections,animation));
    }
    resolve_clipping(p,parts,clipping_issues);
    for (const auto* issues : {&clipping_issues,&warp,&rig,&corrections}) derive(field(art,"id"),true,Value(),*issues,diagnostics);
    order_diagnostics(diagnostics);
    return Value(Object{{"keyArtId",field(art,"id")},{"evaluatedParts",Value(parts)},{"compositeGroups",Value(groups(parts))},{"baseSelections",Value(selections)},{"diagnostics",Value(diagnostics)}});
}
}
