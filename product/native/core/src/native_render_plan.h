#pragma once
#include "picojson.h"
namespace fl2d_render {
picojson::value plan(const picojson::value& frame,const picojson::value& artwork);
picojson::value projection(const picojson::value& project,const picojson::value& input);
}
