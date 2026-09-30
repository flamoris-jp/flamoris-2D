#pragma once
#include "native_commands.h"
#include <array>
#include <map>
#include <set>
namespace fl2d_evaluation {
using fl2d_commands::Value;
using fl2d_commands::Object;
using fl2d_commands::Array;
std::string canonical_evidence(const Value& value);
Value sequence_diagnostic(const Value& id, const char* code, const Object& details);
Value sequence_frame(const Value& project, const Value& sequence, double ticks);
Value transition_diagnostics(const Value& project, const Value& transition);
Value frame_diagnostic(const Value& owner_id, bool key_art, const char* code, const char* severity,
    const Value& slot, const Value& ticks, const Object& details);
void order_diagnostics(Array& values);
void acknowledge(Array& values, const Value& transition);
// Disposable evaluation contributions, never an editable Project/session.
struct FrameAnimation {
    Value sequence_id;
    std::map<std::string,Value> transforms, discrete;
    std::map<std::string,std::array<double,3>> bone_deltas;
    std::map<std::string,std::array<double,2>> warp_deltas;
    std::map<std::string,double> opacity;
    Array mesh_entries, diagnostics;
    std::set<std::string> active_warps, active_topologies, applied_mesh_entries;
};
Value transition_frame(const Value& project, const Value& transition, double ticks, FrameAnimation* animation = nullptr);
Value keyart_frame(const Value& project, const Value& key_art, const Value& evaluation_id, FrameAnimation* animation = nullptr);
}
