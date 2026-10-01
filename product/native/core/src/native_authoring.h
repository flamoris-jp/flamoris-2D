#pragma once
#include "native_commands.h"
#include "native_queries.h"
#include <iomanip>
#include <sstream>
namespace fl2d_authoring {
using namespace fl2d_commands;
inline std::string text(const Value &v) {
  return v.is<std::string>() ? v.get<std::string>() : "";
}
inline bool truthy(const Value &v) {
  return v.is<bool>()          ? v.get<bool>()
         : v.is<std::string>() ? !v.get<std::string>().empty()
         : v.is<double>()      ? v.get<double>() != 0
                               : v.is<Object>() || v.is<Array>();
}
inline double number(const Value &v, double fallback = 0) {
  return v.is<double>() ? v.get<double>() : fallback;
}
inline void error(const std::string &message) {
  throw fl2d_queries::Error{"Error", message};
}
inline Value query(const Value &p, const std::string &name,
                   const Object &input = {}) {
  auto result = fl2d_queries::query(p, name, Value(input));
  if (field(result, "error").is<Object>())
    throw fl2d_queries::Error{text(field(field(result, "error"), "name")),
                              text(field(field(result, "error"), "message"))};
  return field(result, "value");
}
inline Value find(const Value &list, const Value &id) {
  if (list.is<Array>())
    for (const auto &item : list.get<Array>())
      if (field(item, "id") == id)
        return item;
  return Value();
}
inline Value command(const std::string &type, const Object &payload) {
  return Value(Object{{"type", Value(type)}, {"payload", Value(payload)}});
}
inline Value plan(const Array &commands, const std::string &label,
                  const Object &result = {}) {
  return Value(Object{{"commands", Value(commands)},
                      {"label", Value(label)},
                      {"result", Value(result)}});
}
struct Ids {
  std::string prefix;
  unsigned sequence = 0;
  explicit Ids(const Value &input) : prefix(text(field(input, "idNamespace"))) {
    if (prefix.empty() || prefix.size() > 128)
      error("Authoring requires a bounded ID namespace.");
  }
  Value next(const std::string &kind) {
    std::ostringstream s;
    s << kind << "_" << prefix << "_" << std::setw(4) << std::setfill('0')
      << ++sequence;
    return Value(s.str());
  }
};
Value timeline_state(const Value &project, const Value &context);
Value transition_diagnostics(const Value &id, const Value &validation,
                             const Value &evaluation, const Value &failure);
Value timeline_tool(const Value &project, const Value &input);
Value playback_tick(const Value &project, const Value &input);
Value rig_state(const Value &project, const Value &context);
Value rig_tool(const Value &project, const Value &input);
Value mesh_state(const Value &project, const Value &input, bool strict = false);
Value mesh_tool(const Value &project, const Value &input);
} // namespace fl2d_authoring
