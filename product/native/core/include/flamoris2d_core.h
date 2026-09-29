#ifndef FLAMORIS2D_CORE_H
#define FLAMORIS2D_CORE_H

#include <stdint.h>

#ifdef _WIN32
#ifdef FL2D_CORE_BUILD
#define FL2D_API __declspec(dllexport)
#else
#define FL2D_API __declspec(dllimport)
#endif
#define FL2D_CALL __cdecl
#else
#define FL2D_API __attribute__((visibility("default")))
#define FL2D_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct fl2d_engine fl2d_engine;

typedef int32_t fl2d_status;

enum {
    FL2D_OK = 0,
    FL2D_INVALID_ARGUMENT = 1,
    FL2D_OUT_OF_MEMORY = 2,
    FL2D_INTERNAL_ERROR = 3,
    FL2D_MALFORMED_JSON = 4,
    FL2D_INVALID_UTF8 = 5,
    FL2D_INPUT_TOO_LARGE = 6,
    FL2D_BUFFER_TOO_SMALL = 7
};

typedef struct fl2d_snapshot fl2d_snapshot;
/* Up to 1 MiB of UTF-8 JSON. The input is copied; caller retains its bytes.
 * Validation issues are retained even for invalid Product data. Only malformed
 * interchange input fails creation. Returned strings are UTF-8 caller buffers. */
#define FL2D_SNAPSHOT_MAX_BYTES 1048576u
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_load(const uint8_t* bytes, uint32_t length, fl2d_snapshot** result);
FL2D_API void FL2D_CALL fl2d_snapshot_destroy(fl2d_snapshot* snapshot);
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_summary(const fl2d_snapshot* snapshot,
    int32_t* schema, double* width, double* height, uint32_t* node_count, uint32_t* issue_count);
/* Field names: id, displayName, rootId. Node fields: id, kind, parentId,
 * displayName. NULL parentId is projected as an empty string. */
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_string(const fl2d_snapshot* snapshot,
    const char* field, char* buffer, uint32_t capacity, uint32_t* required);
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_node_string(const fl2d_snapshot* snapshot,
    const char* node_id, const char* field, char* buffer, uint32_t capacity, uint32_t* required);
/* Issue fields: code, path, entityId. Missing entityId is an empty string. */
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_issue_string(const fl2d_snapshot* snapshot,
    uint32_t index, const char* field, char* buffer, uint32_t capacity, uint32_t* required);

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
