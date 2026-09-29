#include "flamoris2d_core.h"
#include "picojson.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace {
using Value = picojson::value;
using Object = picojson::object;
using Array = picojson::array;
constexpr int64_t max_js_revision = 9007199254740991LL;

struct Failure { fl2d_status status; const char* code; };
struct Entry {
    std::string label;
    Array commands, inverses;
    std::vector<std::string> affected;
    int64_t before = 0, after = 0;
};
struct State {
    Value project;
    std::vector<Entry> undo, redo;
    Array history;
    int64_t counter = 0, current = 0, saved = 0;
    uint64_t generation = 0;
    std::string error;
};
const Value& field(const Value& value, const std::string& key) {
    static const Value missing;
    if (!value.is<Object>()) return missing;
    const auto& object = value.get<Object>();
    auto it = object.find(key);
    return it == object.end() ? missing : it->second;
}
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
bool point(const Value& value) {
    return exact(value, {"x", "y"}) && number(field(value, "x")) && number(field(value, "y"));
}
bool transform(const Value& value) {
    return exact(value, {"position", "rotation", "scale", "pivot"}) &&
        point(field(value, "position")) && number(field(value, "rotation")) &&
        point(field(value, "scale")) && point(field(value, "pivot"));
}
fl2d_status copy(const std::string& value, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!required) return FL2D_INVALID_ARGUMENT;
    if (value.size() >= UINT32_MAX) return FL2D_INPUT_TOO_LARGE;
    *required = static_cast<uint32_t>(value.size() + 1);
    if (!buffer || capacity < *required) return FL2D_BUFFER_TOO_SMALL;
    std::memcpy(buffer, value.c_str(), *required);
    return FL2D_OK;
}
// Snapshot admission is the single native Project validation path, including
// the interchange size, encoding and JSON syntax gates.
fl2d_status parse_project(const uint8_t* bytes, uint32_t length, Value& project) {
    fl2d_snapshot* snapshot = nullptr;
    auto status = fl2d_snapshot_load(bytes, length, &snapshot);
    if (status != FL2D_OK) return status;
    int32_t schema; double width, height; uint32_t nodes, issues;
    status = fl2d_snapshot_summary(snapshot, &schema, &width, &height, &nodes, &issues);
    if (status != FL2D_OK) { fl2d_snapshot_destroy(snapshot); return status; }
    for (uint32_t i = 0; i < issues; ++i) {
        char severity[16]; uint32_t required = 0;
        status = fl2d_snapshot_issue_string(snapshot, i, "severity", severity, sizeof(severity), &required);
        if (status != FL2D_OK || std::strcmp(severity, "error") == 0) {
            fl2d_snapshot_destroy(snapshot);
            return status == FL2D_OK ? FL2D_PROJECT_INVALID : status;
        }
    }
    fl2d_snapshot_destroy(snapshot);
    std::string source(reinterpret_cast<const char*>(bytes), length), error;
    auto end = picojson::parse(project, source.begin(), source.end(), &error);
    if (!error.empty() || end != source.end()) return FL2D_MALFORMED_JSON;
    return FL2D_OK;
}
fl2d_status validate_candidate(const Value& project) {
    const auto text = project.serialize();
    if (text.size() > FL2D_SNAPSHOT_MAX_BYTES) return FL2D_INPUT_TOO_LARGE;
    Value ignored;
    return parse_project(reinterpret_cast<const uint8_t*>(text.data()), static_cast<uint32_t>(text.size()), ignored);
}
fl2d_status validate_transaction_candidate(const Value& before, const Value& after) {
    // Product JS additionally validates temporal ownership across before/after.
    // The current native command set changes only scene node name, visibility,
    // and transform, so it cannot alter a program owner, track, or binding.
    // Keep this two-state seam when those command families migrate.
    (void)before;
    return validate_candidate(after);
}
fl2d_status parse_commands(const uint8_t* bytes, uint32_t length, Array& commands) {
    if (!bytes || !length) return FL2D_COMMAND_INVALID;
    if (length > FL2D_SNAPSHOT_MAX_BYTES) return FL2D_INPUT_TOO_LARGE;
    // Reuse the snapshot parser's UTF-8 gate for command interchange below by
    // checking byte sequences before parsing (picojson does not enforce UTF-8).
    for (uint32_t i = 0; i < length;) {
        unsigned char c = bytes[i++];
        if (c < 0x80) continue;
        int extra = c >= 0xC2 && c <= 0xDF ? 1 : c >= 0xE0 && c <= 0xEF ? 2 : c >= 0xF0 && c <= 0xF4 ? 3 : 0;
        if (!extra || static_cast<uint32_t>(extra) > length - i) return FL2D_INVALID_UTF8;
        unsigned char first = bytes[i];
        if ((c == 0xE0 && first < 0xA0) || (c == 0xED && first >= 0xA0) ||
            (c == 0xF0 && first < 0x90) || (c == 0xF4 && first >= 0x90)) return FL2D_INVALID_UTF8;
        for (int j = 0; j < extra; ++j) if ((bytes[i++] & 0xC0) != 0x80) return FL2D_INVALID_UTF8;
    }
    std::string text(reinterpret_cast<const char*>(bytes), length), error;
    Value parsed;
    auto end = picojson::parse(parsed, text.begin(), text.end(), &error);
    if (!error.empty() || end != text.end() || !parsed.is<Array>()) return FL2D_COMMAND_INVALID;
    commands = parsed.get<Array>();
    return commands.empty() ? FL2D_TRANSACTION_EMPTY : FL2D_OK;
}
const char* error_name(fl2d_status status) {
    switch (status) {
    case FL2D_PROJECT_INVALID: return "project.invalid";
    case FL2D_COMMAND_INVALID: return "command.payload_invalid";
    case FL2D_COMMAND_UNSUPPORTED: return "command.unsupported";
    case FL2D_TARGET_NOT_FOUND: return "scene.node_not_found";
    case FL2D_TRANSACTION_EMPTY: return "transaction.empty";
    case FL2D_REVISION_CONFLICT: return "revision.conflict";
    case FL2D_SAVED_REVISION_INVALID: return "history.saved_revision_invalid";
    case FL2D_HISTORY_EMPTY: return "history.empty";
    case FL2D_REVISION_EXHAUSTED: return "revision.exhausted";
    case FL2D_INVALID_UTF8: return "input.invalid_utf8";
    case FL2D_INPUT_TOO_LARGE: return "input.too_large";
    default: return "input.invalid";
    }
}
fl2d_status record(State& s, fl2d_status status) {
    s.error = status == FL2D_OK ? "" : error_name(status);
    return status;
}
Value& node(Value& project, const std::string& id) {
    auto& nodes = project.get<Object>().at("scene").get<Object>().at("nodes").get<Object>();
    auto it = nodes.find(id);
    if (it == nodes.end()) throw Failure{FL2D_TARGET_NOT_FOUND, "scene.node_not_found"};
    return it->second;
}
const Value* find_node(const State& state, const char* id) {
    if (!id) return nullptr;
    const auto& nodes = field(field(state.project, "scene"), "nodes").get<Object>();
    auto it = nodes.find(id);
    return it == nodes.end() ? nullptr : &it->second;
}
Value command(const std::string& type, const Object& payload) {
    return Value(Object{{"type", Value(type)}, {"payload", Value(payload)}});
}
struct Applied { Value inverse; std::vector<std::string> ids; };
Applied apply(Value& project, const Value& cmd) {
    if (!exact(cmd, {"type", "payload"}) || !field(cmd, "type").is<std::string>())
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    const std::string type = field(cmd, "type").get<std::string>();
    const Value& payload = field(cmd, "payload");
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
bool shape(const Value& value, std::initializer_list<const char*> required, std::initializer_list<const char*> optional = {}) {
    if (!value.is<Object>()) return false;
    for (const auto key : required) if (!value.get<Object>().count(key)) return false;
    for (const auto& [key, ignored] : value.get<Object>()) {
        (void)ignored;
        if (std::find(required.begin(), required.end(), key) == required.end() &&
            std::find(optional.begin(), optional.end(), key) == optional.end()) return false;
    }
    return true;
}
bool index(const Value& payload) {
    const auto& v = field(payload, "index");
    return !payload.get<Object>().count("index") || (number(v) && v.get<double>() >= 0 && std::floor(v.get<double>()) == v.get<double>());
}
void assert_command(const Value& cmd, bool internal) {
    if (!exact(cmd, {"type", "payload"}) || !field(cmd, "type").is<std::string>())
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    const auto type = field(cmd, "type").get<std::string>();
    const auto& p = field(cmd, "payload");
    bool valid = false, supported = true;
    if (type == "scene.rename_node") valid = exact(p, {"nodeId", "displayName"}) && nonblank(field(p, "nodeId")) && nonblank(field(p, "displayName"));
    else if (type == "scene.set_transform") valid = exact(p, {"nodeId", "coordinateSpace", "transform"}) && nonblank(field(p, "nodeId")) && field(p, "coordinateSpace") == Value("node-local") && transform(field(p, "transform"));
    else if (type == "scene.set_visibility" || type == "scene.set_locked") {
        const char* property = type == "scene.set_visibility" ? "visible" : "locked";
        valid = exact(p, {"nodeId", property}) && nonblank(field(p, "nodeId")) && field(p, property).is<bool>();
    } else if (type == "scene.create_group") valid = shape(p, {"id", "parentId", "displayName"}, {"index"}) && nonblank(field(p, "id")) && nonblank(field(p, "parentId")) && nonblank(field(p, "displayName")) && index(p);
    else if (type == "scene.reparent_node") valid = shape(p, {"nodeId", "parentId"}, {"index"}) && nonblank(field(p, "nodeId")) && nonblank(field(p, "parentId")) && index(p);
    else if (type == "scene.remove_empty_group") valid = internal && exact(p, {"nodeId"}) && nonblank(field(p, "nodeId"));
    else if (type == "clipping.create" || type == "clipping.restore") {
        const auto& b = field(p, "binding");
        valid = (type == "clipping.create" ? exact(p, {"binding"}) : internal && exact(p, {"binding", "index"}) && index(p)) &&
            exact(b, {"id", "targetNodeId", "sourceNodeId", "mode", "enabled"}) && nonblank(field(b, "id")) &&
            nonblank(field(b, "targetNodeId")) && nonblank(field(b, "sourceNodeId")) && field(b, "mode") == Value("inside") && field(b, "enabled").is<bool>();
    } else if (type == "clipping.set_source") valid = exact(p, {"bindingId", "sourceNodeId"}) && nonblank(field(p, "bindingId")) && nonblank(field(p, "sourceNodeId"));
    else if (type == "clipping.set_enabled") valid = exact(p, {"bindingId", "enabled"}) && nonblank(field(p, "bindingId")) && field(p, "enabled").is<bool>();
    else if (type == "clipping.remove" || type == "clipping.remove_internal") valid = (internal || type == "clipping.remove") && exact(p, {"bindingId"}) && nonblank(field(p, "bindingId"));
    else supported = false;
    if (!supported) throw Failure{FL2D_COMMAND_UNSUPPORTED, "command.unsupported"};
    if (!valid) throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
}

Array history_item(const std::string& label, const Array& commands, const std::vector<std::string>& affected) {
    Array types, ids;
    for (const auto& cmd : commands) types.emplace_back(field(cmd, "type"));
    for (const auto& id : affected) ids.emplace_back(id);
    return Array{Value(Object{{"label", Value(label)}, {"commandTypes", Value(types)}, {"affectedIds", Value(ids)}})};
}
void append_history(State& s, const std::string& label, const Array& commands, const std::vector<std::string>& affected) {
    s.history.push_back(history_item(label, commands, affected).front());
}
} // namespace

