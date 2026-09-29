#include "flamoris2d_core.h"
#include "picojson.h"

#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <new>
#include <numeric>
#include <string>
#include <utility>
#include <vector>

using Value = picojson::value;
using Object = picojson::object;
using Array = picojson::array;

namespace {
struct Issue { std::string code, path, entity; };
struct Node { std::string id, kind, parent, name; bool null_parent = false; };
struct Snapshot {
    int32_t schema = 0;
    double width = 0, height = 0;
    std::string id, name, root;
    std::map<std::string, Node> nodes;
    std::vector<Issue> issues;
    // Presence is retained explicitly; these payloads are not interpreted yet.
    std::map<std::string, bool> unsupported_sections;
};

const Value& field(const Value& value, const std::string& key) {
    static const Value missing;
    if (!value.is<Object>()) return missing;
    const auto& object = value.get<Object>();
    auto it = object.find(key);
    return it == object.end() ? missing : it->second;
}
std::string str(const Value& value) { return value.is<std::string>() ? value.get<std::string>() : ""; }
bool finite(const Value& value) { return value.is<double>() && std::isfinite(value.get<double>()); }
void add(Snapshot& s, const char* code, std::string path, std::string entity = {}) {
    s.issues.push_back({code, std::move(path), std::move(entity)});
}
bool utf8(const uint8_t* data, uint32_t length) {
    for (uint32_t i = 0; i < length;) {
        uint8_t c = data[i++];
        if (c < 0x80) continue;
        uint32_t extra = c >= 0xC2 && c <= 0xDF ? 1 : c >= 0xE0 && c <= 0xEF ? 2 : c >= 0xF0 && c <= 0xF4 ? 3 : 0;
        if (!extra || extra > length - i) return false;
        uint8_t first = data[i];
        if ((c == 0xE0 && first < 0xA0) || (c == 0xED && first >= 0xA0) ||
            (c == 0xF0 && first < 0x90) || (c == 0xF4 && first >= 0x90)) return false;
        for (uint32_t j = 0; j < extra; ++j) if ((data[i++] & 0xC0) != 0x80) return false;
    }
    return true;
}
void validate(Snapshot& s, const Value& project) {
    if (!project.is<Object>()) { add(s, "project.invalid", "$"); return; }
    const Value& schema = field(project, "schemaVersion");
    s.schema = finite(schema) && schema.get<double>() >= INT32_MIN && schema.get<double>() <= INT32_MAX
        ? static_cast<int32_t>(schema.get<double>()) : 0;
    if (!finite(schema) || schema.get<double>() != 15) add(s, "project.unsupported_schema", "schemaVersion");
    const Value& timebase = field(project, "timebaseTicksPerSecond");
    if (!finite(timebase) || timebase.get<double>() != 120000) add(s, "ANIMATION_INVALID_TIMEBASE", "timebaseTicksPerSecond");
    s.id = str(field(project, "id"));
    s.name = str(field(project, "displayName"));
    if (s.id.empty()) add(s, "project.missing_id", "id");
    const Value& canvas = field(project, "canvas");
    const Value& width = field(canvas, "width");
    const Value& height = field(canvas, "height");
    if (finite(width)) s.width = width.get<double>();
    if (finite(height)) s.height = height.get<double>();
    if (!finite(width) || s.width <= 0) add(s, "canvas.invalid_width", "canvas.width");
    if (!finite(height) || s.height <= 0) add(s, "canvas.invalid_height", "canvas.height");
    const Value& rate = field(field(project, "renderSettings"), "frameRate");
    const Value& n = field(rate, "numerator");
    const Value& d = field(rate, "denominator");
    constexpr double max_safe = 9007199254740991.0;
    bool rate_ok = finite(n) && finite(d) && n.get<double>() > 0 && d.get<double>() > 0 &&
        n.get<double>() <= max_safe && d.get<double>() <= max_safe &&
        std::floor(n.get<double>()) == n.get<double>() && std::floor(d.get<double>()) == d.get<double>();
    if (rate_ok) rate_ok = std::gcd(static_cast<int64_t>(n.get<double>()), static_cast<int64_t>(d.get<double>())) == 1;
    if (!rate_ok) add(s, "ANIMATION_INVALID_FRAME_RATE", "renderSettings.frameRate");

    const Value& scene = field(project, "scene");
    s.root = str(field(scene, "rootId"));
    const Value& nodes = field(scene, "nodes");
    if (!nodes.is<Object>()) { add(s, "scene.missing_nodes", "scene.nodes"); return; }
    const auto& node_map = nodes.get<Object>();
    auto root = node_map.find(s.root);
    if (root == node_map.end()) add(s, "scene.missing_root", "scene.rootId", s.root);
    else {
        if (!field(root->second, "parentId").is<picojson::null>()) add(s, "scene.root_parent_not_null", "scene.nodes." + s.root + ".parentId", s.root);
        if (str(field(root->second, "kind")) != "group") add(s, "scene.root_not_group", "scene.nodes." + s.root + ".kind", s.root);
    }
    std::map<std::string, std::string> ids;
    auto register_id = [&](const Value& id, const std::string& path) {
        std::string text = str(id);
        if (text.empty()) add(s, "identity.missing", path);
        else if (!ids.emplace(text, path).second) add(s, "identity.duplicate", path, text);
    };
    register_id(field(project, "id"), "id");
    for (const auto& [key, value] : node_map) {
        const std::string path = "scene.nodes." + key;
        const Value& id = field(value, "id");
        register_id(id, path + ".id");
        Node node{str(id), str(field(value, "kind")), str(field(value, "parentId")), str(field(value, "displayName")), field(value, "parentId").is<picojson::null>()};
        s.nodes.emplace(key, node);
        if (node.id != key) add(s, "scene.key_id_mismatch", path + ".id", node.id);
        if (node.kind != "group" && node.kind != "part" && node.kind != "deformer" && node.kind != "bone") add(s, "scene.invalid_kind", path + ".kind", key);
        const Value& opacity = field(value, "opacity");
        if (!finite(opacity) || opacity.get<double>() < 0 || opacity.get<double>() > 1) add(s, "scene.invalid_opacity", path + ".opacity", key);
        const Value& children = field(value, "children");
        if (!children.is<Array>()) add(s, "scene.invalid_children", path + ".children", key);
        if (node.null_parent && key != s.root) add(s, "scene.orphan", path + ".parentId", key);
        if (!node.parent.empty() && node_map.find(node.parent) == node_map.end()) add(s, "scene.missing_parent", path + ".parentId", key);
        if (children.is<Array>()) for (const auto& child : children.get<Array>()) {
            std::string child_id = str(child);
            auto found = node_map.find(child_id);
            if (found == node_map.end()) add(s, "scene.missing_child", path + ".children", child_id);
            else if (str(field(found->second, "parentId")) != key) add(s, "scene.parent_child_mismatch", path + ".children", child_id);
        }
        const Value& transform = field(value, "transform");
        const Value& position = field(transform, "position");
        const Value& scale = field(transform, "scale");
        const Value& pivot = field(transform, "pivot");
        if (!finite(field(position, "x")) || !finite(field(position, "y")) || !finite(field(transform, "rotation")) ||
            !finite(field(scale, "x")) || !finite(field(scale, "y")) || !finite(field(pivot, "x")) || !finite(field(pivot, "y")))
            add(s, "transform.non_finite", path + ".transform", key);
        if ((finite(field(scale, "x")) && field(scale, "x").get<double>() == 0) ||
            (finite(field(scale, "y")) && field(scale, "y").get<double>() == 0))
            add(s, "transform.zero_scale", path + ".transform.scale", key);
    }
    // Register IDs from collections supported by the JS base validator. The
    // remaining payload stays opaque and is never projected as native truth.
    const char* collections[] = {"sourceAssets", "semanticSlots", "keyArts", "meshes", "meshTopologies", "meshKeyforms", "meshFormCorrectionKeyforms", "transitions", "sequences"};
    for (const char* name : collections) {
        const Value& values = field(project, name);
        s.unsupported_sections[name] = !values.is<picojson::null>();
        if (!values.is<Array>()) add(s, "collection.invalid", name);
        else { size_t i = 0; for (const auto& value : values.get<Array>()) register_id(field(value, "id"), std::string(name) + "." + std::to_string(i++) + ".id"); }
    }
    for (const char* name : {"rig", "animation", "temporalPrograms", "clippingBindings", "renderSettings"})
        s.unsupported_sections[name] = !field(project, name).is<picojson::null>();
}
fl2d_status copy(const std::string& value, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!required) return FL2D_INVALID_ARGUMENT;
    *required = static_cast<uint32_t>(value.size() + 1);
    if (!buffer || capacity < *required) return FL2D_BUFFER_TOO_SMALL;
    std::memcpy(buffer, value.c_str(), *required);
    return FL2D_OK;
}
} // namespace

