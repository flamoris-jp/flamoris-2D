#pragma once
#include <stdint.h>
#ifdef _WIN32
#ifdef FL2DR_BUILD
#define FL2DR_API __declspec(dllexport)
#else
#define FL2DR_API __declspec(dllimport)
#endif
#define FL2DR_CALL __cdecl
#else
#define FL2DR_API __attribute__((visibility("default")))
#define FL2DR_CALL
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct fl2dr_renderer fl2dr_renderer;
typedef int32_t (FL2DR_CALL *fl2dr_cancel)(void* context);
/* Serialized calls, caller-owned buffers. Input/texture bytes are copied during
 * the call. 0=success, 1=invalid input, 2=allocation, 3=GPU/runtime, 4=cancelled.
 * Output is premultiplied BGRA8, tightly packed. No Project/session is owned here. */
FL2DR_API int32_t FL2DR_CALL fl2dr_create(int32_t software, fl2dr_renderer** result, char* error, uint32_t capacity);
FL2DR_API void FL2DR_CALL fl2dr_destroy(fl2dr_renderer* renderer);
FL2DR_API int32_t FL2DR_CALL fl2dr_texture(fl2dr_renderer* renderer, const uint8_t* id, uint32_t id_length,
    const uint8_t* straight_bgra, uint32_t length, int32_t width, int32_t height, char* error, uint32_t capacity);
FL2DR_API int32_t FL2DR_CALL fl2dr_remove_texture(fl2dr_renderer* renderer, const uint8_t* id, uint32_t id_length);
FL2DR_API int32_t FL2DR_CALL fl2dr_render(fl2dr_renderer* renderer, const uint8_t* projection, uint32_t length,
    int32_t width, int32_t height, uint8_t* output, uint32_t output_capacity,
    fl2dr_cancel cancelled, void* cancel_context, char* error, uint32_t error_capacity);
#ifdef __cplusplus
}
#endif
