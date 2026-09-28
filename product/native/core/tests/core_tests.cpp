#include "flamoris2d_core.h"

#include <cassert>
#include <cstdint>

int main() {
    int32_t major = 0, minor = -1;
    assert(fl2d_abi_version(&major, &minor) == FL2D_OK && major == 1 && minor == 0);
    assert(fl2d_abi_version(nullptr, &minor) == FL2D_INVALID_ARGUMENT);
    fl2d_engine* engine = nullptr;
    assert(fl2d_engine_create(&engine) == FL2D_OK && engine);
    fl2d_frame_rate result{};
    assert(fl2d_normalize_frame_rate(engine, 60000, 2002, &result) == FL2D_OK);
    assert(result.numerator == 30000 && result.denominator == 1001);
    assert(fl2d_normalize_frame_rate(engine, 9007199254740991LL, 1, &result) == FL2D_OK);
    assert(result.numerator == 9007199254740991LL && result.denominator == 1);
    assert(fl2d_normalize_frame_rate(engine, 0, 1, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(engine, 1, 0, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(engine, 9007199254740992LL, 1, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(nullptr, 1, 1, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(engine, 1, 1, nullptr) == FL2D_INVALID_ARGUMENT);
    fl2d_engine_destroy(engine);
}
