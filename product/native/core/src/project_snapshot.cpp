#include "flamoris2d_core.h"
#include "picojson.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <new>
#include <numeric>
#include <set>
#include <string>
#include <utility>
#include <vector>

using Value = picojson::value;
using Object = picojson::object;
using Array = picojson::array;

namespace {
struct Issue { std::string code, path, entity, severity; };
struct Node {
    std::string id, kind, parent, name;
    bool null_parent = false, visible = false;
    std::vector<std::string> children;
    fl2d_node_state state{};
};
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
bool has(const Value& value, const std::string& key) {
    return value.is<Object>() && value.get<Object>().find(key) != value.get<Object>().end();
}
std::string str(const Value& value) { return value.is<std::string>() ? value.get<std::string>() : ""; }
bool finite(const Value& value) { return value.is<double>() && std::isfinite(value.get<double>()); }
bool exact(const Value& value, std::initializer_list<const char*> names) {
    if (!value.is<Object>() || value.get<Object>().size() != names.size()) return false;
    for (const auto name : names) if (!has(value, name)) return false;
    return true;
}
bool trim_space(uint32_t cp) {
    return (cp >= 9 && cp <= 13) || cp == 0x20 || cp == 0xA0 || cp == 0x1680 ||
        (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 ||
        cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF;
}
bool nonblank(const Value& value) {
    if (!value.is<std::string>()) return false;
    const auto& name = value.get<std::string>();
    for (size_t i = 0; i < name.size();) {
        const auto lead = static_cast<uint8_t>(name[i++]);
        uint32_t cp = lead;
        if (lead >= 0x80) {
            cp = lead < 0xE0 ? lead & 0x1F : lead < 0xF0 ? lead & 0x0F : lead & 0x07;
            const int following = lead < 0xE0 ? 1 : lead < 0xF0 ? 2 : 3;
            for (int j = 0; j < following; ++j) cp = (cp << 6) | (static_cast<uint8_t>(name[i++]) & 0x3F);
        }
        if (!trim_space(cp)) return true;
    }
    return false;
}
void add(Snapshot& s, const char* code, std::string path, std::string entity = {}, const char* severity = "error") {
    s.issues.push_back({code, std::move(path), std::move(entity), severity});
}
bool contains_id(const Value& values, const Value& id) {
    if (!values.is<Array>()) return false;
    for (const auto& value : values.get<Array>()) if (field(value, "id") == id) return true;
    return false;
}
bool safe_integer(const Value& value) {
    return finite(value) && std::floor(value.get<double>()) == value.get<double>() &&
        std::abs(value.get<double>()) <= 9007199254740991.0;
}
bool valid_time(const Value& value) { return safe_integer(value) && value.get<double>() >= 0; }
template <typename Register>
void validate_temporal_ownership(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& programs = field(project, "temporalPrograms");
    if (!programs.is<Array>()) { add(s, "collection.invalid", "temporalPrograms"); return; }
    struct Owner { std::string kind, id, path; };
    std::map<std::string, std::vector<Owner>> owners;
    auto collect = [&](const Value& values, const std::string& collection, const std::string& kind) {
        if (!values.is<Array>()) return;
        for (size_t i = 0; i < values.get<Array>().size(); ++i) {
            const Value& item = values.get<Array>()[i];
            const Value& program = field(item, "temporalProgramId");
            if (program.is<std::string>() && !program.get<std::string>().empty())
                owners[str(program)].push_back({kind, str(field(item, "id")),
                    collection + "." + std::to_string(i) + ".temporalProgramId"});
        }
    };
    collect(field(project, "transitions"), "transitions", "Transition");
    collect(field(field(project, "animation"), "clips"), "animation.clips", "AnimationClip");
    collect(field(project, "sequences"), "sequences", "Sequence");
    for (auto& [unused, entries] : owners) {
        (void)unused;
        if (entries.size() < 2) continue;
        std::sort(entries.begin(), entries.end(), [](const Owner& a, const Owner& b) {
            return a.kind == b.kind ? a.id < b.id : a.kind < b.kind;
        });
        for (const auto& entry : entries)
            add(s, "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT", entry.path, entry.id);
    }
    for (size_t i = 0; i < programs.get<Array>().size(); ++i) {
        const Value& program = programs.get<Array>()[i];
        const std::string path = "temporalPrograms." + std::to_string(i);
        const Value& id = field(program, "id");
        if (!program.is<Object>() || !id.is<std::string>() || str(id).empty()) {
            add(s, "identity.missing", path + ".id");
            continue;
        }
        register_id(id, path + ".id");
        if (!exact(program, {"id", "durationTicks", "tracks", "events", "regions"}))
            add(s, "ANIMATION_INVALID_PROGRAM", path, str(id));
        const Value& duration = field(program, "durationTicks");
        if (!valid_time(duration) || duration.get<double>() == 0)
            add(s, "ANIMATION_INVALID_DURATION", path + ".durationTicks", str(id));
        const Value& tracks = field(program, "tracks");
        const Value& events = field(program, "events");
        const Value& regions = field(program, "regions");
        if (!tracks.is<Array>() || !events.is<Array>() || !regions.is<Array>()) {
            add(s, "ANIMATION_INVALID_PROGRAM", path, str(id));
            continue;
        }
        const auto found = owners.find(str(id));
        const std::vector<Owner> empty;
        const auto& entries = found == owners.end() ? empty : found->second;
        const Owner* sole = entries.size() == 1 ? &entries[0] : nullptr;
        size_t camera_count = 0;
        for (size_t j = 0; j < tracks.get<Array>().size(); ++j) {
            const Value& track = tracks.get<Array>()[j];
            const std::string track_path = path + ".tracks." + std::to_string(j);
            const Value& track_id = field(track, "trackId");
            if (!track.is<Object>() || !track_id.is<std::string>() || str(track_id).empty()) {
                add(s, "identity.missing", track_path + ".trackId");
                continue;
            }
            register_id(track_id, track_path + ".trackId");
            if (!exact(track, {"trackId", "version", "kind", "target", "channels"}))
                add(s, "ANIMATION_INVALID_TRACK", track_path, str(track_id));
            const std::string kind = str(field(track, "kind"));
            const std::set<std::string> transition_kinds = {"GeometryBlendTrack", "AppearanceTrack", "OpacityTrack", "PresenceTrack", "DrawOrderTrack", "ClippingTrack"};
            const std::set<std::string> clip_kinds = {"TransformTrack", "BoneTrack", "DeformerTrack", "MeshDeformationTrack", "OpacityTrack", "PresenceTrack", "DrawOrderTrack", "ClippingTrack"};
            if (kind == "CameraTrack") ++camera_count;
            if ((kind == "CameraTrack" && (!sole || sole->kind != "Sequence")) ||
                (sole && sole->kind == "Sequence" && kind != "CameraTrack") ||
                (sole && sole->kind == "Transition" && !transition_kinds.count(kind)) ||
                (sole && sole->kind == "AnimationClip" && !clip_kinds.count(kind)))
                add(s, "ANIMATION_TRACK_OWNER_INVALID", track_path + ".kind", str(track_id).empty() ? str(id) : str(track_id));
        }
        if (sole && sole->kind == "Sequence" && camera_count > 1)
            add(s, "SEQUENCE_CAMERA_TRACK_MULTIPLE", path + ".tracks", sole->id);
        auto entries_validation = [&](const Value& values, const std::string& collection) {
            for (size_t j = 0; j < values.get<Array>().size(); ++j) {
                const Value& item = values.get<Array>()[j];
                const std::string item_path = path + "." + collection + "." + std::to_string(j);
                const Value& item_id = field(item, "id");
                if (!item.is<Object>() || !item_id.is<std::string>() || str(item_id).empty())
                    add(s, "identity.missing", item_path + ".id");
                else register_id(item_id, item_path + ".id");
            }
        };
        entries_validation(events, "events");
        entries_validation(regions, "regions");
    }
}
template <typename Register>
void validate_clipping(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& values = field(project, "clippingBindings");
    if (!values.is<Array>()) { add(s, "collection.invalid", "clippingBindings"); return; }
    const Value& nodes = field(field(project, "scene"), "nodes");
    std::map<std::string, std::string> targets;
    std::map<std::string, std::pair<std::string, std::string>> dependencies;
    for (size_t i = 0; i < values.get<Array>().size(); ++i) {
        const Value& binding = values.get<Array>()[i];
        const std::string path = "clippingBindings." + std::to_string(i);
        if (!binding.is<Object>()) { add(s, "CLIPPING_BINDING_INVALID", path); continue; }
        const std::string id = str(field(binding, "id"));
        const std::string target = str(field(binding, "targetNodeId"));
        const std::string source = str(field(binding, "sourceNodeId"));
        if (nonblank(field(binding, "id"))) register_id(field(binding, "id"), path + ".id");
        else add(s, "identity.missing", path + ".id");
        if (!exact(binding, {"enabled", "id", "mode", "sourceNodeId", "targetNodeId"}))
            add(s, "CLIPPING_BINDING_INVALID", path, id);
        auto found_node = [&](const std::string& node) {
            return nodes.is<Object>() && nodes.get<Object>().find(node) != nodes.get<Object>().end();
        };
        auto part_node = [&](const std::string& node) {
            return found_node(node) && str(field(field(nodes, node), "kind")) == "part";
        };
        if (!nonblank(field(binding, "targetNodeId")) || !found_node(target))
            add(s, "CLIPPING_TARGET_MISSING", path + ".targetNodeId", id);
        else if (!part_node(target)) add(s, "CLIPPING_TARGET_NOT_RENDERABLE", path + ".targetNodeId", id);
        if (!nonblank(field(binding, "sourceNodeId")) || !found_node(source))
            add(s, "CLIPPING_SOURCE_MISSING", path + ".sourceNodeId", id);
        else if (!part_node(source)) add(s, "CLIPPING_SOURCE_NOT_RENDERABLE", path + ".sourceNodeId", id);
        if (nonblank(field(binding, "targetNodeId")) && target == source)
            add(s, "CLIPPING_SELF_REFERENCE", path, id);
        if (str(field(binding, "mode")) != "inside") add(s, "CLIPPING_MODE_UNSUPPORTED", path + ".mode", id);
        const Value& enabled = field(binding, "enabled");
        if (!enabled.is<bool>()) add(s, "CLIPPING_BINDING_INVALID", path + ".enabled", id);
        if (nonblank(field(binding, "targetNodeId")) && !targets.emplace(target, id).second)
            add(s, "CLIPPING_TARGET_ALREADY_BOUND", path + ".targetNodeId", id);
        if (nonblank(field(binding, "id")) && nonblank(field(binding, "targetNodeId")) &&
            nonblank(field(binding, "sourceNodeId")) && str(field(binding, "mode")) == "inside" &&
            enabled.is<bool>() && enabled.get<bool>() && target != source && part_node(target) &&
            part_node(source) && !dependencies.count(target))
            dependencies.emplace(target, std::make_pair(source, id));
    }
    std::set<std::string> visited, cycle_keys;
    for (const auto& [start, unused] : dependencies) {
        (void)unused;
        std::vector<std::string> stack;
        std::map<std::string, size_t> position;
        std::string current = start;
        while (dependencies.count(current) && !visited.count(current)) {
            if (position.count(current)) {
                auto first = stack.begin() + static_cast<std::ptrdiff_t>(position[current]);
                std::string least;
                for (auto it = first; it != stack.end(); ++it) {
                    const auto& id = dependencies.at(*it).second;
                    if (least.empty() || id < least) least = id;
                }
                std::vector<std::string> nodes_in_cycle(first, stack.end());
                std::sort(nodes_in_cycle.begin(), nodes_in_cycle.end());
                std::string key;
                for (const auto& node : nodes_in_cycle) { key += node; key.push_back('\0'); }
                if (cycle_keys.insert(key).second) add(s, "CLIPPING_CYCLE", "clippingBindings", least);
                break;
            }
            position.emplace(current, stack.size());
            stack.push_back(current);
            current = dependencies.at(current).first;
        }
        visited.insert(stack.begin(), stack.end());
    }
}
const Value& find_id(const Value& values, const Value& id) {
    static const Value missing;
    if (values.is<Array>()) for (const auto& value : values.get<Array>())
        if (field(value, "id") == id) return value;
    return missing;
}
bool loop_value_equal(const Value& a, const Value& b, bool numeric) {
    if (numeric && finite(a) && finite(b)) return std::abs(a.get<double>() - b.get<double>()) <= 1e-9;
    if (a.is<Array>() && b.is<Array>()) {
        if (a.get<Array>().size() != b.get<Array>().size()) return false;
        for (size_t i = 0; i < a.get<Array>().size(); ++i)
            if (!loop_value_equal(a.get<Array>()[i], b.get<Array>()[i], numeric)) return false;
        return true;
    }
    if (a.is<Object>() && b.is<Object>()) {
        if (a.get<Object>().size() != b.get<Object>().size()) return false;
        for (const auto& [key, value] : a.get<Object>())
            if (!has(b, key) || !loop_value_equal(value, field(b, key), numeric)) return false;
        return true;
    }
    return a == b;
}
void validate_deformation_samples(Snapshot& s, const Value& project) {
    const Value& samples = field(field(project, "animation"), "deformationSamples");
    if (!samples.is<Array>()) { add(s, "collection.invalid", "animation.deformationSamples"); return; }
    const Value& meshes = field(project, "meshes");
    const Value& topologies = field(project, "meshTopologies");
    for (size_t i = 0; i < samples.get<Array>().size(); ++i) {
        const Value& sample = samples.get<Array>()[i];
        const std::string path = "animation.deformationSamples." + std::to_string(i);
        if (!sample.is<Object>()) { add(s, "ANIMATION_DEFORMATION_SAMPLE_INVALID", path); continue; }
        const std::string id = str(field(sample, "id"));
        if (!exact(sample, {"id", "meshId", "topologyId", "offsets"}))
            add(s, "ANIMATION_DEFORMATION_SAMPLE_INVALID", path, id);
        if (!nonblank(field(sample, "id"))) add(s, "identity.missing", path + ".id");
        if (!contains_id(meshes, field(sample, "meshId")))
            add(s, "ANIMATION_TRACK_TARGET_INVALID", path + ".meshId", id);
        const Value& topology = find_id(topologies, field(sample, "topologyId"));
        if (topology.is<picojson::null>())
            add(s, "ANIMATION_TOPOLOGY_INCOMPATIBLE", path + ".topologyId", id);
        const Value& offsets = field(sample, "offsets");
        if (!offsets.is<Array>()) { add(s, "ANIMATION_DEFORMATION_OFFSET_INVALID", path + ".offsets", id); continue; }
        std::set<std::string> seen;
        std::string previous;
        bool has_previous = false;
        const Value& vertices = field(topology, "vertexIds");
        for (size_t j = 0; j < offsets.get<Array>().size(); ++j) {
            const Value& offset = offsets.get<Array>()[j];
            const std::string offset_path = path + ".offsets." + std::to_string(j);
            const Value& vertex = field(offset, "vertexId");
            if (!exact(offset, {"vertexId", "dx", "dy"}) || !nonblank(vertex)) {
                add(s, "ANIMATION_DEFORMATION_OFFSET_INVALID", offset_path, id);
                continue;
            }
            const std::string vertex_id = str(vertex);
            bool found = false;
            if (vertices.is<Array>()) for (const auto& candidate : vertices.get<Array>()) if (candidate == vertex) found = true;
            if (!found) add(s, "ANIMATION_TOPOLOGY_INCOMPATIBLE", offset_path + ".vertexId", id);
            if (!seen.insert(vertex_id).second)
                add(s, "ANIMATION_DEFORMATION_VERTEX_DUPLICATE", offset_path + ".vertexId", id);
            if (has_previous && previous > vertex_id)
                add(s, "ANIMATION_DEFORMATION_VERTEX_ORDER_INVALID", path + ".offsets", id);
            previous = vertex_id;
            has_previous = true;
            const Value& dx = field(offset, "dx");
            const Value& dy = field(offset, "dy");
            if (!finite(dx) || !finite(dy) || (dx.get<double>() == 0 && dy.get<double>() == 0))
                add(s, "ANIMATION_DEFORMATION_OFFSET_INVALID", offset_path, id);
        }
    }
}
void validate_animation_clips(Snapshot& s, const Value& project) {
    const Value& clips = field(field(project, "animation"), "clips");
    if (!clips.is<Array>()) { add(s, "collection.invalid", "animation.clips"); return; }
    const Value& programs = field(project, "temporalPrograms");
    std::set<std::string> looping;
    for (const auto& clip : clips.get<Array>())
        if (str(field(clip, "defaultLoopMode")) == "loop") looping.insert(str(field(clip, "id")));
    const Value& sequences = field(project, "sequences");
    if (sequences.is<Array>()) for (const auto& sequence : sequences.get<Array>()) {
        const Value& instances = field(sequence, "clipInstances");
        if (instances.is<Array>()) for (const auto& instance : instances.get<Array>())
            if (str(field(instance, "loopMode")) == "loop" && field(instance, "clipId").is<std::string>())
                looping.insert(str(field(instance, "clipId")));
    }
    Array sorted = clips.get<Array>();
    std::stable_sort(sorted.begin(), sorted.end(), [](const Value& a, const Value& b) {
        return str(field(a, "id")) < str(field(b, "id"));
    });
    for (size_t i = 0; i < sorted.size(); ++i) {
        const Value& clip = sorted[i];
        const std::string path = "animation.clips." + std::to_string(i);
        if (!clip.is<Object>()) { add(s, "ANIMATION_CLIP_INVALID", path); continue; }
        const std::string id = str(field(clip, "id"));
        if (!exact(clip, {"id", "displayName", "temporalProgramId", "defaultLoopMode", "metadata"}))
            add(s, "ANIMATION_CLIP_INVALID", path, id);
        if (!nonblank(field(clip, "displayName")))
            add(s, "ANIMATION_CLIP_INVALID", path + ".displayName", id);
        const Value& program_id = field(clip, "temporalProgramId");
        if (!program_id.is<std::string>() || !contains_id(programs, program_id))
            add(s, "ANIMATION_CLIP_PROGRAM_REFERENCE_INVALID", path + ".temporalProgramId", id);
        const std::string loop = str(field(clip, "defaultLoopMode"));
        if (loop != "once" && loop != "loop")
            add(s, "ANIMATION_CLIP_LOOP_MODE_INVALID", path + ".defaultLoopMode", id);
        if (!field(clip, "metadata").is<Object>())
            add(s, "ANIMATION_CLIP_INVALID", path + ".metadata", id);
        const Value& program = find_id(programs, program_id);
        const Value& duration = field(program, "durationTicks");
        const Value& tracks = field(program, "tracks");
        if (!looping.count(id) || !safe_integer(duration) || duration.get<double>() <= 0 || !tracks.is<Array>()) continue;
        Array sorted_tracks = tracks.get<Array>();
        std::stable_sort(sorted_tracks.begin(), sorted_tracks.end(), [](const Value& a, const Value& b) {
            return str(field(a, "trackId")) < str(field(b, "trackId"));
        });
        for (const auto& track : sorted_tracks) {
            const std::string kind = str(field(track, "kind"));
            const Value& channels = field(track, "channels");
            if (!channels.is<Object>() || (kind != "GeometryBlendTrack" && kind != "AppearanceTrack" &&
                kind != "OpacityTrack" && kind != "PresenceTrack" && kind != "DrawOrderTrack" &&
                kind != "ClippingTrack" && kind != "TransformTrack" && kind != "BoneTrack" &&
                kind != "DeformerTrack" && kind != "CameraTrack" && kind != "MeshDeformationTrack")) continue;
            for (const auto& [channel_name, channel] : channels.get<Object>()) {
                const Value& keys = field(channel, "keyframes");
                if (!keys.is<Array>() || keys.get<Array>().empty()) continue;
                Array ordered = keys.get<Array>();
                bool valid = true;
                for (const auto& key : ordered) if (!valid_time(field(key, "timeTicks"))) valid = false;
                if (!valid) continue;
                std::stable_sort(ordered.begin(), ordered.end(), [](const Value& a, const Value& b) {
                    const double at = field(a, "timeTicks").get<double>();
                    const double bt = field(b, "timeTicks").get<double>();
                    return at == bt ? str(field(a, "id")) < str(field(b, "id")) : at < bt;
                });
                const bool numeric = kind == "GeometryBlendTrack" || kind == "AppearanceTrack" ||
                    kind == "OpacityTrack" || kind == "TransformTrack" || kind == "BoneTrack" ||
                    kind == "DeformerTrack" || kind == "CameraTrack";
                if (!loop_value_equal(field(ordered.front(), "value"), field(ordered.back(), "value"), numeric))
                    add(s, "ANIMATION_LOOP_ENDPOINT_MISMATCH", path + ".temporalProgramId", id, "warning");
            }
        }
    }
}
void validate_rotation_constraints(Snapshot& s, const Value& project) {
    const Value& rig = field(project, "rig");
    const Value& constraints = field(rig, "boneRotationConstraints");
    if (!constraints.is<Array>()) { add(s, "collection.invalid", "rig.boneRotationConstraints"); return; }
    const Value& bones = field(rig, "bones");
    std::map<std::string, std::string> enabled_by_bone;
    for (size_t i = 0; i < constraints.get<Array>().size(); ++i) {
        const Value& item = constraints.get<Array>()[i];
        const std::string path = "rig.boneRotationConstraints." + std::to_string(i);
        const std::string id = str(field(item, "id"));
        if (!exact(item, {"id", "boneId", "enabled", "minRotation", "maxRotation"}))
            add(s, "BONE_ROTATION_CONSTRAINT_INVALID", path, id);
        if (!nonblank(field(item, "id"))) add(s, "identity.missing", path + ".id");
        const Value& bone_id = field(item, "boneId");
        if (!nonblank(bone_id) || !contains_id(bones, bone_id))
            add(s, "BONE_ROTATION_CONSTRAINT_BONE_MISSING", path + ".boneId", id);
        const Value& enabled = field(item, "enabled");
        const Value& minimum = field(item, "minRotation");
        const Value& maximum = field(item, "maxRotation");
        if (!enabled.is<bool>() || !finite(minimum) || !finite(maximum) ||
            (finite(minimum) && finite(maximum) && minimum.get<double>() > maximum.get<double>()))
            add(s, "BONE_ROTATION_CONSTRAINT_INVALID", path, id);
        if (enabled.is<bool>() && enabled.get<bool>() && nonblank(bone_id)) {
            if (!enabled_by_bone.emplace(str(bone_id), id).second)
                add(s, "BONE_ROTATION_CONSTRAINT_CONFLICT", path + ".boneId", id);
        }
    }
}
void validate_ik_constraints(Snapshot& s, const Value& project) {
    const Value& rig = field(project, "rig");
    const Value& constraints = field(rig, "twoBoneIkConstraints");
    if (!constraints.is<Array>()) { add(s, "collection.invalid", "rig.twoBoneIkConstraints"); return; }
    const Value& bones = field(rig, "bones");
    const Value& nodes = field(field(project, "scene"), "nodes");
    std::map<std::string, std::string> enabled_end;
    auto contiguous = [](const Value& parent, const Value& child) {
        const Value& length = field(parent, "length");
        const Value& rest = field(child, "restLocalTransform");
        const Value& x = field(rest, "x"), &y = field(rest, "y");
        return finite(length) && finite(x) && finite(y) &&
            std::abs(x.get<double>() - length.get<double>()) <= 1e-9 && std::abs(y.get<double>()) <= 1e-9;
    };
    for (size_t i = 0; i < constraints.get<Array>().size(); ++i) {
        const Value& item = constraints.get<Array>()[i];
        const std::string path = "rig.twoBoneIkConstraints." + std::to_string(i);
        const std::string id = str(field(item, "id"));
        if (!exact(item, {"id", "rootBoneId", "midBoneId", "endBoneId", "enabled", "bendDirection"}))
            add(s, "TWO_BONE_IK_INVALID", path, id);
        if (!nonblank(field(item, "id"))) add(s, "identity.missing", path + ".id");
        const char* roles[] = {"root", "mid", "end"};
        const char* names[] = {"rootBoneId", "midBoneId", "endBoneId"};
        const Value* references[] = {&field(item, names[0]), &field(item, names[1]), &field(item, names[2])};
        std::set<std::string> unique;
        bool distinct = true, all_present = true;
        for (size_t j = 0; j < 3; ++j) {
            if (!nonblank(*references[j]) || !unique.insert(str(*references[j])).second) distinct = false;
            if (!contains_id(bones, *references[j])) {
                add(s, "TWO_BONE_IK_BONE_MISSING", path + "." + roles[j] + "BoneId", id);
                all_present = false;
            }
        }
        if (!distinct) add(s, "TWO_BONE_IK_BONES_INVALID", path, id);
        if (all_present) {
            const auto& mid_node = field(nodes, str(*references[1]));
            const auto& end_node = field(nodes, str(*references[2]));
            if (field(mid_node, "parentId") != *references[0] || field(end_node, "parentId") != *references[1])
                add(s, "TWO_BONE_IK_HIERARCHY_INVALID", path, id);
            if (!contiguous(find_id(bones, *references[0]), find_id(bones, *references[1])) ||
                !contiguous(find_id(bones, *references[1]), find_id(bones, *references[2])))
                add(s, "TWO_BONE_IK_CHAIN_GEOMETRY_INVALID", path, id);
        }
        const Value& enabled = field(item, "enabled");
        const std::string bend = str(field(item, "bendDirection"));
        if (!enabled.is<bool>() || (bend != "clockwise" && bend != "counterclockwise"))
            add(s, "TWO_BONE_IK_INVALID", path, id);
        if (enabled.is<bool>() && enabled.get<bool>() && nonblank(*references[2])) {
            if (!enabled_end.emplace(str(*references[2]), id).second)
                add(s, "TWO_BONE_IK_END_CONFLICT", path + ".endBoneId", id);
        }
    }
}
template <class Register>
void validate_rigid_bindings(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& rig = field(project, "rig");
    const Value& bindings = field(rig, "rigidBoneBindings");
    if (!bindings.is<Array>()) { add(s, "collection.invalid", "rig.rigidBoneBindings"); return; }
    const Value& nodes = field(field(project, "scene"), "nodes");
    const Value& bones = field(rig, "bones");
    std::set<std::string> skin_targets;
    const Value& skin = field(rig, "skinBindings");
    if (skin.is<Array>()) for (const auto& item : skin.get<Array>())
        if (field(item, "enabled").is<bool>() && field(item, "enabled").get<bool>() &&
            nonblank(field(item, "targetNodeId"))) skin_targets.insert(str(field(item, "targetNodeId")));
    // JS reports conflicts in target-ID order after validating individual bindings.
    std::vector<const Value*> enabled;
    for (size_t i = 0; i < bindings.get<Array>().size(); ++i) {
        const Value& item = bindings.get<Array>()[i];
        const std::string path = "rig.rigidBoneBindings." + std::to_string(i);
        if (!item.is<Object>()) { add(s, "RIGID_BINDING_TARGET_INVALID", path); continue; }
        const std::string id = str(field(item, "id"));
        if (nonblank(field(item, "id"))) register_id(field(item, "id"), path + ".id");
        else add(s, "identity.missing", path + ".id");
        if (!exact(item, {"id", "targetNodeId", "boneId", "enabled"}))
            add(s, "RIGID_BINDING_TARGET_INVALID", path, id);
        const Value& target_id = field(item, "targetNodeId");
        if (!nonblank(target_id) || str(field(field(nodes, str(target_id)), "kind")) != "part")
            add(s, "RIGID_BINDING_TARGET_INVALID", path + ".targetNodeId", id);
        const Value& bone_id = field(item, "boneId");
        if (!nonblank(bone_id) || !contains_id(bones, bone_id) ||
            str(field(field(nodes, str(bone_id)), "kind")) != "bone")
            add(s, "BONE_NODE_MISSING", path + ".boneId", id);
        const Value& active = field(item, "enabled");
        if (!active.is<bool>()) add(s, "RIGID_BINDING_TARGET_INVALID", path + ".enabled", id);
        if (active.is<bool>() && active.get<bool>() && nonblank(target_id)) enabled.push_back(&item);
    }
    std::stable_sort(enabled.begin(), enabled.end(), [](const Value* a, const Value* b) {
        const auto left = str(field(*a, "targetNodeId")), right = str(field(*b, "targetNodeId"));
        return left == right ? str(field(*a, "id")) < str(field(*b, "id")) : left < right;
    });
    std::map<std::string, std::string> by_target;
    for (const Value* item : enabled) {
        const std::string target = str(field(*item, "targetNodeId"));
        const std::string id = str(field(*item, "id"));
        const auto previous = by_target.find(target);
        if (previous != by_target.end() || skin_targets.count(target))
            add(s, "RIGID_BINDING_CONFLICT", "rig.rigidBoneBindings", previous != by_target.end() ? previous->second : id);
        else by_target.emplace(target, id);
    }
}
void validate_mesh_form_corrections(Snapshot& s, const Value& project) {
    const Value& values = field(project, "meshFormCorrectionKeyforms");
    if (!values.is<Array>()) { add(s, "collection.invalid", "meshFormCorrectionKeyforms"); return; }
    const Value& topologies = field(project, "meshTopologies");
    const Value& key_arts = field(project, "keyArts");
    const Value& slots = field(project, "semanticSlots");
    const Value& keyforms = field(project, "meshKeyforms");
    const Value& nodes = field(field(project, "scene"), "nodes");
    std::set<std::string> contexts;
    for (size_t i = 0; i < values.get<Array>().size(); ++i) {
        const Value& value = values.get<Array>()[i];
        const std::string path = "meshFormCorrectionKeyforms." + std::to_string(i);
        if (!value.is<Object>()) { add(s, "MESH_FORM_CORRECTION_INVALID", path); continue; }
        const std::string id = str(field(value, "id"));
        if (!nonblank(field(value, "id"))) add(s, "identity.missing", path + ".id");
        if (!exact(value, {"id", "topologyId", "keyArtId", "semanticSlotId", "vertexOffsets"}))
            add(s, "MESH_FORM_CORRECTION_INVALID", path, id);
        const Value& topology_id = field(value, "topologyId");
        const Value& key_art_id = field(value, "keyArtId");
        const Value& slot_id = field(value, "semanticSlotId");
        const Value& topology = find_id(topologies, topology_id);
        const Value& slot = find_id(slots, slot_id);
        if (topology.is<picojson::null>())
            add(s, "MESH_FORM_CORRECTION_TOPOLOGY_MISSING", path + ".topologyId", id);
        if (!contains_id(key_arts, key_art_id))
            add(s, "MESH_FORM_CORRECTION_KEY_ART_MISSING", path + ".keyArtId", id);
        if (!contains_id(slots, slot_id))
            add(s, "MESH_FORM_CORRECTION_SEMANTIC_SLOT_MISSING", path + ".semanticSlotId", id);
        const std::string context = topology_id.serialize() + std::string(1, '\0') +
            key_art_id.serialize() + std::string(1, '\0') + slot_id.serialize();
        if (!contexts.insert(context).second)
            add(s, "MESH_FORM_CORRECTION_CONTEXT_DUPLICATE", path, id);
        bool compatible = false;
        if (keyforms.is<Array>()) for (const auto& item : keyforms.get<Array>())
            if (field(item, "topologyId") == topology_id && field(item, "keyArtId") == key_art_id &&
                field(item, "semanticSlotId") == slot_id) compatible = true;
        if (!compatible) add(s, "MESH_FORM_CORRECTION_CONTEXT_INCOMPATIBLE", path, id);
        if (slot.is<Object>() && contains_id(key_arts, key_art_id)) {
            bool mapped = false;
            const Value& mappings = field(slot, "mappings");
            if (mappings.is<Array>()) for (const auto& item : mappings.get<Array>())
                if (field(item, "keyArtId") == key_art_id &&
                    str(field(field(nodes, str(field(item, "nodeId"))), "kind")) == "part") mapped = true;
            if (!mapped) add(s, "MESH_FORM_CORRECTION_MAPPING_INCOMPATIBLE", path, id);
        }
        const Value& offsets = field(value, "vertexOffsets");
        if (!offsets.is<Array>()) { add(s, "MESH_FORM_CORRECTION_VERTEX_INVALID", path + ".vertexOffsets", id); continue; }
        const Value& vertices = field(topology, "vertexIds");
        std::set<std::string> seen;
        std::string previous;
        bool has_previous = false;
        for (size_t j = 0; j < offsets.get<Array>().size(); ++j) {
            const Value& item = offsets.get<Array>()[j];
            const std::string item_path = path + ".vertexOffsets." + std::to_string(j);
            if (!exact(item, {"vertexId", "x", "y"})) {
                add(s, "MESH_FORM_CORRECTION_VERTEX_INVALID", item_path, id); continue;
            }
            const Value& vertex = field(item, "vertexId");
            bool found = false;
            if (vertices.is<Array>()) for (const auto& candidate : vertices.get<Array>())
                if (candidate == vertex) found = true;
            if (!found) add(s, "MESH_FORM_CORRECTION_VERTEX_MISSING", item_path + ".vertexId", id);
            const std::string vertex_id = str(vertex);
            if (!seen.insert(vertex_id).second)
                add(s, "MESH_FORM_CORRECTION_VERTEX_DUPLICATE", item_path + ".vertexId", id);
            if (has_previous && previous > vertex_id)
                add(s, "MESH_FORM_CORRECTION_VERTEX_ORDER_INVALID", path + ".vertexOffsets", id);
            previous = vertex_id;
            has_previous = true;
            const Value& x = field(item, "x"), &y = field(item, "y");
            if (!finite(x) || !finite(y)) add(s, "MESH_FORM_CORRECTION_OFFSET_INVALID", item_path, id);
            else if (x.get<double>() == 0 && y.get<double>() == 0)
                add(s, "MESH_FORM_CORRECTION_ZERO_OFFSET", item_path, id);
        }
    }
}
void validate_bones(Snapshot& s, const Value& project) {
    const Value& rig = field(project, "rig");
    if (!rig.is<Object>()) { add(s, "collection.invalid", "rig"); return; }
    const Value& bones = field(rig, "bones"), &poses = field(rig, "bonePoseKeyforms");
    if (!bones.is<Array>()) add(s, "collection.invalid", "rig.bones");
    if (!poses.is<Array>()) add(s, "collection.invalid", "rig.bonePoseKeyforms");
    if (!bones.is<Array>() || !poses.is<Array>()) return;
    const Value& nodes = field(field(project, "scene"), "nodes");
    const Value& key_arts = field(project, "keyArts");
    std::map<std::string, const Value*> by_id;
    auto local_transform = [](const Value& value) {
        return exact(value, {"x", "y", "rotation"}) && finite(field(value, "x")) &&
            finite(field(value, "y")) && finite(field(value, "rotation"));
    };
    for (size_t i = 0; i < bones.get<Array>().size(); ++i) {
        const Value& bone = bones.get<Array>()[i];
        const std::string path = "rig.bones." + std::to_string(i);
        if (!bone.is<Object>()) { add(s, "BONE_REST_INVALID", path); continue; }
        const Value& bone_id = field(bone, "id");
        const std::string id = str(bone_id);
        if (!exact(bone, {"id", "parentNodeId", "restLocalTransform", "length", "enabled"}))
            add(s, "BONE_REST_INVALID", path, id);
        if (!nonblank(bone_id)) add(s, "identity.missing", path + ".id");
        else if (!by_id.emplace(id, &bone).second) add(s, "identity.duplicate", path + ".id", id);
        const Value& node = field(nodes, id);
        if (node.is<picojson::null>()) add(s, "BONE_NODE_MISSING", path + ".id", id);
        else if (str(field(node, "kind")) != "bone") add(s, "BONE_SCENE_IDENTITY_MISMATCH", path + ".id", id);
        const Value& parent_id = field(bone, "parentNodeId");
        const Value& parent = field(nodes, str(parent_id));
        if (!nonblank(parent_id) || parent.is<picojson::null>())
            add(s, "BONE_PARENT_INVALID", path + ".parentNodeId", id);
        else {
            const std::string kind = str(field(parent, "kind"));
            if (kind != "group" && kind != "deformer" && kind != "bone")
                add(s, "BONE_PARENT_INVALID", path + ".parentNodeId", id);
        }
        if (!node.is<picojson::null>() && field(node, "parentId") != parent_id)
            add(s, "BONE_SCENE_IDENTITY_MISMATCH", path + ".parentNodeId", id);
        const Value& rest = field(bone, "restLocalTransform");
        if (str(field(node, "kind")) == "bone") {
            const Value& transform = field(node, "transform");
            const Value& position = field(transform, "position");
            const Value& scale = field(transform, "scale"), &pivot = field(transform, "pivot");
            auto eq_one = [](const Value& v) { return finite(v) && v.get<double>() == 1; };
            auto eq_zero = [](const Value& v) { return finite(v) && v.get<double>() == 0; };
            if (field(position, "x") != field(rest, "x") || field(position, "y") != field(rest, "y") ||
                field(transform, "rotation") != field(rest, "rotation") ||
                !eq_one(field(scale, "x")) || !eq_one(field(scale, "y")) ||
                !eq_zero(field(pivot, "x")) || !eq_zero(field(pivot, "y")))
                add(s, "BONE_SCENE_IDENTITY_MISMATCH", path + ".restLocalTransform", id);
        }
        if (!local_transform(rest)) add(s, "BONE_REST_INVALID", path + ".restLocalTransform", id);
        const Value& length = field(bone, "length");
        if (!finite(length) || length.get<double>() <= 0) add(s, "BONE_LENGTH_INVALID", path + ".length", id);
        if (!field(bone, "enabled").is<bool>()) add(s, "BONE_REST_INVALID", path + ".enabled", id);
    }
    for (const auto& bone : bones.get<Array>()) {
        const Value& parent = field(nodes, str(field(bone, "parentNodeId")));
        if (str(field(parent, "kind")) == "bone" && !by_id.count(str(field(parent, "id"))))
            add(s, "BONE_PARENT_INVALID", "rig.bones." + str(field(bone, "id")) + ".parentNodeId", str(field(bone, "id")));
    }
    if (nodes.is<Object>()) for (const auto& [key, node] : nodes.get<Object>()) {
        (void)key;
        if (str(field(node, "kind")) != "bone") continue;
        const std::string id = str(field(node, "id"));
        if (!by_id.count(id)) add(s, "BONE_NODE_MISSING", "scene.nodes." + id, id);
        const Value& children = field(node, "children");
        if (children.is<Array>()) for (const auto& child : children.get<Array>())
            if (str(field(field(nodes, str(child)), "kind")) != "bone")
                add(s, "BONE_PARENT_INVALID", "scene.nodes." + id + ".children", id);
    }
    for (const auto& bone : bones.get<Array>()) {
        std::set<std::string> visited;
        const std::string bone_id = str(field(bone, "id"));
        const Value* current = &field(nodes, bone_id);
        while (str(field(*current, "kind")) == "bone") {
            const std::string id = str(field(*current, "id"));
            if (!visited.insert(id).second) {
                add(s, "BONE_HIERARCHY_CYCLE", "scene.nodes." + id, bone_id); break;
            }
            current = &field(nodes, str(field(*current, "parentId")));
        }
    }
    std::set<std::string> pose_keys;
    for (size_t i = 0; i < poses.get<Array>().size(); ++i) {
        const Value& pose = poses.get<Array>()[i];
        const std::string path = "rig.bonePoseKeyforms." + std::to_string(i);
        const std::string id = str(field(pose, "boneId"));
        if (!exact(pose, {"boneId", "keyArtId", "localDelta"})) add(s, "BONE_POSE_INVALID", path, id);
        const std::string key = id + std::string(1, '\0') + str(field(pose, "keyArtId"));
        if (!pose_keys.insert(key).second) add(s, "BONE_POSE_INVALID", path, id);
        if (!by_id.count(id)) add(s, "BONE_NODE_MISSING", path + ".boneId", id);
        if (!contains_id(key_arts, field(pose, "keyArtId")))
            add(s, "BONE_KEYART_REFERENCE_INVALID", path + ".keyArtId", id);
        if (!local_transform(field(pose, "localDelta")))
            add(s, "BONE_POSE_INVALID", path + ".localDelta", id);
    }
}
template <class Register>
void validate_warp(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& rig = field(project, "rig"), &nodes = field(field(project, "scene"), "nodes");
    if (!rig.is<Object>()) { add(s, "collection.invalid", "rig"); return; }
    const Value& deformers = field(rig, "deformers"), &points = field(rig, "warpControlPoints");
    const Value& keyforms = field(rig, "warpDeformerKeyforms");
    if (!deformers.is<Array>()) add(s, "collection.invalid", "rig.deformers");
    if (!points.is<Array>()) add(s, "collection.invalid", "rig.warpControlPoints");
    if (!keyforms.is<Array>()) add(s, "collection.invalid", "rig.warpDeformerKeyforms");
    if (!deformers.is<Array>() || !points.is<Array>() || !keyforms.is<Array>()) return;
    auto grid = [](const Value& value) {
        const Value& columns = field(value, "columns"), &rows = field(value, "rows");
        return finite(columns) && columns == rows &&
            (columns.get<double>() == 2 || columns.get<double>() == 3 || columns.get<double>() == 4);
    };
    std::map<std::string, const Value*> by_deformer, by_point;
    for (size_t i = 0; i < deformers.get<Array>().size(); ++i) {
        const Value& item = deformers.get<Array>()[i];
        const std::string path = "rig.deformers." + std::to_string(i);
        const std::string id = str(field(item, "id"));
        if (id.empty()) { add(s, "identity.missing", path + ".id"); continue; }
        if (!by_deformer.emplace(id, &item).second) add(s, "identity.duplicate", path + ".id", id);
        const Value& node = field(nodes, id);
        if (str(field(node, "kind")) != "deformer") add(s, "DEFORMER_CHILD_REFERENCE_INVALID", path + ".id", id);
        const Value& parent = field(nodes, str(field(item, "parentNodeId")));
        if (parent.is<picojson::null>()) add(s, "DEFORMER_PARENT_MISSING", path + ".parentNodeId", id);
        else if (!node.is<picojson::null>() && field(node, "parentId") != field(item, "parentNodeId"))
            add(s, "DEFORMER_CHILD_REFERENCE_INVALID", path + ".parentNodeId", id);
        if (str(field(item, "type")) != "warp") add(s, "DEFORMER_TYPE_INVALID", path + ".type", id);
        if (!nonblank(field(item, "displayName")))
            add(s, "DEFORMER_CONTROL_POINT_INVALID", path + ".displayName", id);
        else if (!node.is<picojson::null>() && field(node, "displayName") != field(item, "displayName"))
            add(s, "DEFORMER_CHILD_REFERENCE_INVALID", path + ".displayName", id);
        if (!grid(item)) add(s, "DEFORMER_CONTROL_POINT_INVALID", path + ".columns", id);
        const Value& bounds = field(item, "bounds");
        const Value& left = field(bounds, "left"), &top = field(bounds, "top");
        const Value& right = field(bounds, "right"), &bottom = field(bounds, "bottom");
        if (!finite(left) || !finite(top) || !finite(right) || !finite(bottom) ||
            (finite(left) && finite(right) && right.get<double>() <= left.get<double>()) ||
            (finite(top) && finite(bottom) && bottom.get<double>() <= top.get<double>()))
            add(s, "DEFORMER_CONTROL_POINT_INVALID", path + ".bounds", id);
        const Value& ids = field(item, "controlPointIds");
        std::set<std::string> unique;
        if (ids.is<Array>()) for (const auto& point : ids.get<Array>()) unique.insert(point.serialize());
        if (!ids.is<Array>() || !finite(field(item, "columns")) || !finite(field(item, "rows")) ||
            ids.get<Array>().size() != field(item, "columns").get<double>() * field(item, "rows").get<double>() ||
            unique.size() != ids.get<Array>().size())
            add(s, "DEFORMER_CONTROL_POINT_INVALID", path + ".controlPointIds", id);
    }
    for (size_t i = 0; i < points.get<Array>().size(); ++i) {
        const Value& point = points.get<Array>()[i];
        const std::string path = "rig.warpControlPoints." + std::to_string(i);
        const Value& point_id = field(point, "id");
        register_id(point_id, path + ".id");
        const std::string id = str(point_id);
        if (id.empty()) continue;
        if (!by_point.emplace(id, &point).second) {
            add(s, "DEFORMER_CONTROL_POINT_INVALID", path + ".id", id); continue;
        }
        const Value& u = field(point, "u"), &v = field(point, "v");
        if (!by_deformer.count(str(field(point, "deformerId"))) || !finite(u) || !finite(v) ||
            (finite(u) && (u.get<double>() < 0 || u.get<double>() > 1)) ||
            (finite(v) && (v.get<double>() < 0 || v.get<double>() > 1)))
            add(s, "DEFORMER_CONTROL_POINT_INVALID", path, id);
    }
    for (size_t i = 0; i < deformers.get<Array>().size(); ++i) {
        const Value& deformer = deformers.get<Array>()[i];
        const Value& ids = field(deformer, "controlPointIds");
        if (!ids.is<Array>() || !grid(deformer)) continue;
        const int columns = static_cast<int>(field(deformer, "columns").get<double>());
        const int rows = static_cast<int>(field(deformer, "rows").get<double>());
        for (size_t j = 0; j < ids.get<Array>().size(); ++j) {
            const auto found = by_point.find(str(ids.get<Array>()[j]));
            const Value& entry = found == by_point.end() ? Value() : *found->second;
            const Value& u = field(entry, "u"), &v = field(entry, "v");
            if (found == by_point.end() || field(entry, "deformerId") != field(deformer, "id") ||
                !finite(u) || !finite(v) || u.get<double>() != static_cast<double>(j % columns) / (columns - 1) ||
                v.get<double>() != static_cast<double>(j / columns) / (rows - 1))
                add(s, "DEFORMER_CONTROL_POINT_INVALID", "rig.deformers." + std::to_string(i) +
                    ".controlPointIds." + std::to_string(j), str(field(deformer, "id")));
        }
    }
    for (const auto& [id, point] : by_point) {
        const auto owner = by_deformer.find(str(field(*point, "deformerId")));
        if (owner != by_deformer.end()) {
            const Value& ids = field(*owner->second, "controlPointIds");
            bool included = false;
            if (ids.is<Array>()) for (const auto& candidate : ids.get<Array>()) if (candidate == field(*point, "id")) included = true;
            if (!included) add(s, "DEFORMER_CONTROL_POINT_INVALID", "rig.warpControlPoints." + id, id);
        }
    }
    std::set<std::string> keys;
    for (size_t i = 0; i < keyforms.get<Array>().size(); ++i) {
        const Value& keyform = keyforms.get<Array>()[i];
        const std::string path = "rig.warpDeformerKeyforms." + std::to_string(i);
        const std::string id = str(field(keyform, "deformerId"));
        if (!keys.insert(id + std::string(1, '\0') + str(field(keyform, "keyArtId"))).second)
            add(s, "DEFORMER_KEYFORM_INCOMPATIBLE", path, id);
        const auto deformer = by_deformer.find(id);
        if (deformer == by_deformer.end() || !contains_id(field(project, "keyArts"), field(keyform, "keyArtId"))) {
            add(s, "DEFORMER_KEYFORM_INCOMPATIBLE", path, id); continue;
        }
        const Value& positions = field(keyform, "controlPoints");
        const Value& ids = field(*deformer->second, "controlPointIds");
        std::set<std::string> position_ids;
        if (positions.is<Array>()) for (const auto& entry : positions.get<Array>()) position_ids.insert(field(entry, "controlPointId").serialize());
        bool invalid = !positions.is<Array>() || !ids.is<Array>() ||
            positions.get<Array>().size() != ids.get<Array>().size() || position_ids.size() != positions.get<Array>().size();
        if (!invalid) for (const auto& entry : positions.get<Array>()) {
            bool found = false;
            for (const auto& candidate : ids.get<Array>()) if (candidate == field(entry, "controlPointId")) found = true;
            if (!found) invalid = true;
        }
        if (invalid) add(s, "DEFORMER_KEYFORM_INCOMPATIBLE", path + ".controlPoints", id);
        if (positions.is<Array>()) for (size_t j = 0; j < positions.get<Array>().size(); ++j) {
            const Value& entry = positions.get<Array>()[j];
            if (!finite(field(entry, "x")) || !finite(field(entry, "y")))
                add(s, "DEFORMER_CONTROL_POINT_INVALID", path + ".controlPoints." + std::to_string(j), id);
        }
    }
    if (nodes.is<Object>()) for (const auto& [key, node] : nodes.get<Object>()) {
        (void)key;
        if (str(field(node, "kind")) == "deformer" && !by_deformer.count(str(field(node, "id"))))
            add(s, "DEFORMER_CHILD_REFERENCE_INVALID", "scene.nodes." + str(field(node, "id")), str(field(node, "id")));
    }
    for (const auto& deformer : deformers.get<Array>()) {
        std::set<std::string> seen;
        const std::string original = str(field(deformer, "id"));
        const Value* node = &field(nodes, original);
        while (!str(field(*node, "parentId")).empty()) {
            const std::string id = str(field(*node, "id"));
            if (!seen.insert(id).second) { add(s, "DEFORMER_CYCLE", "scene.nodes." + id, original); break; }
            node = &field(nodes, str(field(*node, "parentId")));
        }
    }
}
template <class Register>
void validate_skin(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& rig = field(project, "rig"), &bindings = field(rig, "skinBindings");
    if (!bindings.is<Array>()) { add(s, "collection.invalid", "rig.skinBindings"); return; }
    const Value& nodes = field(field(project, "scene"), "nodes");
    const Value& topologies = field(project, "meshTopologies"), &bones = field(rig, "bones");
    const Value& slots = field(project, "semanticSlots"), &keyforms = field(project, "meshKeyforms");
    std::map<std::string, std::string> enabled_targets;
    for (size_t i = 0; i < bindings.get<Array>().size(); ++i) {
        const Value& binding = bindings.get<Array>()[i];
        const std::string path = "rig.skinBindings." + std::to_string(i);
        if (!binding.is<Object>()) { add(s, "SKIN_BINDING_TARGET_INVALID", path); continue; }
        const Value& id_value = field(binding, "id");
        const std::string id = str(id_value);
        if (nonblank(id_value)) register_id(id_value, path + ".id");
        else add(s, "identity.missing", path + ".id");
        if (!exact(binding, {"id", "targetNodeId", "topologyId", "enabled", "vertexWeights"}))
            add(s, "SKIN_BINDING_TARGET_INVALID", path, id);
        const Value& target_id = field(binding, "targetNodeId");
        const Value& target = field(nodes, str(target_id));
        if (!nonblank(target_id) || target.is<picojson::null>())
            add(s, "SKIN_BINDING_TARGET_MISSING", path + ".targetNodeId", id);
        else if (str(field(target, "kind")) != "part")
            add(s, "SKIN_BINDING_TARGET_INVALID", path + ".targetNodeId", id);
        const Value& topology_id = field(binding, "topologyId");
        const Value& topology = find_id(topologies, topology_id);
        if (!nonblank(topology_id) || topology.is<picojson::null>())
            add(s, "SKIN_BINDING_TOPOLOGY_MISSING", path + ".topologyId", id);
        else if (str(field(target, "kind")) == "part") {
            std::set<std::string> related_art;
            if (slots.is<Array>()) for (const auto& slot : slots.get<Array>()) {
                const Value& mappings = field(slot, "mappings");
                if (mappings.is<Array>()) for (const auto& mapping : mappings.get<Array>())
                    if (field(mapping, "nodeId") == target_id)
                        related_art.insert(str(field(slot, "id")) + std::string(1, '\0') + str(field(mapping, "keyArtId")));
            }
            std::set<std::string> evaluated;
            if (keyforms.is<Array>()) for (const auto& item : keyforms.get<Array>())
                if (related_art.count(str(field(item, "semanticSlotId")) + std::string(1, '\0') +
                    str(field(item, "keyArtId")))) evaluated.insert(str(field(item, "topologyId")));
            if (evaluated.empty() || evaluated.size() != 1 || !evaluated.count(str(topology_id)))
                add(s, "SKIN_BINDING_TOPOLOGY_TARGET_MISMATCH", path + ".topologyId", id);
        }
        const Value& active = field(binding, "enabled");
        if (!active.is<bool>()) add(s, "SKIN_BINDING_TARGET_INVALID", path + ".enabled", id);
        if (active.is<bool>() && active.get<bool>() && nonblank(target_id) &&
            !enabled_targets.emplace(str(target_id), id).second)
            add(s, "SKIN_BINDING_TARGET_CONFLICT", "rig.skinBindings", id);
        const Value& weights = field(binding, "vertexWeights");
        if (!weights.is<Array>()) { add(s, "SKIN_BINDING_VERTEX_INVALID", path + ".vertexWeights", id); continue; }
        const Value& vertices = field(topology, "vertexIds");
        std::set<std::string> vertex_ids;
        if (vertices.is<Array>()) for (const auto& vertex : vertices.get<Array>()) vertex_ids.insert(str(vertex));
        std::set<std::string> weighted;
        std::string previous_vertex;
        bool has_previous_vertex = false;
        for (size_t j = 0; j < weights.get<Array>().size(); ++j) {
            const Value& weight = weights.get<Array>()[j];
            const std::string weight_path = path + ".vertexWeights." + std::to_string(j);
            if (!exact(weight, {"vertexId", "influences"})) {
                add(s, "SKIN_BINDING_VERTEX_INVALID", weight_path, id); continue;
            }
            const Value& vertex_value = field(weight, "vertexId");
            const std::string vertex = str(vertex_value);
            if (!nonblank(vertex_value) || !vertex_ids.count(vertex))
                add(s, "SKIN_BINDING_VERTEX_MISSING", weight_path + ".vertexId", id);
            if (!weighted.insert(vertex).second)
                add(s, "SKIN_BINDING_VERTEX_DUPLICATE", weight_path + ".vertexId", id);
            if (has_previous_vertex && previous_vertex > vertex)
                add(s, "SKIN_BINDING_VERTEX_ORDER_INVALID", path + ".vertexWeights", id);
            previous_vertex = vertex; has_previous_vertex = true;
            const Value& influences = field(weight, "influences");
            if (!influences.is<Array>() || influences.get<Array>().empty() || influences.get<Array>().size() > 4) {
                add(s, "SKIN_BINDING_INFLUENCE_COUNT_INVALID", weight_path + ".influences", id); continue;
            }
            std::set<std::string> seen_bones, roots;
            std::string previous_bone;
            bool has_previous_bone = false, weights_valid = true;
            double sum = 0;
            for (size_t k = 0; k < influences.get<Array>().size(); ++k) {
                const Value& influence = influences.get<Array>()[k];
                const std::string influence_path = weight_path + ".influences." + std::to_string(k);
                if (!exact(influence, {"boneId", "weight"})) {
                    add(s, "SKIN_BINDING_INFLUENCE_INVALID", influence_path, id); continue;
                }
                const Value& bone_value = field(influence, "boneId");
                const std::string bone_id = str(bone_value);
                if (!seen_bones.insert(bone_id).second)
                    add(s, "SKIN_BINDING_INFLUENCE_DUPLICATE", influence_path + ".boneId", id);
                if (has_previous_bone && previous_bone > bone_id)
                    add(s, "SKIN_BINDING_INFLUENCE_ORDER_INVALID", weight_path + ".influences", id);
                previous_bone = bone_id; has_previous_bone = true;
                if (!nonblank(bone_value) || !contains_id(bones, bone_value) ||
                    str(field(field(nodes, bone_id), "kind")) != "bone")
                    add(s, "BONE_NODE_MISSING", influence_path + ".boneId", id);
                else {
                    std::set<std::string> visited;
                    const Value* current = &field(nodes, bone_id);
                    while (str(field(*current, "kind")) == "bone") {
                        const std::string current_id = str(field(*current, "id"));
                        if (!visited.insert(current_id).second) { current = nullptr; break; }
                        current = &field(nodes, str(field(*current, "parentId")));
                    }
                    if (current && nonblank(field(*current, "id"))) roots.insert(str(field(*current, "id")));
                }
                const Value& numeric = field(influence, "weight");
                if (!finite(numeric) || numeric.get<double>() <= 0 || numeric.get<double>() > 1) {
                    weights_valid = false;
                    add(s, "SKIN_BINDING_WEIGHT_INVALID", influence_path + ".weight", id);
                } else sum += numeric.get<double>();
            }
            if (std::isfinite(sum) && std::abs(sum - 1) > 1e-6)
                add(s, "SKIN_BINDING_WEIGHT_NOT_NORMALIZED", weight_path + ".influences", id);
            else if (weights_valid && std::isfinite(sum)) {
                double normalized = 0;
                bool canonical = false;
                for (size_t k = 0; k < influences.get<Array>().size(); ++k) {
                    const Value& original = field(influences.get<Array>()[k], "weight");
                    if (!finite(original)) continue;
                    const double value = k + 1 == influences.get<Array>().size() ? 1 - normalized : original.get<double>() / sum;
                    normalized += value;
                    if (original.get<double>() != value) canonical = true;
                }
                if (canonical) add(s, "SKIN_BINDING_WEIGHT_NOT_CANONICAL", weight_path + ".influences", id);
            }
            if (roots.size() > 1)
                add(s, "SKIN_BINDING_BONE_HIERARCHY_INCOMPATIBLE", weight_path + ".influences", id);
        }
        if (active.is<bool>() && active.get<bool>() && !topology.is<picojson::null>())
            for (const auto& vertex : vertex_ids) if (!weighted.count(vertex))
                add(s, "SKIN_BINDING_VERTEX_MISSING", path + ".vertexWeights", id);
    }
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
    if (has(field(project, "renderSettings"), "durationTicks"))
        add(s, "ANIMATION_SECOND_DURATION_AUTHORITY", "renderSettings.durationTicks");
    const Value& animation = field(project, "animation");
    if (!animation.is<Object>() || animation.get<Object>().size() != 2 ||
        !has(animation, "clips") || !has(animation, "deformationSamples"))
        add(s, "ANIMATION_SCHEMA_INVALID", "animation");

    const Value& scene = field(project, "scene");
    s.root = str(field(scene, "rootId"));
    const Value& nodes = field(scene, "nodes");
    if (!nodes.is<Object>()) { add(s, "scene.missing_nodes", "scene.nodes"); return; }
    const auto& node_map = nodes.get<Object>();
    auto root = node_map.find(s.root);
    if (root == node_map.end()) add(s, "scene.missing_root", "scene.rootId", s.root);
    else {
        if (!has(root->second, "parentId") || !field(root->second, "parentId").is<picojson::null>())
            add(s, "scene.root_parent_not_null", "scene.nodes." + s.root + ".parentId", s.root);
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
        Node node{};
        node.id = str(id);
        node.kind = str(field(value, "kind"));
        node.parent = str(field(value, "parentId"));
        node.name = str(field(value, "displayName"));
        node.null_parent = has(value, "parentId") && field(value, "parentId").is<picojson::null>();
        if (node.id != key) add(s, "scene.key_id_mismatch", path + ".id", node.id);
        if (node.kind != "group" && node.kind != "part" && node.kind != "deformer" && node.kind != "bone") add(s, "scene.invalid_kind", path + ".kind", key);
        if (!nonblank(field(value, "displayName"))) add(s, "scene.invalid_display_name", path + ".displayName", key);
        const Value& opacity = field(value, "opacity");
        if (!finite(opacity) || opacity.get<double>() < 0 || opacity.get<double>() > 1) add(s, "scene.invalid_opacity", path + ".opacity", key);
        const Value& children = field(value, "children");
        if (!children.is<Array>()) add(s, "scene.invalid_children", path + ".children", key);
        if (children.is<Array>()) for (const auto& child : children.get<Array>()) node.children.push_back(str(child));
        node.visible = field(value, "visible").is<bool>() && field(value, "visible").get<bool>();
        node.state.visible = node.visible ? 1 : 0;
        if (finite(opacity)) node.state.opacity = opacity.get<double>();
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
        auto number = [](const Value& value) { return finite(value) ? value.get<double>() : 0.0; };
        node.state.position_x = number(field(position, "x"));
        node.state.position_y = number(field(position, "y"));
        node.state.rotation = number(field(transform, "rotation"));
        node.state.scale_x = number(field(scale, "x"));
        node.state.scale_y = number(field(scale, "y"));
        node.state.pivot_x = number(field(pivot, "x"));
        node.state.pivot_y = number(field(pivot, "y"));
        s.nodes.emplace(key, std::move(node));
        if (!finite(field(position, "x")) || !finite(field(position, "y")) || !finite(field(transform, "rotation")) ||
            !finite(field(scale, "x")) || !finite(field(scale, "y")) || !finite(field(pivot, "x")) || !finite(field(pivot, "y")))
            add(s, "transform.non_finite", path + ".transform", key);
        if ((finite(field(scale, "x")) && field(scale, "x").get<double>() == 0) ||
            (finite(field(scale, "y")) && field(scale, "y").get<double>() == 0))
            add(s, "transform.zero_scale", path + ".transform.scale", key);
    }
    // Register IDs from collections supported by the JS base validator. The
    // remaining payload stays opaque and is never projected as native truth.
    const char* collections[] = {"sourceAssets", "semanticSlots", "keyArts", "meshes", "meshTopologies", "meshKeyforms", "meshFormCorrectionKeyforms", "transitions", "animation.clips", "animation.deformationSamples", "sequences"};
    for (const char* name : collections) {
        const std::string path(name);
        const auto dot = path.find('.');
        const Value& values = dot == std::string::npos ? field(project, path) : field(animation, path.substr(dot + 1));
        s.unsupported_sections[name] = dot == std::string::npos ? has(project, name) : has(animation, path.substr(dot + 1));
        if (!values.is<Array>()) add(s, "collection.invalid", name);
        else { size_t i = 0; for (const auto& value : values.get<Array>()) register_id(field(value, "id"), std::string(name) + "." + std::to_string(i++) + ".id"); }
    }
    for (const char* name : {"rig", "animation", "temporalPrograms", "clippingBindings", "renderSettings"})
        s.unsupported_sections[name] = has(project, name);
    validate_temporal_ownership(s, project, register_id);
    validate_clipping(s, project, register_id);
    validate_animation_clips(s, project);
    validate_deformation_samples(s, project);
    validate_rotation_constraints(s, project);
    validate_ik_constraints(s, project);
    validate_rigid_bindings(s, project, register_id);
    validate_mesh_form_corrections(s, project);
    validate_bones(s, project);
    validate_warp(s, project, register_id);
    validate_skin(s, project, register_id);
    if (root != node_map.end()) {
        std::set<std::string> visiting, visited;
        auto walk = [&](auto&& self, const std::string& id) -> void {
            if (visiting.count(id)) { add(s, "scene.cycle", "scene.nodes." + id, id); return; }
            if (visited.count(id)) return;
            auto it = node_map.find(id);
            if (it == node_map.end()) return;
            visiting.insert(id);
            const Value& children = field(it->second, "children");
            if (children.is<Array>()) for (const auto& child : children.get<Array>())
                if (child.is<std::string>()) self(self, child.get<std::string>());
            visiting.erase(id);
            visited.insert(id);
        };
        walk(walk, s.root);
        for (const auto& [id, unused] : node_map) {
            (void)unused;
            if (!visited.count(id)) add(s, "scene.unreachable", "scene.nodes." + id, id);
        }
    }
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
    const Node* n = nullptr;
    for (const auto& entry : s->nodes) if (entry.second.id == node_id) { n = &entry.second; break; }
    if (!n) return FL2D_INVALID_ARGUMENT;
    if (!std::strcmp(field_name, "id")) return copy(n->id, buffer, capacity, required);
    if (!std::strcmp(field_name, "kind")) return copy(n->kind, buffer, capacity, required);
    if (!std::strcmp(field_name, "parentId")) return copy(n->parent, buffer, capacity, required);
    if (!std::strcmp(field_name, "displayName")) return copy(n->name, buffer, capacity, required);
    return FL2D_INVALID_ARGUMENT;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_node_state(const fl2d_snapshot* s,
    const char* node_id, fl2d_node_state* result) {
    if (!s || !node_id || !result) return FL2D_INVALID_ARGUMENT;
    for (const auto& entry : s->nodes) if (entry.second.id == node_id) {
        *result = entry.second.state;
        return FL2D_OK;
    }
    return FL2D_INVALID_ARGUMENT;
}
extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_issue_string(const fl2d_snapshot* s,
    uint32_t index, const char* field_name, char* buffer, uint32_t capacity, uint32_t* required) {
    if (!s || !field_name || index >= s->issues.size()) return FL2D_INVALID_ARGUMENT;
    const Issue& issue = s->issues[index];
    if (!std::strcmp(field_name, "code")) return copy(issue.code, buffer, capacity, required);
    if (!std::strcmp(field_name, "path")) return copy(issue.path, buffer, capacity, required);
    if (!std::strcmp(field_name, "entityId")) return copy(issue.entity, buffer, capacity, required);
    if (!std::strcmp(field_name, "severity")) return copy(issue.severity, buffer, capacity, required);
    return FL2D_INVALID_ARGUMENT;
}
