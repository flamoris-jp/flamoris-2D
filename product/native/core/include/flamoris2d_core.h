#ifndef FLAMORIS2D_CORE_H
#define FLAMORIS2D_CORE_H

#include <stdint.h>

#ifdef _WIN32
#define FL2D_API __declspec(dllexport)
#define FL2D_CALL __cdecl
#else
#define FL2D_API __attribute__((visibility("default")))
#define FL2D_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct fl2d_engine fl2d_engine;

typedef enum fl2d_status {
    FL2D_OK = 0,
    FL2D_INVALID_ARGUMENT = 1,
    FL2D_OUT_OF_MEMORY = 2,
    FL2D_INTERNAL_ERROR = 3
} fl2d_status;

typedef struct fl2d_frame_rate {
    int64_t numerator;
    int64_t denominator;
} fl2d_frame_rate;

FL2D_API fl2d_status FL2D_CALL fl2d_abi_version(int32_t* major, int32_t* minor);
FL2D_API fl2d_status FL2D_CALL fl2d_engine_create(fl2d_engine** result);
FL2D_API void FL2D_CALL fl2d_engine_destroy(fl2d_engine* engine);
FL2D_API fl2d_status FL2D_CALL fl2d_normalize_frame_rate(
    fl2d_engine* engine, int64_t numerator, int64_t denominator, fl2d_frame_rate* result);

#ifdef __cplusplus
}
#endif
#endif
