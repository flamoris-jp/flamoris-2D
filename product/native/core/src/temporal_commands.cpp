#include "native_commands.h"
#include "js_text.h"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
namespace fl2d_commands {
Value command(const std::string& type, const Object& payload);
[[noreturn]] void fail(const char* code);
size_t insert_index(const Value& payload, size_t length);
namespace {
Array& collection(Value& project, const char* key) { return project.get<Object>().at(key).get<Array>(); }
Array& array(Value& object, const char* key) { return object.get<Object>().at(key).get<Array>(); }
std::string text(const Value& object, const char* key) { const auto& value = field(object, key); return value.is<std::string>() ? value.get<std::string>() : ""; }
size_t index(const Array& values, const Value& id, const char* key, const char* error) {
    auto at = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, key) == id; });
    if (at == values.end()) fail(error);
    return static_cast<size_t>(at - values.begin());
}
void sort_ids(Array& values) { std::stable_sort(values.begin(), values.end(), [](const Value& a, const Value& b) { return fl2d_text::less(text(a, "id"), text(b, "id")); }); }
double ordered_number(const Value& value) {
    if (!value.is<double>()) return 9007199254740991.0;
    const auto number = value.get<double>(); return std::floor(number) == number && std::abs(number) <= 9007199254740991.0 ? number : 9007199254740991.0;
}
void sort_items(Array& values, bool clips) {
    std::stable_sort(values.begin(), values.end(), [&](const Value& a, const Value& b) {
        for (auto key : {"startTicks", "endTicks", "layer"}) {
            if (!clips && std::string(key) == "layer") break;
            const double left = ordered_number(field(a, key)), right = ordered_number(field(b, key));
            if (left != right) return left < right;
        }
        return fl2d_text::less(text(a, "id"), text(b, "id"));
    });
}
bool falsy(const Value& value) {
    return value.is<picojson::null>() || value == Value(false) || value == Value(0.0) || value == Value("");
}
Value normalize_owner(Value value, bool sequence) {
    auto& object = value.get<Object>();
    if (falsy(field(value, "metadata"))) object["metadata"] = Value(Object{});
    if (sequence) for (const auto* key : {"viewLaneItems", "clipInstances"}) {
        if (falsy(field(value, key))) object[key] = Value(Array{});
        if (!field(value, key).is<Array>()) fail("project.invalid");
        sort_items(object.at(key).get<Array>(), std::string(key) == "clipInstances");
    }
    return value;
}
}
bool valid_temporal_ownership_change(const Value& before, const Value& after) {
    std::set<std::string> before_programs, after_programs;
    for (const auto& program : field(before, "temporalPrograms").get<Array>()) before_programs.insert(text(program, "id"));
    for (const auto& program : field(after, "temporalPrograms").get<Array>()) after_programs.insert(text(program, "id"));
    for (bool sequence : {true, false}) {
        const auto& old_owners = sequence ? field(before, "sequences").get<Array>() : field(field(before, "animation"), "clips").get<Array>();
        const auto& next_owners = sequence ? field(after, "sequences").get<Array>() : field(field(after, "animation"), "clips").get<Array>();
        std::map<std::string, std::string> old_by_id, next_by_id;
        for (const auto& owner : old_owners) old_by_id.emplace(text(owner, "id"), text(owner, "temporalProgramId"));
        for (const auto& owner : next_owners) next_by_id.emplace(text(owner, "id"), text(owner, "temporalProgramId"));
        for (const auto& [id, program] : old_by_id) {
            auto found = next_by_id.find(id);
            if (found != next_by_id.end() ? found->second != program : after_programs.count(program) != 0) return false;
        }
        for (const auto& [id, program] : next_by_id) if (!old_by_id.count(id) && before_programs.count(program)) return false;
    }
    return true;
}
bool apply_temporal(Value& project, const std::string& type, const Value& p, Applied& result) {
    static const std::set<std::string> types{"animation.temporal.set_duration", "animation.temporal.create_program", "animation.temporal.remove_program", "animation.temporal.restore_program", "animation.temporal.add_track", "animation.temporal.remove_track", "animation.temporal.restore_track", "animation.temporal.add_keyframe", "animation.temporal.update_keyframe", "animation.temporal.remove_keyframe", "animation.temporal.restore_keyframe", "animation.temporal.add_event", "animation.temporal.remove_event", "animation.temporal.restore_event", "animation.temporal.add_region", "animation.temporal.remove_region", "animation.temporal.restore_region"};
    if (!types.count(type)) return false;
    auto& programs = collection(project, "temporalPrograms");
    if (type == "animation.temporal.create_program") {
        if (std::any_of(programs.begin(), programs.end(), [&](const Value& value) { return field(value, "id") == field(p, "programId"); })) fail("identity.duplicate");
        programs.emplace_back(Object{{"id", field(p, "programId")}, {"durationTicks", field(p, "durationTicks")}, {"tracks", Value(Array{})}, {"events", Value(Array{})}, {"regions", Value(Array{})}});
        result = {command("animation.temporal.remove_program", Object{{"programId", field(p, "programId")}}), {text(p, "programId")}}; return true;
    }
    if (type == "animation.temporal.restore_program") {
        programs.insert(programs.begin() + insert_index(p, programs.size()), field(p, "program"));
        result = {command("animation.temporal.remove_program", Object{{"programId", field(field(p, "program"), "id")}}), {text(field(p, "program"), "id")}}; return true;
    }
    const auto program_index = index(programs, field(p, "programId"), "id", "animation.program_not_found");
    auto& program = programs[program_index]; const auto program_id = field(program, "id");
    if (type == "animation.temporal.remove_program") {
        auto inverse = command("animation.temporal.restore_program", Object{{"program", program}, {"index", Value(static_cast<double>(program_index))}});
        programs.erase(programs.begin() + program_index); result = {inverse, {program_id.get<std::string>()}}; return true;
    }
    if (type == "animation.temporal.set_duration") {
        auto inverse = command(type, Object{{"programId", program_id}, {"durationTicks", field(program, "durationTicks")}});
        program.get<Object>()["durationTicks"] = field(p, "durationTicks"); result = {inverse, {program_id.get<std::string>()}}; return true;
    }
    const bool keyframe = type.find("keyframe") != std::string::npos;
    const char* item = keyframe ? "keyframe" : type.find("track") != std::string::npos ? "track" : type.find("event") != std::string::npos ? "event" : "region";
    const std::string id_key = std::string(item) + "Id", prefix = std::string("animation.temporal.");
    Array* values = nullptr; Object base{{"programId", program_id}}; std::vector<std::string> affected{program_id.get<std::string>()};
    if (keyframe) {
        auto& tracks = array(program, "tracks"); auto& track = tracks[index(tracks, field(p, "trackId"), "trackId", "animation.track_not_found")];
        auto& channels = track.get<Object>().at("channels").get<Object>(); auto found = channels.find(text(p, "channel"));
        if (found == channels.end()) fail("animation.channel_not_found");
        values = &array(found->second, "keyframes"); base["trackId"] = field(track, "trackId"); base["channel"] = field(p, "channel"); affected.push_back(text(track, "trackId"));
    } else values = &array(program, std::string(std::string(item) + "s").c_str());
    const char* entity_key = std::string(item) == "track" ? "trackId" : "id";
    const char* error = keyframe ? "animation.keyframe_not_found" : std::string(item) == "track" ? "animation.track_not_found" : std::string(item) == "event" ? "animation.event_not_found" : "animation.region_not_found";
    if (type == prefix + "add_" + item || type == prefix + "restore_" + item) {
        const auto next = field(p, item);
        if (std::string(item) == "track" && type == prefix + "add_track" && std::any_of(values->begin(), values->end(), [&](const Value& value) { return field(value, "trackId") == field(next, "trackId"); })) fail("identity.duplicate");
        const auto position = type == prefix + "restore_" + item ? insert_index(p, values->size()) : values->size();
        values->insert(values->begin() + position, next); base[id_key] = field(next, entity_key); affected.push_back(text(next, entity_key));
        result = {command(prefix + "remove_" + item, base), affected}; return true;
    }
    const auto position = index(*values, field(p, id_key), entity_key, error); const auto previous = values->at(position);
    if (type == prefix + "update_keyframe") {
        if (field(field(p, "keyframe"), "id") != field(p, "keyframeId")) fail("animation.keyframe_identity_changed");
        base["keyframeId"] = field(p, "keyframeId"); base["keyframe"] = previous; values->at(position) = field(p, "keyframe"); affected.push_back(text(field(p, "keyframe"), "id"));
        result = {command(type, base), affected}; return true;
    }
    values->erase(values->begin() + position); base[item] = previous; base["index"] = Value(static_cast<double>(position)); affected.push_back(text(previous, entity_key));
    result = {command(prefix + "restore_" + item, base), affected}; return true;
}
bool apply_owners(Value& project, const std::string& type, const Value& p, Applied& result) {
    static const std::set<std::string> types{"animation.clip.create", "animation.clip.update", "animation.clip.remove", "animation.clip.remove_internal", "animation.clip.restore", "sequence.create", "sequence.update", "sequence.remove", "sequence.remove_internal", "sequence.restore", "sequence.add_view_item", "sequence.update_view_item", "sequence.remove_view_item", "sequence.remove_view_item_internal", "sequence.restore_view_item", "sequence.add_clip_instance", "sequence.update_clip_instance", "sequence.remove_clip_instance", "sequence.remove_clip_instance_internal", "sequence.restore_clip_instance"};
    if (!types.count(type)) return false;
    const bool sequence = type.rfind("sequence.", 0) == 0; const std::string prefix = sequence ? "sequence." : "animation.clip.";
    const char* owner = sequence ? "sequence" : "clip"; const char* id_key = sequence ? "sequenceId" : "clipId";
    auto& owners = sequence ? collection(project, "sequences") : array(project.get<Object>().at("animation"), "clips");
    if (type == prefix + "create" || type == prefix + "restore") {
        auto next = normalize_owner(field(p, owner), sequence); const auto id = field(next, "id");
        if (type == prefix + "create" && std::any_of(owners.begin(), owners.end(), [&](const Value& value) { return field(value, "id") == id; })) fail("identity.duplicate");
        owners.insert(owners.begin() + (type == prefix + "create" ? owners.size() : insert_index(p, owners.size())), next); sort_ids(owners);
        result = {command(prefix + "remove_internal", Object{{id_key, id}}), {text(next, "id"), text(next, "temporalProgramId")}}; return true;
    }
    const auto position = index(owners, field(p, id_key), "id", sequence ? "sequence.not_found" : "animation.clip_not_found"); auto& current = owners[position];
    const auto id = field(current, "id"), program = field(current, "temporalProgramId");
    if (type == prefix + "update") {
        auto next = normalize_owner(field(p, owner), sequence);
        if (field(next, "id") != field(p, id_key)) fail("identity.changed");
        if (field(next, "temporalProgramId") != program) fail(sequence ? "sequence.temporal_program_immutable" : "animation.clip_temporal_program_immutable");
        auto inverse = command(type, Object{{id_key, id}, {owner, current}}); current = next; sort_ids(owners);
        std::vector<std::string> affected{id.get<std::string>(), program.get<std::string>()}; if (sequence) affected.push_back(text(next, "temporalProgramId"));
        result = {inverse, affected}; return true;
    }
    if (type == prefix + "remove" || type == prefix + "remove_internal") {
        auto inverse = command(prefix + "restore", Object{{owner, current}, {"index", Value(static_cast<double>(position))}}); owners.erase(owners.begin() + position);
        result = {inverse, {id.get<std::string>(), program.get<std::string>()}}; return true;
    }
    const bool instance = type.find("clip_instance") != std::string::npos;
    const std::string item = instance ? "clip_instance" : "view_item"; const char* payload_key = instance ? "clipInstance" : "viewItem"; const char* item_id_key = instance ? "clipInstanceId" : "viewItemId";
    auto& values = array(current, instance ? "clipInstances" : "viewLaneItems"); Object base{{id_key, id}};
    if (type == prefix + "add_" + item || type == prefix + "restore_" + item) {
        const auto next = field(p, payload_key); const auto item_id = field(next, "id");
        if (type == prefix + "add_" + item && std::any_of(values.begin(), values.end(), [&](const Value& value) { return field(value, "id") == item_id; })) fail("identity.duplicate");
        values.insert(values.begin() + (type == prefix + "restore_" + item ? insert_index(p, values.size()) : values.size()), next); sort_items(values, instance); base[item_id_key] = item_id;
        std::vector<std::string> affected{id.get<std::string>(), text(next, "id")}; if (instance) affected.push_back(text(next, "clipId"));
        result = {command(prefix + "remove_" + item + "_internal", base), affected}; return true;
    }
    const auto item_index = index(values, field(p, item_id_key), "id", instance ? "sequence.clip_instance_not_found" : "sequence.view_item_not_found"); const auto previous = values[item_index];
    if (type == prefix + "update_" + item) {
        const auto next = field(p, payload_key); if (field(next, "id") != field(p, item_id_key)) fail("identity.changed");
        base[item_id_key] = field(previous, "id"); base[payload_key] = previous; values[item_index] = next; sort_items(values, instance);
        std::vector<std::string> affected{id.get<std::string>(), text(previous, "id")}; if (instance) { affected.push_back(text(previous, "clipId")); affected.push_back(text(next, "clipId")); }
        result = {command(type, base), affected}; return true;
    }
    base[payload_key] = previous; base["index"] = Value(static_cast<double>(item_index)); values.erase(values.begin() + item_index);
    std::vector<std::string> affected{id.get<std::string>(), text(previous, "id")}; if (instance) affected.push_back(text(previous, "clipId"));
    result = {command(prefix + "restore_" + item, base), affected}; return true;
}
}
