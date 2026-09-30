#pragma once
#include <cstdint>
#include "picojson.h"
namespace fl2d_evaluation {
picojson::value sort_program(picojson::value program);
picojson::value sample_program(const picojson::value& program, const picojson::value& time);
picojson::value clip_projection(const picojson::value& instance, uint64_t time, uint64_t clip_duration);
picojson::value frame_plan(uint64_t duration, const picojson::value& frame_rate);
}
