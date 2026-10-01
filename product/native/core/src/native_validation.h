#pragma once
#include "picojson.h"
#include "flamoris2d_core.h"
namespace fl2d_validation {
// Full readonly diagnostics for already-admitted session state. The existing
// validator is shared with admission; only warnings can survive that boundary.
fl2d_status parse_project(const uint8_t* bytes, uint32_t length, picojson::value& project);
bool valid_project(const picojson::value& project);
picojson::value admitted_result(const picojson::value& project);
}
