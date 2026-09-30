#pragma once
#include "flamoris2d_core.h"
#include "picojson.h"
#include <string>
#include <vector>
namespace fl2d_commands {
using Value = picojson::value;
using Object = picojson::object;
using Array = picojson::array;
struct Failure { fl2d_status status; const char* code; };
struct Applied { Value inverse; std::vector<std::string> ids; };
inline const Value& field(const Value& value, const std::string& key) {
    static const Value missing;
    if (!value.is<Object>()) return missing;
    const auto& object = value.get<Object>();
    auto it = object.find(key);
    return it == object.end() ? missing : it->second;
}
void assert_command(const Value& command, bool allow_internal);
Applied apply(Value& project, const Value& command);
bool apply_bone_hierarchy(Value& project, const std::string& type, const Value& payload, Applied& result);
bool apply_warp(Value& project, const std::string& type, const Value& payload, Applied& result);
}
