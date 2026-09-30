#include "native_frame_evaluation.h"
#include "native_temporal_evaluation.h"
#include "native_queries.h"
#include "js_text.h"
#include "wide_ticks.h"
#include <algorithm>
#include <cmath>
#include <limits>

namespace fl2d_evaluation {
namespace {
using fl2d_commands::field;
bool has(const Value& v) { return !v.is<picojson::null>(); }
std::string text(const Value& v) { return v.is<std::string>() ? v.get<std::string>() : ""; }
double num(const Value& v) { return v.is<double>() ? v.get<double>() : std::numeric_limits<double>::quiet_NaN(); }
Value numeric(double n) { return std::isfinite(n) ? Value(n) : Value(); }
Value find(const Value& values,const Value& id,const char* key = "id") {
    for (const auto& v : values.get<Array>()) if (field(v,key) == id) return v;
    return Value();
}
Array ordered(Array values,const std::vector<const char*>& keys = {},const char* id = "id") {
    std::stable_sort(values.begin(),values.end(),[&](const Value& a,const Value& b){
        for (const auto key : keys) if (field(a,key) != field(b,key)) return num(field(a,key)) < num(field(b,key));
        return fl2d_text::less(text(field(a,id)),text(field(b,id)));
    }); return values;
}
uint64_t integer(const Value& v) { return static_cast<uint64_t>(num(v)); }
Value duration(const Value& p,const Value& owner) { return field(find(field(p,"temporalPrograms"),field(owner,"temporalProgramId")),"durationTicks"); }
uint64_t local_tick(const Value& p,const Value& item,uint64_t time) {
    const uint64_t start = integer(field(item,"startTicks")), end = integer(field(item,"endTicks"));
    if (field(item,"kind") == Value("KeyArtHold")) return time-start;
    const uint64_t length = integer(duration(p,find(field(p,"transitions"),field(item,"transitionId"))));
    if (time == start) return 0;
    if (time == end) return length;
    return fl2d_ticks::round_half_up(fl2d_ticks::UInt128(time-start).times(length),end-start).low();
}
using SemanticNodes = std::map<std::string,std::set<std::string>>;
SemanticNodes semantic_nodes(const Value& p,const Value& item,uint64_t local) {
    SemanticNodes result;
    const bool hold = field(item,"kind") == Value("KeyArtHold");
    const auto t = hold ? Value() : find(field(p,"transitions"),field(item,"transitionId"));
    for (const auto& slot : field(p,"semanticSlots").get<Array>()) {
        auto add = [&](const Value& mapping) { if (has(mapping)) result[text(field(slot,"id"))].insert(text(field(mapping,"nodeId"))); };
        if (hold) { add(find(field(slot,"mappings"),field(item,"keyArtId"),"keyArtId")); continue; }
        const auto from = find(field(slot,"mappings"),field(t,"fromKeyArtId"),"keyArtId"), to = find(field(slot,"mappings"),field(t,"toKeyArtId"),"keyArtId");
        if (local == 0) { add(from); continue; }
        if (local == integer(duration(p,t))) { add(to); continue; }
        const auto part = find(field(t,"partTransitions"),field(slot,"id"),"semanticSlotId"); if (!has(part)) continue;
        const auto mode = text(field(part,"mode"));
        if (mode == "morph" || mode == "replace") { add(from); add(to); }
        else if (mode == "appear") add(to);
        else if (mode == "hold") add(field(field(part,"configuration"),"holdEndpoint") == Value("to") ? to : has(from) ? from : to);
        else add(from);
    }
    return result;
}
std::vector<std::string> targets(const Value& entry,const SemanticNodes& nodes) {
    const auto target = field(entry,"target");
    if (has(field(target,"nodeId"))) return {text(field(target,"nodeId"))};
    const auto found = nodes.find(text(field(target,"semanticSlotId"))); if (found == nodes.end()) return {};
    std::vector<std::string> result(found->second.begin(),found->second.end()); std::sort(result.begin(),result.end(),fl2d_text::less); return result;
}
Value incompatible(const Value& p,const Value& sequence,const Value& instance,const Value& node) {
    Array slots; for (const auto& slot : field(p,"semanticSlots").get<Array>()) for (const auto& m : field(slot,"mappings").get<Array>()) if (field(m,"nodeId") == node) { slots.push_back(slot); break; }
    slots = ordered(slots);
    for (const auto& item : ordered(field(sequence,"viewLaneItems").get<Array>(),{"startTicks","endTicks"})) {
        const double start = std::max(num(field(instance,"startTicks")),num(field(item,"startTicks"))), end = std::min(num(field(instance,"endTicks")),num(field(item,"endTicks")));
        if (start >= end) continue;
        // Preserve JavaScript's double addition before midpoint rounding.
        for (const double tick : {start,std::floor((start+end-1)/2),end-1}) {
            const auto nodes = semantic_nodes(p,item,local_tick(p,item,static_cast<uint64_t>(tick)));
            for (const auto& slot : slots) {
                const auto found = nodes.find(text(field(slot,"id"))); if (found == nodes.end()) continue;
                std::vector<std::string> values(found->second.begin(),found->second.end()); std::sort(values.begin(),values.end(),fl2d_text::less);
                for (const auto& other : values) if (Value(other) != node) return Value(Object{{"semanticSlotId",field(slot,"id")},{"mappedNodeId",Value(other)},{"sequenceTick",Value(tick)}});
            }
        }
    }
    return Value();
}
std::string stable_id(const Value& t) {
    for (const auto key : {"nodeId","semanticSlotId","boneId"}) if (has(field(t,key))) return text(field(t,key));
    if (has(field(t,"deformerId")) && has(field(t,"controlPointId"))) return text(field(t,"deformerId"))+":"+text(field(t,"controlPointId"));
    for (const auto key : {"meshId","cameraId"}) if (has(field(t,key))) return text(field(t,key));
    return "";
}
bool valid_target(const Value& p,const Value& e) {
    const auto t = field(e,"target");
    if (has(field(t,"nodeId"))) return field(field(p,"scene"),"nodes").get<Object>().count(text(field(t,"nodeId"))) != 0;
    if (has(field(t,"semanticSlotId"))) return has(find(field(p,"semanticSlots"),field(t,"semanticSlotId")));
    if (has(field(t,"boneId"))) return has(find(field(field(p,"rig"),"bones"),field(t,"boneId")));
    if (has(field(t,"deformerId")) || has(field(t,"controlPointId"))) {
        const auto d = find(field(field(p,"rig"),"deformers"),field(t,"deformerId")), point = find(field(field(p,"rig"),"warpControlPoints"),field(t,"controlPointId"));
        return has(d) && has(point) && field(point,"deformerId") == field(t,"deformerId") && std::find(field(d,"controlPointIds").get<Array>().begin(),field(d,"controlPointIds").get<Array>().end(),field(point,"id")) != field(d,"controlPointIds").get<Array>().end();
    }
    return has(field(t,"meshId")) && has(find(field(p,"meshes"),field(t,"meshId")));
}
struct Active { Value instance,clip,program,projection,sample; };
Array contributions(const std::vector<Active>& active) {
    Array result;
    for (const auto& a : active) {
        if (!(num(field(a.instance,"weight")) > 0)) continue;
        for (const auto& track : field(a.sample,"tracks").get<Array>()) for (const auto& [channel,value] : field(track,"values").get<Object>()) if (has(value))
            result.emplace_back(Object{{"kind",field(track,"kind")},{"channel",Value(channel)},{"target",field(track,"target")},{"targetStableId",Value(stable_id(field(track,"target")))},
                {"value",value},{"weight",field(a.instance,"weight")},{"layer",field(a.instance,"layer")},{"clipInstanceId",field(a.instance,"id")},{"clipId",field(a.clip,"id")},{"programId",field(a.program,"id")},{"trackId",field(track,"trackId")}});
    }
    std::stable_sort(result.begin(),result.end(),[](const Value& a,const Value& b){
        if (field(a,"layer") != field(b,"layer")) return num(field(a,"layer")) < num(field(b,"layer"));
        for (const auto key : {"clipInstanceId","trackId","channel","targetStableId"}) if (field(a,key) != field(b,key)) return fl2d_text::less(text(field(a,key)),text(field(b,key)));
        return false;
    }); return result;
}
void mix(const Value& p,const Value& sequence,const std::vector<Active>& active,const SemanticNodes& nodes,FrameAnimation& animation,Array& deformer_entries) {
    const auto entries = contributions(active); std::map<std::string,std::array<double,5>> transforms; std::map<std::string,Array> discrete;
    auto issue = [&](const char* code,const Object& details) { animation.diagnostics.push_back(sequence_diagnostic(field(sequence,"id"),code,details)); };
    for (const auto& e : entries) {
        const auto kind = text(field(e,"kind")), channel = text(field(e,"channel")); const auto target = field(e,"target"); const double value = num(field(e,"value")), weight = num(field(e,"weight"));
        if (!valid_target(p,e)) { issue("ANIMATION_TRACK_TARGET_INVALID",{{"clipInstanceId",field(e,"clipInstanceId")},{"trackId",field(e,"trackId")},{"kind",field(e,"kind")},{"target",target}}); continue; }
        if (kind == "TransformTrack") {
            if (has(field(target,"nodeId"))) {
                Value placement; for (const auto& a : active) if (field(a.instance,"id") == field(e,"clipInstanceId")) { placement = a.instance; break; }
                const auto bad = incompatible(p,sequence,placement,field(target,"nodeId"));
                if (has(bad)) { auto details = bad.get<Object>(); details["clipInstanceId"] = field(e,"clipInstanceId"); details["trackId"] = field(e,"trackId"); details["nodeId"] = field(target,"nodeId"); issue("ANIMATION_CLIP_TARGET_INCOMPATIBLE",details); continue; }
            }
            for (const auto& node : targets(e,nodes)) {
                if (!transforms.count(node)) transforms[node] = {0,0,0,1,1};
                auto& t = transforms[node];
                if (channel == "positionX") t[0] += value*weight;
                if (channel == "positionY") t[1] += value*weight;
                if (channel == "rotation") t[2] += value*weight;
                if (channel == "scaleX") t[3] *= std::pow(value,weight);
                if (channel == "scaleY") t[4] *= std::pow(value,weight);
            }
        } else if (kind == "BoneTrack") {
            auto& d = animation.bone_deltas[text(field(target,"boneId"))]; d[channel == "x" ? 0 : channel == "y" ? 1 : 2] += value*weight;
        } else if (kind == "DeformerTrack") {
            deformer_entries.push_back(e); auto& d = animation.warp_deltas[text(field(target,"deformerId"))+'\0'+text(field(target,"controlPointId"))]; d[channel == "deltaX" ? 0 : 1] += value*weight;
        } else if (kind == "MeshDeformationTrack") animation.mesh_entries.push_back(e);
        else if (kind == "OpacityTrack") for (const auto& node : targets(e,nodes)) {
            if (!animation.opacity.count(node)) animation.opacity[node] = 1;
            animation.opacity[node] *= 1+weight*(value-1);
        }
    }
    // Discrete arbitration uses all contributions, independently of numeric target validation.
    for (const auto& e : entries) {
        const auto kind = text(field(e,"kind")); if (kind != "PresenceTrack" && kind != "DrawOrderTrack" && kind != "ClippingTrack") continue;
        if (field(e,"weight") != Value(1.0)) { issue("ANIMATION_DISCRETE_WEIGHT_INVALID",{{"clipInstanceId",field(e,"clipInstanceId")},{"trackId",field(e,"trackId")},{"kind",field(e,"kind")},{"channel",field(e,"channel")},{"weight",field(e,"weight")}}); continue; }
        for (const auto& node : targets(e,nodes)) discrete[kind+'\0'+text(field(e,"channel"))+'\0'+node].push_back(e);
    }
    for (const auto& [key,list] : discrete) {
        double layer = -std::numeric_limits<double>::infinity(); for (const auto& e : list) layer = std::max(layer,num(field(e,"layer")));
        Array highest,identities; std::set<std::string> values;
        for (const auto& e : list) if (num(field(e,"layer")) == layer) { highest.push_back(e); values.insert(canonical_evidence(field(e,"value"))); identities.emplace_back(Object{{"clipInstanceId",field(e,"clipInstanceId")},{"trackId",field(e,"trackId")},{"value",field(e,"value")}}); }
        if (values.size() > 1) {
            const auto first = key.find('\0'), second = key.find('\0',first+1);
            issue("ANIMATION_TRACK_CONFLICT",{{"targetStableId",Value(key.substr(second+1))},{"kind",Value(key.substr(0,first))},{"channel",Value(key.substr(first+1,second-first-1))},{"layer",Value(layer)},{"contributions",Value(identities)}});
        } else animation.discrete[key] = field(highest.front(),"value");
    }
    const auto& scene_nodes = field(field(p,"scene"),"nodes").get<Object>();
    for (const auto& [node,d] : transforms) {
        auto t = field(scene_nodes.at(node),"transform");
        t.get<Object>()["position"] = Value(Object{{"x",numeric(num(field(field(t,"position"),"x"))+d[0])},{"y",numeric(num(field(field(t,"position"),"y"))+d[1])}});
        t.get<Object>()["rotation"] = numeric(num(field(t,"rotation"))+d[2]);
        t.get<Object>()["scale"] = Value(Object{{"x",numeric(num(field(field(t,"scale"),"x"))*d[3])},{"y",numeric(num(field(field(t,"scale"),"y"))*d[4])}}); animation.transforms[node] = t;
    }
}
void finalize(const Value& p,FrameAnimation& a,const Array& deformers) {
    auto issue = [&](const char* code,const Object& details) { a.diagnostics.push_back(sequence_diagnostic(a.sequence_id,code,details)); };
    for (const auto& e : deformers) if (!a.active_warps.count(text(field(field(e,"target"),"deformerId"))))
        issue("ANIMATION_TRACK_TARGET_INVALID",{{"clipInstanceId",field(e,"clipInstanceId")},{"trackId",field(e,"trackId")},{"kind",field(e,"kind")},{"target",field(e,"target")},{"reason",Value("deformer-not-active")}});
    for (const auto& e : a.mesh_entries) {
        if (a.applied_mesh_entries.count(text(field(e,"clipInstanceId"))+'\0'+text(field(e,"trackId"))+'\0'+text(field(e,"channel")))) continue;
        const auto sample = find(field(field(p,"animation"),"deformationSamples"),field(field(e,"value"),"deformationSampleId"));
        if (!has(sample) || field(sample,"meshId") != field(field(e,"target"),"meshId"))
            issue("ANIMATION_TRACK_TARGET_INVALID",{{"clipInstanceId",field(e,"clipInstanceId")},{"trackId",field(e,"trackId")},{"kind",field(e,"kind")},{"target",field(e,"target")},{"deformationSampleId",field(field(e,"value"),"deformationSampleId")},{"reason",Value(!has(sample) ? "deformation-sample-missing" : "sample-mesh-mismatch")}});
        else {
            Array ids; for (const auto& id : a.active_topologies) ids.push_back(Value(id)); std::sort(ids.begin(),ids.end(),[](const Value& l,const Value& r){return fl2d_text::less(text(l),text(r));});
            issue("ANIMATION_TOPOLOGY_INCOMPATIBLE",{{"clipInstanceId",field(e,"clipInstanceId")},{"trackId",field(e,"trackId")},{"meshId",field(field(e,"target"),"meshId")},{"sampleTopologyId",field(sample,"topologyId")},{"activeTopologyIds",Value(ids)},{"reason",Value("topology-not-active")}});
        }
    }
}
}
Value sequence_frame(const Value& p,const Value& sequence,double ticks) {
    if (!std::isfinite(ticks) || std::trunc(ticks) != ticks || ticks < 0 || ticks > num(duration(p,sequence))) throw fl2d_queries::Error{"RangeError","Sequence timeTicks must be within its owned TemporalProgram duration."};
    Value item; const auto items = ordered(field(sequence,"viewLaneItems").get<Array>(),{"startTicks","endTicks"});
    if (ticks == num(duration(p,sequence))) { if (!items.empty()) item = items.back(); }
    else for (const auto& candidate : items) if (num(field(candidate,"startTicks")) <= ticks && ticks < num(field(candidate,"endTicks"))) { item = candidate; break; }
    if (!has(item)) throw fl2d_queries::Error{"Error","Sequence ViewLane does not cover tick "+std::to_string(static_cast<uint64_t>(ticks))+"."};
    const auto sequence_program = find(field(p,"temporalPrograms"),field(sequence,"temporalProgramId")), sequence_sample = sample_program(sequence_program,Value(ticks));
    std::vector<Active> active;
    for (const auto& instance : ordered(field(sequence,"clipInstances").get<Array>(),{"startTicks","endTicks","layer"})) {
        const auto clip = find(field(field(p,"animation"),"clips"),field(instance,"clipId")), program = find(field(p,"temporalPrograms"),field(clip,"temporalProgramId"));
        const auto projection = clip_projection(instance,static_cast<uint64_t>(ticks),integer(field(program,"durationTicks")));
        if (field(projection,"active") == Value(true)) active.push_back({instance,clip,program,projection,sample_program(program,field(projection,"localTick"))});
    }
    std::stable_sort(active.begin(),active.end(),[](const Active& a,const Active& b){return field(a.instance,"layer") != field(b.instance,"layer") ? num(field(a.instance,"layer")) < num(field(b.instance,"layer")) : fl2d_text::less(text(field(a.instance,"id")),text(field(b.instance,"id")));});
    const uint64_t local = local_tick(p,item,static_cast<uint64_t>(ticks)); FrameAnimation animation; animation.sequence_id = field(sequence,"id"); Array deformer_entries;
    mix(p,sequence,active,semantic_nodes(p,item,local),animation,deformer_entries);
    const auto base = field(item,"kind") == Value("KeyArtHold") ? keyart_frame(p,find(field(p,"keyArts"),field(item,"keyArtId")),Value(text(field(sequence,"id"))+":"+text(field(item,"id"))),&animation) : transition_frame(p,find(field(p,"transitions"),field(item,"transitionId")),static_cast<double>(local),&animation);
    finalize(p,animation,deformer_entries);
    Value camera_track; for (const auto& track : field(sequence_sample,"tracks").get<Array>()) if (field(track,"kind") == Value("CameraTrack")) { camera_track = track; break; }
    Object camera; for (const auto key : {"positionX","positionY","rotation","scale"}) camera[key] = has(field(field(camera_track,"values"),key)) ? field(field(camera_track,"values"),key) : Value(std::string(key) == "scale" ? 1.0 : 0.0);
    Array events,projections; auto append_events = [&](const Value& sample,const Value& program,const Value& clip) { for (const auto& event : field(sample,"events").get<Array>()) events.emplace_back(Object{{"sequenceTick",Value(ticks)},{"sourceScope",Value(has(clip) ? "clip" : "sequence")},{"clipInstanceId",clip},{"programId",field(program,"id")},{"event",event}}); };
    append_events(sequence_sample,sequence_program,Value());
    for (const auto& a : active) {
        append_events(a.sample,a.program,field(a.instance,"id")); auto v = a.projection; v.get<Object>()["weight"] = field(a.instance,"weight"); v.get<Object>()["layer"] = field(a.instance,"layer"); v.get<Object>()["visuallyContributing"] = Value(num(field(a.instance,"weight")) > 0); projections.push_back(v);
    }
    std::stable_sort(events.begin(),events.end(),[](const Value& a,const Value& b){
        if (field(a,"sourceScope") != field(b,"sourceScope")) return field(a,"sourceScope") == Value("sequence");
        for (const auto key : {"clipInstanceId","programId"}) if (field(a,key) != field(b,key)) return fl2d_text::less(text(field(a,key)),text(field(b,key)));
        return fl2d_text::less(text(field(field(a,"event"),"id")),text(field(field(b,"event"),"id")));
    });
    std::map<std::string,Value> unique; for (const auto& d : field(base,"diagnostics").get<Array>()) unique[text(field(d,"key"))] = d; for (const auto& d : animation.diagnostics) unique[text(field(d,"key"))] = d;
    Array diagnostics; bool authoritative = true; for (const auto& [key,d] : unique) { (void)key; diagnostics.push_back(d); if (field(d,"severity") == Value("error")) authoritative = false; }
    std::stable_sort(diagnostics.begin(),diagnostics.end(),[](const Value& a,const Value& b){return field(a,"code") != field(b,"code") ? fl2d_text::less(text(field(a,"code")),text(field(b,"code"))) : fl2d_text::less(text(field(a,"key")),text(field(b,"key")));});
    item.get<Object>()["localTimeTicks"] = Value(static_cast<double>(local));
    return Value(Object{{"sequenceId",field(sequence,"id")},{"timeTicks",Value(ticks)},{"activeViewLaneItem",item},{"activeClipInstances",Value(projections)},
        {"evaluatedParts",field(base,"evaluatedParts")},{"compositeGroups",field(base,"compositeGroups")},{"camera",Value(camera)},{"events",Value(events)},{"diagnostics",Value(diagnostics)},{"authoritative",Value(authoritative)}});
}
}
