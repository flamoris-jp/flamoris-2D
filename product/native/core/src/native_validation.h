#pragma once
#include "picojson.h"
namespace fl2d_validation {
// Full readonly diagnostics for already-admitted session state. The existing
// validator is shared with admission; only warnings can survive that boundary.
picojson::value admitted_result(const picojson::value& project);
}
