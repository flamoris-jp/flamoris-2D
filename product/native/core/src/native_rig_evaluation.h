#pragma once
#include "native_commands.h"
#include "native_math.h"
#include <map>
namespace fl2d_evaluation {
using fl2d_commands::Value;
using fl2d_commands::Object;
using fl2d_commands::Array;
// Pure projections of the existing session snapshot, shared by frame evaluation.
Value bone_fk(const Value& project, const Value& key_art, bool projected = false,
    const std::map<std::string, Value>& pose_overrides = {});
Value ik_chain(const Value& project, const Value& constraint_id, const Value& key_art);
Value solve_ik(const Value& project, const Value& input);
Value skin(const Value& project, const Value& binding, const Value& key_art, const Value& positions);
Value form(const Value& topology, const Value& keyform, const Value& positions);
}
