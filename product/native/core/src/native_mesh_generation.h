#pragma once
#include "picojson.h"
#include <cstdint>
namespace fl2d_mesh {
picojson::value generate(uint32_t width, uint32_t height, const uint8_t *rgba,
                         const picojson::value &input);
}
