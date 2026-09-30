#include "native_frame_evaluation.h"
#include "js_text.h"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <map>

namespace fl2d_evaluation {
namespace {
using fl2d_commands::field;
Value find(const Value& collection, const Value& id, const char* key = "id") {
    for (const auto& entry : collection.get<Array>()) if (field(entry,key) == id) return entry;
    return Value();
}
bool present(const Value& v) { return !v.is<picojson::null>(); }
std::string text(const Value& v) { return v.is<std::string>() ? v.get<std::string>() : ""; }
// JSON.stringify shortest-number formatting is observable in evidence fingerprints.
std::string number_text(double n) {
    if (n == 0) return "0";
    char buffer[128]; const auto converted = std::to_chars(buffer,buffer+sizeof(buffer),n,std::chars_format::general);
    std::string result(buffer,converted.ptr); const auto e = result.find('e');
    if (e == std::string::npos) return result;
    const int exponent = std::stoi(result.substr(e+1));
    if (exponent >= -6 && exponent < 21) {
        const bool negative = result.front() == '-';
        std::string digits = result.substr(negative ? 1 : 0,e-(negative ? 1 : 0)); const auto dot = digits.find('.');
        const int original = dot == std::string::npos ? static_cast<int>(digits.size()) : static_cast<int>(dot);
        if (dot != std::string::npos) digits.erase(dot,1);
        const int position = original+exponent;
        if (position <= 0) digits = "0."+std::string(static_cast<size_t>(-position),'0')+digits;
        else if (static_cast<size_t>(position) >= digits.size()) digits.append(static_cast<size_t>(position)-digits.size(),'0');
        else digits.insert(static_cast<size_t>(position),".");
        return (negative ? "-" : "")+digits;
    }
    return result.substr(0,e)+"e"+(exponent >= 0 ? "+" : "-")+std::to_string(std::abs(exponent));
}
std::string canonical_json(const Value& v) {
    if (v.is<double>()) return number_text(v.get<double>());
    if (v.is<Array>()) {
        std::string out = "["; bool first = true;
        for (const auto& item : v.get<Array>()) { if (!first) out += ','; first = false; out += canonical_json(item); }
        return out+"]";
    }
    if (v.is<Object>()) {
        auto keys = v.get<Object>().keys(); std::sort(keys.begin(),keys.end(),fl2d_text::less);
        Object ordered; for (const auto& key : keys) ordered[key] = field(v,key);
        // Object.fromEntries still enumerates array-index keys first in JS.
        std::string out = "{"; bool first = true;
        for (const auto& key : ordered.keys()) { if (!first) out += ','; first = false; out += Value(key).serialize()+":"+canonical_json(ordered.at(key)); }
        return out+"}";
    }
    return v.serialize();
}
std::string fingerprint(const Value& v) {
    uint32_t hash = 2166136261u;
    for (const auto c : fl2d_text::utf16(canonical_json(v))) { hash ^= c; hash *= 16777619u; }
    char buffer[9]; std::snprintf(buffer,sizeof(buffer),"%08x",hash); return buffer;
}
const std::map<std::string,std::string> messages{
    {"SEQUENCE_KEYART_BASE_AMBIGUOUS","Standalone KeyArt base state has multiple compatible MeshKeyforms."},
    {"TRANSITION_MISSING_CORRESPONDENCE","SemanticSlot correspondence is incomplete for this Transition."},
    {"TRANSITION_INVALID_MODE_FOR_MAPPING","PartTransition mode is incompatible with the available endpoint mappings."},
    {"TRANSITION_TOPOLOGY_INCOMPATIBLE","Morph endpoints do not share a compatible MeshTopology."},
    {"TRANSITION_MISSING_KEYFORM","A required endpoint MeshKeyform is missing."},
    {"TRANSITION_TRIANGLE_DEGENERATE","An endpoint mesh triangle has zero area."},
    {"TRANSITION_TRIANGLE_INVERSION","A mesh triangle changes winding between endpoints."},
    {"TRANSITION_GEOMETRY_STRETCH_HIGH","Mesh geometry stretches substantially between endpoints."},
    {"TRANSITION_GEOMETRY_COMPRESSION_HIGH","Mesh geometry compresses substantially between endpoints."},
    {"TRANSITION_UV_DISTORTION_HIGH","Per-Key-Art UV geometry changes substantially between endpoints."},
    {"TRANSITION_TEXTURE_GHOSTING_RISK","Weighted endpoint appearances may produce visible ghosting."},
    {"TRANSITION_INTERMEDIATE_KEYART_RECOMMENDED","An intermediate Key Art may improve this Transition."},
    {"TRANSITION_DRAW_ORDER_CROSSING","Endpoint draw order changes across this Transition."},
    {"TRANSITION_PART_PRESENCE_MISMATCH","Endpoint presence states differ for this SemanticSlot."},
    {"TRANSITION_CLIPPING_REFERENCE_INVALID","A clipping reference does not resolve to a scene node."},
    {"TRANSITION_CLIPPING_RENDER_UNSUPPORTED","The evaluator produced clipping state that the current renderer cannot rasterize."},
    {"TRANSITION_DRAW_ORDER_CONFLICT","Multiple visible render instances conflict at the same explicit draw order."},
    {"CLIPPING_SOURCE_MISSING","The evaluated clipping source node is missing."},
    {"CLIPPING_SOURCE_NOT_RENDERABLE","The clipping source cannot be resolved to one evaluated render instance."},
    {"CLIPPING_CYCLE","The evaluated clipping relationships contain a cycle."},
    {"DEFORMER_KEYFORM_MISSING","A required WarpDeformer keyform is missing."},
    {"DEFORMER_KEYFORM_INCOMPATIBLE","WarpDeformer endpoint keyforms or hierarchy are incompatible."},
    {"DEFORMER_CONTROL_POINT_INVALID","WarpDeformer control-point data cannot be evaluated."},
    {"DEFORMER_CHILD_REFERENCE_INVALID","The evaluated Scene child does not resolve to a WarpDeformer hierarchy."},
    {"DEFORMER_PARENT_MISSING","The evaluated WarpDeformer hierarchy has a missing parent."},
    {"DEFORMER_CYCLE","The evaluated WarpDeformer hierarchy contains a cycle."},
    {"BONE_HIERARCHY_CYCLE","The evaluated Bone hierarchy contains a cycle."},
    {"BONE_NODE_MISSING","A rigid attachment references a missing Bone."},
    {"BONE_PARENT_INVALID","The evaluated Bone hierarchy has an invalid parent."},
    {"BONE_SCENE_IDENTITY_MISMATCH","Bone identity does not match the Scene hierarchy."},
    {"BONE_POSE_INVALID","A Bone pose cannot be evaluated."},
    {"BONE_PROJECTED_FRAME_DEGENERATE","A post-Warp Bone bind frame is degenerate."},
    {"BONE_TRANSITION_INCOMPATIBLE","Morph endpoints have incompatible rigid Bone state."}
};
double area(const Value& positions, const Value& indices, size_t offset) {
    const auto& p = positions.get<Array>(); const auto& i = indices.get<Array>();
    const size_t a = static_cast<size_t>(i[offset].get<double>())*2, b = static_cast<size_t>(i[offset+1].get<double>())*2, c = static_cast<size_t>(i[offset+2].get<double>())*2;
    return ((p[b].get<double>()-p[a].get<double>())*(p[c+1].get<double>()-p[a+1].get<double>())-
        (p[b+1].get<double>()-p[a+1].get<double>())*(p[c].get<double>()-p[a].get<double>()))/2;
}
int sign(double n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
}

std::string canonical_evidence(const Value& value) { return canonical_json(value); }
Value sequence_diagnostic(const Value& id,const char* code,const Object& details) {
    const auto hash = fingerprint(Value(Object{{"sequenceId",id},{"code",Value(code)},{"details",Value(details)}}));
    const std::map<std::string,std::string> sequence_messages{
        {"ANIMATION_CLIP_TARGET_INCOMPATIBLE","Clip target does not remain the same compatible mapped source across the placement."},
        {"ANIMATION_TRACK_CONFLICT","Same-layer discrete animation contributions contain incompatible values."},
        {"ANIMATION_TOPOLOGY_INCOMPATIBLE","Mesh animation does not match the active evaluated topology."},
        {"ANIMATION_DISCRETE_WEIGHT_INVALID","An active discrete animation contribution requires ClipInstance weight 1."},
        {"ANIMATION_TRACK_TARGET_INVALID","Animation track target cannot be resolved in the active Sequence state."}
    };
    Value canonical; const auto error = picojson::parse(canonical,canonical_json(Value(details))); if (!error.empty()) throw std::runtime_error(error);
    return Value(Object{{"key",Value(std::string(code)+"|"+text(id)+"|"+hash)},{"code",Value(code)},{"severity",Value("error")},
        {"message",Value(sequence_messages.count(code) ? sequence_messages.at(code) : code)},{"sequenceId",id},{"details",canonical},{"evidenceFingerprint",Value(hash)}});
}

Value frame_diagnostic(const Value& owner, bool key_art, const char* code, const char* severity,
    const Value& slot, const Value& ticks, const Object& details) {
    Object evidence{{key_art ? "keyArtId" : "transitionId",owner},{"code",Value(code)},{"semanticSlotId",slot},{"details",Value(details)}};
    if (!key_art) evidence["timeTicks"] = ticks;
    const auto hash = fingerprint(Value(evidence));
    const auto key = std::string(code)+"|"+text(owner)+"|"+(text(slot).empty() ? "-" : text(slot))+"|"+
        (key_art ? "" : present(ticks) ? number_text(ticks.get<double>())+"|" : "-|")+hash;
    Object value{{"key",Value(key)},{"code",Value(code)},{"severity",Value(severity)},
        {"message",Value(messages.count(code) ? messages.at(code) : code)},
        {key_art ? "keyArtId" : "transitionId",owner},{"details",Value(details)},{"evidenceFingerprint",Value(hash)}};
    if (!text(slot).empty()) value["semanticSlotId"] = slot;
    if (!key_art && present(ticks)) value["timeTicks"] = ticks;
    return Value(value);
}
void order_diagnostics(Array& values) {
    std::stable_sort(values.begin(),values.end(),[](const Value& a, const Value& b) {
        for (const auto key : {"code","semanticSlotId"}) if (text(field(a,key)) != text(field(b,key))) return fl2d_text::less(text(field(a,key)),text(field(b,key)));
        const double left = field(a,"timeTicks").is<double>() ? field(a,"timeTicks").get<double>() : -1;
        const double right = field(b,"timeTicks").is<double>() ? field(b,"timeTicks").get<double>() : -1;
        return left != right ? left < right : fl2d_text::less(text(field(a,"key")),text(field(b,"key")));
    });
}
void acknowledge(Array& values, const Value& transition) {
    for (auto& value : values) {
        const auto override = find(field(transition,"diagnosticOverrides"),field(value,"key"),"key");
        value.get<Object>()["acknowledged"] = Value(present(override) && field(override,"evidenceFingerprint") == field(value,"evidenceFingerprint"));
    }
}
Value transition_diagnostics(const Value& p, const Value& transition) {
    const auto from = find(field(p,"keyArts"),field(transition,"fromKeyArtId")), to = find(field(p,"keyArts"),field(transition,"toKeyArtId"));
    Array slots = field(p,"semanticSlots").get<Array>(), output;
    std::stable_sort(slots.begin(),slots.end(),[](const Value& a,const Value& b){return fl2d_text::less(text(field(a,"id")),text(field(b,"id")));});
    for (const auto& slot : slots) {
        const auto fm = find(field(slot,"mappings"),field(from,"id"),"keyArtId"), tm = find(field(slot,"mappings"),field(to,"id"),"keyArtId");
        const auto part = find(field(transition,"partTransitions"),field(slot,"id"),"semanticSlotId");
        if (!present(fm) && !present(tm) && !present(part)) continue;
        auto emit = [&](const char* code,const char* severity,const Object& details = {}) { output.push_back(frame_diagnostic(field(transition,"id"),false,code,severity,field(slot,"id"),Value(),details)); };
        if (!present(part)) { emit("TRANSITION_MISSING_CORRESPONDENCE","warning",{{"fromNodeId",field(fm,"nodeId")},{"toNodeId",field(tm,"nodeId")},{"reason",Value("missing-part-transition")}}); continue; }
        const auto mode = text(field(part,"mode"));
        if ((mode == "morph" || mode == "replace" || mode == "occlusion") && (!present(fm) || !present(tm))) {
            emit("TRANSITION_MISSING_CORRESPONDENCE","error",{{"fromNodeId",field(fm,"nodeId")},{"toNodeId",field(tm,"nodeId")}});
            emit("TRANSITION_INVALID_MODE_FOR_MAPPING","error",{{"mode",field(part,"mode")}});
        }
        if (mode == "morph") {
            const auto topology = find(field(p,"meshTopologies"),field(part,"topologyId"));
            const auto fk = find(field(p,"meshKeyforms"),field(part,"fromKeyformId")), tk = find(field(p,"meshKeyforms"),field(part,"toKeyformId"));
            if (!present(topology) || !present(fk) || !present(tk) || field(fk,"topologyId") != field(topology,"id") || field(tk,"topologyId") != field(topology,"id")) {
                Object details; for (const auto key : {"topologyId","fromKeyformId","toKeyformId"}) if (part.get<Object>().count(key)) details[key] = field(part,key);
                details["partTransitionId"] = field(part,"id"); emit("TRANSITION_TOPOLOGY_INCOMPATIBLE","error",details);
                if (!present(fk) || !present(tk)) { Array endpoints; if (!present(fk)) endpoints.emplace_back("from"); if (!present(tk)) endpoints.emplace_back("to"); details["missingEndpoints"] = Value(endpoints); emit("TRANSITION_MISSING_KEYFORM","error",details); }
            } else {
                bool intermediate = false, ghost = false;
                for (size_t i = 0; i < field(topology,"indices").get<Array>().size(); i += 3) {
                    const Value triangle(static_cast<double>(i/3)); const double a = area(field(fk,"positions"),field(topology,"indices"),i), b = area(field(tk,"positions"),field(topology,"indices"),i);
                    if (std::abs(a) < 1e-9 || std::abs(b) < 1e-9) emit("TRANSITION_TRIANGLE_DEGENERATE","error",{{"triangleIndex",triangle}});
                    else if (std::isnan(a) || std::isnan(b) || sign(a) != sign(b)) { emit("TRANSITION_TRIANGLE_INVERSION","warning",{{"triangleIndex",triangle}}); intermediate = true; ghost = true; }
                    else {
                        const double ratio = std::abs(b/a);
                        if (ratio > 4 || ratio < 0.25) { emit(ratio > 4 ? "TRANSITION_GEOMETRY_STRETCH_HIGH" : "TRANSITION_GEOMETRY_COMPRESSION_HIGH","warning",{{"triangleIndex",triangle},{"areaRatio",std::isfinite(ratio) ? Value(ratio) : Value()}}); intermediate = true; }
                    }
                    const double ua = area(field(fk,"uvs"),field(topology,"indices"),i), ub = area(field(tk,"uvs"),field(topology,"indices"),i);
                    if (std::abs(ua) > 1e-12 && std::abs(ub) > 1e-12) {
                        const double ratio = std::abs(ub/ua);
                        if (ratio > 4 || ratio < 0.25 || sign(ua) != sign(ub)) { emit("TRANSITION_UV_DISTORTION_HIGH","warning",{{"triangleIndex",triangle},{"areaRatio",std::isfinite(ratio) ? Value(ratio) : Value()}}); intermediate = true; ghost = true; }
                    }
                }
                if (ghost && present(fm) && present(tm)) emit("TRANSITION_TEXTURE_GHOSTING_RISK","warning");
                if (intermediate) emit("TRANSITION_INTERMEDIATE_KEYART_RECOMMENDED","info");
            }
        }
        const auto fmember = find(field(from,"members"),field(fm,"nodeId"),"nodeId"), tmember = find(field(to,"members"),field(tm,"nodeId"),"nodeId");
        if (present(fmember) && present(tmember)) {
            if (field(fmember,"drawOrder") != field(tmember,"drawOrder")) emit("TRANSITION_DRAW_ORDER_CROSSING","info",{{"fromDrawOrder",field(fmember,"drawOrder")},{"toDrawOrder",field(tmember,"drawOrder")}});
            if (field(fmember,"presence") != field(tmember,"presence")) emit("TRANSITION_PART_PRESENCE_MISMATCH","info",{{"fromPresence",field(fmember,"presence")},{"toPresence",field(tmember,"presence")}});
        }
        bool clipping = false;
        for (const auto& member : {fmember,tmember}) if (field(field(member,"clipping"),"sourceNodeId").is<std::string>()) clipping = true;
        if (clipping) emit("TRANSITION_CLIPPING_RENDER_UNSUPPORTED","warning");
    }
    acknowledge(output,transition); order_diagnostics(output); return Value(output);
}
}