struct fl2d_snapshot : Snapshot {};

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_load(const uint8_t* bytes, uint32_t length, fl2d_snapshot** result) {
    if (!result) return FL2D_INVALID_ARGUMENT;
    *result = nullptr;
    if (length > FL2D_SNAPSHOT_MAX_BYTES) return FL2D_INPUT_TOO_LARGE;
    if (!bytes || !length) return FL2D_INVALID_ARGUMENT;
    if (!utf8(bytes, length)) return FL2D_INVALID_UTF8;
    try {
        Value parsed;
        std::string json(reinterpret_cast<const char*>(bytes), length);
        std::string error;
        auto end = picojson::parse(parsed, json.begin(), json.end(), &error);
        if (!error.empty() || (end != json.end() &&
            json.find_first_not_of(" \t\r\n", static_cast<size_t>(end - json.begin())) != std::string::npos))
            return FL2D_MALFORMED_JSON;
        auto snapshot = new fl2d_snapshot();
        try { validate(*snapshot, parsed); } catch (...) { delete snapshot; throw; }
        *result = snapshot;
        return FL2D_OK;
    } catch (const std::bad_alloc&) { return FL2D_OUT_OF_MEMORY; }
      catch (...) { return FL2D_INTERNAL_ERROR; }
}
extern "C" FL2D_API void FL2D_CALL fl2d_snapshot_destroy(fl2d_snapshot* snapshot) { delete snapshot; }
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_summary(const fl2d_snapshot* s, int32_t* schema,
    double* width, double* height, uint32_t* nodes, uint32_t* issues) {
    if (!s || !schema || !width || !height || !nodes || !issues) return FL2D_INVALID_ARGUMENT;
    *schema = s->schema; *width = s->width; *height = s->height;
    *nodes = static_cast<uint32_t>(s->nodes.size()); *issues = static_cast<uint32_t>(s->issues.size());
    return FL2D_OK;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_string(const fl2d_snapshot* s,
    const char* field_name, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!s || !field_name) return FL2D_INVALID_ARGUMENT;
    if (!std::strcmp(field_name, "id")) return copy(s->id, buffer, capacity, required);
    if (!std::strcmp(field_name, "displayName")) return copy(s->name, buffer, capacity, required);
    if (!std::strcmp(field_name, "rootId")) return copy(s->root, buffer, capacity, required);
    return FL2D_INVALID_ARGUMENT;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_node_string(const fl2d_snapshot* s,
    const char* node_id, const char* field_name, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!s || !node_id || !field_name) return FL2D_INVALID_ARGUMENT;
    auto it = s->nodes.find(node_id);
    if (it == s->nodes.end()) return FL2D_INVALID_ARGUMENT;
    const Node& n = it->second;
    if (!std::strcmp(field_name, "id")) return copy(n.id, buffer, capacity, required);
    if (!std::strcmp(field_name, "kind")) return copy(n.kind, buffer, capacity, required);
    if (!std::strcmp(field_name, "parentId")) return copy(n.parent, buffer, capacity, required);
    if (!std::strcmp(field_name, "displayName")) return copy(n.name, buffer, capacity, required);
    return FL2D_INVALID_ARGUMENT;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_issue_string(const fl2d_snapshot* s,
    uint32_t index, const char* field_name, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!s || !field_name || index >= s->issues.size()) return FL2D_INVALID_ARGUMENT;
    const Issue& issue = s->issues[index];
    if (!std::strcmp(field_name, "code")) return copy(issue.code, buffer, capacity, required);
    if (!std::strcmp(field_name, "path")) return copy(issue.path, buffer, capacity, required);
    if (!std::strcmp(field_name, "entityId")) return copy(issue.entity, buffer, capacity, required);
    return FL2D_INVALID_ARGUMENT;
}
