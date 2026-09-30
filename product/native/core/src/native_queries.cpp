#include "native_queries.h"
#include "native_commands.h"
#include "native_math.h"
#include "native_validation.h"
#include "js_text.h"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace fl2d_queries {
namespace {
using namespace fl2d_commands;
struct Error { std::string name, message; };
enum class Query {
#define FL2D_QUERY(symbol, name, implemented) symbol,
#include "native_query_names.inc"
#undef FL2D_QUERY
};
struct Registration { Query id; bool implemented; };
const std::map<std::string, Registration> queries = {
#define FL2D_QUERY(symbol, name, implemented) {name, {Query::symbol, implemented != 0}},
#include "native_query_names.inc"
#undef FL2D_QUERY
};
bool truthy(const Value& v) {
    if (v.is<picojson::null>()) return false;
    if (v.is<bool>()) return v.get<bool>();
    if (v.is<double>()) return v.get<double>() != 0 && !std::isnan(v.get<double>());
    if (v.is<std::string>()) return !v.get<std::string>().empty();
    return true;
}
std::string number_string(double n) {
    if (std::isinf(n)) return n < 0 ? "-Infinity" : "Infinity";
    if (std::isnan(n)) return "NaN";
    if (n == 0) return "0";
    char buffer[128];
    const auto converted = std::to_chars(buffer, buffer+sizeof(buffer), n);
    std::string result(buffer, converted.ptr);
    const auto e = result.find('e');
    if (e == std::string::npos) return result;
    const int exponent = std::stoi(result.substr(e+1));
    if (exponent >= -6 && exponent < 21) {
        const bool negative = result.front() == '-';
        std::string digits = result.substr(negative ? 1 : 0, e-(negative ? 1 : 0));
        const auto dot = digits.find('.');
        const int original = dot == std::string::npos ? static_cast<int>(digits.size()) : static_cast<int>(dot);
        if (dot != std::string::npos) digits.erase(dot, 1);
        const int position = original+exponent;
        if (position <= 0) digits = "0."+std::string(static_cast<size_t>(-position), '0')+digits;
        else if (static_cast<size_t>(position) >= digits.size()) digits.append(static_cast<size_t>(position)-digits.size(), '0');
        else digits.insert(static_cast<size_t>(position), ".");
        return (negative ? "-" : "")+digits;
    }
    return result.substr(0,e)+"e"+(exponent >= 0 ? "+" : "-")+std::to_string(std::abs(exponent));
}
std::string js_string(const Value& v) {
    if (v.is<std::string>()) return v.get<std::string>();
    if (v.is<picojson::null>()) return "null";
    if (v.is<bool>()) return v.get<bool>() ? "true" : "false";
    if (v.is<double>()) return number_string(v.get<double>());
    if (v.is<Array>()) {
        std::string result; bool first = true;
        for (const auto& item : v.get<Array>()) {
            if (!first) result += ',';
            first = false;
            if (!item.is<picojson::null>()) result += js_string(item);
        }
        return result;
    }
    return "[object Object]";
}
std::string selector(const Value& input, const std::string& key) {
    const auto& object = input.get<Object>();
    auto found = object.find(key);
    return found == object.end() ? "undefined" : js_string(found->second);
}
[[noreturn]] void unknown(const char* domain, const Value& input, const char* key) {
    throw Error{"Error", std::string("Unknown ")+domain+" "+selector(input,key)+"."};
}
const Value& collection(const Value& p, const char* path) {
    const std::string name(path); const auto dot = name.find('.');
    return dot == std::string::npos ? field(p,name) : field(field(p,name.substr(0,dot)),name.substr(dot+1));
}
Value find(const Value& values, const Value& wanted, const char* key = "id") {
    for (const auto& entry : values.get<Array>()) if (field(entry,key) == wanted) return entry;
    return Value();
}
Value get(const Value& p, const Value& input, const char* path, const char* key, const char* domain) {
    auto value = find(collection(p,path),field(input,key));
    if (value.is<picojson::null>()) unknown(domain,input,key);
    return value;
}
Array sorted(const Value& values, const char* key = "id") {
    Array result = values.get<Array>();
    std::stable_sort(result.begin(),result.end(),[&](const Value& a, const Value& b) {
        return fl2d_text::less(field(a,key).get<std::string>(),field(b,key).get<std::string>());
    });
    return result;
}
void sort_timed(Array& values, const std::vector<const char*>& keys, const char* id = "id") {
    std::stable_sort(values.begin(),values.end(),[&](const Value& a, const Value& b) {
        for (const auto key : keys) {
            const double left = field(a,key).get<double>(), right = field(b,key).get<double>();
            if (left != right) return left < right;
        }
        return fl2d_text::less(field(a,id).get<std::string>(),field(b,id).get<std::string>());
    });
}
Value program(const Value& p, const Value& id) {
    auto value = find(field(p,"temporalPrograms"),id);
    if (value.is<picojson::null>()) throw Error{"Error","Unknown TemporalProgram "+js_string(id)+"."};
    return value;
}
Value with_duration(const Value& p, Value value) {
    value.get<Object>()["durationTicks"] = field(program(p,field(value,"temporalProgramId")),"durationTicks");
    return value;
}
Value canonical(Value value) {
    if (value.is<Array>()) {
        for (auto& item : value.get<Array>()) item = canonical(std::move(item));
    } else if (value.is<Object>()) {
        auto keys = value.get<Object>().keys(); std::sort(keys.begin(),keys.end(),fl2d_text::less);
        Object result;
        for (const auto& key : keys) result.emplace(key,canonical(value.get<Object>().at(key)));
        value = Value(result);
    }
    return value;
}
Value temporal_projection(Value value) {
    auto& object = value.get<Object>();
    auto tracks = sorted(object.at("tracks"),"trackId");
    for (auto& track : tracks) {
        const auto& channels = field(track,"channels").get<Object>();
        auto names = channels.keys(); std::sort(names.begin(),names.end(),fl2d_text::less);
        Object result;
        for (const auto& name : names) {
            Value channel = channels.at(name);
            auto& keys = channel.get<Object>().at("keyframes").get<Array>();
            sort_timed(keys,{"timeTicks"}); result.emplace(name,std::move(channel));
        }
        track.get<Object>()["channels"] = Value(result);
    }
    object["tracks"] = Value(tracks);
    sort_timed(object.at("events").get<Array>(),{"timeTicks"});
    sort_timed(object.at("regions").get<Array>(),{"startTicks","endTicks"});
    return canonical(std::move(value));
}
Value sequence_projection(const Value& p, Value value) {
    sort_timed(value.get<Object>().at("viewLaneItems").get<Array>(),{"startTicks","endTicks"});
    sort_timed(value.get<Object>().at("clipInstances").get<Array>(),{"startTicks","endTicks","layer"});
    return with_duration(p,std::move(value));
}
const Object& nodes(const Value& p) { return field(field(p,"scene"),"nodes").get<Object>(); }
Value node(const Value& p, const Value& input) {
    auto found = nodes(p).find(selector(input,"nodeId"));
    if (found == nodes(p).end()) unknown("node",input,"nodeId");
    return found->second;
}
bool visible(const Value& p, const Value& value) {
    const auto* current = &value;
    while (current) {
        if (!truthy(field(*current,"visible"))) return false;
        const auto& parent = field(*current,"parentId");
        current = parent.is<std::string>() ? &nodes(p).at(parent.get<std::string>()) : nullptr;
    }
    return true;
}
Value tree(const Value& p, bool include_hidden) {
    // Build child projections bottom-up without recursing through the scene graph.
    std::vector<std::string> order{field(field(p,"scene"),"rootId").get<std::string>()};
    for (size_t i = 0; i < order.size(); ++i) {
        const auto& current = nodes(p).at(order[i]);
        if (!include_hidden && !visible(p,current)) continue;
        for (const auto& child : field(current,"children").get<Array>()) order.push_back(child.get<std::string>());
    }
    std::map<std::string,Value> built;
    for (auto it = order.rbegin(); it != order.rend(); ++it) {
        const auto& current = nodes(p).at(*it); const bool effective = visible(p,current);
        if (!include_hidden && !effective) { built[*it] = Value(); continue; }
        Array children;
        for (const auto& child : field(current,"children").get<Array>()) {
            auto& projection = built.at(child.get<std::string>());
            if (!projection.is<picojson::null>()) children.emplace_back(std::move(projection));
        }
        built[*it] = Value(Object{{"id",field(current,"id")},{"kind",field(current,"kind")},
            {"displayName",field(current,"displayName")},{"visible",field(current,"visible")},
            {"effectiveVisible",Value(effective)},{"locked",field(current,"locked")},{"children",Value(children)}});
    }
    return std::move(built.at(order.front()));
}
Value bone_projection(const Value& p, Value bone) {
    const auto& n = nodes(p).at(field(bone,"id").get<std::string>());
    bone.get<Object>()["displayName"] = truthy(field(n,"displayName")) ? field(n,"displayName") : Value();
    Array children;
    for (const auto& id : field(n,"children").get<Array>())
        if (field(nodes(p).at(id.get<std::string>()),"kind") == Value("bone")) children.push_back(id);
    bone.get<Object>()["childBoneIds"] = Value(children);
    return bone;
}
Value first_matching(const Value& values, const Value& input, const std::vector<std::pair<const char*,const char*>>& keys, bool enabled, bool by_id = true) {
    const auto candidates = by_id ? sorted(values) : values.get<Array>();
    for (const auto& value : candidates) {
        if (enabled && !truthy(field(value,"enabled"))) continue;
        bool match = true;
        for (const auto& [stored,selected] : keys) if (field(value,stored) != field(input,selected)) match = false;
        if (match) return value;
    }
    return Value();
}
Value topology_projection(const Value& p, Value topology) {
    std::set<std::string> used; double maximum = 0;
    for (const auto& value : field(p,"meshTopologies").get<Array>()) for (const auto& vertex : field(value,"vertexIds").get<Array>()) {
        const auto& id = vertex.get<std::string>(); used.insert(id);
        if (id.size() <= 4 || id.substr(0,4) != "vtx_" || id.find_first_not_of("0123456789",4) != std::string::npos) continue;
        double n;
        try { n = std::stod(id.substr(4)); } catch (const std::out_of_range&) { n = std::numeric_limits<double>::infinity(); }
        maximum = std::max(maximum,n);
    }
    const auto& next = field(topology,"nextVertexSequence");
    double sequence = std::max(maximum+1, next.is<double>() && std::trunc(next.get<double>()) == next.get<double>() &&
        std::abs(next.get<double>()) <= 9007199254740991.0 ? next.get<double>() : 1);
    std::string candidate;
    do {
        auto number = number_string(sequence++);
        if (number.size() < 4) number.insert(0,4-number.size(),'0');
        candidate = "vtx_"+number;
    } while (used.count(candidate));
    const Value metadata = truthy(field(topology,"vertexMetadata")) ? field(topology,"vertexMetadata") : Value(Object{});
    Array vertices;
    const auto& ids = field(topology,"vertexIds").get<Array>();
    for (size_t i = 0; i < ids.size(); ++i) {
        const auto& label = field(field(metadata,ids[i].get<std::string>()),"semanticLabel");
        vertices.emplace_back(Object{{"id",ids[i]},{"index",Value(static_cast<double>(i))},
            {"semanticLabel",truthy(label) ? label : Value()}});
    }
    auto& object = topology.get<Object>(); object["vertexMetadata"] = metadata;
    object["vertices"] = Value(vertices); object["nextVertexId"] = Value(candidate);
    return topology;
}
Value node_summary(const Value& n) {
    return Value(Object{{"id",field(n,"id")},{"displayName",field(n,"displayName")},{"kind",field(n,"kind")}});
}
Value endpoint(const Value& p, const Value& id) {
    auto key = find(field(p,"keyArts"),id);
    if (!key.is<picojson::null>()) for (auto& member : key.get<Object>().at("members").get<Array>()) {
        auto found = nodes(p).find(field(member,"nodeId").get<std::string>());
        member.get<Object>()["node"] = found == nodes(p).end() ? Value() : node_summary(found->second);
    }
    return Value(Object{{"id",id},{"keyArt",key},{"missing",Value(key.is<picojson::null>())}});
}
Value mapping_projection(const Value& p, const Value& end, const Value& slot, const Value& key_id) {
    auto mapping = find(field(slot,"mappings"),key_id,"keyArtId");
    if (mapping.is<picojson::null>()) return Value(Object{{"mapping",Value()},{"node",Value()},{"valid",Value(false)},{"missing",Value(false)}});
    auto n = nodes(p).find(field(mapping,"nodeId").get<std::string>());
    const auto& key = field(end,"keyArt");
    const bool member = !key.is<picojson::null>() && !find(field(key,"members"),field(mapping,"nodeId"),"nodeId").is<picojson::null>();
    const bool valid = !key.is<picojson::null>() && n != nodes(p).end() && member;
    return Value(Object{{"mapping",mapping},{"node",n == nodes(p).end() ? Value() : node_summary(n->second)},
        {"valid",Value(valid)},{"missing",Value(!valid)}});
}
Value authoring(const Value& p, Value transition) {
    const Value from_end = endpoint(p,field(transition,"fromKeyArtId")), to_end = endpoint(p,field(transition,"toKeyArtId"));
    Array slots = sorted(field(p,"semanticSlots"));
    for (auto& slot : slots) {
        const auto from = mapping_projection(p,from_end,slot,field(transition,"fromKeyArtId"));
        const auto to = mapping_projection(p,to_end,slot,field(transition,"toKeyArtId"));
        const bool f = field(from,"valid").get<bool>(), t = field(to,"valid").get<bool>();
        const std::string status = field(from,"missing").get<bool>() || field(to,"missing").get<bool>() ? "missing-invalid" :
            f && t ? "mapped" : f ? "a-only" : t ? "b-only" : "unmapped";
        const auto part = find(field(transition,"partTransitions"),field(slot,"id"),"semanticSlotId");
        const auto topology = find(field(p,"meshTopologies"),field(part,"topologyId"));
        const auto a = find(field(p,"meshKeyforms"),field(part,"fromKeyformId"));
        const auto b = find(field(p,"meshKeyforms"),field(part,"toKeyformId"));
        Value morph;
        if (!topology.is<picojson::null>() && !a.is<picojson::null>() && !b.is<picojson::null>() &&
            field(a,"topologyId") == field(topology,"id") && field(b,"topologyId") == field(topology,"id") &&
            field(a,"keyArtId") == field(transition,"fromKeyArtId") && field(b,"keyArtId") == field(transition,"toKeyArtId") &&
            field(a,"semanticSlotId") == field(slot,"id") && field(b,"semanticSlotId") == field(slot,"id"))
            morph = Value(Object{{"topologyId",field(topology,"id")},{"fromKeyformId",field(a,"id")},{"toKeyformId",field(b,"id")}});
        const bool mapped = status == "mapped";
        auto& object = slot.get<Object>(); object["from"] = from; object["to"] = to; object["status"] = Value(status);
        object["partTransition"] = part; object["morphReferences"] = morph;
        object["availableModes"] = Value(Object{{"morph",Value(mapped && !morph.is<picojson::null>())},
            {"hold",Value(mapped || status == "a-only" || status == "b-only")},{"replace",Value(mapped)},
            {"appear",Value(status == "b-only")},{"disappear",Value(status == "a-only")},{"occlusion",Value(mapped)}});
    }
    return Value(Object{{"transition",with_duration(p,std::move(transition))},
        {"endpoints",Value(Object{{"from",from_end},{"to",to_end}})},{"semanticSlots",Value(slots)}});
}
Value dispatch(const Value& p, Query id, const Value& input) {
    switch (id) {
    case Query::project_validate: return fl2d_validation::admitted_result(p);
    case Query::project_get_render_settings: return field(p,"renderSettings");
    case Query::project_get_summary: {
        Object counts;
        counts["nodes"] = Value(static_cast<double>(nodes(p).size()));
        const std::pair<const char*,const char*> paths[] = {
            {"sources","sourceAssets"},{"keyArts","keyArts"},{"semanticSlots","semanticSlots"},
            {"meshes","meshes"},{"meshTopologies","meshTopologies"},{"meshKeyforms","meshKeyforms"},
            {"meshFormCorrectionKeyforms","meshFormCorrectionKeyforms"},{"clippingBindings","clippingBindings"},
            {"deformers","rig.deformers"},{"warpDeformerKeyforms","rig.warpDeformerKeyforms"},{"bones","rig.bones"},
            {"bonePoseKeyforms","rig.bonePoseKeyforms"},{"rigidBoneBindings","rig.rigidBoneBindings"},
            {"skinBindings","rig.skinBindings"},{"boneRotationConstraints","rig.boneRotationConstraints"},
            {"twoBoneIkConstraints","rig.twoBoneIkConstraints"},{"transitions","transitions"},
            {"clips","animation.clips"},{"deformationSamples","animation.deformationSamples"},
            {"sequences","sequences"},{"temporalPrograms","temporalPrograms"}};
        for (const auto& [name,path] : paths) counts[name] = Value(static_cast<double>(collection(p,path).get<Array>().size()));
        Object result{{"id",field(p,"id")},{"schemaVersion",field(p,"schemaVersion")},
            {"canvas",field(p,"canvas")},{"counts",Value(counts)}};
        if (p.get<Object>().count("displayName")) result["displayName"] = field(p,"displayName");
        return Value(result);
    }
    case Query::clipping_validate: case Query::deformer_validate: case Query::bone_validate:
    case Query::bone_validate_rotation_constraints: case Query::bone_validate_two_bone_ik:
    case Query::bone_validate_rigid_bindings: case Query::skin_validate: case Query::mesh_form_validate:
        // Admission and every committed transaction already use the shared validators.
        // These domain validators report errors only, so admitted state has no issues.
        return Value(Object{{"valid",Value(true)},{"issues",Value(Array{})}});
    case Query::clipping_get_for_node:
        return first_matching(field(p,"clippingBindings"),input,{{"targetNodeId","nodeId"}},false);
    case Query::deformer_get: {
        auto value = get(p,input,"rig.deformers","deformerId","WarpDeformer"); Array points;
        for (const auto& point : field(value,"controlPointIds").get<Array>()) points.push_back(find(collection(p,"rig.warpControlPoints"),point));
        value.get<Object>()["controlPoints"] = Value(points);
        value.get<Object>()["childNodeIds"] = field(nodes(p).at(field(value,"id").get<std::string>()),"children");
        return value;
    }
    case Query::deformer_get_keyform:
        return first_matching(collection(p,"rig.warpDeformerKeyforms"),input,{{"deformerId","deformerId"},{"keyArtId","keyArtId"}},false,false);
    case Query::bone_get: return bone_projection(p,get(p,input,"rig.bones","boneId","Bone"));
    case Query::bone_get_keyform:
        return first_matching(collection(p,"rig.bonePoseKeyforms"),input,{{"boneId","boneId"},{"keyArtId","keyArtId"}},false,false);
    case Query::bone_get_rotation_constraint: return get(p,input,"rig.boneRotationConstraints","constraintId","BoneRotationConstraint");
    case Query::bone_get_rotation_constraint_for_bone:
        return first_matching(collection(p,"rig.boneRotationConstraints"),input,{{"boneId","boneId"}},true);
    case Query::bone_get_two_bone_ik: return get(p,input,"rig.twoBoneIkConstraints","constraintId","TwoBoneIkConstraint");
    case Query::bone_get_rigid_binding: return get(p,input,"rig.rigidBoneBindings","bindingId","RigidBoneBinding");
    case Query::bone_get_rigid_binding_for_target:
        return first_matching(collection(p,"rig.rigidBoneBindings"),input,{{"targetNodeId","targetNodeId"}},true);
    case Query::skin_get_binding: return get(p,input,"rig.skinBindings","bindingId","SkinBinding");
    case Query::skin_get_binding_for_target:
        return first_matching(collection(p,"rig.skinBindings"),input,{{"targetNodeId","targetNodeId"}},true);
    case Query::skin_get_vertex_weights:
        return find(field(get(p,input,"rig.skinBindings","bindingId","SkinBinding"),"vertexWeights"),field(input,"vertexId"),"vertexId");
    case Query::mesh_form_get_keyform: return get(p,input,"meshFormCorrectionKeyforms","keyformId","MeshFormCorrectionKeyform");
    case Query::mesh_form_get_for_context:
        return first_matching(field(p,"meshFormCorrectionKeyforms"),input,{{"topologyId","topologyId"},{"keyArtId","keyArtId"},{"semanticSlotId","semanticSlotId"}},false);
    case Query::scene_get_tree: return tree(p,field(input,"includeHidden") != Value(false));
    case Query::scene_get_node: {
        auto value = node(p,input); value.get<Object>()["effectiveVisible"] = Value(visible(p,value));
        value.get<Object>()["worldTransform"] = fl2d_math::json(fl2d_math::world(p,selector(input,"nodeId")));
        return value;
    }
    case Query::animation_get_program: case Query::animation_list_tracks: {
        auto value = temporal_projection(get(p,input,"temporalPrograms","programId","TemporalProgram"));
        return id == Query::animation_list_tracks ? field(value,"tracks") : value;
    }
    case Query::animation_clip_get: return with_duration(p,get(p,input,"animation.clips","clipId","AnimationClip"));
    case Query::animation_clip_list: case Query::transition_list: case Query::sequence_list: {
        auto values = sorted(collection(p,id == Query::animation_clip_list ? "animation.clips" : id == Query::transition_list ? "transitions" : "sequences"));
        for (auto& value : values) value = id == Query::sequence_list ? sequence_projection(p,std::move(value)) : with_duration(p,std::move(value));
        return Value(values);
    }
    case Query::animation_deformation_sample_get: return get(p,input,"animation.deformationSamples","sampleId","MeshDeformationSample");
    case Query::animation_deformation_sample_list: {
        Array result;
        for (const auto& sample : sorted(collection(p,"animation.deformationSamples"))) {
            if (truthy(field(input,"meshId")) && field(sample,"meshId") != field(input,"meshId")) continue;
            if (truthy(field(input,"topologyId")) && field(sample,"topologyId") != field(input,"topologyId")) continue;
            result.push_back(sample);
        }
        return Value(result);
    }
    case Query::keyart_get: return get(p,input,"keyArts","keyArtId","KeyArt");
    case Query::keyart_list: return Value(sorted(field(p,"keyArts")));
    case Query::semantic_slot_get: return get(p,input,"semanticSlots","semanticSlotId","SemanticSlot");
    case Query::semantic_slot_list: return Value(sorted(field(p,"semanticSlots")));
    case Query::semantic_slot_get_mapping: return find(field(get(p,input,"semanticSlots","semanticSlotId","SemanticSlot"),"mappings"),field(input,"keyArtId"),"keyArtId");
    case Query::mesh_get_topology: return topology_projection(p,get(p,input,"meshTopologies","topologyId","MeshTopology"));
    case Query::mesh_get_vertex: {
        auto topology = get(p,input,"meshTopologies","topologyId","MeshTopology");
        const auto& vertices = field(topology,"vertexIds").get<Array>();
        auto found = std::find(vertices.begin(),vertices.end(),field(input,"vertexId"));
        if (found == vertices.end()) unknown("stable vertex",input,"vertexId");
        const auto index = static_cast<size_t>(found-vertices.begin());
        return field(topology_projection(p,std::move(topology)),"vertices").get<Array>().at(index);
    }
    case Query::mesh_get_keyform: return get(p,input,"meshKeyforms","keyformId","MeshKeyform");
    case Query::transition_get: return with_duration(p,get(p,input,"transitions","transitionId","Transition"));
    case Query::transition_get_authoring: return authoring(p,get(p,input,"transitions","transitionId","Transition"));
    case Query::sequence_get: return sequence_projection(p,get(p,input,"sequences","sequenceId","Sequence"));
    case Query::sequence_get_diagnostics:
        (void)get(p,input,"sequences","sequenceId","Sequence");
        return Value(Object{{"valid",Value(true)},{"issues",Value(Array{})}});
    default: throw Unsupported{};
    }
}
}
Value query(const Value& project, const std::string& name, const Value& input) {
    try {
        const auto found = queries.find(name);
        if (found == queries.end()) throw Error{"Error","Unknown query "+name+"."};
        if (!found->second.implemented) throw Unsupported{};
        return Value(Object{{"value",dispatch(project,found->second.id,input)}});
    } catch (const Error& error) {
        return Value(Object{{"error",Value(Object{{"name",Value(error.name)},{"message",Value(error.message)}})}});
    }
}
}
