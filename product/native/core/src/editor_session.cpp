#include "flamoris2d_core.h"
#include "picojson.h"

#include <cmath>
#include <cctype>
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
bool nonblank(const Value& v) {
    if (!v.is<std::string>() || v.get<std::string>().empty()) return false;
    for (unsigned char c : v.get<std::string>()) if (!std::isspace(c)) return true;
    return false;
}
std::string trimmed(const std::string& text) {
    size_t begin = 0, end = text.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) --end;
    return text.substr(begin, end - begin);
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
// The snapshot loader is the focused native Project validator. It also enforces
// the interchange size, encoding and JSON syntax before any session mutation.
bool session_shape(const Value& project) {
    const Value& scene = field(project, "scene");
    const Value& nodes = field(scene, "nodes");
    if (!nodes.is<Object>()) return false;
    for (const auto& [key, node] : nodes.get<Object>()) {
        if (!node.is<Object>() || !field(node, "id").is<std::string>() ||
            field(node, "id").get<std::string>() != key || !field(node, "displayName").is<std::string>() ||
            !field(node, "visible").is<bool>() || !number(field(node, "opacity"))) return false;
        const Value& t = field(node, "transform");
        if (!point(field(t, "position")) || !number(field(t, "rotation")) ||
            !point(field(t, "scale")) || !point(field(t, "pivot"))) return false;
    }
    return true;
}
fl2d_status parse_project(const uint8_t* bytes, uint32_t length, Value& project) {
    fl2d_snapshot* snapshot = nullptr;
    auto status = fl2d_snapshot_load(bytes, length, &snapshot);
    if (status != FL2D_OK) return status;
    int32_t schema; double width, height; uint32_t nodes, issues;
    status = fl2d_snapshot_summary(snapshot, &schema, &width, &height, &nodes, &issues);
    fl2d_snapshot_destroy(snapshot);
    if (status != FL2D_OK) return status;
    if (issues) return FL2D_PROJECT_INVALID;
    std::string source(reinterpret_cast<const char*>(bytes), length), error;
    auto end = picojson::parse(project, source.begin(), source.end(), &error);
    if (!error.empty() || end != source.end()) return FL2D_MALFORMED_JSON;
    return session_shape(project) ? FL2D_OK : FL2D_PROJECT_INVALID;
}
fl2d_status validate_candidate(const Value& project) {
    const auto text = project.serialize();
    if (text.size() > FL2D_SNAPSHOT_MAX_BYTES) return FL2D_INPUT_TOO_LARGE;
    Value ignored;
    return parse_project(reinterpret_cast<const uint8_t*>(text.data()), static_cast<uint32_t>(text.size()), ignored);
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
std::pair<Value, std::string> apply(Value& project, const Value& cmd) {
    if (!exact(cmd, {"type", "payload"}) || !field(cmd, "type").is<std::string>())
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    const std::string type = field(cmd, "type").get<std::string>();
    if (type != "scene.rename_node" && type != "scene.set_visibility" && type != "scene.set_transform")
        throw Failure{FL2D_COMMAND_UNSUPPORTED, "command.unsupported"};
    const Value& payload = field(cmd, "payload");
    if (!payload.is<Object>() || !nonblank(field(payload, "nodeId")))
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    if (type == "scene.rename_node" && (!exact(payload, {"nodeId", "displayName"}) || !nonblank(field(payload, "displayName"))))
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    if (type == "scene.set_visibility" && (!exact(payload, {"nodeId", "visible"}) || !field(payload, "visible").is<bool>()))
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    if (type == "scene.set_transform" && (!exact(payload, {"nodeId", "coordinateSpace", "transform"}) ||
        field(payload, "coordinateSpace") != Value("node-local") || !transform(field(payload, "transform"))))
        throw Failure{FL2D_COMMAND_INVALID, "command.payload_invalid"};
    std::string id = field(payload, "nodeId").get<std::string>();
    Value& target = node(project, id);
    auto& properties = target.get<Object>();
    Object inverse{{"nodeId", Value(id)}};
    if (type == "scene.rename_node") {
        inverse["displayName"] = properties.at("displayName");
        std::string name = trimmed(field(payload, "displayName").get<std::string>());
        if (name.empty()) throw Failure{FL2D_COMMAND_INVALID, "scene.empty_display_name"};
        properties["displayName"] = Value(name);
    } else if (type == "scene.set_visibility") {
        inverse["visible"] = properties.at("visible");
        properties["visible"] = field(payload, "visible");
    } else {
        inverse["coordinateSpace"] = Value("node-local");
        inverse["transform"] = properties.at("transform");
        properties["transform"] = field(payload, "transform");
    }
    return {command(type, inverse), id};
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
        field(pivot, "y").get<double>(), field(*n, "opacity").get<double>(), field(*n, "visible").get<bool>() ? 1 : 0};
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
        for (const auto& cmd : operation) {
            auto [inverse, id] = apply(draft->project, cmd);
            inverses.insert(inverses.begin(), std::move(inverse));
            if (seen.insert(id).second) affected.push_back(id);
        }
        auto validation = validate_candidate(draft->project);
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
