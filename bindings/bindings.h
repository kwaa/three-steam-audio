#ifndef SA_BRIDGE_H
#define SA_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Flat bridge used by the TypeScript runtime. Complex Steam Audio structs stay
 * on the C side; JavaScript only passes scalars and contiguous arrays.
 */

int sa_context_create(void** out_ctx);
void sa_context_release(void* ctx);

int sa_scene_create(void* ctx, void** out_scene);
void sa_scene_commit(void* scene);
void sa_scene_release(void* scene);

int sa_static_mesh_create(void* scene,
                          int num_verts, const float* verts,
                          int num_tris, const int* indices,
                          int num_materials,
                          const float* absorption,
                          const float* scattering,
                          const float* transmission,
                          const int* tri_materials,
                          void** out_mesh);
void sa_static_mesh_add(void* mesh, void* scene);
void sa_static_mesh_remove(void* mesh, void* scene);
void sa_static_mesh_release(void* mesh);

/*
 * matrix_4x4 is row-major. TypeScript explicitly transposes Three.js'
 * column-major Matrix4.elements before crossing the WASM boundary.
 */
int sa_instanced_mesh_create(void* parent_scene, void* sub_scene,
                             const float* matrix_4x4, void** out_mesh);
void sa_instanced_mesh_update_transform(void* mesh, void* parent_scene,
                                        const float* matrix_4x4);
void sa_instanced_mesh_remove(void* mesh, void* parent_scene);
void sa_instanced_mesh_release(void* mesh);

int sa_hrtf_create(void* ctx, int sample_rate, int frame_size,
                   float volume, int normalization, int type,
                   const unsigned char* data, int data_size,
                   void** out_hrtf);
void sa_hrtf_release(void* hrtf);

int sa_binaural_effect_create(void* ctx, int sample_rate, int frame_size,
                              void* hrtf, void** out_effect);
void sa_binaural_effect_release(void* effect);
int sa_binaural_effect_apply(void* effect, void* hrtf,
                             float dir_x, float dir_y, float dir_z,
                             float spatial_blend,
                             int interpolation,
                             const float* in_buffer, float* out_buffer,
                             int num_channels, int num_samples);

int sa_panning_effect_create(void* ctx, int sample_rate, int frame_size,
                             void** out_effect);
void sa_panning_effect_release(void* effect);
int sa_panning_effect_apply(void* effect,
                            float dir_x, float dir_y, float dir_z,
                            const float* in_buffer, float* out_buffer,
                            int num_channels, int num_samples);

int sa_direct_effect_create(void* ctx, int sample_rate, int frame_size,
                            int num_channels, void** out_effect);
void sa_direct_effect_release(void* effect);
int sa_direct_effect_apply(void* effect,
                           int effect_flags,
                           int transmission_type,
                           float distance_attenuation,
                           const float* air_absorption,
                           float directivity,
                           float occlusion,
                           const float* transmission,
                           const float* in_buffer, float* out_buffer,
                           int num_channels, int num_samples);

int sa_reflection_effect_create(void* ctx, int sample_rate, int frame_size,
                                int num_channels, void** out_effect);
void sa_reflection_effect_release(void* effect);
int sa_reflection_effect_apply(void* effect,
                               const float* reverb_times,
                               const float* in_buffer, float* out_buffer,
                               int num_samples);
int sa_reflection_effect_get_tail(void* effect, float* out_buffer,
                                  int num_samples);

int sa_simulator_create(void* ctx, void* scene,
                        int sample_rate, int frame_size,
                        int max_sources, int max_occlusion_samples,
                        int reflections_enabled,
                        int max_rays, int diffuse_samples,
                        float max_duration, int max_order,
                        int reflection_threads,
                        void** out_sim);
void sa_simulator_commit(void* sim);
void sa_simulator_release(void* sim);
int sa_simulator_run_direct(void* sim);
int sa_simulator_run_reflections(void* sim);
void sa_simulator_set_listener(void* sim,
                               float x, float y, float z,
                               float ahead_x, float ahead_y, float ahead_z,
                               float up_x, float up_y, float up_z,
                               int reflection_rays, int reflection_bounces,
                               float reflection_duration, int reflection_order,
                               float irradiance_min_distance);

int sa_source_create(void* sim, int simulation_flags, void** out_source);
void sa_source_release(void* source, void* sim);

/*
 * direct_flags uses the IPLDirectSimulationFlags bit layout.
 * distance_model: 0 default, 1 inverse, 2 sampled curve.
 * air_model: 0 default, 1 exponential, 2 sampled curves.
 * occlusion_type: 0 raycast, 1 volumetric.
 * reflections_enabled: -1 unavailable, 0 disabled, 1 enabled.
 */
void sa_source_set_inputs(void* source,
                          float x, float y, float z,
                          float ahead_x, float ahead_y, float ahead_z,
                          float up_x, float up_y, float up_z,
                          int direct_flags,
                          int distance_model, float min_distance,
                          float distance_max, int distance_samples,
                          const float* distance_curve,
                          int air_model, const float* air_coefficients,
                          float air_max, int air_samples,
                          const float* air_curves,
                          float dipole_weight, float dipole_power,
                          int occlusion_type, float occlusion_radius,
                          int occlusion_samples, int transmission_rays,
                          int reflections_enabled,
                          const float* reverb_scale);
void sa_source_set_reflection_inputs(void* source,
                                     float x, float y, float z,
                                     float ahead_x, float ahead_y, float ahead_z,
                                     float up_x, float up_y, float up_z,
                                     int enabled,
                                     const float* reverb_scale);

int sa_source_get_direct_outputs(void* source,
                                 float* out_distance_att,
                                 float* out_air_absorption,
                                 float* out_directivity,
                                 float* out_occlusion,
                                 float* out_transmission);
int sa_source_get_reflection_outputs(void* source,
                                     float* out_reverb_times);

float* sa_buffer_alloc(int num_floats);
void sa_buffer_free(float* buffer);
void sa_buffer_deinterleave(const float* interleaved, float* deinterleaved,
                            int num_channels, int num_samples);
void sa_buffer_interleave(const float* deinterleaved, float* interleaved,
                          int num_channels, int num_samples);

#ifdef __cplusplus
}
#endif

#endif
