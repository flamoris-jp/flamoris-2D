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
#include <tuple>
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
bool positive_time(const Value& value) { return valid_time(value) && value.get<double>() > 0; }
const Value& find_id(const Value& values, const Value& id);
template <typename Register>
void validate_clip_instances(Snapshot& s, const Value& project, const Value& sequence,
    const Value& sequence_program, const std::string& sequence_path, Register&& register_id) {
    const Value& instances = field(sequence, "clipInstances");
    const std::string sequence_id = str(field(sequence, "id"));
    if (!instances.is<Array>()) {
        add(s, "SEQUENCE_INVALID", sequence_path + ".clipInstances", sequence_id);
        return;
    }
    Array ordered = instances.get<Array>();
    auto rank = [](const Value& item, const char* name) {
        const Value& value = field(item, name);
        return safe_integer(value) ? value.get<double>() : 9007199254740991.0;
    };
    std::stable_sort(ordered.begin(), ordered.end(), [&](const Value& a, const Value& b) {
        for (const char* field_name : {"startTicks", "endTicks", "layer"}) {
            if (rank(a, field_name) != rank(b, field_name)) return rank(a, field_name) < rank(b, field_name);
        }
        return str(field(a, "id")) < str(field(b, "id"));
    });
    const Value& clips = field(field(project, "animation"), "clips");
    const Value& programs = field(project, "temporalPrograms");
    for (size_t i = 0; i < ordered.size(); ++i) {
        const Value& item = ordered[i];
        const std::string path = sequence_path + ".clipInstances." + std::to_string(i);
        if (!item.is<Object>()) { add(s, "ANIMATION_CLIP_INSTANCE_INVALID", path, sequence_id); continue; }
        const Value& id_value = field(item, "id");
        const std::string id = str(id_value);
        register_id(id_value, path + ".id");
        if (!exact(item, {"id", "clipId", "startTicks", "endTicks", "sourceOffsetTicks", "playbackRate",
            "loopMode", "weight", "layer", "enabled"})) add(s, "ANIMATION_CLIP_INSTANCE_INVALID", path, id);
        const Value& clip = find_id(clips, field(item, "clipId"));
        const Value& clip_program = find_id(programs, field(clip, "temporalProgramId"));
        if (!clip.is<Object>()) add(s, "ANIMATION_CLIP_REFERENCE_INVALID", path + ".clipId", id);
        const Value& start = field(item, "startTicks"), &end = field(item, "endTicks");
        const Value& duration = field(sequence_program, "durationTicks");
        const bool placement = valid_time(start) && valid_time(end) && start.get<double>() < end.get<double>() &&
            (!sequence_program.is<Object>() || (finite(duration) && end.get<double>() <= duration.get<double>()));
        if (!placement) add(s, "ANIMATION_CLIP_INSTANCE_PLACEMENT_INVALID", path, id);
        const Value& offset = field(item, "sourceOffsetTicks");
        if (!valid_time(offset)) add(s, "ANIMATION_CLIP_SOURCE_OFFSET_INVALID", path + ".sourceOffsetTicks", id);
        const Value& rate = field(item, "playbackRate");
        const Value& n = field(rate, "numerator"), &d = field(rate, "denominator");
        const bool rate_ok = exact(rate, {"numerator", "denominator"}) && positive_time(n) && positive_time(d);
        if (!rate_ok) add(s, "ANIMATION_CLIP_PLAYBACK_RATE_INVALID", path + ".playbackRate", id);
        else if (std::gcd(static_cast<int64_t>(n.get<double>()), static_cast<int64_t>(d.get<double>())) != 1)
            add(s, "ANIMATION_CLIP_PLAYBACK_RATE_NONCANONICAL", path + ".playbackRate", id);
        const std::string loop = str(field(item, "loopMode"));
        if (loop != "once" && loop != "loop") add(s, "ANIMATION_CLIP_LOOP_MODE_INVALID", path + ".loopMode", id);
        const Value& weight = field(item, "weight");
        if (!finite(weight) || weight.get<double>() < 0 || weight.get<double>() > 1)
            add(s, "ANIMATION_CLIP_WEIGHT_INVALID", path + ".weight", id);
        if (!safe_integer(field(item, "layer"))) add(s, "ANIMATION_CLIP_LAYER_INVALID", path + ".layer", id);
        const Value& enabled = field(item, "enabled");
        if (!enabled.is<bool>()) add(s, "ANIMATION_CLIP_INSTANCE_INVALID", path + ".enabled", id);
        // A positive partial blend cannot interpolate authored discrete channels.
        bool discrete = false;
        const Value& tracks = field(clip_program, "tracks");
        if (tracks.is<Array>()) for (const auto& track : tracks.get<Array>()) {
            const std::string kind = str(field(track, "kind"));
            const Value& channels = field(track, "channels");
            if (!channels.is<Object>()) continue;
            for (const auto& [name, channel] : channels.get<Object>()) {
                if ((kind == "PresenceTrack" && name == "presence") || (kind == "DrawOrderTrack" && name == "drawOrder") ||
                    (kind == "ClippingTrack" && name == "clipping")) {
                    const Value& keys = field(channel, "keyframes");
                    if (keys.is<Array>() && !keys.get<Array>().empty()) discrete = true;
                }
            }
        }
        if (enabled.is<bool>() && enabled.get<bool>() && finite(weight) && weight.get<double>() > 0 &&
            weight.get<double>() != 1 && discrete) add(s, "ANIMATION_DISCRETE_WEIGHT_INVALID", path + ".weight", id);
        if (!clip_program.is<Object>() || !placement || !rate_ok || !valid_time(offset) ||
            (loop != "once" && loop != "loop")) continue;
        const Value& clip_duration = field(clip_program, "durationTicks");
        if (loop == "once" && finite(clip_duration) && offset.get<double>() > clip_duration.get<double>()) {
            add(s, "ANIMATION_CLIP_SOURCE_OFFSET_INVALID", path + ".sourceOffsetTicks", id);
            continue;
        }
        if (loop == "loop" && (!finite(clip_duration) || clip_duration.get<double>() <= 0 ||
            offset.get<double>() >= clip_duration.get<double>())) {
            add(s, "ANIMATION_CLIP_LOOP_OFFSET_INVALID", path + ".sourceOffsetTicks", id);
            continue;
        }
        // Compute the last active local tick without overflowing a JS safe integer.
        const long double elapsed = static_cast<long double>(end.get<double>() - 1 - start.get<double>());
        const long double raw = static_cast<long double>(offset.get<double>()) +
            std::floor((elapsed * n.get<double>() / d.get<double>()) + 0.5L);
        if (raw > 9007199254740991.0L) add(s, "ANIMATION_CLIP_LOCAL_TIME_OVERFLOW", path, id);
        else if (loop == "once" && finite(clip_duration) && raw > clip_duration.get<double>())
            add(s, "ANIMATION_CLIP_ONCE_OVERRUN", path, id);
    }
}
// Both JS endpointSignature paths call endpointPartState without animation.
// For the same KeyArt, equal ordered slot/keyform/topology selections therefore
// imply equal geometry, transforms, appearance, rig state and resolved clipping.
// Render-instance IDs are explicitly removed by normalizedEvaluatedParts.
// Compare the generating selections instead of duplicating the entire renderer.
bool endpoint_selection_signature(const Value& project, const Value& item, bool ending, Value& signature) {
    const bool hold = str(field(item, "kind")) == "KeyArtHold";
    const Value& transition = find_id(field(project, "transitions"), field(item, "transitionId"));
    const Value& art_id = hold ? field(item, "keyArtId") : field(transition, ending ? "toKeyArtId" : "fromKeyArtId");
    const Value& art = find_id(field(project, "keyArts"), art_id);
    const Value& parts = field(transition, "partTransitions"), &slots = field(project, "semanticSlots");
    if (!art.is<Object>() || !slots.is<Array>()) return false;
    if (!hold) {
        const Value& program = find_id(field(project, "temporalPrograms"), field(transition, "temporalProgramId"));
        if (!program.is<Object>() || !parts.is<Array>()) return false;
    }
    Array ordered = slots.get<Array>(), selections;
    std::stable_sort(ordered.begin(), ordered.end(), [](const Value& a, const Value& b) { return str(field(a, "id")) < str(field(b, "id")); });
    const Value& keyforms = field(project, "meshKeyforms");
    for (const auto& slot : ordered) {
        const Value* part = nullptr;
        if (!hold) for (const auto& entry : parts.get<Array>()) if (field(entry, "semanticSlotId") == field(slot, "id")) { part = &entry; break; }
        const Value& mappings = field(slot, "mappings");
        const Value* mapping = nullptr;
        if (mappings.is<Array>()) for (const auto& entry : mappings.get<Array>()) if (field(entry, "keyArtId") == art_id) { mapping = &entry; break; }
        // Transition endpoints include slots present only at the opposite end.
        bool opposite = false;
        if (!hold && mappings.is<Array>()) for (const auto& entry : mappings.get<Array>())
            if (field(entry, "keyArtId") == field(transition, ending ? "fromKeyArtId" : "toKeyArtId")) opposite = true;
        if (!mapping && !part && !opposite) continue;
        // JS selections exclude opposite-only slots, but evaluatedParts retains
        // an absent entry. Include that distinction in the signature.
        Value keyform;
        Value requested;
        if (hold) {
            size_t count = 0;
            if (keyforms.is<Array>()) for (const auto& form : keyforms.get<Array>())
                if (field(form, "keyArtId") == art_id && field(form, "semanticSlotId") == field(slot, "id")) { keyform = form; ++count; }
            if (count != 1) keyform = Value();
            requested = field(keyform, "id");
        } else if (part) {
            requested = field(*part, ending ? "toKeyformId" : "fromKeyformId");
            keyform = find_id(keyforms, requested);
        }
        if (mapping) {
            const Value& nodes = field(field(project, "scene"), "nodes");
            const Value& members = field(art, "members");
            const Value* member = nullptr;
            if (members.is<Array>()) for (const auto& entry : members.get<Array>())
                if (field(entry, "nodeId") == field(*mapping, "nodeId")) { member = &entry; break; }
            std::string node_id = str(field(*mapping, "nodeId"));
            if (has(nodes, node_id) && member) {
                // worldTransformMatrix is evaluated even for absent members.
                std::set<std::string> ancestors;
                while (!node_id.empty()) {
                    if (!has(nodes, node_id) || !ancestors.insert(node_id).second) return false;
                    const Value& node = field(nodes, node_id), &transform = field(node, "transform");
                    for (const char* component : {"position", "scale", "pivot"})
                        if (field(transform, component).is<picojson::null>()) return false;
                    node_id = str(field(node, "parentId"));
                }
                if (str(field(*member, "presence")) == "present" && !requested.is<picojson::null>() && !str(requested).empty()) {
                    const Value& topology = find_id(field(project, "meshTopologies"), field(keyform, "topologyId"));
                    if (!keyform.is<Object>() || !field(keyform, "positions").is<Array>() ||
                        !field(keyform, "uvs").is<Array>() || !field(topology, "indices").is<Array>()) return false;
                }
            }
        }
        selections.push_back(Value(Array{field(slot, "id"), field(keyform, "id"), field(keyform, "topologyId"), Value(mapping || part)}));
    }
    signature = Value(selections);
    return true;
}
template <typename Register>
void validate_sequences(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& sequences = field(project, "sequences");
    if (!sequences.is<Array>()) { add(s, "collection.invalid", "sequences"); return; }
    const Value& programs = field(project, "temporalPrograms");
    const Value& key_arts = field(project, "keyArts");
    const Value& transitions = field(project, "transitions");
    for (size_t i = 0; i < sequences.get<Array>().size(); ++i) {
        const Value& sequence = sequences.get<Array>()[i];
        const std::string path = "sequences." + std::to_string(i);
        if (!sequence.is<Object>()) { add(s, "SEQUENCE_INVALID", path); continue; }
        const std::string id = str(field(sequence, "id"));
        if (!exact(sequence, {"id", "displayName", "temporalProgramId", "viewLaneItems", "clipInstances", "metadata"}))
            add(s, "SEQUENCE_INVALID", path, id);
        if (!nonblank(field(sequence, "displayName"))) add(s, "SEQUENCE_INVALID", path + ".displayName", id);
        const Value& program = find_id(programs, field(sequence, "temporalProgramId"));
        if (!program.is<Object>()) add(s, "SEQUENCE_PROGRAM_REFERENCE_INVALID", path + ".temporalProgramId", id);
        if (!field(sequence, "metadata").is<Object>()) add(s, "SEQUENCE_INVALID", path + ".metadata", id);
        validate_clip_instances(s, project, sequence, program, path, register_id);
        const Value& lane = field(sequence, "viewLaneItems");
        if (!lane.is<Array>()) { add(s, "SEQUENCE_INVALID", path + ".viewLaneItems", id); continue; }
        Array items = lane.get<Array>();
        auto ticks = [](const Value& item, const char* key) {
            const Value& value = field(item, key);
            return finite(value) ? value.get<double>() : 0.0;
        };
        std::stable_sort(items.begin(), items.end(), [&](const Value& a, const Value& b) {
            if (ticks(a, "startTicks") != ticks(b, "startTicks")) return ticks(a, "startTicks") < ticks(b, "startTicks");
            if (ticks(a, "endTicks") != ticks(b, "endTicks")) return ticks(a, "endTicks") < ticks(b, "endTicks");
            return str(field(a, "id")) < str(field(b, "id"));
        });
        for (size_t j = 0; j < items.size(); ++j) {
            const Value& item = items[j];
            const std::string item_path = path + ".viewLaneItems." + std::to_string(j);
            if (!item.is<Object>()) { add(s, "SEQUENCE_VIEW_ITEM_INVALID", item_path, id); continue; }
            const Value& item_id = field(item, "id");
            register_id(item_id, item_path + ".id");
            const std::string kind = str(field(item, "kind"));
            const bool hold = kind == "KeyArtHold", instance = kind == "TransitionInstance";
            if (!hold && !instance) { add(s, "SEQUENCE_VIEW_ITEM_INVALID", item_path + ".kind", str(item_id)); continue; }
            if (hold ? !exact(item, {"id", "kind", "keyArtId", "startTicks", "endTicks"}) :
                !exact(item, {"id", "kind", "transitionId", "startTicks", "endTicks"}))
                add(s, "SEQUENCE_VIEW_ITEM_INVALID", item_path, str(item_id));
            const Value& start = field(item, "startTicks"), &end = field(item, "endTicks");
            const Value& duration = field(program, "durationTicks");
            if (!valid_time(start) || !valid_time(end) || start.get<double>() >= end.get<double>() ||
                (program.is<Object>() && (!finite(duration) || end.get<double>() > duration.get<double>())))
                add(s, "SEQUENCE_INVALID_TIME", item_path, str(item_id));
            if (hold && !contains_id(key_arts, field(item, "keyArtId")))
                add(s, "SEQUENCE_KEYART_REFERENCE_INVALID", item_path + ".keyArtId", str(item_id));
            if (hold && contains_id(key_arts, field(item, "keyArtId"))) {
                const Value& slots = field(project, "semanticSlots");
                const Value& keyforms = field(project, "meshKeyforms");
                if (slots.is<Array>()) for (const auto& slot : slots.get<Array>()) {
                    const Value& mappings = field(slot, "mappings");
                    bool mapped = false;
                    if (mappings.is<Array>()) for (const auto& mapping : mappings.get<Array>())
                        if (field(mapping, "keyArtId") == field(item, "keyArtId")) mapped = true;
                    if (!mapped || !keyforms.is<Array>()) continue;
                    size_t matching = 0;
                    for (const auto& keyform : keyforms.get<Array>())
                        if (field(keyform, "keyArtId") == field(item, "keyArtId") &&
                            field(keyform, "semanticSlotId") == field(slot, "id")) ++matching;
                    if (matching > 1) add(s, "SEQUENCE_KEYART_BASE_AMBIGUOUS", item_path + ".keyArtId", str(item_id));
                }
            }
            if (instance && !contains_id(transitions, field(item, "transitionId")))
                add(s, "SEQUENCE_TRANSITION_REFERENCE_INVALID", item_path + ".transitionId", str(item_id));
        }
        if (!program.is<Object>()) continue;
        if (items.empty()) { add(s, "SEQUENCE_VIEW_GAP", path + ".viewLaneItems", id); continue; }
        if (!finite(field(items.front(), "startTicks")) || ticks(items.front(), "startTicks") != 0)
            add(s, "SEQUENCE_VIEW_GAP", path + ".viewLaneItems", id);
        auto endpoint = [&](const Value& item, bool ending) {
            if (str(field(item, "kind")) == "KeyArtHold") return str(field(item, "keyArtId"));
            const Value& transition = find_id(transitions, field(item, "transitionId"));
            return str(field(transition, ending ? "toKeyArtId" : "fromKeyArtId"));
        };
        for (size_t j = 1; j < items.size(); ++j) {
            const Value& previous = items[j - 1], &current = items[j];
            if (!previous.is<Object>() || !current.is<Object>()) continue;
            if (ticks(previous, "endTicks") < ticks(current, "startTicks"))
                add(s, "SEQUENCE_VIEW_GAP", path + ".viewLaneItems", id);
            else if (ticks(previous, "endTicks") > ticks(current, "startTicks"))
                add(s, "SEQUENCE_VIEW_OVERLAP", path + ".viewLaneItems", id);
            const std::string outgoing = endpoint(previous, true), incoming = endpoint(current, false);
            if (!outgoing.empty() && !incoming.empty() && outgoing != incoming)
                add(s, (str(field(previous, "kind")) == "TransitionInstance" ||
                    str(field(current, "kind")) == "TransitionInstance") ?
                    "SEQUENCE_TRANSITION_ENDPOINT_MISMATCH" : "SEQUENCE_VIEW_CONTINUITY_MISMATCH",
                    path + ".viewLaneItems", id);
            else if (!outgoing.empty() && !incoming.empty()) {
                Value left, right;
                if (endpoint_selection_signature(project, previous, true, left) &&
                    endpoint_selection_signature(project, current, false, right) && left != right)
                    add(s, "SEQUENCE_VIEW_ENDPOINT_INCOMPATIBLE", path + ".viewLaneItems", id);
            }
        }
        const Value& duration = field(program, "durationTicks");
        if (finite(duration) && ticks(items.back(), "endTicks") < duration.get<double>())
            add(s, "SEQUENCE_VIEW_GAP", path + ".viewLaneItems", id);
        else if (finite(duration) && ticks(items.back(), "endTicks") > duration.get<double>())
            add(s, "SEQUENCE_VIEW_OVERLAP", path + ".viewLaneItems", id);
    }
}
struct TrackDefinition {
    const char* target;
    std::set<std::string> channels;
    const char* value;
    bool discrete;
};
TrackDefinition track_definition(const std::string& kind) {
    if (kind == "GeometryBlendTrack") return {"transition", {"geometryWeight"}, "unit-number", false};
    if (kind == "AppearanceTrack") return {"transition", {"appearance"}, "weights", false};
    if (kind == "OpacityTrack") return {"node-semantic-or-transition", {"opacity"}, "unit-number", false};
    if (kind == "PresenceTrack") return {"node-semantic-or-transition", {"presence"}, "presence", true};
    if (kind == "DrawOrderTrack") return {"node-semantic-or-transition", {"drawOrder"}, "integer", true};
    if (kind == "ClippingTrack") return {"node-semantic-or-transition", {"clipping"}, "clipping", true};
    if (kind == "TransformTrack") return {"node-or-semantic-local", {"positionX", "positionY", "rotation", "scaleX", "scaleY"}, "number", false};
    if (kind == "BoneTrack") return {"bone", {"x", "y", "rotation"}, "number", false};
    if (kind == "DeformerTrack") return {"deformer-control-point", {"deltaX", "deltaY"}, "number", false};
    if (kind == "CameraTrack") return {"camera", {"positionX", "positionY", "rotation", "scale"}, "number", false};
    if (kind == "MeshDeformationTrack") return {"mesh", {"deformation"}, "deformation", false};
    return {nullptr, {}, nullptr, false};
}
void validate_track_target(Snapshot& s, const Value& project, const Value& program,
    const Value& track, const TrackDefinition& definition, const std::string& path) {
    const Value& target = field(track, "target");
    const std::string id = str(field(track, "trackId"));
    if (!target.is<Object>()) { add(s, "ANIMATION_TRACK_TARGET_INVALID", path, id); return; }
    const bool node = field(target, "nodeId").is<std::string>() && !str(field(target, "nodeId")).empty();
    const bool semantic = field(target, "semanticSlotId").is<std::string>() && !str(field(target, "semanticSlotId")).empty();
    const bool transition = field(target, "transitionDefault").is<bool>() && field(target, "transitionDefault").get<bool>();
    const size_t fields = target.get<Object>().size();
    const std::string shape = definition.target;
    bool valid = false;
    if (shape == "transition") valid = (semantic != transition) && fields == 1;
    else if (shape == "node-semantic-or-transition") valid = static_cast<int>(node) + semantic + transition == 1 && fields == 1;
    else if (shape == "node-or-semantic-local") valid = node != semantic &&
        str(field(target, "coordinateSpace")) == "node-local" && fields == 2;
    else if (shape == "bone") valid = !str(field(target, "boneId")).empty() && fields == 1;
    else if (shape == "deformer-control-point") valid = !str(field(target, "deformerId")).empty() &&
        !str(field(target, "controlPointId")).empty() && fields == 2;
    else if (shape == "mesh") valid = !str(field(target, "meshId")).empty() && fields == 1;
    else if (shape == "camera") valid = str(field(target, "cameraId")) == "main" && fields == 1;
    if (!valid) { add(s, "ANIMATION_TRACK_TARGET_INVALID", path, id); return; }
    const Value& nodes = field(field(project, "scene"), "nodes");
    if (node && (!nodes.is<Object>() || !has(nodes, str(field(target, "nodeId")))))
        add(s, "ANIMATION_TRACK_TARGET_INVALID", path + ".nodeId", str(field(target, "nodeId")));
    if (semantic && !contains_id(field(project, "semanticSlots"), field(target, "semanticSlotId")))
        add(s, "ANIMATION_TRACK_TARGET_INVALID", path + ".semanticSlotId", str(field(target, "semanticSlotId")));
    if (transition) {
        bool owned = false;
        const Value& transitions = field(project, "transitions");
        if (transitions.is<Array>()) for (const auto& item : transitions.get<Array>())
            if (field(item, "temporalProgramId") == field(program, "id")) owned = true;
        if (!owned) add(s, "ANIMATION_TRACK_TARGET_INVALID", path + ".transitionDefault", id);
    }
    for (const auto& [key, collection, suffix] : {
        std::tuple<const char*, const char*, const char*>{"meshId", "meshes", ".meshId"},
        {"boneId", "bones", ".boneId"}}) {
        const Value& target_id = field(target, key);
        const Value& values = std::strcmp(collection, "bones") == 0 ? field(field(project, "rig"), "bones") : field(project, "meshes");
        if (target_id.is<std::string>() && !str(target_id).empty() && !contains_id(values, target_id))
            add(s, "ANIMATION_TRACK_TARGET_INVALID", path + suffix, str(target_id));
    }
    if (field(target, "deformerId").is<std::string>() && !str(field(target, "deformerId")).empty()) {
        const Value& rig = field(project, "rig");
        const Value& deformer = find_id(field(rig, "deformers"), field(target, "deformerId"));
        const Value& point = find_id(field(rig, "warpControlPoints"), field(target, "controlPointId"));
        if (!deformer.is<Object>()) add(s, "ANIMATION_TRACK_TARGET_INVALID", path + ".deformerId", str(field(target, "deformerId")));
        const Value& ids = field(deformer, "controlPointIds");
        bool linked = false;
        if (ids.is<Array>()) for (const auto& candidate : ids.get<Array>())
            if (candidate == field(target, "controlPointId")) linked = true;
        if (!point.is<Object>() || field(point, "deformerId") != field(target, "deformerId") || !linked)
            add(s, "ANIMATION_TRACK_TARGET_INVALID", path + ".controlPointId", str(field(target, "controlPointId")));
    }
}
void validate_track_value(Snapshot& s, const Value& project, const Value& track,
    const std::string& type, const Value& value, const std::string& path) {
    if (type == "number" && !finite(value)) add(s, "ANIMATION_INVALID_VALUE", path);
    else if (type == "positive-number" && (!finite(value) || value.get<double>() <= 0)) add(s, "ANIMATION_INVALID_VALUE", path);
    else if (type == "unit-number" && (!finite(value) || value.get<double>() < 0 || value.get<double>() > 1))
        add(s, "ANIMATION_INVALID_VALUE", path);
    else if (type == "integer" && !safe_integer(value)) add(s, "ANIMATION_INVALID_DRAW_ORDER", path);
    else if (type == "presence" && str(value) != "present" && str(value) != "occluded" && str(value) != "absent")
        add(s, "ANIMATION_INVALID_PRESENCE_VALUE", path);
    else if (type == "weights") {
        bool valid = value.is<Object>() && !value.get<Object>().empty();
        double sum = 0;
        if (valid) for (const auto& [key, weight] : value.get<Object>()) {
            (void)key;
            if (!finite(weight) || weight.get<double>() < 0) valid = false;
            else sum += weight.get<double>();
        }
        if (!valid || std::abs(sum - 1) > 1e-9) add(s, "ANIMATION_INVALID_VALUE", path);
    } else if (type == "clipping") {
        const Value& source = field(value, "sourceNodeId");
        if (!value.is<Object>() || !has(value, "sourceNodeId") ||
            (!source.is<picojson::null>() && (!source.is<std::string>() || str(source).empty())))
            add(s, "ANIMATION_INVALID_VALUE", path);
        else if (source.is<std::string>() && !has(field(field(project, "scene"), "nodes"), str(source)))
            add(s, "ANIMATION_UNKNOWN_TARGET", path + ".sourceNodeId", str(source));
    } else if (type == "deformation") {
        if (!exact(value, {"deformationSampleId", "weight"}) || !nonblank(field(value, "deformationSampleId")) ||
            !finite(field(value, "weight"))) { add(s, "ANIMATION_INVALID_VALUE", path); return; }
        const Value& sample = find_id(field(field(project, "animation"), "deformationSamples"), field(value, "deformationSampleId"));
        if (!sample.is<Object>() || field(sample, "meshId") != field(field(track, "target"), "meshId") ||
            !contains_id(field(project, "meshTopologies"), field(sample, "topologyId")))
            add(s, "ANIMATION_TOPOLOGY_INCOMPATIBLE", sample.is<Object>() ? path : path + ".deformationSampleId",
                str(field(track, "trackId")));
    }
}
void validate_curve(Snapshot& s, const Value& value, const std::string& path,
    bool discrete, bool positive) {
    const std::string kind = str(field(value, "kind"));
    if (!value.is<Object>() || (kind != "step" && kind != "linear" && kind != "bezier")) {
        add(s, "ANIMATION_INVALID_CURVE", path); return;
    }
    if (discrete && kind != "step") add(s, "ANIMATION_INVALID_CURVE", path);
    if (kind == "bezier" ? !exact(value, {"kind", "x1", "x2", "y1", "y2"}) : !exact(value, {"kind"})) {
        add(s, "ANIMATION_INVALID_CURVE", path); return;
    }
    if (kind != "bezier") return;
    const Value& x1 = field(value, "x1"), &x2 = field(value, "x2");
    const Value& y1 = field(value, "y1"), &y2 = field(value, "y2");
    if (!finite(x1) || !finite(x2) || !finite(y1) || !finite(y2) ||
        (finite(x1) && (x1.get<double>() < 0 || x1.get<double>() > 1)) ||
        (finite(x2) && (x2.get<double>() < 0 || x2.get<double>() > 1)))
        add(s, "ANIMATION_INVALID_CURVE", path);
    if (positive && ((!finite(y1) || y1.get<double>() < 0 || y1.get<double>() > 1) ||
        (!finite(y2) || y2.get<double>() < 0 || y2.get<double>() > 1)))
        add(s, "ANIMATION_INVALID_CURVE", path);
}
bool only_keys(const Value& value, std::initializer_list<const char*> allowed) {
    if (!value.is<Object>()) return false;
    for (const auto& [key, ignored] : value.get<Object>()) {
        (void)ignored;
        bool found = false;
        for (const auto* name : allowed) if (key == name) found = true;
        if (!found) return false;
    }
    return true;
}
template <typename Register>
void validate_transition_domain(Snapshot& s, const Value& project, Register&& register_id) {
    const Value& nodes = field(field(project, "scene"), "nodes");
    const Value& key_arts = field(project, "keyArts");
    const Value& slots = field(project, "semanticSlots");
    const Value& keyforms = field(project, "meshKeyforms");
    const Value& transitions = field(project, "transitions");
    const Value& topologies = field(project, "meshTopologies");
    if (!key_arts.is<Array>()) add(s, "collection.invalid", "keyArts");
    if (!slots.is<Array>()) add(s, "collection.invalid", "semanticSlots");
    if (!keyforms.is<Array>()) add(s, "collection.invalid", "meshKeyforms");
    if (!transitions.is<Array>()) add(s, "collection.invalid", "transitions");
    if (!topologies.is<Array>()) add(s, "collection.invalid", "meshTopologies");
    if (key_arts.is<Array>()) for (size_t i = 0; i < key_arts.get<Array>().size(); ++i) {
        const Value& art = key_arts.get<Array>()[i];
        const std::string path = "keyArts." + std::to_string(i);
        if (!art.is<Object>()) { add(s, "KEYART_INVALID", path); continue; }
        const std::string id = str(field(art, "id"));
        if (!only_keys(art, {"id", "displayName", "rootNodeId", "sourceAssetId", "members", "metadata"}))
            add(s, "KEYART_INVALID", path, id);
        if (!nonblank(field(art, "displayName"))) add(s, "KEYART_INVALID", path + ".displayName", id);
        const Value& metadata = field(art, "metadata");
        if (!metadata.is<picojson::null>() && !metadata.is<Object>())
            add(s, "KEYART_INVALID", path + ".metadata", id);
        const std::string root_id = str(field(art, "rootNodeId"));
        if (!nonblank(field(art, "rootNodeId")) || !has(nodes, root_id))
            add(s, "KEYART_UNKNOWN_ROOT", path + ".rootNodeId", id);
        const Value& source = field(art, "sourceAssetId");
        if (!source.is<picojson::null>() && !contains_id(field(project, "sourceAssets"), source))
            add(s, "KEYART_UNKNOWN_SOURCE", path + ".sourceAssetId", id);
        const Value& members = field(art, "members");
        if (!members.is<picojson::null>() && !members.is<Array>()) {
            add(s, "KEYART_INVALID", path + ".members", id); continue;
        }
        if (!members.is<Array>()) continue;
        std::set<std::string> allowed_nodes, member_ids;
        auto visit = [&](auto&& self, const std::string& node) -> void {
            if (!has(nodes, node) || !allowed_nodes.insert(node).second) return;
            const Value& children = field(field(nodes, node), "children");
            if (children.is<Array>()) for (const auto& child : children.get<Array>()) self(self, str(child));
        };
        visit(visit, root_id);
        std::map<double, std::string> draw_orders;
        for (size_t j = 0; j < members.get<Array>().size(); ++j) {
            const Value& member = members.get<Array>()[j];
            const std::string member_path = path + ".members." + std::to_string(j);
            if (!member.is<Object>() || !nonblank(field(member, "nodeId"))) {
                add(s, "KEYART_INVALID_MEMBER", member_path, id); continue;
            }
            const std::string node_id = str(field(member, "nodeId"));
            if (!only_keys(member, {"nodeId", "appearanceId", "opacity", "presence", "drawOrder", "clipping"}))
                add(s, "KEYART_INVALID_MEMBER", member_path, node_id);
            if (!allowed_nodes.count(node_id)) add(s, "KEYART_UNKNOWN_MEMBER", member_path + ".nodeId", node_id);
            if (!member_ids.insert(node_id).second) add(s, "KEYART_DUPLICATE_MEMBER", member_path + ".nodeId", node_id);
            if (!nonblank(field(member, "appearanceId"))) add(s, "KEYART_INVALID_MEMBER", member_path + ".appearanceId", node_id);
            const Value& opacity = field(member, "opacity");
            if (!finite(opacity) || opacity.get<double>() < 0 || opacity.get<double>() > 1)
                add(s, "KEYART_INVALID_MEMBER", member_path + ".opacity", node_id);
            const std::string presence = str(field(member, "presence"));
            if (presence != "present" && presence != "occluded" && presence != "absent")
                add(s, "KEYART_INVALID_MEMBER", member_path + ".presence", node_id);
            const Value& order = field(member, "drawOrder");
            if (!safe_integer(order)) add(s, "ANIMATION_INVALID_DRAW_ORDER", member_path + ".drawOrder", node_id);
            else if (!draw_orders.emplace(order.get<double>(), node_id).second)
                add(s, "TRANSITION_DRAW_ORDER_CONFLICT", member_path + ".drawOrder", id);
            const Value& clipping = field(member, "clipping");
            const Value& clipping_source = field(clipping, "sourceNodeId");
            if (!clipping.is<Object>() || !has(clipping, "sourceNodeId") ||
                (!clipping_source.is<picojson::null>() && !nonblank(clipping_source)))
                add(s, "TRANSITION_CLIPPING_REFERENCE_INVALID", member_path + ".clipping", node_id);
            else if (!clipping_source.is<picojson::null>() && !has(nodes, str(clipping_source)))
                add(s, "TRANSITION_CLIPPING_REFERENCE_INVALID", member_path + ".clipping.sourceNodeId", node_id);
        }
    }
    std::map<std::string, std::string> mapped_node_owner;
    if (slots.is<Array>()) for (size_t i = 0; i < slots.get<Array>().size(); ++i) {
        const Value& slot = slots.get<Array>()[i];
        const std::string path = "semanticSlots." + std::to_string(i);
        if (!slot.is<Object>()) { add(s, "SEMANTIC_SLOT_INVALID", path); continue; }
        const std::string id = str(field(slot, "id"));
        if (!only_keys(slot, {"id", "displayName", "role", "mappings", "metadata"}))
            add(s, "SEMANTIC_SLOT_INVALID", path, id);
        for (const char* key : {"displayName", "role"}) {
            const Value& value = field(slot, key);
            if (!value.is<picojson::null>() && !nonblank(value))
                add(s, "SEMANTIC_SLOT_INVALID", path + "." + key, id);
        }
        const Value& metadata = field(slot, "metadata");
        if (!metadata.is<picojson::null>() && !metadata.is<Object>())
            add(s, "SEMANTIC_SLOT_INVALID", path + ".metadata", id);
        const Value& mappings = field(slot, "mappings");
        if (!mappings.is<picojson::null>() && !mappings.is<Array>()) {
            add(s, "SEMANTIC_SLOT_INVALID", path + ".mappings", id); continue;
        }
        if (!mappings.is<Array>()) continue;
        std::set<std::string> art_ids;
        for (size_t j = 0; j < mappings.get<Array>().size(); ++j) {
            const Value& mapping = mappings.get<Array>()[j];
            const std::string mapping_path = path + ".mappings." + std::to_string(j);
            const Value& art_id = field(mapping, "keyArtId"), &node_id = field(mapping, "nodeId");
            if (!mapping.is<Object>() || !nonblank(art_id) || !nonblank(node_id)) {
                add(s, "SEMANTIC_MAPPING_INVALID", mapping_path, id); continue;
            }
            if (!only_keys(mapping, {"keyArtId", "nodeId"})) add(s, "SEMANTIC_MAPPING_INVALID", mapping_path, id);
            const Value& art = find_id(key_arts, art_id);
            if (!art.is<Object>()) add(s, "SEMANTIC_MAPPING_UNKNOWN_KEYART", mapping_path + ".keyArtId", id);
            if (!has(nodes, str(node_id))) add(s, "SEMANTIC_MAPPING_UNKNOWN_NODE", mapping_path + ".nodeId", id);
            if (!art_ids.insert(str(art_id)).second) add(s, "SEMANTIC_MAPPING_DUPLICATE", mapping_path, id);
            std::string node_key = str(art_id); node_key.push_back('\0'); node_key += str(node_id);
            auto owner = mapped_node_owner.find(node_key);
            if (owner != mapped_node_owner.end() && owner->second != id)
                add(s, "SEMANTIC_MAPPING_DUPLICATE", mapping_path, str(node_id));
            else mapped_node_owner[node_key] = id;
            const Value& members = field(art, "members");
            bool member = false;
            if (members.is<Array>()) for (const auto& item : members.get<Array>())
                if (field(item, "nodeId") == node_id) member = true;
            if (art.is<Object>() && !member)
                add(s, "SEMANTIC_MAPPING_NOT_MEMBER", mapping_path + ".nodeId", str(node_id));
        }
    }
    std::map<std::string, std::pair<std::string, std::string>> vertex_owners;
    if (topologies.is<Array>()) for (size_t i = 0; i < topologies.get<Array>().size(); ++i) {
        const Value& topology = topologies.get<Array>()[i];
        const std::string path = "meshTopologies." + std::to_string(i);
        const Value& vertices = field(topology, "vertexIds"), &indices = field(topology, "indices");
        const std::string id = str(field(topology, "id"));
        if (!topology.is<Object>() || !vertices.is<Array>() || !indices.is<Array>()) {
            add(s, "MESH_TOPOLOGY_INVALID", path, id); continue;
        }
        if (!only_keys(topology, {"id", "vertexIds", "indices", "vertexMetadata", "nextVertexSequence"}))
            add(s, "MESH_TOPOLOGY_INVALID", path, id);
        const Value& next = field(topology, "nextVertexSequence");
        if (has(topology, "nextVertexSequence")) {
            double maximum = 0;
            for (const auto& vertex : vertices.get<Array>()) {
                const std::string name = str(vertex);
                if (name.rfind("vtx_", 0) != 0 || name.size() == 4) continue;
                const std::string suffix = name.substr(4);
                if (!std::all_of(suffix.begin(), suffix.end(), [](unsigned char ch) { return ch >= '0' && ch <= '9'; })) continue;
                try { maximum = std::max(maximum, std::stod(suffix)); } catch (...) {}
            }
            if (!positive_time(next) || next.get<double>() <= maximum)
                add(s, "MESH_TOPOLOGY_VERTEX_SEQUENCE_INVALID", path + ".nextVertexSequence", id);
        }
        std::set<std::string> unique;
        for (const auto& vertex : vertices.get<Array>()) unique.insert(vertex.serialize());
        for (size_t j = 0; j < vertices.get<Array>().size(); ++j) {
            const Value& vertex = vertices.get<Array>()[j];
            if (!nonblank(vertex)) continue;
            const std::string vertex_id = str(vertex), vertex_path = path + ".vertexIds." + std::to_string(j);
            auto found = vertex_owners.find(vertex_id);
            if (found != vertex_owners.end() && found->second.first != id)
                add(s, "MESH_TOPOLOGY_DUPLICATE_VERTEX_ACROSS_TOPOLOGIES", vertex_path, vertex_id);
            else if (found == vertex_owners.end()) vertex_owners.emplace(vertex_id, std::make_pair(id, vertex_path));
            register_id(vertex, vertex_path);
        }
        bool blank_vertex = false;
        for (const auto& vertex : vertices.get<Array>()) if (!nonblank(vertex)) blank_vertex = true;
        if (vertices.get<Array>().size() < 3 || blank_vertex || unique.size() != vertices.get<Array>().size()) {
            if (vertices.get<Array>().size() < 3 || blank_vertex) add(s, "MESH_TOPOLOGY_INVALID", path + ".vertexIds", id);
            if (unique.size() != vertices.get<Array>().size()) add(s, "MESH_TOPOLOGY_DUPLICATE_VERTEX", path + ".vertexIds", id);
        }
        const Value& metadata = field(topology, "vertexMetadata");
        if (!metadata.is<picojson::null>() && !metadata.is<Object>())
            add(s, "MESH_TOPOLOGY_VERTEX_METADATA_INVALID", path + ".vertexMetadata", id);
        else if (metadata.is<Object>()) {
            std::set<std::string> labels;
            for (const auto& [vertex_id, annotation] : metadata.get<Object>()) {
                const std::string annotation_path = path + ".vertexMetadata." + vertex_id;
                bool exists = false;
                for (const auto& vertex : vertices.get<Array>()) if (str(vertex) == vertex_id) exists = true;
                if (!exists) { add(s, "MESH_TOPOLOGY_MISSING_VERTEX_REFERENCE", annotation_path, id); continue; }
                const Value& label = field(annotation, "semanticLabel");
                if (!annotation.is<Object>() || !only_keys(annotation, {"semanticLabel"}) || !nonblank(label)) {
                    add(s, "MESH_TOPOLOGY_VERTEX_METADATA_INVALID", annotation_path, vertex_id); continue;
                }
                if (!labels.insert(str(label)).second)
                    add(s, "MESH_TOPOLOGY_DUPLICATE_SEMANTIC_LABEL", annotation_path + ".semanticLabel", vertex_id);
            }
        }
        if (indices.get<Array>().empty() || indices.get<Array>().size() % 3)
            add(s, "MESH_TOPOLOGY_INVALID_TRIANGLES", path + ".indices", id);
        for (size_t offset = 0; offset < indices.get<Array>().size(); offset += 3) {
            bool references_valid = offset + 2 < indices.get<Array>().size();
            std::set<double> triangle;
            for (size_t j = offset; j < indices.get<Array>().size() && j < offset + 3; ++j) {
                const Value& vertex = indices.get<Array>()[j];
                if (!valid_time(vertex) || vertex.get<double>() >= vertices.get<Array>().size()) references_valid = false;
                else triangle.insert(vertex.get<double>());
            }
            if (!references_valid) add(s, "MESH_TOPOLOGY_INVALID_VERTEX_REFERENCE", path + ".indices." + std::to_string(offset), id);
            else if (triangle.size() != 3) add(s, "MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX", path + ".indices." + std::to_string(offset), id);
        }
    }
    std::set<std::string> keyform_keys;
    if (keyforms.is<Array>()) for (size_t i = 0; i < keyforms.get<Array>().size(); ++i) {
        const Value& keyform = keyforms.get<Array>()[i];
        const std::string path = "meshKeyforms." + std::to_string(i);
        if (!keyform.is<Object>()) { add(s, "MESH_KEYFORM_INVALID", path); continue; }
        const std::string id = str(field(keyform, "id"));
        if (!only_keys(keyform, {"id", "topologyId", "keyArtId", "semanticSlotId", "positions", "uvs"}))
            add(s, "MESH_KEYFORM_INVALID", path, id);
        const Value& topology = find_id(topologies, field(keyform, "topologyId"));
        if (!topology.is<Object>()) add(s, "MESH_KEYFORM_UNKNOWN_TOPOLOGY", path + ".topologyId", id);
        if (!contains_id(key_arts, field(keyform, "keyArtId"))) add(s, "MESH_KEYFORM_UNKNOWN_KEYART", path + ".keyArtId", id);
        if (!contains_id(slots, field(keyform, "semanticSlotId"))) add(s, "MESH_KEYFORM_UNKNOWN_SLOT", path + ".semanticSlotId", id);
        const Value& vertices = field(topology, "vertexIds");
        const size_t expected = vertices.is<Array>() ? vertices.get<Array>().size() * 2 : 0;
        for (const char* name : {"positions", "uvs"}) {
            const Value& coordinates = field(keyform, name);
            bool valid = coordinates.is<Array>();
            if (valid) for (const auto& coordinate : coordinates.get<Array>()) if (!finite(coordinate)) valid = false;
            const std::string field_path = path + "." + name;
            if (!valid) add(s, std::strcmp(name, "positions") == 0 ? "MESH_KEYFORM_POSITIONS_INVALID" :
                "MESH_KEYFORM_UVS_INVALID", field_path, id);
            else if (topology.is<Object>() && vertices.is<Array>() && coordinates.get<Array>().size() != expected)
                add(s, std::strcmp(name, "positions") == 0 ? "MESH_KEYFORM_POSITION_COUNT_MISMATCH" :
                    "MESH_KEYFORM_UV_COUNT_MISMATCH", field_path, id);
        }
        const Value& positions = field(keyform, "positions");
        const Value& indices = field(topology, "indices");
        if (topology.is<Object>() && vertices.is<Array>() && positions.is<Array>() &&
            positions.get<Array>().size() == expected && indices.is<Array>() && indices.get<Array>().size() % 3 == 0) {
            for (size_t offset = 0; offset < indices.get<Array>().size(); offset += 3) {
                int vertex_indices[3]{}; bool valid_triangle = true;
                for (size_t j = 0; j < 3; ++j) {
                    const Value& value = indices.get<Array>()[offset + j];
                    if (!valid_time(value) || value.get<double>() >= vertices.get<Array>().size()) valid_triangle = false;
                    else vertex_indices[j] = static_cast<int>(value.get<double>());
                }
                if (!valid_triangle) continue;
                auto coordinate = [&](int index, int dimension) {
                    const Value& value = positions.get<Array>()[static_cast<size_t>(index * 2 + dimension)];
                    return finite(value) ? value.get<double>() : std::numeric_limits<double>::quiet_NaN();
                };
                const int a = vertex_indices[0], b = vertex_indices[1], c = vertex_indices[2];
                const double area = std::abs((coordinate(b, 0) - coordinate(a, 0)) *
                    (coordinate(c, 1) - coordinate(a, 1)) - (coordinate(b, 1) - coordinate(a, 1)) *
                    (coordinate(c, 0) - coordinate(a, 0))) / 2;
                if (area <= 1e-8) add(s, "MESH_TOPOLOGY_TRIANGLE_ZERO_AREA", path + ".positions", id, "warning");
                else if (area < 1e-4) add(s, "MESH_TOPOLOGY_TRIANGLE_NEAR_DEGENERATE", path + ".positions", id, "warning");
            }
        }
        std::string context = str(field(keyform, "topologyId")); context.push_back('\0');
        context += str(field(keyform, "keyArtId")); context.push_back('\0');
        context += str(field(keyform, "semanticSlotId"));
        if (!keyform_keys.insert(context).second) add(s, "MESH_KEYFORM_DUPLICATE", path, id);
    }
    if (transitions.is<Array>()) for (size_t i = 0; i < transitions.get<Array>().size(); ++i) {
        const Value& transition = transitions.get<Array>()[i];
        const std::string path = "transitions." + std::to_string(i);
        if (!transition.is<Object>()) { add(s, "TRANSITION_INVALID", path); continue; }
        const std::string id = str(field(transition, "id"));
        if (!only_keys(transition, {"id", "displayName", "fromKeyArtId", "toKeyArtId", "temporalProgramId",
            "partTransitions", "diagnosticOverrides"})) add(s, "TRANSITION_INVALID", path, id);
        if (!nonblank(field(transition, "displayName"))) add(s, "TRANSITION_INVALID", path + ".displayName", id);
        const Value& from_id = field(transition, "fromKeyArtId"), &to_id = field(transition, "toKeyArtId");
        if (!contains_id(key_arts, from_id)) add(s, "TRANSITION_UNKNOWN_KEYART", path + ".fromKeyArtId", id);
        if (!contains_id(key_arts, to_id)) add(s, "TRANSITION_UNKNOWN_KEYART", path + ".toKeyArtId", id);
        if (from_id == to_id) add(s, "TRANSITION_SAME_KEYART", path, id);
        if (!contains_id(field(project, "temporalPrograms"), field(transition, "temporalProgramId")))
            add(s, "TRANSITION_UNKNOWN_PROGRAM", path + ".temporalProgramId", id);
        const Value& parts = field(transition, "partTransitions");
        if (!parts.is<Array>()) { add(s, "TRANSITION_INVALID", path + ".partTransitions", id); continue; }
        const Value& overrides = field(transition, "diagnosticOverrides");
        if (!overrides.is<Array>()) add(s, "TRANSITION_INVALID", path + ".diagnosticOverrides", id);
        else {
            std::set<std::string> override_keys;
            for (size_t j = 0; j < overrides.get<Array>().size(); ++j) {
                const Value& override = overrides.get<Array>()[j];
                const std::string override_path = path + ".diagnosticOverrides." + std::to_string(j);
                const Value& key = field(override, "key");
                if (!override.is<Object>() || !nonblank(key) || !nonblank(field(override, "code")) ||
                    !nonblank(field(override, "evidenceFingerprint"))) {
                    add(s, "TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", override_path, id); continue;
                }
                if (!only_keys(override, {"key", "code", "semanticSlotId", "timeTicks", "evidenceFingerprint"}))
                    add(s, "TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", override_path, id);
                if (!override_keys.insert(str(key)).second)
                    add(s, "TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", override_path + ".key", id);
                const Value& slot_id = field(override, "semanticSlotId"), &tick = field(override, "timeTicks");
                if (!slot_id.is<picojson::null>() && !contains_id(slots, slot_id))
                    add(s, "TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", override_path + ".semanticSlotId", id);
                if (!tick.is<picojson::null>() && !valid_time(tick))
                    add(s, "TRANSITION_DIAGNOSTIC_OVERRIDE_INVALID", override_path + ".timeTicks", id);
            }
        }
        std::set<std::string> part_slots;
        for (size_t j = 0; j < parts.get<Array>().size(); ++j) {
            const Value& part = parts.get<Array>()[j];
            const std::string part_path = path + ".partTransitions." + std::to_string(j);
            if (!part.is<Object>() || !nonblank(field(part, "id"))) {
                add(s, "TRANSITION_INVALID_PART", part_path, id); continue;
            }
            const std::string part_id = str(field(part, "id")), mode = str(field(part, "mode"));
            if (!only_keys(part, {"id", "semanticSlotId", "mode", "topologyId", "fromKeyformId", "toKeyformId", "configuration"}))
                add(s, "TRANSITION_INVALID_PART", part_path, part_id);
            const Value& configuration = field(part, "configuration");
            if (!configuration.is<Object>() || !only_keys(configuration, {"holdEndpoint", "compositeGroupId"}))
                add(s, "TRANSITION_INVALID_PART", part_path + ".configuration", part_id);
            if (configuration.is<Object>()) {
                const Value& hold = field(configuration, "holdEndpoint"), &group = field(configuration, "compositeGroupId");
                if (!hold.is<picojson::null>() && (mode != "hold" || (str(hold) != "from" && str(hold) != "to")))
                    add(s, "TRANSITION_INVALID_PART", part_path + ".configuration.holdEndpoint", part_id);
                if (!group.is<picojson::null>() && (mode != "replace" || !nonblank(group)))
                    add(s, "TRANSITION_INVALID_PART", part_path + ".configuration.compositeGroupId", part_id);
            }
            register_id(field(part, "id"), part_path + ".id");
            const Value& slot_id = field(part, "semanticSlotId");
            const Value& slot = find_id(slots, slot_id);
            if (!slot.is<Object>()) add(s, "TRANSITION_UNKNOWN_SLOT", part_path + ".semanticSlotId", part_id);
            if (!part_slots.insert(str(slot_id)).second)
                add(s, "TRANSITION_DUPLICATE_PART", part_path + ".semanticSlotId", part_id);
            const std::set<std::string> modes = {"morph", "hold", "replace", "appear", "disappear", "occlusion"};
            if (!modes.count(mode)) add(s, "TRANSITION_INVALID_MODE", part_path + ".mode", part_id);
            bool from_mapping = false, to_mapping = false;
            const Value& mappings = field(slot, "mappings");
            if (mappings.is<Array>()) for (const auto& mapping : mappings.get<Array>()) {
                if (field(mapping, "keyArtId") == from_id) from_mapping = true;
                if (field(mapping, "keyArtId") == to_id) to_mapping = true;
            }
            if (((mode == "morph" || mode == "replace" || mode == "occlusion") && (!from_mapping || !to_mapping)) ||
                (mode == "appear" && (from_mapping || !to_mapping)) ||
                (mode == "disappear" && (!from_mapping || to_mapping)) ||
                (mode == "hold" && !from_mapping && !to_mapping))
                add(s, "TRANSITION_INVALID_MODE_FOR_MAPPING", part_path + ".mode", part_id);
            if (mode == "morph") {
                const Value& topology_id = field(part, "topologyId");
                const Value& from_form = find_id(keyforms, field(part, "fromKeyformId"));
                const Value& to_form = find_id(keyforms, field(part, "toKeyformId"));
                if (!contains_id(topologies, topology_id))
                    add(s, "TRANSITION_TOPOLOGY_INCOMPATIBLE", part_path + ".topologyId", part_id);
                if (!from_form.is<Object>() || !to_form.is<Object>())
                    add(s, "TRANSITION_MISSING_KEYFORM", part_path, part_id);
                else if (field(from_form, "topologyId") != topology_id || field(to_form, "topologyId") != topology_id ||
                    field(from_form, "keyArtId") != from_id || field(to_form, "keyArtId") != to_id ||
                    field(from_form, "semanticSlotId") != slot_id || field(to_form, "semanticSlotId") != slot_id)
                    add(s, "TRANSITION_TOPOLOGY_INCOMPATIBLE", part_path, part_id);
            }
        }
    }
}
// Deterministic clipping relations shared by authored and evaluated cycle checks.
using ClippingRelations = std::vector<std::pair<std::string, std::string>>;
std::vector<std::vector<std::string>> clipping_cycles(ClippingRelations relations) {
    std::sort(relations.begin(), relations.end());
    std::map<std::string, std::string> sources;
    for (const auto& relation : relations) sources.emplace(relation.first, relation.second);
    std::set<std::string> visited;
    std::vector<std::vector<std::string>> result;
    for (const auto& [start, unused] : sources) {
        (void)unused;
        std::vector<std::string> stack;
        std::map<std::string, size_t> positions;
        std::string cursor = start;
        while (sources.count(cursor) && !visited.count(cursor)) {
            auto found = positions.find(cursor);
            if (found != positions.end()) {
                std::vector<std::string> cycle(stack.begin() + static_cast<std::ptrdiff_t>(found->second), stack.end());
                std::rotate(cycle.begin(), std::min_element(cycle.begin(), cycle.end()), cycle.end());
                result.push_back(std::move(cycle));
                break;
            }
            positions.emplace(cursor, stack.size()); stack.push_back(cursor);
            cursor = sources.at(cursor);
        }
        visited.insert(stack.begin(), stack.end());
    }
    std::sort(result.begin(), result.end());
    return result;
}
std::string clipping_cycle_key(std::vector<std::string> nodes) {
    std::sort(nodes.begin(), nodes.end());
    std::string result;
    for (const auto& node : nodes) { result += node; result.push_back('\0'); }
    return result;
}
const Value& clipping_binding(const Value& project, const Value& target) {
    static const Value missing;
    const Value* result = &missing;
    const Value& bindings = field(project, "clippingBindings");
    if (bindings.is<Array>()) for (const auto& binding : bindings.get<Array>())
        if (field(binding, "targetNodeId") == target &&
            (result == &missing || str(field(binding, "id")) < str(field(*result, "id")))) result = &binding;
    return *result;
}
bool enabled_clipping(const Value& binding) {
    return field(binding, "enabled").is<bool>() && field(binding, "enabled").get<bool>();
}
// Validation only needs instance identity, presence and clipping edges. Geometry
// cannot change these edges. Endpoint rendering bypasses temporal overrides.
Value clipping_sample(const Value& keys, double ticks) {
    if (!keys.is<Array>() || keys.get<Array>().empty()) return Value();
    Array ordered = keys.get<Array>();
    for (const auto& key : ordered) if (!finite(field(key, "timeTicks"))) return Value();
    std::stable_sort(ordered.begin(), ordered.end(), [](const Value& a, const Value& b) {
        const auto left = field(a, "timeTicks").get<double>(), right = field(b, "timeTicks").get<double>();
        return left == right ? str(field(a, "id")) < str(field(b, "id")) : left < right;
    });
    if (ticks <= field(ordered.front(), "timeTicks").get<double>()) return field(ordered.front(), "value");
    if (ticks >= field(ordered.back(), "timeTicks").get<double>()) return field(ordered.back(), "value");
    for (size_t i = 1; i < ordered.size(); ++i) {
        const auto end = field(ordered[i], "timeTicks").get<double>();
        if (end < ticks) continue;
        const Value& left = field(ordered[i - 1], "value"), &right = field(ordered[i], "value");
        if (end == ticks) return right;
        const Value& interpolation = field(ordered[i - 1], "interpolationToNext");
        if (str(field(interpolation, "kind")) == "step") return left;
        const double start = field(ordered[i - 1], "timeTicks").get<double>();
        double progress = (ticks - start) / (end - start);
        if (str(field(interpolation, "kind")) == "bezier") {
            auto cubic = [](double t, double a, double b) {
                const double inverse = 1 - t;
                return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
            };
            for (const char* key : {"x1", "x2", "y1", "y2"}) if (!finite(field(interpolation, key))) return Value();
            double low = 0, high = 1;
            for (int iteration = 0; iteration < 60; ++iteration) {
                const double mid = (low + high) / 2;
                if (cubic(mid, field(interpolation, "x1").get<double>(), field(interpolation, "x2").get<double>()) < progress) low = mid;
                else high = mid;
            }
            progress = cubic((low + high) / 2, field(interpolation, "y1").get<double>(), field(interpolation, "y2").get<double>());
        }
        if (finite(left) && finite(right)) return Value(left.get<double>() + (right.get<double>() - left.get<double>()) * progress);
        if (left.is<Object>() && right.is<Object>()) {
            Object result;
            std::set<std::string> keys_union;
            for (const auto& [key, value] : left.get<Object>()) { (void)value; keys_union.insert(key); }
            for (const auto& [key, value] : right.get<Object>()) { (void)value; keys_union.insert(key); }
            for (const auto& key : keys_union) {
                const Value a = field(left, key).is<picojson::null>() ? Value(0.0) : field(left, key);
                const Value b = field(right, key).is<picojson::null>() ? Value(0.0) : field(right, key);
                if (finite(a) && finite(b)) result[key] = Value(a.get<double>() + (b.get<double>() - a.get<double>()) * progress);
                else if (a == b) result[key] = a;
                else return left;
            }
            return Value(result);
        }
        return left;
    }
    return Value();
}
Value clipping_track_value(const Value& program, double ticks, const char* kind, const char* channel,
    const Value& slot_id, const Value& node_id = Value()) {
    const Value& tracks = field(program, "tracks");
    Value result;
    int priority = 0;
    std::string selected_id;
    if (tracks.is<Array>()) for (const auto& track : tracks.get<Array>()) {
        if (str(field(track, "kind")) != kind) continue;
        const Value sample = clipping_sample(field(field(field(track, "channels"), channel), "keyframes"), ticks);
        if (sample.is<picojson::null>()) continue;
        const Value& target = field(track, "target");
        const int rank = field(target, "semanticSlotId") == slot_id ? 3 :
            !node_id.is<picojson::null>() && field(target, "nodeId") == node_id ? 2 :
            field(target, "transitionDefault") == Value(true) ? 1 : 0;
        const std::string id = str(field(track, "trackId"));
        if (rank > 0 && (rank > priority || (rank == priority && id < selected_id))) {
            priority = rank; selected_id = id; result = sample;
        }
    }
    return result;
}
const Value& clipping_member(const Value& project, const Value& art, const Value& slot) {
    static const Value missing;
    const Value& mappings = field(slot, "mappings"), &members = field(art, "members");
    if (!mappings.is<Array>() || !members.is<Array>()) return missing;
    for (const auto& mapping : mappings.get<Array>()) if (field(mapping, "keyArtId") == field(art, "id")) {
        if (!has(field(field(project, "scene"), "nodes"), str(field(mapping, "nodeId")))) return missing;
        for (const auto& member : members.get<Array>()) if (field(member, "nodeId") == field(mapping, "nodeId")) return member;
        break;
    }
    return missing;
}
struct ClippingInstance { std::string id, slot, node, source; };
std::vector<ClippingInstance> transition_clipping_instances(const Value& project, const Value& transition,
    const Value& program, double ticks) {
    std::vector<ClippingInstance> result;
    const Value& from_art = find_id(field(project, "keyArts"), field(transition, "fromKeyArtId"));
    const Value& to_art = find_id(field(project, "keyArts"), field(transition, "toKeyArtId"));
    const Value& slots = field(project, "semanticSlots"), &parts = field(transition, "partTransitions");
    if (!from_art.is<Object>() || !to_art.is<Object>() || !slots.is<Array>() || !parts.is<Array>()) return result;
    const double duration = field(program, "durationTicks").get<double>(), u = ticks / duration;
    for (const auto& slot : slots.get<Array>()) {
        const Value& from = clipping_member(project, from_art, slot), &to = clipping_member(project, to_art, slot);
        const Value* part = nullptr;
        for (const auto& entry : parts.get<Array>()) if (field(entry, "semanticSlotId") == field(slot, "id")) part = &entry;
        const std::string prefix = str(field(transition, "id")) + ":" + str(field(slot, "id")) + ":";
        auto sample = [&](const char* kind, const char* channel, const Value& node = Value()) {
            return clipping_track_value(program, ticks, kind, channel, field(slot, "id"), node);
        };
        auto emit = [&](const Value& state, const std::string& suffix, bool endpoint) {
            if (!state.is<Object>()) return;
            const Value& node = field(state, "nodeId"), &binding = clipping_binding(project, node);
            std::string source;
            if (!binding.is<Object>() || enabled_clipping(binding)) {
                const Value authored = endpoint ? Value() : sample("ClippingTrack", "clipping", node);
                if (!authored.is<picojson::null>()) source = str(field(authored, "sourceNodeId"));
                else {
                    source = str(field(field(state, "clipping"), "sourceNodeId"));
                    if (source.empty() && enabled_clipping(binding)) source = str(field(binding, "sourceNodeId"));
                }
            }
            result.push_back({prefix + suffix, str(field(slot, "id")), str(node), source});
        };
        if (ticks == 0 || ticks == duration) {
            const Value& state = ticks == 0 ? from : to;
            if (str(field(state, "presence")) == "present") emit(state, ticks == 0 ? "from" : "to", true);
            continue;
        }
        if (!part) continue;
        const std::string mode = str(field(*part, "mode"));
        if (mode == "morph") {
            if (!from.is<Object>() || !to.is<Object>()) return {};
            const Value authored = sample("PresenceTrack", "presence");
            const auto presence = authored.is<picojson::null>() ? field(u < 0.5 ? from : to, "presence") : authored;
            if (str(presence) != "present") continue;
            const Value weight = sample("GeometryBlendTrack", "geometryWeight");
            const double geometry = finite(weight) ? std::clamp(weight.get<double>(), 0.0, 1.0) : u;
            // Morph source identity follows geometry, authored clipping follows time.
            const Value& selected = u < 0.5 ? from : to;
            emit(selected, "morph", false);
            result.back().node = str(field(geometry < 1 ? from : to, "nodeId"));
        } else if (mode == "replace") {
            const Value presence = sample("PresenceTrack", "presence");
            if (!presence.is<picojson::null>() && str(presence) != "present") continue;
            Value weights = sample("AppearanceTrack", "appearance");
            if (weights.is<picojson::null>()) {
                Object defaults;
                if (from.is<Object>()) defaults[str(field(from, "appearanceId"))] = Value(1 - u);
                if (to.is<Object>()) {
                    auto& value = defaults[str(field(to, "appearanceId"))];
                    value = Value((finite(value) ? value.get<double>() : 0) + u);
                }
                weights = Value(defaults);
            }
            for (const auto& endpoint : {std::make_pair(&from, "from"), std::make_pair(&to, "to")}) {
                const Value& state = *endpoint.first;
                const Value& weight = field(weights, str(field(state, "appearanceId")));
                if (str(field(state, "presence")) == "present" && finite(weight) && weight.get<double>() > 0)
                    emit(state, endpoint.second, false);
            }
        } else {
            const Value* state = &from;
            std::string presence;
            if (mode == "hold") {
                state = str(field(field(*part, "configuration"), "holdEndpoint")) == "to" ? &to : from.is<Object>() ? &from : &to;
                presence = str(field(*state, "presence"));
            } else if (mode == "appear") { state = &to; presence = "present"; }
            else if (mode == "disappear") presence = "present";
            else if (mode == "occlusion") presence = u < 0.5 ? str(field(from, "presence")) : "occluded";
            else continue;
            const Value authored = sample("PresenceTrack", "presence", field(*state, "nodeId"));
            if (!authored.is<picojson::null>()) presence = str(authored);
            if (presence == "present") emit(*state, mode, false);
        }
    }
    return result;
}
void validate_evaluated_clipping(Snapshot& s, const Value& project, std::set<std::string>& seen_cycles) {
    const Value& transitions = field(project, "transitions"), &slots = field(project, "semanticSlots");
    if (!transitions.is<Array>()) return;
    Array ordered = transitions.get<Array>();
    std::stable_sort(ordered.begin(), ordered.end(), [](const Value& a, const Value& b) { return str(field(a, "id")) < str(field(b, "id")); });
    for (const auto& transition : ordered) {
        const Value& program = find_id(field(project, "temporalPrograms"), field(transition, "temporalProgramId"));
        if (!positive_time(field(program, "durationTicks"))) continue;
        const double duration = field(program, "durationTicks").get<double>();
        std::set<double> times{0, duration};
        if (duration > 1) times.insert(1);
        if (duration > 2) times.insert(duration - 1);
        const Value& tracks = field(program, "tracks");
        if (tracks.is<Array>()) for (const auto& track : tracks.get<Array>()) {
            const Value& keys = field(field(field(track, "channels"), "clipping"), "keyframes");
            if (str(field(track, "kind")) != "ClippingTrack" || !keys.is<Array>()) continue;
            for (const auto& key : keys.get<Array>()) if (valid_time(field(key, "timeTicks"))) {
                const double time = field(key, "timeTicks").get<double>();
                if (time > duration) continue;
                times.insert(time);
                if (time > 0) times.insert(time - 1);
                if (time < duration) times.insert(time + 1);
            }
        }
        for (const double time : times) {
            const auto instances = transition_clipping_instances(project, transition, program, time);
            ClippingRelations relations;
            std::map<std::string, std::string> nodes;
            for (const auto& instance : instances) nodes[instance.id] = instance.node;
            for (const auto& target : instances) {
                if (target.source.empty() || str(field(field(field(field(project, "scene"), "nodes"), target.source), "kind")) != "part") continue;
                std::set<std::string> candidates;
                for (const auto& source : instances) if (source.node == target.source) candidates.insert(source.id);
                if (candidates.empty() && slots.is<Array>()) for (const auto& slot : slots.get<Array>()) {
                    const Value& mappings = field(slot, "mappings");
                    bool mapped = false;
                    if (mappings.is<Array>()) for (const auto& mapping : mappings.get<Array>())
                        if (str(field(mapping, "nodeId")) == target.source) mapped = true;
                    if (mapped) for (const auto& source : instances) if (source.slot == str(field(slot, "id"))) candidates.insert(source.id);
                }
                if (candidates.size() == 1) relations.emplace_back(target.id, *candidates.begin());
            }
            for (const auto& cycle : clipping_cycles(relations)) {
                std::set<std::string> node_set;
                for (const auto& instance_id : cycle) if (!nodes[instance_id].empty()) node_set.insert(nodes[instance_id]);
                if (!node_set.empty() && seen_cycles.insert(clipping_cycle_key({node_set.begin(), node_set.end()})).second)
                    add(s, "CLIPPING_CYCLE", "transitions", str(field(transition, "id")));
            }
        }
    }
}
void validate_transition_clipping(Snapshot& s, const Value& project) {
    const Value& nodes = field(field(project, "scene"), "nodes");
    const Value& arts = field(project, "keyArts");
    const Value& programs = field(project, "temporalPrograms");
    auto renderable = [&](const std::string& id) {
        return str(field(field(nodes, id), "kind")) == "part";
    };
    std::set<std::string> seen, seen_cycles;
    ClippingRelations binding_relations;
    const Value& bindings = field(project, "clippingBindings");
    if (bindings.is<Array>()) for (const auto& binding : bindings.get<Array>()) {
        const auto target = str(field(binding, "targetNodeId")), source = str(field(binding, "sourceNodeId"));
        if (enabled_clipping(binding) && target != source && renderable(target) && renderable(source))
            binding_relations.emplace_back(target, source);
    }
    for (const auto& cycle : clipping_cycles(binding_relations)) seen_cycles.insert(clipping_cycle_key(cycle));
    auto unique_add = [&](const char* code, const std::string& path, const std::string& entity) {
        std::string key(code); key.push_back('\0'); key += path; key.push_back('\0'); key += entity;
        if (seen.insert(key).second) add(s, code, path, entity);
    };
    if (arts.is<Array>()) for (size_t i = 0; i < arts.get<Array>().size(); ++i) {
        const Value& art = arts.get<Array>()[i];
        const Value& members = field(art, "members");
        if (!members.is<Array>()) continue;
        ClippingRelations relations;
        for (size_t j = 0; j < members.get<Array>().size(); ++j) {
            const Value& member = members.get<Array>()[j];
            const std::string source = str(field(field(member, "clipping"), "sourceNodeId"));
            const std::string target = str(field(member, "nodeId"));
            const Value& binding = clipping_binding(project, field(member, "nodeId"));
            if (!binding.is<Object>() || enabled_clipping(binding)) {
                const auto effective = !source.empty() ? source : enabled_clipping(binding) ? str(field(binding, "sourceNodeId")) : "";
                if (!effective.empty() && effective != target) relations.emplace_back(target, effective);
            }
            if (source.empty()) continue;
            const std::string path = "keyArts." + std::to_string(i) + ".members." + std::to_string(j) + ".clipping.sourceNodeId";
            if (source == target) unique_add("CLIPPING_SELF_REFERENCE", path, target);
            if (has(nodes, target) && !renderable(target)) unique_add("CLIPPING_TARGET_NOT_RENDERABLE", path, target);
            if (has(nodes, source) && !renderable(source)) unique_add("CLIPPING_SOURCE_NOT_RENDERABLE", path, source);
        }
        for (const auto& cycle : clipping_cycles(relations))
            if (seen_cycles.insert(clipping_cycle_key(cycle)).second)
                add(s, "CLIPPING_CYCLE", "keyArts." + std::to_string(i) + ".members", str(field(art, "id")));
    }
    if (programs.is<Array>()) for (size_t i = 0; i < programs.get<Array>().size(); ++i) {
        const Value& program = programs.get<Array>()[i];
        const Value& tracks = field(program, "tracks");
        if (!tracks.is<Array>()) continue;
        for (size_t j = 0; j < tracks.get<Array>().size(); ++j) {
            const Value& track = tracks.get<Array>()[j];
            if (str(field(track, "kind")) != "ClippingTrack") continue;
            const Value& target = field(track, "target");
            std::set<std::string> targets;
            if (!str(field(target, "nodeId")).empty()) targets.insert(str(field(target, "nodeId")));
            const Value& slots = field(project, "semanticSlots");
            if (!str(field(target, "semanticSlotId")).empty()) {
                const Value& slot = find_id(slots, field(target, "semanticSlotId"));
                const Value& mappings = field(slot, "mappings");
                if (mappings.is<Array>()) for (const auto& mapping : mappings.get<Array>()) targets.insert(str(field(mapping, "nodeId")));
            }
            if (targets.empty() && field(target, "transitionDefault") == Value(true)) {
                const Value& transitions = field(project, "transitions");
                if (transitions.is<Array>() && slots.is<Array>()) for (const auto& transition : transitions.get<Array>()) {
                    if (field(transition, "temporalProgramId") != field(program, "id")) continue;
                    const Value& parts = field(transition, "partTransitions");
                    if (!parts.is<Array>()) continue;
                    for (const auto& slot : slots.get<Array>()) {
                        bool used = false;
                        for (const auto& part : parts.get<Array>()) if (field(part, "semanticSlotId") == field(slot, "id")) used = true;
                        const Value& mappings = field(slot, "mappings");
                        if (!used || !mappings.is<Array>()) continue;
                        for (const auto& mapping : mappings.get<Array>())
                            if (field(mapping, "keyArtId") == field(transition, "fromKeyArtId") ||
                                field(mapping, "keyArtId") == field(transition, "toKeyArtId")) targets.insert(str(field(mapping, "nodeId")));
                    }
                }
            }
            const Value& keys = field(field(field(track, "channels"), "clipping"), "keyframes");
            if (!keys.is<Array>()) continue;
            for (size_t k = 0; k < keys.get<Array>().size(); ++k) {
                const std::string source = str(field(field(keys.get<Array>()[k], "value"), "sourceNodeId"));
                if (source.empty()) continue;
                const std::string path = "temporalPrograms." + std::to_string(i) + ".tracks." +
                    std::to_string(j) + ".channels.clipping.keyframes." + std::to_string(k) + ".value.sourceNodeId";
                if (has(nodes, source) && !renderable(source)) unique_add("CLIPPING_SOURCE_NOT_RENDERABLE", path, source);
                for (const auto& node : targets) {
                    if (has(nodes, node) && !renderable(node))
                        unique_add("CLIPPING_TARGET_NOT_RENDERABLE", path, str(field(track, "trackId")));
                    if (source == node) unique_add("CLIPPING_SELF_REFERENCE", path, str(field(track, "trackId")));
                }
            }
        }
    }
    validate_evaluated_clipping(s, project, seen_cycles);
}
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
            const TrackDefinition definition = track_definition(kind);
            if (!definition.target) {
                add(s, "ANIMATION_UNKNOWN_TRACK_KIND", track_path + ".kind", str(track_id));
                continue;
            }
            if (!finite(field(track, "version")) || field(track, "version").get<double>() != 1)
                add(s, "ANIMATION_TRACK_VERSION_UNSUPPORTED", track_path + ".version", str(track_id));
            validate_track_target(s, project, program, track, definition, track_path + ".target");
            const Value& channels = field(track, "channels");
            if (!channels.is<Object>() || channels.get<Object>().empty())
                add(s, "ANIMATION_INVALID_CHANNEL", track_path + ".channels", str(track_id));
            else for (const auto& [channel_name, channel] : channels.get<Object>()) {
                const std::string channel_path = track_path + ".channels." + channel_name;
                if (!definition.channels.count(channel_name)) {
                    add(s, "ANIMATION_INVALID_CHANNEL", channel_path, str(track_id)); continue;
                }
                const Value& keyframes = field(channel, "keyframes");
                if (!channel.is<Object>() || !keyframes.is<Array>()) {
                    add(s, "ANIMATION_INVALID_CHANNEL", channel_path, str(track_id)); continue;
                }
                if (!exact(channel, {"keyframes"})) add(s, "ANIMATION_INVALID_CHANNEL", channel_path, str(track_id));
                std::set<double> times;
                for (size_t k = 0; k < keyframes.get<Array>().size(); ++k) {
                    const Value& key = keyframes.get<Array>()[k];
                    const std::string key_path = channel_path + ".keyframes." + std::to_string(k);
                    const Value& key_id = field(key, "id");
                    if (!key.is<Object>() || !key_id.is<std::string>() || str(key_id).empty()) {
                        add(s, "identity.missing", key_path + ".id"); continue;
                    }
                    register_id(key_id, key_path + ".id");
                    if (!exact(key, {"id", "timeTicks", "value", "interpolationToNext"}))
                        add(s, "ANIMATION_INVALID_KEYFRAME", key_path, str(key_id));
                    const Value& tick = field(key, "timeTicks");
                    if (!valid_time(tick)) add(s, "ANIMATION_INVALID_TIME", key_path + ".timeTicks", str(key_id));
                    else {
                        if (finite(duration) && tick.get<double>() > duration.get<double>())
                            add(s, "ANIMATION_KEY_OUTSIDE_PROGRAM", key_path + ".timeTicks", str(key_id));
                        if (!times.insert(tick.get<double>()).second)
                            add(s, "ANIMATION_DUPLICATE_KEY_TIME", key_path + ".timeTicks", str(key_id));
                    }
                    std::string value_type = definition.value;
                    if ((kind == "TransformTrack" && (channel_name == "scaleX" || channel_name == "scaleY")) ||
                        (kind == "CameraTrack" && channel_name == "scale")) value_type = "positive-number";
                    validate_track_value(s, project, track, value_type, field(key, "value"), key_path + ".value");
                    validate_curve(s, field(key, "interpolationToNext"), key_path + ".interpolationToNext",
                        definition.discrete, value_type == "positive-number");
                }
                if (kind == "MeshDeformationTrack" && channel_name == "deformation") {
                    Array ordered = keyframes.get<Array>();
                    std::stable_sort(ordered.begin(), ordered.end(), [](const Value& a, const Value& b) {
                        const Value& at = field(a, "timeTicks"), &bt = field(b, "timeTicks");
                        return (finite(at) ? at.get<double>() : 0) < (finite(bt) ? bt.get<double>() : 0);
                    });
                    for (size_t k = 1; k < ordered.size(); ++k) {
                        const Value& previous = ordered[k - 1], &next = ordered[k];
                        if (str(field(field(previous, "interpolationToNext"), "kind")) != "step" &&
                            field(field(previous, "value"), "deformationSampleId") !=
                                field(field(next, "value"), "deformationSampleId"))
                            add(s, "ANIMATION_MESH_SAMPLE_INCOMPATIBLE", channel_path, str(track_id));
                    }
                }
            }
            const std::set<std::string> transition_kinds = {"GeometryBlendTrack", "AppearanceTrack", "OpacityTrack", "PresenceTrack", "DrawOrderTrack", "ClippingTrack"};
            const std::set<std::string> clip_kinds = {"TransformTrack", "BoneTrack", "DeformerTrack", "MeshDeformationTrack", "OpacityTrack", "PresenceTrack", "DrawOrderTrack", "ClippingTrack"};
            if (kind == "CameraTrack") ++camera_count;
            if ((kind == "CameraTrack" && (!sole || sole->kind != "Sequence")) ||
                (sole && sole->kind == "Sequence" && kind != "CameraTrack") ||
                (sole && sole->kind == "Transition" && !transition_kinds.count(kind)) ||
                (sole && sole->kind == "AnimationClip" && !clip_kinds.count(kind)))
                add(s, "ANIMATION_TRACK_OWNER_INVALID", track_path + ".kind", str(track_id).empty() ? str(id) : str(track_id));
        }
        std::set<std::string> channel_owners;
        for (const auto& track : tracks.get<Array>()) {
            const std::string kind = str(field(track, "kind"));
            const Value& target = field(track, "target"), &channels = field(track, "channels");
            if (kind.empty() || !target.is<Object>() || !channels.is<Object>()) continue;
            for (const auto& [name, unused] : channels.get<Object>()) {
                (void)unused;
                const std::string key = kind + "\n" + target.serialize() + "\n" + name;
                if (!channel_owners.insert(key).second)
                    add(s, "ANIMATION_TRACK_CONFLICT", path + ".tracks", str(id));
            }
        }
        std::vector<const Value*> draw_tracks;
        std::set<double> sample_times = {0};
        if (finite(duration)) sample_times.insert(duration.get<double>());
        for (const auto& track : tracks.get<Array>()) {
            if (str(field(track, "kind")) != "DrawOrderTrack") continue;
            const Value& keys = field(field(field(track, "channels"), "drawOrder"), "keyframes");
            if (!keys.is<Array>()) continue;
            bool valid = true;
            for (const auto& key : keys.get<Array>()) {
                if (!field(key, "id").is<std::string>() || !valid_time(field(key, "timeTicks")) ||
                    !safe_integer(field(key, "value")) || str(field(field(key, "interpolationToNext"), "kind")) != "step") valid = false;
                else if (finite(duration) && field(key, "timeTicks").get<double>() <= duration.get<double>())
                    sample_times.insert(field(key, "timeTicks").get<double>());
            }
            if (valid) draw_tracks.push_back(&track);
        }
        if (draw_tracks.size() > 1) for (const double tick : sample_times) {
            std::map<double, size_t> orders;
            for (const auto* track : draw_tracks) {
                const Value& keys = field(field(field(*track, "channels"), "drawOrder"), "keyframes");
                std::vector<const Value*> ordered;
                for (const auto& key : keys.get<Array>()) ordered.push_back(&key);
                std::sort(ordered.begin(), ordered.end(), [](const Value* a, const Value* b) {
                    const double at = field(*a, "timeTicks").get<double>();
                    const double bt = field(*b, "timeTicks").get<double>();
                    return at == bt ? str(field(*a, "id")) < str(field(*b, "id")) : at < bt;
                });
                const Value* selected = ordered.empty() ? nullptr : ordered.front();
                for (const auto* key : ordered) if (field(*key, "timeTicks").get<double>() <= tick) selected = key;
                if (selected) ++orders[field(*selected, "value").get<double>()];
            }
            for (const auto& [unused, count] : orders) {
                (void)unused;
                if (count > 1) add(s, "ANIMATION_TRACK_CONFLICT", path + ".tracks", str(id));
            }
        }
        if (sole && sole->kind == "Sequence" && camera_count > 1)
            add(s, "SEQUENCE_CAMERA_TRACK_MULTIPLE", path + ".tracks", sole->id);
        const std::set<std::string> event_types = {"contact", "release", "blink", "occlusion_change",
            "depth_crossing", "pose_switch", "marker"};
        const std::set<std::string> region_types = {"idle", "anticipation", "action", "contact", "settle", "hold"};
        for (size_t j = 0; j < events.get<Array>().size(); ++j) {
            const Value& event = events.get<Array>()[j];
            const std::string item_path = path + ".events." + std::to_string(j);
            const Value& event_id = field(event, "id");
            if (!event.is<Object>() || !event_id.is<std::string>() || str(event_id).empty()) {
                add(s, "identity.missing", item_path + ".id"); continue;
            }
            register_id(event_id, item_path + ".id");
            if (!exact(event, {"id", "timeTicks", "type", "participants", "payload"}))
                add(s, "ANIMATION_INVALID_EVENT", item_path, str(event_id));
            const Value& tick = field(event, "timeTicks");
            if (!valid_time(tick) || (finite(duration) && valid_time(tick) && tick.get<double>() > duration.get<double>()))
                add(s, "ANIMATION_INVALID_TIME", item_path + ".timeTicks", str(event_id));
            if (!event_types.count(str(field(event, "type"))))
                add(s, "ANIMATION_INVALID_EVENT", item_path + ".type", str(event_id));
            const Value& participants = field(event, "participants");
            bool participants_valid = participants.is<Array>();
            if (participants_valid) for (const auto& member : participants.get<Array>())
                if (!member.is<std::string>() || str(member).empty()) participants_valid = false;
            if (!participants_valid) add(s, "ANIMATION_INVALID_EVENT", item_path + ".participants", str(event_id));
            if (participants.is<Array>()) for (const auto& member : participants.get<Array>()) {
                const Value& nodes = field(field(project, "scene"), "nodes");
                if ((!nodes.is<Object>() || !has(nodes, str(member))) &&
                    !contains_id(field(project, "semanticSlots"), member))
                    add(s, "ANIMATION_UNKNOWN_TARGET", item_path + ".participants", str(member));
            }
            if (!field(event, "payload").is<Object>())
                add(s, "ANIMATION_INVALID_EVENT", item_path + ".payload", str(event_id));
        }
        for (size_t j = 0; j < regions.get<Array>().size(); ++j) {
            const Value& region = regions.get<Array>()[j];
            const std::string item_path = path + ".regions." + std::to_string(j);
            const Value& region_id = field(region, "id");
            if (!region.is<Object>() || !region_id.is<std::string>() || str(region_id).empty()) {
                add(s, "identity.missing", item_path + ".id"); continue;
            }
            register_id(region_id, item_path + ".id");
            if (!exact(region, {"id", "startTicks", "endTicks", "type", "metadata"}))
                add(s, "ANIMATION_INVALID_REGION", item_path, str(region_id));
            const Value& start = field(region, "startTicks"), &end = field(region, "endTicks");
            if (!valid_time(start) || !valid_time(end) || (valid_time(start) && valid_time(end) &&
                start.get<double>() > end.get<double>()) || (valid_time(end) && finite(duration) &&
                end.get<double>() > duration.get<double>())) add(s, "ANIMATION_INVALID_TIME", item_path, str(region_id));
            if (!region_types.count(str(field(region, "type"))))
                add(s, "ANIMATION_INVALID_REGION", item_path + ".type", str(region_id));
            if (!field(region, "metadata").is<Object>())
                add(s, "ANIMATION_INVALID_REGION", item_path + ".metadata", str(region_id));
        }
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
            part_node(source) && (!dependencies.count(target) || id < dependencies.at(target).second))
            dependencies[target] = std::make_pair(source, id);
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
    validate_transition_domain(s, project, register_id);
    validate_animation_clips(s, project);
    validate_deformation_samples(s, project);
    validate_sequences(s, project, register_id);
    validate_clipping(s, project, register_id);
    validate_transition_clipping(s, project);
    validate_warp(s, project, register_id);
    validate_bones(s, project);
    validate_rotation_constraints(s, project);
    validate_ik_constraints(s, project);
    validate_skin(s, project, register_id);
    validate_mesh_form_corrections(s, project);
    validate_rigid_bindings(s, project, register_id);
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