struct fl2d_session { std::shared_ptr<State> state; };
struct fl2d_prepared {
    std::weak_ptr<State> owner;
    std::unique_ptr<State> next;
    int64_t revision, counter;
    uint64_t generation;
    bool used = false, empty = false;
};

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_create(const uint8_t* bytes, uint32_t length, fl2d_session** result) {
    if (!result) return FL2D_INVALID_ARGUMENT;
    *result = nullptr;
    try {
        Value project;
        auto status = parse_project(bytes, length, project);
        if (status != FL2D_OK) return status;
        auto session = std::make_unique<fl2d_session>();
        session->state = std::make_shared<State>();
        session->state->project = std::move(project);
        *result = session.release();
        return FL2D_OK;
    } catch (const std::bad_alloc&) { return FL2D_OUT_OF_MEMORY; }
      catch (...) { return FL2D_INTERNAL_ERROR; }
}
extern "C" FL2D_API void FL2D_CALL fl2d_session_destroy(fl2d_session* session) { delete session; }
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_replace(fl2d_session* session, const uint8_t* bytes, uint32_t length, int32_t saved) {
    if (!session || (saved != 0 && saved != 1)) return FL2D_INVALID_ARGUMENT;
    try {
        Value project;
        auto status = parse_project(bytes, length, project);
        if (status != FL2D_OK) return record(*session->state, status);
        State next; next.project = std::move(project); next.saved = saved ? 0 : -1;
        next.generation = session->state->generation + 1;
        *session->state = std::move(next);
        return FL2D_OK;
    } catch (const std::bad_alloc&) { return record(*session->state, FL2D_OUT_OF_MEMORY); }
      catch (...) { return record(*session->state, FL2D_INTERNAL_ERROR); }
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_state_get(const fl2d_session* session, fl2d_session_state* result) {
    if (!session || !result) return FL2D_INVALID_ARGUMENT;
    const auto& s = *session->state;
    if (s.undo.size() > UINT32_MAX || s.redo.size() > UINT32_MAX || s.history.size() > UINT32_MAX) return FL2D_INTERNAL_ERROR;
    *result = {s.counter, s.current, s.saved, static_cast<uint32_t>(s.undo.size()),
        static_cast<uint32_t>(s.redo.size()), static_cast<uint32_t>(s.history.size()), s.current != s.saved ? 1u : 0u};
    return FL2D_OK;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_mark_saved(fl2d_session* session, int64_t revision) {
    if (!session) return FL2D_INVALID_ARGUMENT;
    auto& s = *session->state;
    if (revision < 0 || revision > s.counter) return record(s, FL2D_SAVED_REVISION_INVALID);
    s.saved = revision; return record(s, FL2D_OK);
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_node_string(const fl2d_session* session, const char* id, const char* field_name,
    char* buffer, uint32_t capacity, uint32_t* required) {
    if (!session || !id || !field_name) return FL2D_INVALID_ARGUMENT;
    auto* n = find_node(*session->state, id);
    if (!n) return FL2D_TARGET_NOT_FOUND;
    const Value& value = field(*n, field_name);
    if ((std::strcmp(field_name, "id") && std::strcmp(field_name, "displayName") &&
         std::strcmp(field_name, "kind") && std::strcmp(field_name, "parentId")) ||
        (!value.is<std::string>() && !(value.is<picojson::null>() && !std::strcmp(field_name, "parentId"))))
        return FL2D_INVALID_ARGUMENT;
    return copy(value.is<std::string>() ? value.get<std::string>() : "", buffer, capacity, required);
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_node_state(const fl2d_session* session, const char* id, fl2d_node_state* result) {
    if (!session || !id || !result) return FL2D_INVALID_ARGUMENT;
    auto* n = find_node(*session->state, id);
    if (!n) return FL2D_TARGET_NOT_FOUND;
    const auto& t = field(*n, "transform");
    const auto& p = field(t, "position"), &scale = field(t, "scale"), &pivot = field(t, "pivot");
    *result = {field(p, "x").get<double>(), field(p, "y").get<double>(), field(t, "rotation").get<double>(),
        field(scale, "x").get<double>(), field(scale, "y").get<double>(), field(pivot, "x").get<double>(),
        field(pivot, "y").get<double>(), field(*n, "opacity").get<double>(), field(*n, "visible") == Value(true) ? 1 : 0};
    return FL2D_OK;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_project_json(const fl2d_session* session, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!session) return FL2D_INVALID_ARGUMENT;
    try { return copy(session->state->project.serialize(), buffer, capacity, required); }
    catch (...) { return FL2D_INTERNAL_ERROR; }
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_history_json(const fl2d_session* session, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!session) return FL2D_INVALID_ARGUMENT;
    try { return copy(Value(session->state->history).serialize(), buffer, capacity, required); }
    catch (...) { return FL2D_INTERNAL_ERROR; }
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_error(const fl2d_session* session, char* buffer, uint32_t capacity, uint32_t* required) {
    return session ? copy(session->state->error, buffer, capacity, required) : FL2D_INVALID_ARGUMENT;
}

namespace {
fl2d_status prepare(fl2d_session* session, const Array& commands, const char* label, fl2d_prepared** result, int kind) {
    auto& current = *session->state;
    try {
        auto draft = std::make_unique<State>(current);
        Entry entry;
        if (kind == 0) {
            if (current.counter == max_js_revision) return record(current, FL2D_REVISION_EXHAUSTED);
            entry.label = label ? label : "Edit";
            entry.commands = commands;
            entry.before = current.current; entry.after = current.counter + 1;
        } else {
            const auto& stack = kind == 1 ? current.undo : current.redo;
            if (stack.empty()) {
                auto prepared = std::make_unique<fl2d_prepared>();
                prepared->owner = session->state;
                prepared->revision = current.current; prepared->counter = current.counter;
                prepared->generation = current.generation; prepared->empty = true;
                *result = prepared.release(); return record(current, FL2D_OK);
            }
            entry = stack.back();
        }
        const Array& operation = kind == 1 ? entry.inverses : entry.commands;
        Array inverses;
        std::vector<std::string> affected;
        std::set<std::string> seen;
        // JS validates the whole envelope batch before the first domain handler.
        for (const auto& cmd : operation) assert_command(cmd, kind == 1);
        for (const auto& cmd : operation) {
            auto [inverse, ids] = apply(draft->project, cmd);
            inverses.insert(inverses.begin(), std::move(inverse));
            for (const auto& id : ids) if (seen.insert(id).second) affected.push_back(id);
        }
        auto validation = validate_transaction_candidate(current.project, draft->project);
        if (validation != FL2D_OK) {
            current.error = validation == FL2D_PROJECT_INVALID ? "transaction.validation_failed" : error_name(validation);
            return validation;
        }
        if (kind == 0) {
            entry.inverses = std::move(inverses); entry.affected = affected;
            draft->counter = entry.after; draft->current = entry.after;
            draft->undo.push_back(entry); draft->redo.clear();
            append_history(*draft, entry.label, entry.commands, affected);
        } else if (kind == 1) {
            draft->undo.pop_back(); draft->redo.push_back(entry);
            draft->current = entry.before;
            append_history(*draft, "Undo: " + entry.label, entry.inverses, entry.affected);
        } else {
            draft->redo.pop_back(); draft->undo.push_back(entry);
            draft->current = entry.after;
            append_history(*draft, "Redo: " + entry.label, entry.commands, entry.affected);
        }
        auto prepared = std::make_unique<fl2d_prepared>();
        prepared->owner = session->state;
        prepared->next = std::move(draft);
        prepared->revision = current.current; prepared->counter = current.counter;
        prepared->generation = current.generation;
        *result = prepared.release();
        return record(current, FL2D_OK);
    } catch (const Failure& failure) { current.error = failure.code; return failure.status; }
      catch (const std::bad_alloc&) { return record(current, FL2D_OUT_OF_MEMORY); }
      catch (...) { return record(current, FL2D_INTERNAL_ERROR); }
}
} // namespace
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_prepare(fl2d_session* session, const uint8_t* bytes,
    uint32_t length, const char* label, fl2d_prepared** result) {
    if (!session || !result) return FL2D_INVALID_ARGUMENT;
    *result = nullptr;
    try {
        Array commands;
        auto status = parse_commands(bytes, length, commands);
        if (status != FL2D_OK) return record(*session->state, status);
        return prepare(session, commands, label, result, 0);
    } catch (const std::bad_alloc&) { return record(*session->state, FL2D_OUT_OF_MEMORY); }
      catch (...) { return record(*session->state, FL2D_INTERNAL_ERROR); }
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_prepare_undo(fl2d_session* session, fl2d_prepared** result) {
    if (!session || !result) return FL2D_INVALID_ARGUMENT;
    *result = nullptr; return prepare(session, {}, nullptr, result, 1);
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_session_prepare_redo(fl2d_session* session, fl2d_prepared** result) {
    if (!session || !result) return FL2D_INVALID_ARGUMENT;
    *result = nullptr; return prepare(session, {}, nullptr, result, 2);
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_prepared_commit(fl2d_prepared* prepared) {
    if (!prepared) return FL2D_INVALID_ARGUMENT;
    auto live = prepared->owner.lock();
    if (!live) return FL2D_INVALID_ARGUMENT;
    if (prepared->used || live->current != prepared->revision || live->counter != prepared->counter ||
        live->generation != prepared->generation) return record(*live, FL2D_REVISION_CONFLICT);
    prepared->used = true;
    if (!prepared->empty) {
        // markSaved does not change the JS stale-edit token. Keep that save point
        // if it happened after prepare but before commit.
        prepared->next->saved = live->saved;
        prepared->next->generation = live->generation + 1;
        *live = std::move(*prepared->next);
    }
    return record(*live, FL2D_OK);
}
extern "C" FL2D_API void FL2D_CALL fl2d_prepared_destroy(fl2d_prepared* prepared) { delete prepared; }
