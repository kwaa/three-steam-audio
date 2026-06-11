#ifndef SA_BRIDGE_H
#define SA_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

/*
 * three-steam-audio C bridge layer
 *
 * Design goals:
 *   - Flat C API that maps 1:1 to Emscripten ccall/cwrap
 *   - No complex structs passed across the JS/WASM boundary
 *   - Coordinate system matches Steam Audio: right-handed, +x right, +y up, -z forward
 *   - When passing data from Three.js: remember to flip the z axis
 */

/*
 * All functions that create objects return 0 on success, non-zero on failure.
 * All "release" functions accept NULL safely and will set the internal pointer to NULL.
 */

/* ================================================================ */
/*  Context                                                         */
/* ================================================================ */

int  sa_context_create(void** out_ctx);
void sa_context_release(void* ctx);

/* ================================================================ */
/*  Scene                                                           */
/* ================================================================ */

/*
 * Create a static scene from raw triangle data.
 *
 *   verts:            float[num_verts * 3]   — xyz xyz xyz...
 *   indices:          int[num_tris * 3]      — i0 i1 i2 i3 i4 i5...
 *   absorption:       float[num_materials * 3] — per-material (low, mid, high)
 *   scattering:       float[num_materials]   — per-material
 *   tri_materials:    int[num_tris]          — material index for each triangle
 */
int  sa_scene_create(void* ctx,
                     int num_verts, const float* verts,
                     int num_tris,  const int* indices,
                     int num_materials,
                     const float* absorption,
                     const float* scattering,
                     const int* tri_materials,
                     void** out_scene);

void sa_scene_release(void* scene);

/* ================================================================ */
/*  HRTF                                                            */
/* ================================================================ */

int  sa_hrtf_create(void* ctx, int sample_rate, int frame_size, void** out_hrtf);
void sa_hrtf_release(void* hrtf);

/* ================================================================ */
/*  Binaural Effect                                                 */
/* ================================================================ */

int  sa_binaural_effect_create(void* ctx, int sample_rate, int frame_size,
                               void* hrtf, void** out_effect);
void sa_binaural_effect_release(void* effect);

/*
 * Apply binaural spatialisation.
 *
 *   dir_*:     unit vector from listener to source (Steam Audio coords)
 *   in_buffer:  deinterleaved float array, layout [left_samples][right_samples]...
 *               Number of input channels is determined by num_channels (1 or 2).
 *   out_buffer: deinterleaved float array, layout [left_samples][right_samples]
 *               Must have space for 2 channels.
 */
int  sa_binaural_effect_apply(void* effect,
                              float dir_x, float dir_y, float dir_z,
                              const float* in_buffer, float* out_buffer,
                              int num_channels, int num_samples);

/* ================================================================ */
/*  Direct Effect                                                   */
/* ================================================================ */

int  sa_direct_effect_create(void* ctx, int sample_rate, int frame_size,
                             int num_channels, void** out_effect);
void sa_direct_effect_release(void* effect);

/*
 * Apply direct-path filtering (distance attenuation, air absorption, occlusion, etc.)
 *
 *   air_absorption:  float[3] — low, mid, high frequency coefficients (0..1)
 *   transmission:    float[3] — low, mid, high frequency transmission (0..1)
 *   in_buffer / out_buffer: deinterleaved, same channel count
 */
int  sa_direct_effect_apply(void* effect,
                            float distance_attenuation,
                            const float* air_absorption,
                            float directivity,
                            float occlusion,
                            const float* transmission,
                            const float* in_buffer, float* out_buffer,
                            int num_channels, int num_samples);

/* ================================================================ */
/*  Simulator (simplified — direct path only)                       */
/* ================================================================ */

int  sa_simulator_create(void* ctx, void* scene,
                         int sample_rate, int frame_size,
                         void** out_sim);
void sa_simulator_release(void* sim);
int  sa_simulator_run_direct(void* sim);
void sa_simulator_set_listener(void* sim,
                               float x, float y, float z,
                               float ahead_x, float ahead_y, float ahead_z,
                               float up_x, float up_y, float up_z);

/* ================================================================ */
/*  Source                                                          */
/* ================================================================ */

int  sa_source_create(void* sim, void** out_source);
void sa_source_release(void* source);

/*
 * Set source transform and occlusion. This internally calls iplSourceSetInputs.
 * Call sa_simulator_run_direct afterwards to update simulation results.
 */
void sa_source_set_transform(void* source,
                             float x, float y, float z,
                             float ahead_x, float ahead_y, float ahead_z,
                             float up_x, float up_y, float up_z,
                             float occlusion);

/*
 * Read back direct-path simulation results.
 * Must call sa_simulator_run_direct between set_transform and get_outputs.
 */
int  sa_source_get_direct_outputs(void* source,
                                  float* out_distance_att,
                                  float* out_air_absorption,
                                  float* out_directivity,
                                  float* out_occlusion,
                                  float* out_transmission);

/* ================================================================ */
/*  Buffer Helpers                                                  */
/* ================================================================ */

/*
 * Allocate / free a float array on the WASM heap.
 * The returned pointer can be used directly with Module.HEAPF32 in JS.
 */
float* sa_buffer_alloc(int num_floats);
void   sa_buffer_free(float* buffer);

/*
 * Convert between interleaved (Web Audio native) and deinterleaved (Steam Audio native).
 * All pointers must point to WASM heap memory.
 */
void sa_buffer_deinterleave(const float* interleaved, float* deinterleaved,
                            int num_channels, int num_samples);
void sa_buffer_interleave(const float* deinterleaved, float* interleaved,
                          int num_channels, int num_samples);

#ifdef __cplusplus
}
#endif

#endif /* SA_BRIDGE_H */
