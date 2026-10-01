#include "flamoris2d_core.h"

#include <new>
#include <numeric>

struct fl2d_engine {};

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_abi_version(int32_t* major, int32_t* minor) {
    if (!major || !minor) return FL2D_INVALID_ARGUMENT;
    *major = 1;
    *minor = 5;
    return FL2D_OK;
}

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_engine_create(fl2d_engine** result) {
    if (!result) return FL2D_INVALID_ARGUMENT;
    *result = new (std::nothrow) fl2d_engine();
    return *result ? FL2D_OK : FL2D_OUT_OF_MEMORY;
}

extern "C" FL2D_API void FL2D_CALL fl2d_engine_destroy(fl2d_engine* engine) {
    delete engine;
}

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_normalize_frame_rate(
    fl2d_engine* engine, int64_t numerator, int64_t denominator, fl2d_frame_rate* result) {
    // JavaScript Number.isSafeInteger admits at most 2^53 - 1.
    constexpr int64_t max_safe_integer = 9007199254740991LL;
    if (!engine || !result || numerator <= 0 || denominator <= 0 ||
        numerator > max_safe_integer || denominator > max_safe_integer) {
        return FL2D_INVALID_ARGUMENT;
    }
    const auto divisor = std::gcd(numerator, denominator);
    result->numerator = numerator / divisor;
    result->denominator = denominator / divisor;
    return FL2D_OK;
}
