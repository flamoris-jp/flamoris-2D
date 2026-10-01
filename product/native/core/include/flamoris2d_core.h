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
    FL2D_BUFFER_TOO_SMALL = 7,
    FL2D_PROJECT_INVALID = 8,
    FL2D_COMMAND_INVALID = 9,
    FL2D_COMMAND_UNSUPPORTED = 10,
    FL2D_TARGET_NOT_FOUND = 11,
    FL2D_TRANSACTION_EMPTY = 12,
    FL2D_REVISION_CONFLICT = 13,
    FL2D_SAVED_REVISION_INVALID = 14,
    FL2D_HISTORY_EMPTY = 15,
    FL2D_REVISION_EXHAUSTED = 16,
    FL2D_QUERY_UNSUPPORTED = 17
};

typedef struct fl2d_snapshot fl2d_snapshot;
/* ABI 1.2: numeric scene state, with a fixed field order and 32-bit visibility. */
typedef struct fl2d_node_state {
    double position_x, position_y, rotation;
    double scale_x, scale_y, pivot_x, pivot_y;
    double opacity;
    int32_t visible;
} fl2d_node_state;
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
/* node_id is the node's stable id, not its scene.nodes object key. */
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_node_state(const fl2d_snapshot* snapshot,
    const char* node_id, fl2d_node_state* result);
/* Issue fields: code, path, entityId, severity. Missing entityId is an empty
 * string. Warning diagnostics retain their JS severity and do not reject a session. */
FL2D_API fl2d_status FL2D_CALL fl2d_snapshot_issue_string(const fl2d_snapshot* snapshot,
    uint32_t index, const char* field, char* buffer, uint32_t capacity, uint32_t* required);

/* ABI 1.3: experimental session. UTF-8 input is copied (maximum 1 MiB).
 * The command document is a JSON array of existing Product command envelopes.
 * Session calls must be serialized by the caller. A prepared handle is one-shot;
 * destroy it even after commit. Destroying its session invalidates it safely.
 * Error names are stable Product codes, not human messages. */
typedef struct fl2d_session fl2d_session;
typedef struct fl2d_prepared fl2d_prepared;
typedef struct fl2d_session_state {
    int64_t revision_counter, current_revision, saved_revision;
    uint32_t undo_depth, redo_depth, history_depth, dirty;
} fl2d_session_state;
FL2D_API fl2d_status FL2D_CALL fl2d_session_create(const uint8_t* project, uint32_t length, fl2d_session** result);
FL2D_API void FL2D_CALL fl2d_session_destroy(fl2d_session* session);
FL2D_API fl2d_status FL2D_CALL fl2d_session_replace(fl2d_session* session, const uint8_t* project, uint32_t length, int32_t saved);
FL2D_API fl2d_status FL2D_CALL fl2d_session_state_get(const fl2d_session* session, fl2d_session_state* result);
FL2D_API fl2d_status FL2D_CALL fl2d_session_mark_saved(fl2d_session* session, int64_t revision);
FL2D_API fl2d_status FL2D_CALL fl2d_session_node_string(const fl2d_session* session, const char* node_id,
    const char* field, char* buffer, uint32_t capacity, uint32_t* required);
FL2D_API fl2d_status FL2D_CALL fl2d_session_node_state(const fl2d_session* session, const char* node_id, fl2d_node_state* result);
FL2D_API fl2d_status FL2D_CALL fl2d_session_project_json(const fl2d_session* session, char* buffer, uint32_t capacity, uint32_t* required);
FL2D_API fl2d_status FL2D_CALL fl2d_session_history_json(const fl2d_session* session, char* buffer, uint32_t capacity, uint32_t* required);
FL2D_API fl2d_status FL2D_CALL fl2d_session_prepare(fl2d_session* session, const uint8_t* commands,
    uint32_t length, const char* label, fl2d_prepared** result);
FL2D_API fl2d_status FL2D_CALL fl2d_session_prepare_undo(fl2d_session* session, fl2d_prepared** result);
FL2D_API fl2d_status FL2D_CALL fl2d_session_prepare_redo(fl2d_session* session, fl2d_prepared** result);
FL2D_API fl2d_status FL2D_CALL fl2d_prepared_commit(fl2d_prepared* prepared);
/* Read a disposable validated candidate without committing Project/history.
 * Rejects consumed, stale or orphaned preparations. */
FL2D_API fl2d_status FL2D_CALL fl2d_prepared_query_json(const fl2d_prepared* prepared,
    const uint8_t* request,uint32_t length,char* buffer,uint32_t capacity,uint32_t* required);
FL2D_API void FL2D_CALL fl2d_prepared_destroy(fl2d_prepared* prepared);
/* Last error code on this session, set by failed session operations; empty on success.
 * Caller-owned buffer rules match snapshot_string. */
FL2D_API fl2d_status FL2D_CALL fl2d_session_error(const fl2d_session* session, char* buffer, uint32_t capacity, uint32_t* required);

/* ABI 1.4: readonly Product Query on this session. Request is UTF-8 JSON
 * {"name":string,"input":object?}, maximum 1 MiB. Result is {"value":...}
 * or {"error":{"name":string,"message":string}} for a Product exception.
 * Known queries pending native implementation return FL2D_QUERY_UNSUPPORTED.
 * Output length may exceed Project size; required includes the terminating NUL.
 * Calls, including sizing calls, never change state or the mutation error. */
FL2D_API fl2d_status FL2D_CALL fl2d_session_query_json(const fl2d_session* session,
    const uint8_t* request, uint32_t length, char* buffer, uint32_t capacity, uint32_t* required);

/* ABI 1.5: format-v1 persistence. Inputs and envelope outputs are bounded at
 * 128 MiB; the embedded Project still uses the existing snapshot limit.
 * Parsing returns {value:{project,metadata,renderAssets}} or {error:{code,details}}.
 * Serialization reads this session only and accepts {now,createdAt,modifiedAt,renderAssets}.
 * now is supplied by the storage adapter, never read from a hidden native clock.
 * Both sizing and copy calls are readonly and must run on the session lane. */
#define FL2D_DOCUMENT_MAX_BYTES 134217728u
FL2D_API fl2d_status FL2D_CALL fl2d_document_parse_json(const uint8_t* bytes, uint32_t length,
    char* buffer, uint32_t capacity, uint32_t* required);
FL2D_API fl2d_status FL2D_CALL fl2d_session_document_json(const fl2d_session* session,
    const uint8_t* options, uint32_t length, char* buffer, uint32_t capacity, uint32_t* required);

/* Immutable source-to-Project conversion. Decoder candidates are
 * {kind:"psd"|"flimg",source:object,options:{fileName,projectName,importedAt}}.
 * This does not attach or edit a session. Raster decoding/validation precedes it. */
FL2D_API fl2d_status FL2D_CALL fl2d_source_project_json(const uint8_t* bytes, uint32_t length,
    char* buffer, uint32_t capacity, uint32_t* required);

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
