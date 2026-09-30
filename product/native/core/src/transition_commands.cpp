#include "native_commands.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <set>
namespace fl2d_commands {
Value command(const std::string& type, const Object& payload);
[[noreturn]] void fail(const char* code);
size_t insert_index(const Value& payload, size_t length);
namespace {
Array& list(Value& project, const char* name) { return project.get<Object>().at(name).get<Array>(); }
Array& array(Value& value, const char* name) { return value.get<Object>().at(name).get<Array>(); }
std::string text(const Value& value, const char* key) { const auto& item = field(value, key); return item.is<std::string>() ? item.get<std::string>() : ""; }
size_t find_index(const Array& values, const Value& id, const char* key, const char* error) {
    auto at = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, key) == id; });
    if (at == values.end()) fail(error);
    return static_cast<size_t>(at - values.begin());
}
bool falsy(const Value& value) { return value.is<picojson::null>() || value == Value(false) || value == Value(0.0) || value == Value(""); }
double vertex_sequence(const Value& id) {
    if (!id.is<std::string>()) return 0;
    const auto& text = id.get<std::string>();
    if (text.size() <= 4 || text.substr(0, 4) != "vtx_" || !std::all_of(text.begin() + 4, text.end(), [](char c) { return c >= '0' && c <= '9'; })) return 0;
    const auto value = std::strtod(text.c_str() + 4, nullptr); return std::isfinite(value) ? value : 1e100;
}
Value normalize(Value value, const char* collection) {
    auto& object = value.get<Object>(); const std::string name(collection);
    if (name == "keyArts" || name == "semanticSlots") {
        const char* key = name == "keyArts" ? "members" : "mappings";
        if (falsy(field(value, key))) object[key] = Value(Array{});
        if (falsy(field(value, "metadata"))) object["metadata"] = Value(Object{});
    } else if (name == "transitions") {
        for (auto key : {"partTransitions", "diagnosticOverrides"}) if (falsy(field(value, key))) object[key] = Value(Array{});
    } else if (name == "meshTopologies") {
        for (auto key : {"vertexIds", "indices"}) if (falsy(field(value, key))) object[key] = Value(Array{});
        if (!field(value, "vertexIds").is<Array>()) fail("project.invalid");
        if (falsy(field(value, "vertexMetadata"))) object["vertexMetadata"] = Value(Object{});
        double next = 0;
        for (const auto& id : field(value, "vertexIds").get<Array>()) next = std::max(next, vertex_sequence(id));
        next += 1;
        const auto& previous = field(value, "nextVertexSequence");
        const double sequence = previous.is<double>() && std::floor(previous.get<double>()) == previous.get<double>() && std::abs(previous.get<double>()) <= 9007199254740991.0 ? previous.get<double>() : 1;
        object["nextVertexSequence"] = Value(std::max(sequence, next));
    }
    return value;
}
void assert_new_id(Value& project, const Value& id) {
    if (id == field(project, "id") || (id.is<std::string>() && field(field(project, "scene"), "nodes").get<Object>().count(id.get<std::string>()))) fail("identity.duplicate");
    for (auto name : {"sourceAssets", "semanticSlots", "keyArts", "meshes", "meshTopologies", "meshKeyforms", "meshFormCorrectionKeyforms", "clippingBindings", "transitions", "temporalPrograms"})
        for (const auto& value : list(project, name)) if (field(value, "id") == id) fail("identity.duplicate");
}
void topology_lock(Value& project, const Value& id, bool form) {
    const auto& values = form ? list(project, "meshFormCorrectionKeyforms") : array(project.get<Object>().at("rig"), "skinBindings");
    for (const auto& value : values) if (field(value, "topologyId") == id) fail(form ? "MESH_TOPOLOGY_LOCKED_BY_FORM_CORRECTION" : "MESH_TOPOLOGY_LOCKED_BY_SKIN_BINDING");
}
struct Domain { const char* prefix; const char* collection; const char* payload; const char* id_key; const char* error; };
const Domain domains[] = {{"keyart", "keyArts", "keyArt", "keyArtId", "keyart.not_found"},
    {"semantic_slot", "semanticSlots", "semanticSlot", "semanticSlotId", "semantic_slot.not_found"},
    {"mesh_topology", "meshTopologies", "topology", "topologyId", "mesh_topology.not_found"},
    {"mesh_keyform", "meshKeyforms", "keyform", "keyformId", "mesh_keyform.not_found"},
    {"transition", "transitions", "transition", "transitionId", "transition.not_found"}};
}
bool apply_transition(Value& project, const std::string& type, const Value& p, Applied& result) {
    for (const auto& domain : domains) {
        const std::string prefix = std::string(domain.prefix) + ".";
        const bool internal = type == std::string(domain.collection) + ".remove_internal";
        if (!internal && type != prefix + "create" && type != prefix + "update" && type != prefix + "remove" && type != prefix + "restore") continue;
        auto& values = list(project, domain.collection);
        if (type == prefix + "create") {
            auto next = normalize(field(p, domain.payload), domain.collection);
            if (prefix == "mesh_topology.") for (const auto& id : field(next, "vertexIds").get<Array>()) for (const auto& existing : values)
                for (const auto& owned : field(existing, "vertexIds").get<Array>()) if (owned == id && !falsy(id)) fail("MESH_TOPOLOGY_DUPLICATE_VERTEX_ACROSS_TOPOLOGIES");
            assert_new_id(project, field(next, "id")); values.push_back(next);
            result = {command(std::string(domain.collection) + ".remove_internal", Object{{"id", field(next, "id")}}), {text(next, "id")}}; return true;
        }
        if (type == prefix + "restore") {
            const auto next = field(p, "entity"); values.insert(values.begin() + insert_index(p, values.size()), next);
            result = {command(std::string(domain.collection) + ".remove_internal", Object{{"id", field(next, "id")}}), {text(next, "id")}}; return true;
        }
        const auto target = field(p, internal ? "id" : domain.id_key);
        if (prefix == "mesh_topology." && type == prefix + "remove") { topology_lock(project, target, false); topology_lock(project, target, true); }
        const auto position = find_index(values, target, "id", domain.error); const auto previous = values[position];
        if (type == prefix + "update") {
            auto next = normalize(field(p, domain.payload), domain.collection);
            if (field(next, "id") != target) fail("identity.changed");
            if (prefix == "mesh_topology.") {
                const bool identity_changed = field(previous, "vertexIds") != field(next, "vertexIds");
                if (identity_changed) { topology_lock(project, target, false); topology_lock(project, target, true); }
                const bool structure_changed = identity_changed || field(previous, "indices") != field(next, "indices");
                if (structure_changed) for (const auto& keyform : list(project, "meshKeyforms")) if (field(keyform, "topologyId") == target) fail("MESH_TOPOLOGY_MUTATION_REQUIRES_CONTRACT");
                for (const auto& [key, value] : next.get<Object>()) values[position].get<Object>()[key] = value;
            } else values[position] = next;
            result = {command(type, Object{{domain.id_key, field(previous, "id")}, {domain.payload, previous}}), {text(next, "id")}}; return true;
        }
        values.erase(values.begin() + position);
        result = {command(prefix + "restore", Object{{"entity", previous}, {"index", Value(static_cast<double>(position))}}), {text(previous, "id")}}; return true;
    }
    if (type == "semantic_slot.map_node" || type == "semantic_slot.unmap_node" || type == "semantic_slot.restore_mapping") {
        auto& slots = list(project, "semanticSlots"); auto& slot = slots[find_index(slots, field(p, "semanticSlotId"), "id", "semantic_slot.not_found")];
        auto& mappings = array(slot, "mappings"); const auto slot_id = field(slot, "id");
        if (type == "semantic_slot.map_node") {
            for (const auto& mapping : mappings) if (field(mapping, "keyArtId") == field(p, "keyArtId")) fail("SEMANTIC_MAPPING_DUPLICATE");
            for (const auto& other : slots) if (field(other, "id") != slot_id) for (const auto& mapping : field(other, "mappings").get<Array>())
                if (field(mapping, "keyArtId") == field(p, "keyArtId") && field(mapping, "nodeId") == field(p, "nodeId")) fail("SEMANTIC_MAPPING_DUPLICATE");
            mappings.emplace_back(Object{{"keyArtId", field(p, "keyArtId")}, {"nodeId", field(p, "nodeId")}});
            result = {command("semantic_slot.unmap_node", Object{{"semanticSlotId", slot_id}, {"keyArtId", field(p, "keyArtId")}}), {slot_id.get<std::string>(), text(p, "keyArtId"), text(p, "nodeId")}}; return true;
        }
        if (type == "semantic_slot.restore_mapping") {
            const auto mapping = field(p, "mapping"); mappings.insert(mappings.begin() + insert_index(p, mappings.size()), mapping);
            result = {command("semantic_slot.unmap_node", Object{{"semanticSlotId", slot_id}, {"keyArtId", field(mapping, "keyArtId")}}), {slot_id.get<std::string>(), text(mapping, "keyArtId"), text(mapping, "nodeId")}}; return true;
        }
        const auto position = find_index(mappings, field(p, "keyArtId"), "keyArtId", "semantic_mapping.not_found"); const auto previous = mappings[position]; mappings.erase(mappings.begin() + position);
        result = {command("semantic_slot.restore_mapping", Object{{"semanticSlotId", slot_id}, {"mapping", previous}, {"index", Value(static_cast<double>(position))}}), {slot_id.get<std::string>(), text(previous, "keyArtId"), text(previous, "nodeId")}}; return true;
    }
    static const std::set<std::string> types{"transition.set_part_mode", "transition.set_part_topology", "transition.remove_part", "transition.restore_part", "transition.set_diagnostic_override", "transition.clear_diagnostic_override"};
    if (!types.count(type)) return false;
    auto& transitions = list(project, "transitions"); auto& transition = transitions[find_index(transitions, field(p, "transitionId"), "id", "transition.not_found")]; const auto id = field(transition, "id");
    if (type == "transition.set_diagnostic_override" || type == "transition.clear_diagnostic_override") {
        auto& overrides = array(transition, "diagnosticOverrides"); const auto key = type == "transition.clear_diagnostic_override" ? field(p, "key") : field(field(p, "override"), "key");
        auto at = std::find_if(overrides.begin(), overrides.end(), [&](const Value& value) { return field(value, "key") == key; });
        if (type == "transition.clear_diagnostic_override") {
            if (at == overrides.end()) fail("transition.override_not_found");
            auto inverse = command("transition.set_diagnostic_override", Object{{"transitionId", id}, {"override", *at}}); overrides.erase(at); result = {inverse, {id.get<std::string>()}}; return true;
        }
        auto inverse = at == overrides.end() ? command("transition.clear_diagnostic_override", Object{{"transitionId", id}, {"key", key}}) : command(type, Object{{"transitionId", id}, {"override", *at}});
        if (at == overrides.end()) overrides.push_back(field(p, "override")); else *at = field(p, "override"); result = {inverse, {id.get<std::string>()}}; return true;
    }
    auto& parts = array(transition, "partTransitions"); const auto slot_id = type == "transition.restore_part" ? field(field(p, "part"), "semanticSlotId") : field(p, "semanticSlotId");
    auto at = std::find_if(parts.begin(), parts.end(), [&](const Value& value) { return field(value, "semanticSlotId") == slot_id; });
    const auto position = static_cast<size_t>(at - parts.begin()); const auto previous = at == parts.end() ? Value() : *at;
    if (type == "transition.set_part_mode" || type == "transition.restore_part") {
        Value next;
        if (type == "transition.restore_part") next = field(p, "part");
        else {
            const auto configuration = !falsy(field(p, "configuration")) ? field(p, "configuration") : !falsy(field(previous, "configuration")) ? field(previous, "configuration") : Value(Object{});
            next = Value(Object{{"id", field(p, "partTransitionId")}, {"semanticSlotId", slot_id}, {"mode", field(p, "mode")},
                {"topologyId", field(previous, "topologyId")}, {"fromKeyformId", field(previous, "fromKeyformId")}, {"toKeyformId", field(previous, "toKeyformId")}, {"configuration", configuration}});
            if (!previous.is<picojson::null>() && field(previous, "id") != field(next, "id")) fail("identity.changed");
        }
        auto inverse = previous.is<picojson::null>() ? command("transition.remove_part", Object{{"transitionId", id}, {"semanticSlotId", slot_id}}) : command("transition.restore_part", Object{{"transitionId", id}, {"part", previous}, {"index", Value(static_cast<double>(position))}});
        if (type == "transition.restore_part") { if (at != parts.end()) parts.erase(at); parts.insert(parts.begin() + insert_index(p, parts.size()), next); }
        else if (at == parts.end()) parts.push_back(next); else *at = next;
        result = {inverse, {id.get<std::string>(), text(next, "id"), text(next, "semanticSlotId")}}; return true;
    }
    if (at == parts.end()) fail("transition.part_not_found");
    if (type == "transition.set_part_topology") {
        for (auto key : {"topologyId", "fromKeyformId", "toKeyformId"}) at->get<Object>()[key] = field(p, key);
        result = {command("transition.restore_part", Object{{"transitionId", id}, {"part", previous}, {"index", Value(static_cast<double>(position))}}),
            {id.get<std::string>(), text(previous, "id"), text(p, "topologyId"), text(p, "fromKeyformId"), text(p, "toKeyformId")}}; return true;
    }
    parts.erase(at);
    result = {command("transition.restore_part", Object{{"transitionId", id}, {"part", previous}, {"index", Value(static_cast<double>(position))}}), {id.get<std::string>(), text(previous, "id"), text(previous, "semanticSlotId")}}; return true;
}
}
