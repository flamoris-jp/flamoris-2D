#include "native_commands.h"
#include "js_text.h"
#include <algorithm>
#include <cmath>
#include <set>
namespace fl2d_commands {
bool exact(const Value& value, std::initializer_list<const char*> required) {
    if (!value.is<Object>() || value.get<Object>().size() != required.size()) return false;
    for (auto name : required) if (value.get<Object>().count(name) != 1) return false;
    return true;
}
bool number(const Value& v) { return v.is<double>() && std::isfinite(v.get<double>()); }
// Both Product's nonBlank schema and rename handler use ECMAScript trim().
bool trim_space(uint32_t code_point) {
    return (code_point >= 0x09 && code_point <= 0x0D) || code_point == 0x20 ||
        code_point == 0xA0 || code_point == 0x1680 ||
        (code_point >= 0x2000 && code_point <= 0x200A) ||
        code_point == 0x2028 || code_point == 0x2029 || code_point == 0x202F ||
        code_point == 0x205F || code_point == 0x3000 || code_point == 0xFEFF;
}
uint32_t next_code_point(const std::string& text, size_t& pos) {
    const auto lead = static_cast<unsigned char>(text[pos++]);
    if (lead < 0x80) return lead;
    uint32_t code_point = lead < 0xE0 ? lead & 0x1F : lead < 0xF0 ? lead & 0x0F : lead & 0x07;
    const int continuation = lead < 0xE0 ? 1 : lead < 0xF0 ? 2 : 3;
    for (int i = 0; i < continuation; ++i)
        code_point = (code_point << 6) | (static_cast<unsigned char>(text[pos++]) & 0x3F);
    return code_point;
}
std::string trimmed(const std::string& text) {
    size_t begin = text.size(), end = 0;
    for (size_t pos = 0; pos < text.size();) {
        const size_t start = pos;
        const bool space = trim_space(next_code_point(text, pos));
        if (!space) {
            if (begin == text.size()) begin = start;
            end = pos;
        }
    }
    return begin == text.size() ? "" : text.substr(begin, end - begin);
}
bool nonblank(const Value& v) {
    return v.is<std::string>() && !trimmed(v.get<std::string>()).empty();
}
Value& node(Value& project, const std::string& id) {
    auto& nodes = project.get<Object>().at("scene").get<Object>().at("nodes").get<Object>();
    auto it = nodes.find(id);
    if (it == nodes.end()) throw Failure{FL2D_TARGET_NOT_FOUND, "scene.node_not_found"};
    return it->second;
}
Value command(const std::string& type, const Object& payload) {
    return Value(Object{{"type", Value(type)}, {"payload", Value(payload)}});
}
[[noreturn]] void fail(const char* code) { throw Failure{FL2D_COMMAND_INVALID, code}; }
std::string string_field(const Value& value, const char* key) { return field(value, key).get<std::string>(); }
void sort_field(Array& values, const char* key) {
    std::stable_sort(values.begin(), values.end(), [&](const Value& a, const Value& b) { return fl2d_text::less(string_field(a, key), string_field(b, key)); });
}
Array canonical_influences(const Value& values) {
    Array result = values.get<Array>();
    std::set<std::string> seen;
    for (const auto& influence : result) {
        if (!seen.insert(string_field(influence, "boneId")).second) fail("SKIN_BINDING_INFLUENCE_DUPLICATE");
        const double weight = field(influence, "weight").get<double>();
        if (!(weight > 0) || weight > 1) fail("SKIN_BINDING_WEIGHT_INVALID");
    }
    sort_field(result, "boneId");
    double sum = 0, normalized = 0;
    for (const auto& influence : result) sum += field(influence, "weight").get<double>();
    if (!std::isfinite(sum) || std::abs(sum - 1) > 1e-6) fail("SKIN_BINDING_WEIGHT_NOT_NORMALIZED");
    for (size_t i = 0; i < result.size(); ++i) {
        const double weight = i + 1 == result.size() ? 1 - normalized : field(result[i], "weight").get<double>() / sum;
        if (!std::isfinite(weight) || !(weight > 0)) fail("SKIN_BINDING_WEIGHT_INVALID");
        normalized += weight;
        result[i].get<Object>()["weight"] = Value(weight);
    }
    return result;
}
Array canonical_weights(const Value& values) {
    Array result = values.get<Array>(); std::set<std::string> seen;
    for (auto& entry : result) {
        if (!seen.insert(string_field(entry, "vertexId")).second) fail("SKIN_BINDING_VERTEX_DUPLICATE");
        entry.get<Object>()["influences"] = Value(canonical_influences(field(entry, "influences")));
    }
    sort_field(result, "vertexId"); return result;
}
Array canonical_offsets(const Value& values) {
    Array result; std::set<std::string> seen;
    for (const auto& entry : values.get<Array>()) {
        if (!seen.insert(string_field(entry, "vertexId")).second) fail("MESH_FORM_CORRECTION_VERTEX_DUPLICATE");
        if (field(entry, "x") != Value(0.0) || field(entry, "y") != Value(0.0)) result.push_back(entry);
    }
    sort_field(result, "vertexId"); return result;
}
struct RigDomain {
    const char* collection; const char* parameter; const char* entity;
    const char* create; const char* remove; const char* remove_internal; const char* restore; const char* error;
    std::vector<const char*> ids; bool root = false;
};
const RigDomain rig_domains[] = {
    {"rigidBoneBindings", "bindingId", "binding", "bone.create_rigid_binding", "bone.remove_rigid_binding", "bone.remove_rigid_binding_internal", "bone.restore_rigid_binding", "rigid_binding.not_found", {"id", "targetNodeId", "boneId"}},
    {"boneRotationConstraints", "constraintId", "constraint", "bone.create_rotation_constraint", "bone.remove_rotation_constraint", "bone.remove_rotation_constraint_internal", "bone.restore_rotation_constraint", "bone.rotation_constraint_not_found", {"id", "boneId"}},
    {"twoBoneIkConstraints", "constraintId", "constraint", "bone.create_two_bone_ik", "bone.remove_two_bone_ik", "bone.remove_two_bone_ik_internal", "bone.restore_two_bone_ik", "bone.two_bone_ik_not_found", {"id", "rootBoneId", "midBoneId", "endBoneId"}},
    {"skinBindings", "bindingId", "binding", "skin.create_binding", "skin.remove_binding", "skin.remove_binding_internal", "skin.restore_binding", "skin_binding.not_found", {"id", "targetNodeId", "topologyId"}},
    {"meshFormCorrectionKeyforms", "keyformId", "keyform", "mesh_form.create_keyform", "mesh_form.reset_keyform", "mesh_form.remove_keyform_internal", "mesh_form.restore_keyform", "mesh_form.keyform_not_found", {"id", "topologyId", "keyArtId", "semanticSlotId"}, true},
};
Array& rig_collection(Value& project, const RigDomain& domain) {
    Value& owner = domain.root ? project : project.get<Object>().at("rig");
    auto it = owner.get<Object>().find(domain.collection);
    if (it == owner.get<Object>().end() || !it->second.is<Array>()) fail("collection.invalid");
    return it->second.get<Array>();
}
std::vector<std::string> domain_ids(const Value& value, const RigDomain& domain) {
    std::vector<std::string> ids; for (auto key : domain.ids) ids.push_back(string_field(value, key)); return ids;
}
void weight_ids(std::vector<std::string>& ids, const Value& weights) {
    for (const auto& entry : weights.get<Array>()) {
        ids.push_back(string_field(entry, "vertexId"));
        for (const auto& influence : field(entry, "influences").get<Array>()) ids.push_back(string_field(influence, "boneId"));
    }
}
size_t insert_index(const Value& payload, size_t length) { return static_cast<size_t>(std::min(static_cast<double>(length), field(payload, "index").get<double>())); }
Value normalized_domain(Value value, const RigDomain& domain) {
    const auto name = std::string(domain.collection);
    if (name == "skinBindings") value.get<Object>()["vertexWeights"] = Value(canonical_weights(field(value, "vertexWeights")));
    if (name == "meshFormCorrectionKeyforms") value.get<Object>()["vertexOffsets"] = Value(canonical_offsets(field(value, "vertexOffsets")));
    return value;
}
bool apply_rig(Value& project, const std::string& type, const Value& p, Applied& result) {
    for (const auto& domain : rig_domains) {
        if (type != domain.create && type != domain.remove && type != domain.remove_internal && type != domain.restore) continue;
        auto& values = rig_collection(project, domain);
        if (type == domain.create || type == domain.restore) {
            Value value = normalized_domain(field(p, domain.entity), domain);
            auto ids = domain_ids(value, domain);
            values.insert(values.begin() + (type == domain.create ? values.size() : insert_index(p, values.size())), value);
            result = {command(domain.remove_internal, Object{{domain.parameter, field(value, "id")}}), ids};
        } else {
            auto it = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, "id") == field(p, domain.parameter); });
            if (it == values.end()) fail(domain.error);
            auto ids = domain_ids(*it, domain);
            if (std::string(domain.collection) == "skinBindings") weight_ids(ids, field(*it, "vertexWeights"));
            if (std::string(domain.collection) == "meshFormCorrectionKeyforms") for (const auto& offset : field(*it, "vertexOffsets").get<Array>()) ids.push_back(string_field(offset, "vertexId"));
            Value inverse = command(domain.restore, Object{{domain.entity, *it}, {"index", Value(static_cast<double>(it - values.begin()))}});
            values.erase(it); result = {inverse, ids};
        }
        return true;
    }
    struct Mutation { const char* type; size_t domain; std::vector<const char*> properties; };
    static const Mutation mutations[] = {
        {"bone.set_rigid_binding_bone", 0, {"boneId"}}, {"bone.set_rigid_binding_enabled", 0, {"enabled"}},
        {"bone.set_rotation_constraint_enabled", 1, {"enabled"}}, {"bone.set_rotation_constraint_bounds", 1, {"minRotation", "maxRotation"}},
        {"bone.set_two_bone_ik_enabled", 2, {"enabled"}}, {"bone.set_two_bone_ik_bend_direction", 2, {"bendDirection"}},
        {"skin.set_enabled", 3, {"enabled"}}, {"mesh_form.set_vertex_offsets", 4, {"vertexOffsets"}},
    };
    for (const auto& mutation : mutations) {
        if (type != mutation.type) continue;
        const auto& domain = rig_domains[mutation.domain]; auto& values = rig_collection(project, domain);
        auto it = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, "id") == field(p, domain.parameter); });
        if (it == values.end()) fail(domain.error);
        auto ids = domain_ids(*it, domain); Object inverse{{domain.parameter, field(*it, "id")}};
        for (auto key : mutation.properties) inverse[key] = field(*it, key);
        if (type == "bone.set_two_bone_ik_enabled") ids = {string_field(*it, "id"), string_field(*it, "endBoneId")};
        if (type == "bone.set_rigid_binding_bone") ids.push_back(string_field(p, "boneId"));
        Value next = field(p, mutation.properties.front());
        if (type == "mesh_form.set_vertex_offsets") {
            next = Value(canonical_offsets(next)); std::set<std::string> seen;
            for (const auto* offsets : std::initializer_list<const Value*>{&field(*it, "vertexOffsets"), &next}) for (const auto& offset : offsets->get<Array>()) {
                const auto id = string_field(offset, "vertexId"); if (seen.insert(id).second) ids.push_back(id);
            }
        }
        for (auto key : mutation.properties) it->get<Object>()[key] = type == "mesh_form.set_vertex_offsets" ? next : field(p, key);
        result = {command(type, inverse), ids}; return true;
    }
    if (type != "skin.set_vertex_weights" && type != "skin.set_weights_bulk" && type != "skin.clear_vertex_weights") return false;
    const auto& domain = rig_domains[3]; auto& values = rig_collection(project, domain);
    auto it = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, "id") == field(p, "bindingId"); });
    if (it == values.end()) fail(domain.error);
    auto& current = it->get<Object>().at("vertexWeights").get<Array>(); auto ids = domain_ids(*it, domain);
    const auto id = field(*it, "id");
    if (type == "skin.set_weights_bulk") {
        auto updates = canonical_weights(field(p, "vertexWeights")); Array previous;
        for (const auto& update : updates) {
            auto entry = std::find_if(current.begin(), current.end(), [&](const Value& value) { return field(value, "vertexId") == field(update, "vertexId"); });
            if (entry == current.end()) fail("skin_binding.vertex_weights_not_found");
            previous.push_back(*entry); *entry = update;
        }
        sort_field(current, "vertexId"); weight_ids(ids, Value(updates));
        result = {command(type, Object{{"bindingId", id}, {"vertexWeights", Value(previous)}}), ids}; return true;
    }
    const auto vertex = field(p, "vertexId");
    auto entry = std::find_if(current.begin(), current.end(), [&](const Value& value) { return field(value, "vertexId") == vertex; });
    Value inverse;
    if (type == "skin.clear_vertex_weights") {
        if (entry == current.end()) fail("skin_binding.vertex_weights_not_found");
        inverse = command("skin.set_vertex_weights", Object{{"bindingId", id}, {"vertexId", vertex}, {"influences", field(*entry, "influences")}});
        weight_ids(ids, Value(Array{*entry})); current.erase(entry);
    } else {
        auto influences = Value(canonical_influences(field(p, "influences")));
        inverse = entry == current.end() ? command("skin.clear_vertex_weights", Object{{"bindingId", id}, {"vertexId", vertex}}) :
            command(type, Object{{"bindingId", id}, {"vertexId", vertex}, {"influences", field(*entry, "influences")}});
        Value next(Object{{"vertexId", vertex}, {"influences", influences}});
        if (entry == current.end()) current.push_back(next); else *entry = next;
        sort_field(current, "vertexId"); weight_ids(ids, Value(Array{next}));
    }
    result = {inverse, ids}; return true;
}
Value canonical_sample(Value sample) {
    Array offsets; std::set<std::string> seen;
    for (const auto& offset : field(sample, "offsets").get<Array>()) {
        if (!seen.insert(string_field(offset, "vertexId")).second) fail("ANIMATION_DEFORMATION_VERTEX_DUPLICATE");
        if (field(offset, "dx") != Value(0.0) || field(offset, "dy") != Value(0.0)) offsets.push_back(offset);
    }
    sort_field(offsets, "vertexId"); sample.get<Object>()["offsets"] = Value(offsets); return sample;
}
bool apply_samples(Value& project, const std::string& type, const Value& p, Applied& result) {
    if (type == "animation.mesh_target.create" || type == "animation.mesh_target.remove" || type == "animation.mesh_target.restore_internal") {
        auto& meshes = project.get<Object>().at("meshes").get<Array>(); const auto id = field(p, "meshId");
        auto it = std::find_if(meshes.begin(), meshes.end(), [&](const Value& value) { return field(value, "id") == id; });
        if (type == "animation.mesh_target.create") {
            if (it != meshes.end()) fail("identity.duplicate");
            meshes.emplace_back(Object{{"id", id}});
            result = {command("animation.mesh_target.remove", Object{{"meshId", id}}), {id.get<std::string>()}};
        } else if (type == "animation.mesh_target.restore_internal") {
            meshes.insert(meshes.begin() + insert_index(p, meshes.size()), Value(Object{{"id", id}}));
            result = {command("animation.mesh_target.remove", Object{{"meshId", id}}), {id.get<std::string>()}};
        } else {
            if (it == meshes.end()) fail("animation.mesh_target_not_found");
            if (!exact(*it, {"id"})) fail("animation.legacy_mesh_preserved");
            auto inverse = command("animation.mesh_target.restore_internal", Object{{"meshId", id}, {"index", Value(static_cast<double>(it - meshes.begin()))}});
            meshes.erase(it); result = {inverse, {id.get<std::string>()}};
        }
        return true;
    }
    if (type != "animation.deformation_sample.create" && type != "animation.deformation_sample.update" && type != "animation.deformation_sample.remove" && type != "animation.deformation_sample.remove_internal" && type != "animation.deformation_sample.restore") return false;
    auto& samples = project.get<Object>().at("animation").get<Object>().at("deformationSamples").get<Array>();
    auto ids = [](const Value& value) {
        std::vector<std::string> result{string_field(value, "id"), string_field(value, "meshId"), string_field(value, "topologyId")};
        for (const auto& offset : field(value, "offsets").get<Array>()) result.push_back(string_field(offset, "vertexId"));
        return result;
    };
    if (type == "animation.deformation_sample.create" || type == "animation.deformation_sample.restore") {
        auto next = canonical_sample(field(p, "sample"));
        if (type == "animation.deformation_sample.create" && std::any_of(samples.begin(), samples.end(), [&](const Value& value) { return field(value, "id") == field(next, "id"); })) fail("identity.duplicate");
        samples.insert(samples.begin() + (type == "animation.deformation_sample.create" ? samples.size() : insert_index(p, samples.size())), next);
        sort_field(samples, "id"); result = {command("animation.deformation_sample.remove_internal", Object{{"sampleId", field(next, "id")}}), ids(next)}; return true;
    }
    auto it = std::find_if(samples.begin(), samples.end(), [&](const Value& value) { return field(value, "id") == field(p, "sampleId"); });
    if (it == samples.end()) fail("animation.deformation_sample_not_found");
    if (type != "animation.deformation_sample.update") {
        auto inverse = command("animation.deformation_sample.restore", Object{{"sample", *it}, {"index", Value(static_cast<double>(it - samples.begin()))}});
        auto affected = ids(*it); samples.erase(it); result = {inverse, affected}; return true;
    }
    auto next = canonical_sample(field(p, "sample"));
    if (field(next, "id") != field(p, "sampleId")) fail("identity.changed");
    auto inverse = command(type, Object{{"sampleId", field(*it, "id")}, {"sample", *it}});
    std::vector<std::string> affected{string_field(next, "id"), string_field(*it, "meshId"), string_field(*it, "topologyId"), string_field(next, "meshId"), string_field(next, "topologyId")};
    std::set<std::string> seen;
    for (const auto* value : std::initializer_list<const Value*>{&*it, &next}) for (const auto& offset : field(*value, "offsets").get<Array>()) {
        const auto id = string_field(offset, "vertexId"); if (seen.insert(id).second) affected.push_back(id);
    }
    *it = next; sort_field(samples, "id"); result = {inverse, affected}; return true;
}
Applied apply(Value& project, const Value& cmd) {
    if (!exact(cmd, {"type", "payload"}) || !field(cmd, "type").is<std::string>())
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    const std::string type = field(cmd, "type").get<std::string>();
    const Value& payload = field(cmd, "payload");
    Applied rig_result;
    if (apply_bone_hierarchy(project, type, payload, rig_result) || apply_warp(project, type, payload, rig_result) ||
        apply_rig(project, type, payload, rig_result) || apply_samples(project, type, payload, rig_result) ||
        apply_temporal(project, type, payload, rig_result) || apply_owners(project, type, payload, rig_result) ||
        apply_transition(project, type, payload, rig_result)) return rig_result;
    auto bad = [] { throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"}; };
    auto fail = [](const char* code) { throw Failure{FL2D_COMMAND_INVALID, code}; };
    auto text = [&](const char* key) { return field(payload, key).get<std::string>(); };
    auto index_for = [&](size_t length) {
        const auto& index = field(payload, "index");
        return index.is<double>() ? static_cast<size_t>(std::min(static_cast<double>(length), index.get<double>())) : length;
    };
    auto children = [](Value& n) -> Array& { return n.get<Object>().at("children").get<Array>(); };
    auto group = [](const Value& n) { return field(n, "kind") == Value("group") || field(n, "kind") == Value("deformer"); };
    auto node_id = [](const Value& n) { return field(n, "id").get<std::string>(); };
    if (type.rfind("clipping.", 0) == 0) {
        auto& bindings = project.get<Object>().at("clippingBindings").get<Array>();
        if (type == "clipping.create" || type == "clipping.restore") {
            Value binding = field(payload, "binding");
            const auto id = field(binding, "id").get<std::string>();
            bindings.insert(bindings.begin() + (type == "clipping.create" ? bindings.size() : index_for(bindings.size())), binding);
            return {command("clipping.remove_internal", Object{{"bindingId", Value(id)}}),
                {id, field(binding, "targetNodeId").get<std::string>(), field(binding, "sourceNodeId").get<std::string>()}};
        }
        auto it = std::find_if(bindings.begin(), bindings.end(), [&](const Value& v) { return field(v, "id") == field(payload, "bindingId"); });
        if (it == bindings.end()) fail("clipping.not_found");
        auto id = field(*it, "id").get<std::string>();
        auto target = field(*it, "targetNodeId").get<std::string>();
        auto source = field(*it, "sourceNodeId").get<std::string>();
        if (type == "clipping.remove" || type == "clipping.remove_internal") {
            Value inverse = command("clipping.restore", Object{{"binding", *it}, {"index", Value(static_cast<double>(it - bindings.begin()))}});
            bindings.erase(it);
            return {inverse, {id, target, source}};
        }
        const char* property = type == "clipping.set_enabled" ? "enabled" : "sourceNodeId";
        Value inverse = command(type, Object{{"bindingId", Value(id)}, {property, field(*it, property)}});
        it->get<Object>()[property] = field(payload, property);
        std::vector<std::string> ids{id, target, source};
        if (type == "clipping.set_source") ids.push_back(text("sourceNodeId"));
        return {inverse, ids};
    }
    if (type == "scene.create_group") {
        auto& nodes = project.get<Object>().at("scene").get<Object>().at("nodes").get<Object>();
        const auto id = text("id");
        if (nodes.count(id)) fail("identity.duplicate");
        Value& parent = node(project, text("parentId"));
        if (!group(parent)) fail("scene.invalid_parent_kind");
        const auto parent_id = node_id(parent);
        Value identity(Object{{"position", Value(Object{{"x", Value(0.0)}, {"y", Value(0.0)}})},
            {"rotation", Value(0.0)}, {"scale", Value(Object{{"x", Value(1.0)}, {"y", Value(1.0)}})},
            {"pivot", Value(Object{{"x", Value(0.0)}, {"y", Value(0.0)}})}});
        nodes[id] = Value(Object{{"id", Value(id)}, {"kind", Value("group")}, {"displayName", Value(trimmed(text("displayName")))},
            {"sourceRef", Value()}, {"parentId", Value(parent_id)}, {"children", Value(Array{})}, {"visible", Value(true)},
            {"locked", Value(false)}, {"opacity", Value(1.0)}, {"blendMode", Value("normal")}, {"transform", identity}});
        auto& list = children(parent);
        list.insert(list.begin() + index_for(list.size()), Value(id));
        return {command("scene.remove_empty_group", Object{{"nodeId", Value(id)}}), {parent_id, id}};
    }
    if (type.rfind("scene.", 0) != 0) throw Failure{FL2D_COMMAND_UNSUPPORTED, "command.unsupported"};
    std::string id = text("nodeId");
    Value& target = node(project, id);
    auto& properties = target.get<Object>();
    Object inverse{{"nodeId", Value(id)}};
    if (type == "scene.remove_empty_group") {
        if (Value(id) == field(field(project, "scene"), "rootId") || field(target, "kind") != Value("group") || !children(target).empty())
            fail("scene.group_not_empty");
        const auto name = field(target, "displayName");
        Value& parent = node(project, field(target, "parentId").get<std::string>());
        const auto parent_id = node_id(parent);
        auto& list = children(parent);
        auto at = std::find(list.begin(), list.end(), Value(id));
        const auto index = static_cast<double>(at - list.begin());
        list.erase(at);
        project.get<Object>().at("scene").get<Object>().at("nodes").get<Object>().erase(id);
        return {command("scene.create_group", Object{{"id", Value(id)}, {"parentId", Value(parent_id)}, {"displayName", name}, {"index", Value(index)}}), {parent_id, id}};
    }
    if (type == "scene.reparent_node") {
        Value& parent = node(project, text("parentId"));
        if (Value(id) == field(field(project, "scene"), "rootId")) fail("scene.reparent_root");
        if (!group(parent)) fail("scene.invalid_parent_kind");
        for (const Value* ancestor = &parent; ancestor;) {
            if (field(*ancestor, "id") == Value(id)) fail("scene.cycle");
            const auto& parent_id = field(*ancestor, "parentId");
            ancestor = parent_id.is<std::string>() ? &node(project, parent_id.get<std::string>()) : nullptr;
        }
        Value& previous = node(project, field(target, "parentId").get<std::string>());
        const auto previous_id = node_id(previous), parent_id = node_id(parent);
        auto& old_list = children(previous);
        auto at = std::find(old_list.begin(), old_list.end(), Value(id));
        const auto previous_index = static_cast<double>(at - old_list.begin());
        old_list.erase(at);
        auto& list = children(parent);
        list.insert(list.begin() + index_for(list.size()), Value(id));
        properties["parentId"] = Value(parent_id);
        if (field(target, "kind") == Value("deformer")) {
            auto& deformers = project.get<Object>().at("rig").get<Object>().at("deformers").get<Array>();
            for (auto& deformer : deformers) if (field(deformer, "id") == Value(id)) deformer.get<Object>()["parentNodeId"] = Value(parent_id);
        }
        return {command(type, Object{{"nodeId", Value(id)}, {"parentId", Value(previous_id)}, {"index", Value(previous_index)}}), {id, previous_id, parent_id}};
    }
    if (type == "scene.rename_node") {
        inverse["displayName"] = properties.at("displayName");
        std::string name = trimmed(text("displayName"));
        if (name.empty()) bad();
        properties["displayName"] = Value(name);
    } else if (type == "scene.set_visibility" || type == "scene.set_locked") {
        const char* property = type == "scene.set_visibility" ? "visible" : "locked";
        inverse[property] = field(target, property);
        properties[property] = field(payload, property);
    } else {
        inverse["coordinateSpace"] = Value("node-local");
        inverse["transform"] = properties.at("transform");
        properties["transform"] = field(payload, "transform");
    }
    return {command(type, inverse), {id}};
}
#include "command_schemas.inc"
struct CompiledSchema { bool internal; Value value; };
const std::map<std::string, CompiledSchema>& schemas() {
    static const auto result = [] {
        std::map<std::string, CompiledSchema> values;
        for (const auto& source : schema_sources) {
            Value value;
            if (!picojson::parse(value, source.json).empty()) throw Failure{FL2D_INTERNAL_ERROR, "command.schema_invalid"};
            values.emplace(source.type, CompiledSchema{source.internal, std::move(value)});
        }
        return values;
    }();
    return result;
}
bool schema_project(const Value& value) {
    const auto text = value.serialize();
    if (text.size() > FL2D_SNAPSHOT_MAX_BYTES) return false;
    fl2d_snapshot* snapshot = nullptr;
    if (fl2d_snapshot_load(reinterpret_cast<const uint8_t*>(text.data()), static_cast<uint32_t>(text.size()), &snapshot) != FL2D_OK) return false;
    int32_t schema; double width, height; uint32_t nodes, count;
    auto status = fl2d_snapshot_summary(snapshot, &schema, &width, &height, &nodes, &count);
    bool valid = status == FL2D_OK;
    for (uint32_t i = 0; valid && i < count; ++i) {
        char severity[16]; uint32_t required;
        valid = fl2d_snapshot_issue_string(snapshot, i, "severity", severity, sizeof(severity), &required) == FL2D_OK && std::string(severity) != "error";
    }
    fl2d_snapshot_destroy(snapshot);
    return valid;
}
bool matches_schema(const Value& value, const Value& schema) {
    const auto& type = field(schema, "type");
    if (type == Value("object") && !value.is<Object>()) return false;
    if (type == Value("array") && !value.is<Array>()) return false;
    if (type == Value("string") && !value.is<std::string>()) return false;
    if (type == Value("boolean") && !value.is<bool>()) return false;
    if ((type == Value("number") || type == Value("integer")) && !number(value)) return false;
    if (type == Value("integer") && std::floor(value.get<double>()) != value.get<double>()) return false;
    if (schema.get<Object>().count("const") && value != field(schema, "const")) return false;
    const auto& enums = field(schema, "enum");
    if (enums.is<Array>() && std::find(enums.get<Array>().begin(), enums.get<Array>().end(), value) == enums.get<Array>().end()) return false;
    if (value.is<std::string>()) {
        const auto& text = value.get<std::string>();
        size_t length = 0;
        for (size_t pos = 0; pos < text.size();) length += next_code_point(text, pos) > 0xFFFF ? 2 : 1;
        const auto& minimum = field(schema, "minLength");
        if (minimum.is<double>() && static_cast<double>(length) < minimum.get<double>()) return false;
        if (field(schema, "nonBlank") == Value(true) && trimmed(text).empty()) return false;
    }
    if (value.is<double>() && field(schema, "minimum").is<double>() && value.get<double>() < field(schema, "minimum").get<double>()) return false;
    if (value.is<Array>()) {
        const auto size = static_cast<double>(value.get<Array>().size());
        if (field(schema, "minItems").is<double>() && size < field(schema, "minItems").get<double>()) return false;
        if (field(schema, "maxItems").is<double>() && size > field(schema, "maxItems").get<double>()) return false;
        const auto& items = field(schema, "items");
        if (items.is<Object>()) for (const auto& item : value.get<Array>()) if (!matches_schema(item, items)) return false;
    }
    if (!value.is<Object>()) return true;
    if (field(schema, "projectSchema") == Value(true)) return schema_project(value);
    const auto& required = field(schema, "required");
    if (required.is<Array>()) for (const auto& key : required.get<Array>()) if (!value.get<Object>().count(key.get<std::string>())) return false;
    const auto& properties = field(schema, "properties");
    if (field(schema, "additionalProperties") == Value(false)) for (const auto& [key, ignored] : value.get<Object>()) {
        (void)ignored;
        if (!properties.is<Object>() || !properties.get<Object>().count(key)) return false;
    }
    if (properties.is<Object>()) for (const auto& [key, child] : properties.get<Object>()) {
        auto it = value.get<Object>().find(key);
        if (it != value.get<Object>().end() && !matches_schema(it->second, child)) return false;
    }
    return true;
}
void assert_command(const Value& cmd, bool internal) {
    if (!exact(cmd, {"type", "payload"}) || !field(cmd, "type").is<std::string>())
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    const auto& values = schemas();
    auto found = values.find(field(cmd, "type").get<std::string>());
    if (found == values.end() || (found->second.internal && !internal) || !matches_schema(field(cmd, "payload"), found->second.value))
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
}
}
