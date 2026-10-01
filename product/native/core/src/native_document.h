#pragma once
#include "picojson.h"
#include <string>

namespace fl2d_document {
struct Failure { std::string code; picojson::value details; };
picojson::value parse(const picojson::value& document);
picojson::value serialize(const picojson::value& project, const picojson::value& options);
}
