#include "native_commands.h"
#include "js_text.h"
#include <algorithm>
#include <functional>
#include <set>
namespace fl2d_commands {
Value command(const std::string& type, const Object& payload);
Value& node(Value& project, const std::string& id);
std::string trimmed(const std::string& text);
[[noreturn]] void fail(const char* code);
std::string string_field(const Value& value, const char* key);
size_t insert_index(const Value& payload, size_t length);
namespace {
Array& rig_list(Value& project, const char* name) { return project.get<Object>().at("rig").get<Object>().at(name).get<Array>(); }
Object& nodes(Value& project) { return project.get<Object>().at("scene").get<Object>().at("nodes").get<Object>(); }
Array& children(Value& value) { return value.get<Object>().at("children").get<Array>(); }
size_t optional_index(const Value& p, size_t length) { return p.get<Object>().count("index") ? insert_index(p, length) : length; }
Value& entity(Array& values, const Value& id, const char* code) {
    auto it = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, "id") == id; });
    if (it == values.end()) fail(code);
    return *it;
}
Value bone_transform(const Value& rest) {
    return Value(Object{{"position", Value(Object{{"x", field(rest, "x")}, {"y", field(rest, "y")}})}, {"rotation", field(rest, "rotation")},
        {"scale", Value(Object{{"x", Value(1.0)}, {"y", Value(1.0)}})}, {"pivot", Value(Object{{"x", Value(0.0)}, {"y", Value(0.0)}})}});
}
Value scene_node(const Value& id, const char* kind, const Value& name, const Value& parent, const Value& transform) {
    return Value(Object{{"id", id}, {"kind", Value(kind)}, {"displayName", name}, {"sourceRef", Value()}, {"parentId", parent}, {"children", Value(Array{})},
        {"visible", Value(true)}, {"locked", Value(false)}, {"opacity", Value(1.0)}, {"blendMode", Value("normal")}, {"transform", transform}});
}
Value& bone_parent(Value& project, const Value& id) {
    auto it = id.is<std::string>() ? nodes(project).find(id.get<std::string>()) : nodes(project).end();
    if (it == nodes(project).end()) fail("BONE_PARENT_INVALID");
    const auto kind = field(it->second, "kind");
    if (kind != Value("group") && kind != Value("deformer") && kind != Value("bone")) fail("BONE_PARENT_INVALID");
    if (kind == Value("bone") && std::none_of(rig_list(project, "bones").begin(), rig_list(project, "bones").end(), [&](const Value& bone) { return field(bone, "id") == id; })) fail("BONE_PARENT_INVALID");
    return it->second;
}
std::vector<std::string> bone_descendants(Value& project, const std::string& id) {
    std::vector<std::string> result{id};
    std::function<void(const std::string&)> visit = [&](const std::string& current) {
        for (const auto& child : children(node(project, current))) {
            if (field(node(project, child.get<std::string>()), "kind") != Value("bone")) continue;
            result.push_back(child.get<std::string>()); visit(child.get<std::string>());
        }
    }; visit(id); return result;
}
void no_bone_dependents(Value& project, const std::vector<std::string>& ids) {
    auto contains = [&](const Value& id) { return id.is<std::string>() && std::find(ids.begin(), ids.end(), id.get<std::string>()) != ids.end(); };
    for (const auto& constraint : rig_list(project, "twoBoneIkConstraints")) for (auto key : {"rootBoneId", "midBoneId", "endBoneId"}) if (contains(field(constraint, key))) fail("bone.rest_locked_by_two_bone_ik");
    for (const auto& pose : rig_list(project, "bonePoseKeyforms")) if (contains(field(pose, "boneId"))) fail("bone.rest_locked_by_keyforms");
    for (const auto& binding : rig_list(project, "rigidBoneBindings")) if (contains(field(binding, "boneId"))) fail("bone.rest_locked_by_bindings");
    for (const auto& binding : rig_list(project, "skinBindings")) for (const auto& weight : field(binding, "vertexWeights").get<Array>())
        for (const auto& influence : field(weight, "influences").get<Array>()) if (contains(field(influence, "boneId"))) fail("bone.rest_locked_by_skin_bindings");
}
}
namespace {
Array regular_points(const Value& id, const Value& p) {
    const double columns = field(p, "columns").get<double>(), rows = field(p, "rows").get<double>();
    const auto& ids = field(p, "controlPointIds").get<Array>();
    if (columns != rows || (columns != 2 && columns != 3 && columns != 4) || ids.size() != static_cast<size_t>(columns * rows)) fail("project.invalid");
    Array result;
    for (size_t i = 0; i < ids.size(); ++i) result.emplace_back(Object{{"id", ids[i]}, {"deformerId", id},
        {"u", Value(static_cast<double>(i % static_cast<size_t>(columns)) / (columns - 1))},
        {"v", Value(static_cast<double>(i / static_cast<size_t>(columns)) / (rows - 1))}});
    return result;
}
void append_ids(std::vector<std::string>& ids, const Value& values) { for (const auto& id : values.get<Array>()) ids.push_back(id.get<std::string>()); }
void erase_owned(Array& values, const Value& id) {
    values.erase(std::remove_if(values.begin(), values.end(), [&](const Value& value) { return field(value, "deformerId") == id; }), values.end());
}
Array indexed_owned(const Array& values, const Value& id, const char* key) {
    Array result;
    for (size_t i = 0; i < values.size(); ++i) if (field(values[i], "deformerId") == id) result.emplace_back(Object{{key, values[i]}, {"index", Value(static_cast<double>(i))}});
    return result;
}
void restore_indexed(Array& values, Array saved, const char* key) {
    std::stable_sort(saved.begin(), saved.end(), [](const Value& a, const Value& b) { return field(a, "index").get<double>() < field(b, "index").get<double>(); });
    for (const auto& entry : saved) values.insert(values.begin() + insert_index(entry, values.size()), field(entry, key));
}
void warp_child_parent(Value& project, const Value& child_id, const Value& parent_id) {
    node(project, child_id.get<std::string>()).get<Object>()["parentId"] = parent_id;
    for (auto& deformer : rig_list(project, "deformers")) if (field(deformer, "id") == child_id) deformer.get<Object>()["parentNodeId"] = parent_id;
}
void assert_points(const Value& deformer, const Array& points, bool complete) {
    const auto& ids = field(deformer, "controlPointIds").get<Array>(); std::set<std::string> seen;
    for (const auto& point : points) {
        const auto& id = field(point, "controlPointId");
        if (std::find(ids.begin(), ids.end(), id) == ids.end()) fail("deformer.control_point_not_found");
        if (!seen.insert(id.get<std::string>()).second) fail("deformer.duplicate_control_point");
    }
    if (complete && seen.size() != ids.size()) fail("DEFORMER_KEYFORM_INCOMPATIBLE");
}
Value ordered_warp_keyform(const Value& deformer, const Value& key_art, const Array& points) {
    Array ordered;
    for (const auto& id : field(deformer, "controlPointIds").get<Array>()) {
        const auto found = std::find_if(points.begin(), points.end(), [&](const Value& point) { return field(point, "controlPointId") == id; });
        if (found == points.end()) fail("DEFORMER_KEYFORM_INCOMPATIBLE");
        ordered.push_back(*found);
    }
    return Value(Object{{"deformerId", field(deformer, "id")}, {"keyArtId", key_art}, {"controlPoints", Value(ordered)}});
}
}
bool apply_warp(Value& project, const std::string& type, const Value& p, Applied& result) {
    static const std::set<std::string> types{"deformer.create_warp", "deformer.remove", "deformer.remove_internal", "deformer.restore", "deformer.rename", "deformer.set_grid", "deformer.set_keyform", "deformer.remove_keyform_internal", "deformer.move_control_points", "deformer.reset_control_points", "deformer.reparent_node"};
    if (!types.count(type)) return false;
    if (type == "deformer.reparent_node") { result = apply(project, command("scene.reparent_node", p.get<Object>())); return true; }
    auto& deformers = rig_list(project, "deformers"); auto& points = rig_list(project, "warpControlPoints"); auto& keyforms = rig_list(project, "warpDeformerKeyforms");
    if (type == "deformer.create_warp") {
        const auto id = field(p, "id");
        if (nodes(project).count(id.get<std::string>()) || std::any_of(deformers.begin(), deformers.end(), [&](const Value& value) { return field(value, "id") == id; })) fail("identity.duplicate");
        auto parent_it = nodes(project).find(string_field(p, "parentNodeId"));
        if (parent_it == nodes(project).end()) fail("DEFORMER_PARENT_MISSING");
        auto& parent = parent_it->second; const auto parent_id = field(parent, "id");
        if (field(parent, "kind") != Value("group") && field(parent, "kind") != Value("deformer")) fail("scene.invalid_parent_kind");
        auto created = regular_points(id, p);
        const auto transform = Value(Object{{"position", Value(Object{{"x", Value(0.0)}, {"y", Value(0.0)}})}, {"rotation", Value(0.0)},
            {"scale", Value(Object{{"x", Value(1.0)}, {"y", Value(1.0)}})}, {"pivot", Value(Object{{"x", Value(0.0)}, {"y", Value(0.0)}})}});
        nodes(project)[id.get<std::string>()] = scene_node(id, "deformer", field(p, "displayName"), parent_id, transform);
        auto& list = children(parent); list.insert(list.begin() + optional_index(p, list.size()), id);
        Object deformer{{"id", id}, {"type", Value("warp")}, {"parentNodeId", parent_id}};
        for (auto key : {"displayName", "columns", "rows", "bounds", "controlPointIds"}) deformer[key] = field(p, key);
        deformers.emplace_back(deformer); points.insert(points.end(), created.begin(), created.end());
        std::vector<std::string> affected{parent_id.get<std::string>(), id.get<std::string>()}; append_ids(affected, field(p, "controlPointIds"));
        result = {command("deformer.remove_internal", Object{{"deformerId", id}}), affected}; return true;
    }
    if (type == "deformer.restore") {
        const auto saved = field(p, "snapshot"); const auto saved_node = field(saved, "node"), saved_deformer = field(saved, "deformer");
        const auto id = field(saved_deformer, "id"), parent_id = field(saved_node, "parentId");
        auto& parent = node(project, parent_id.get<std::string>()); auto& list = children(parent);
        for (const auto& child : field(saved_node, "children").get<Array>()) {
            auto at = std::find(list.begin(), list.end(), child); if (at != list.end()) list.erase(at);
            warp_child_parent(project, child, field(saved_node, "id"));
        }
        list.insert(list.begin() + std::min(list.size(), static_cast<size_t>(field(saved, "nodeIndex").get<double>())), field(saved_node, "id"));
        nodes(project)[string_field(saved_node, "id")] = saved_node;
        deformers.insert(deformers.begin() + std::min(deformers.size(), static_cast<size_t>(field(saved, "deformerIndex").get<double>())), saved_deformer);
        restore_indexed(points, field(saved, "controlPoints").get<Array>(), "point"); restore_indexed(keyforms, field(saved, "keyforms").get<Array>(), "keyform");
        std::vector<std::string> affected{parent_id.get<std::string>(), id.get<std::string>()}; append_ids(affected, field(saved_node, "children")); append_ids(affected, field(saved_deformer, "controlPointIds"));
        result = {command("deformer.remove_internal", Object{{"deformerId", id}}), affected}; return true;
    }
    // This history-only command intentionally resolves the pose before the owner,
    // matching JS error precedence when an internal inverse is malformed.
    if (type == "deformer.remove_keyform_internal") {
        auto at = std::find_if(keyforms.begin(), keyforms.end(), [&](const Value& value) { return field(value, "deformerId") == field(p, "deformerId") && field(value, "keyArtId") == field(p, "keyArtId"); });
        if (at == keyforms.end()) fail("deformer.keyform_not_found");
        auto inverse = command("deformer.set_keyform", at->get<Object>()); keyforms.erase(at);
        result = {inverse, {string_field(p, "deformerId"), string_field(p, "keyArtId")}}; return true;
    }
    auto& deformer = entity(deformers, field(p, "deformerId"), "deformer.not_found"); const auto id = field(deformer, "id");
    if (type == "deformer.remove" || type == "deformer.remove_internal") {
        auto& current = node(project, id.get<std::string>()); const auto saved_node = current; const auto saved_deformer = deformer;
        auto& parent = node(project, string_field(current, "parentId")); const auto parent_id = field(parent, "id"); auto& list = children(parent);
        auto at = std::find(list.begin(), list.end(), id); const auto index = static_cast<size_t>(at - list.begin()); const auto deformer_index = static_cast<size_t>(&deformer - deformers.data());
        auto inverse = command("deformer.restore", Object{{"snapshot", Value(Object{{"node", saved_node}, {"nodeIndex", Value(static_cast<double>(index))},
            {"deformer", saved_deformer}, {"deformerIndex", Value(static_cast<double>(deformer_index))},
            {"controlPoints", Value(indexed_owned(points, id, "point"))}, {"keyforms", Value(indexed_owned(keyforms, id, "keyform"))}})}});
        list.erase(at); const auto lifted = field(saved_node, "children").get<Array>(); list.insert(list.begin() + index, lifted.begin(), lifted.end());
        for (const auto& child : lifted) warp_child_parent(project, child, parent_id);
        nodes(project).erase(id.get<std::string>()); deformers.erase(deformers.begin() + deformer_index); erase_owned(points, id); erase_owned(keyforms, id);
        std::vector<std::string> affected{parent_id.get<std::string>(), id.get<std::string>()}; append_ids(affected, field(saved_node, "children")); append_ids(affected, field(saved_deformer, "controlPointIds"));
        result = {inverse, affected}; return true;
    }
    if (type == "deformer.rename") {
        auto inverse = command(type, Object{{"deformerId", id}, {"displayName", field(deformer, "displayName")}});
        deformer.get<Object>()["displayName"] = Value(trimmed(string_field(p, "displayName"))); node(project, id.get<std::string>()).get<Object>()["displayName"] = field(deformer, "displayName");
        result = {inverse, {id.get<std::string>()}}; return true;
    }
    if (type == "deformer.set_grid") {
        for (const auto& keyform : keyforms) if (field(keyform, "deformerId") == id) fail("DEFORMER_KEYFORM_INCOMPATIBLE");
        Object previous{{"deformerId", id}}; for (auto key : {"columns", "rows", "bounds", "controlPointIds"}) previous[key] = field(deformer, key);
        auto next = regular_points(id, p); erase_owned(points, id);
        for (auto key : {"columns", "rows", "bounds", "controlPointIds"}) deformer.get<Object>()[key] = field(p, key);
        points.insert(points.end(), next.begin(), next.end());
        std::vector<std::string> affected{id.get<std::string>()}; append_ids(affected, previous.at("controlPointIds")); append_ids(affected, field(p, "controlPointIds"));
        result = {command(type, previous), affected}; return true;
    }
    if (type == "deformer.reset_control_points") {
        Array defaults; const auto& bounds = field(deformer, "bounds");
        const double left = field(bounds, "left").get<double>(), top = field(bounds, "top").get<double>();
        const double width = field(bounds, "right").get<double>() - left, height = field(bounds, "bottom").get<double>() - top;
        for (const auto& point_id : field(deformer, "controlPointIds").get<Array>()) {
            const auto& point = entity(points, point_id, "project.invalid");
            defaults.emplace_back(Object{{"controlPointId", point_id}, {"x", Value(left + field(point, "u").get<double>() * width)}, {"y", Value(top + field(point, "v").get<double>() * height)}});
        }
        return apply_warp(project, "deformer.set_keyform", Value(Object{{"deformerId", id}, {"keyArtId", field(p, "keyArtId")}, {"controlPoints", Value(defaults)}}), result);
    }
    const auto& updates = field(p, "controlPoints").get<Array>(); assert_points(deformer, updates, type == "deformer.set_keyform");
    auto at = std::find_if(keyforms.begin(), keyforms.end(), [&](const Value& value) { return field(value, "deformerId") == id && field(value, "keyArtId") == field(p, "keyArtId"); });
    if (type == "deformer.move_control_points" && at == keyforms.end()) fail("deformer.keyform_not_found");
    auto inverse = at == keyforms.end() ? command("deformer.remove_keyform_internal", Object{{"deformerId", id}, {"keyArtId", field(p, "keyArtId")}}) : command("deformer.set_keyform", at->get<Object>());
    Array next = updates;
    if (type == "deformer.move_control_points") {
        next = field(*at, "controlPoints").get<Array>();
        for (auto& point : next) for (const auto& update : updates) if (field(point, "controlPointId") == field(update, "controlPointId")) point = update;
    }
    auto next_keyform = ordered_warp_keyform(deformer, field(p, "keyArtId"), next);
    if (at == keyforms.end()) keyforms.push_back(next_keyform); else *at = next_keyform;
    std::vector<std::string> affected{id.get<std::string>(), string_field(p, "keyArtId")};
    if (type == "deformer.set_keyform") append_ids(affected, field(deformer, "controlPointIds"));
    else for (const auto& point : updates) affected.push_back(string_field(point, "controlPointId"));
    result = {inverse, affected}; return true;
}
bool apply_bone_hierarchy(Value& project, const std::string& type, const Value& p, Applied& result) {
    static const std::set<std::string> types{"bone.create", "bone.remove", "bone.remove_internal", "bone.restore", "bone.rename", "bone.set_rest", "bone.set_enabled", "bone.reparent", "bone.set_keyform", "bone.reset_keyform", "bone.remove_keyform_internal"};
    if (!types.count(type)) return false;
    auto& bones = rig_list(project, "bones"); auto& poses = rig_list(project, "bonePoseKeyforms");
    if (type == "bone.create") {
        const auto id = field(p, "id");
        if (nodes(project).count(id.get<std::string>()) || std::any_of(bones.begin(), bones.end(), [&](const Value& bone) { return field(bone, "id") == id; })) fail("identity.duplicate");
        Value& parent = bone_parent(project, field(p, "parentNodeId"));
        const auto parent_id = field(parent, "id");
        auto rest = field(p, "restLocalTransform");
        nodes(project)[id.get<std::string>()] = scene_node(id, "bone", Value(trimmed(string_field(p, "displayName"))), parent_id, bone_transform(rest));
        auto& list = children(parent); list.insert(list.begin() + optional_index(p, list.size()), id);
        bones.emplace_back(Object{{"id", id}, {"parentNodeId", parent_id}, {"restLocalTransform", rest}, {"length", field(p, "length")}, {"enabled", p.get<Object>().count("enabled") ? field(p, "enabled") : Value(true)}});
        result = {command("bone.remove_internal", Object{{"boneId", id}}), {parent_id.get<std::string>(), id.get<std::string>()}}; return true;
    }
    if (type == "bone.restore") {
        const auto& saved = field(p, "snapshot"); const auto& saved_node = field(saved, "node"); const auto& saved_bone = field(saved, "bone");
        auto& parent = bone_parent(project, field(saved_node, "parentId"));
        const auto id = field(saved_bone, "id"), parent_id = field(parent, "id");
        if (nodes(project).count(string_field(saved_node, "id")) || std::any_of(bones.begin(), bones.end(), [&](const Value& value) { return field(value, "id") == id; })) fail("identity.duplicate");
        auto& list = children(parent); list.insert(list.begin() + std::min(list.size(), static_cast<size_t>(field(saved, "nodeIndex").get<double>())), field(saved_node, "id"));
        nodes(project)[string_field(saved_node, "id")] = saved_node;
        bones.insert(bones.begin() + std::min(bones.size(), static_cast<size_t>(field(saved, "boneIndex").get<double>())), saved_bone);
        auto keyforms = field(saved, "keyforms").get<Array>();
        std::stable_sort(keyforms.begin(), keyforms.end(), [](const Value& a, const Value& b) { return field(a, "index").get<double>() < field(b, "index").get<double>(); });
        std::vector<std::string> affected{parent_id.get<std::string>(), id.get<std::string>()};
        for (const auto& entry : keyforms) { poses.insert(poses.begin() + insert_index(entry, poses.size()), field(entry, "keyform")); affected.push_back(string_field(field(entry, "keyform"), "keyArtId")); }
        result = {command("bone.remove_internal", Object{{"boneId", id}}), affected}; return true;
    }
    auto& bone = entity(bones, field(p, "boneId"), "bone.not_found"); const auto id = field(bone, "id");
    Value& current_node = node(project, id.get<std::string>());
    if (type == "bone.remove" || type == "bone.remove_internal") {
        if (field(current_node, "kind") != Value("bone")) fail("BONE_NODE_MISSING");
        if (!children(current_node).empty()) fail("bone.not_leaf");
        no_bone_dependents(project, {id.get<std::string>()});
        for (const auto& constraint : rig_list(project, "boneRotationConstraints")) if (field(constraint, "boneId") == id) fail("bone.delete_locked_by_rotation_constraint");
        Value& parent = node(project, string_field(current_node, "parentId")); const auto parent_id = field(parent, "id");
        auto& list = children(parent); auto at = std::find(list.begin(), list.end(), id);
        const auto bone_index = static_cast<double>(&bone - bones.data()); Array keyforms;
        for (size_t i = 0; i < poses.size(); ++i) if (field(poses[i], "boneId") == id) keyforms.emplace_back(Object{{"keyform", poses[i]}, {"index", Value(static_cast<double>(i))}});
        auto inverse = command("bone.restore", Object{{"snapshot", Value(Object{{"node", current_node}, {"nodeIndex", Value(static_cast<double>(at - list.begin()))}, {"bone", bone}, {"boneIndex", Value(bone_index)}, {"keyforms", Value(keyforms)}})}});
        list.erase(at); nodes(project).erase(id.get<std::string>()); bones.erase(bones.begin() + static_cast<size_t>(bone_index));
        poses.erase(std::remove_if(poses.begin(), poses.end(), [&](const Value& pose) { return field(pose, "boneId") == id; }), poses.end());
        std::vector<std::string> affected{parent_id.get<std::string>(), id.get<std::string>()};
        for (const auto& entry : keyforms) affected.push_back(string_field(field(entry, "keyform"), "keyArtId"));
        result = {inverse, affected}; return true;
    }
    if (type == "bone.rename" || type == "bone.set_enabled" || type == "bone.set_rest") {
        Object inverse{{"boneId", id}};
        if (type == "bone.rename") { inverse["displayName"] = field(current_node, "displayName"); current_node.get<Object>()["displayName"] = Value(trimmed(string_field(p, "displayName"))); }
        else if (type == "bone.set_enabled") { inverse["enabled"] = field(bone, "enabled"); bone.get<Object>()["enabled"] = field(p, "enabled"); }
        else { no_bone_dependents(project, bone_descendants(project, id.get<std::string>()));
            for (auto key : {"restLocalTransform", "length"}) { inverse[key] = field(bone, key); bone.get<Object>()[key] = field(p, key); }
            current_node.get<Object>()["transform"] = bone_transform(field(p, "restLocalTransform"));
        }
        result = {command(type, inverse), {id.get<std::string>()}}; return true;
    }
    if (type == "bone.reparent") {
        auto& parent = bone_parent(project, field(p, "parentNodeId"));
        for (const Value* ancestor = &parent; ancestor;) {
            if (field(*ancestor, "id") == id) fail("BONE_HIERARCHY_CYCLE");
            const auto& parent_id = field(*ancestor, "parentId"); ancestor = parent_id.is<std::string>() ? &node(project, parent_id.get<std::string>()) : nullptr;
        }
        no_bone_dependents(project, bone_descendants(project, id.get<std::string>()));
        Value& previous = node(project, string_field(current_node, "parentId")); const auto old_id = field(previous, "id"), next_id = field(parent, "id");
        auto& old_list = children(previous); auto at = std::find(old_list.begin(), old_list.end(), id); const auto old_index = static_cast<double>(at - old_list.begin()); old_list.erase(at);
        auto& list = children(parent); list.insert(list.begin() + optional_index(p, list.size()), id);
        current_node.get<Object>()["parentId"] = next_id; bone.get<Object>()["parentNodeId"] = next_id;
        result = {command(type, Object{{"boneId", id}, {"parentNodeId", old_id}, {"index", Value(old_index)}}), {id.get<std::string>(), old_id.get<std::string>(), next_id.get<std::string>()}}; return true;
    }
    auto at = std::find_if(poses.begin(), poses.end(), [&](const Value& value) { return field(value, "boneId") == id && field(value, "keyArtId") == field(p, "keyArtId"); });
    if (type == "bone.set_keyform") {
        Value inverse = at == poses.end() ? command("bone.remove_keyform_internal", Object{{"boneId", id}, {"keyArtId", field(p, "keyArtId")}}) : command(type, at->get<Object>());
        if (at == poses.end()) poses.push_back(p); else *at = p;
        result = {inverse, {id.get<std::string>(), string_field(p, "keyArtId")}}; return true;
    }
    if (at == poses.end()) fail("bone.keyform_not_found");
    auto inverse = command("bone.set_keyform", at->get<Object>()); poses.erase(at);
    result = {inverse, {id.get<std::string>(), string_field(p, "keyArtId")}}; return true;
}
}
