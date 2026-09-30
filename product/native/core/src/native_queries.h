#pragma once
#include "flamoris2d_core.h"
#include "picojson.h"
#include <string>
namespace fl2d_queries {
struct Unsupported {};
struct Error { std::string name, message; };
picojson::value query(const picojson::value& project, const std::string& name, const picojson::value& input);
}
