#include <emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "phonon.h"
#include "bindings.h"

typedef struct {
    IPLSource handle;
    float* distance_curve;
    int distance_samples;
    float distance_min;
    float distance_max;
    float* air_curves;
    int air_samples;
    float air_max;
} SASource;

static void copy_matrix(IPLMatrix4x4* target, const float* source)
{
    for (int row = 0; row < 4; ++row)
        for (int column = 0; column < 4; ++column)
            target->elements[row][column] = source[row * 4 + column];
}

static float sample_curve(const float* values, int count,
                          float minimum, float maximum, float distance)
{
    if (!values || count <= 0)
        return 1.0f;
    if (count == 1 || maximum <= minimum)
        return values[0];

    float position = fminf(fmaxf((distance - minimum) / (maximum - minimum), 0.0f), 1.0f)
                   * (float)(count - 1);
    int lower = (int)floorf(position);
    int upper = lower < count - 1 ? lower + 1 : lower;
    float blend = position - (float)lower;
    return values[lower] + (values[upper] - values[lower]) * blend;
}

static float IPLCALL distance_callback(float distance, void* user_data)
{
    SASource* source = (SASource*)user_data;
    return sample_curve(source->distance_curve, source->distance_samples,
                        source->distance_min, source->distance_max, distance);
}

static float IPLCALL air_callback(float distance, int band, void* user_data)
{
    SASource* source = (SASource*)user_data;
    if (!source->air_curves || band < 0 || band >= IPL_NUM_BANDS)
        return 1.0f;
    return sample_curve(source->air_curves + band * source->air_samples,
                        source->air_samples, 0.0f, source->air_max, distance);
}

static int replace_curve(float** target, int* target_count,
                         const float* values, int count, int bands)
{
    free(*target);
    *target = NULL;
    *target_count = 0;

    if (!values || count <= 0)
        return 1;

    size_t total = (size_t)count * (size_t)bands;
    *target = (float*)malloc(total * sizeof(float));
    if (!*target)
        return 0;

    memcpy(*target, values, total * sizeof(float));
    *target_count = count;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int sa_context_create(void** out_ctx)
{
    if (!out_ctx) return 1;
    IPLContextSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.version = STEAMAUDIO_VERSION;
    IPLerror error = iplContextCreate(&settings, (IPLContext*)out_ctx);
    return error == IPL_STATUS_SUCCESS ? 0 : (int)error;
}

EMSCRIPTEN_KEEPALIVE
void sa_context_release(void* ctx)
{
    if (ctx) iplContextRelease((IPLContext*)&ctx);
}

EMSCRIPTEN_KEEPALIVE
int sa_scene_create(void* ctx, void** out_scene)
{
    if (!ctx || !out_scene) return 1;
    IPLSceneSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.type = IPL_SCENETYPE_DEFAULT;
    IPLerror error = iplSceneCreate((IPLContext)ctx, &settings, (IPLScene*)out_scene);
    return error == IPL_STATUS_SUCCESS ? 0 : (int)error;
}

EMSCRIPTEN_KEEPALIVE
void sa_scene_commit(void* scene)
{
    if (scene) iplSceneCommit((IPLScene)scene);
}

EMSCRIPTEN_KEEPALIVE
void sa_scene_release(void* scene)
{
    if (scene) iplSceneRelease((IPLScene*)&scene);
}

EMSCRIPTEN_KEEPALIVE
int sa_static_mesh_create(void* scene,
                          int num_verts, const float* verts,
                          int num_tris, const int* indices,
                          int num_materials,
                          const float* absorption,
                          const float* scattering,
                          const float* transmission,
                          const int* tri_materials,
                          void** out_mesh)
{
    if (!scene || !out_mesh || num_verts <= 0 || num_tris <= 0 ||
        num_materials <= 0 || !verts || !indices || !absorption ||
        !scattering || !transmission || !tri_materials)
        return 1;

    IPLMaterial* materials = (IPLMaterial*)calloc((size_t)num_materials, sizeof(IPLMaterial));
    IPLVector3* vertices = (IPLVector3*)calloc((size_t)num_verts, sizeof(IPLVector3));
    IPLTriangle* triangles = (IPLTriangle*)calloc((size_t)num_tris, sizeof(IPLTriangle));
    if (!materials || !vertices || !triangles) {
        free(materials);
        free(vertices);
        free(triangles);
        return (int)IPL_STATUS_OUTOFMEMORY;
    }

    for (int i = 0; i < num_materials; ++i) {
        for (int band = 0; band < IPL_NUM_BANDS; ++band) {
            materials[i].absorption[band] = absorption[i * IPL_NUM_BANDS + band];
            materials[i].transmission[band] = transmission[i * IPL_NUM_BANDS + band];
        }
        materials[i].scattering = scattering[i];
    }

    for (int i = 0; i < num_verts; ++i) {
        vertices[i].x = verts[i * 3];
        vertices[i].y = verts[i * 3 + 1];
        vertices[i].z = verts[i * 3 + 2];
    }
    for (int i = 0; i < num_tris; ++i) {
        triangles[i].indices[0] = indices[i * 3];
        triangles[i].indices[1] = indices[i * 3 + 1];
        triangles[i].indices[2] = indices[i * 3 + 2];
    }

    IPLStaticMeshSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.numVertices = num_verts;
    settings.numTriangles = num_tris;
    settings.numMaterials = num_materials;
    settings.vertices = vertices;
    settings.triangles = triangles;
    settings.materialIndices = (int*)tri_materials;
    settings.materials = materials;

    IPLerror error = iplStaticMeshCreate((IPLScene)scene, &settings, (IPLStaticMesh*)out_mesh);
    free(materials);
    free(vertices);
    free(triangles);
    return error == IPL_STATUS_SUCCESS ? 0 : (int)error;
}

EMSCRIPTEN_KEEPALIVE
void sa_static_mesh_add(void* mesh, void* scene)
{
    if (mesh && scene) iplStaticMeshAdd((IPLStaticMesh)mesh, (IPLScene)scene);
}

EMSCRIPTEN_KEEPALIVE
void sa_static_mesh_remove(void* mesh, void* scene)
{
    if (mesh && scene) iplStaticMeshRemove((IPLStaticMesh)mesh, (IPLScene)scene);
}

EMSCRIPTEN_KEEPALIVE
void sa_static_mesh_release(void* mesh)
{
    if (mesh) iplStaticMeshRelease((IPLStaticMesh*)&mesh);
}

EMSCRIPTEN_KEEPALIVE
int sa_instanced_mesh_create(void* parent_scene, void* sub_scene,
                             const float* matrix_4x4, void** out_mesh)
{
    if (!parent_scene || !sub_scene || !matrix_4x4 || !out_mesh) return 1;
    IPLInstancedMeshSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.subScene = (IPLScene)sub_scene;
    copy_matrix(&settings.transform, matrix_4x4);
    IPLerror error = iplInstancedMeshCreate((IPLScene)parent_scene, &settings,
                                            (IPLInstancedMesh*)out_mesh);
    if (error != IPL_STATUS_SUCCESS) return (int)error;
    iplInstancedMeshAdd((IPLInstancedMesh)*out_mesh, (IPLScene)parent_scene);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_instanced_mesh_update_transform(void* mesh, void* parent_scene,
                                        const float* matrix_4x4)
{
    if (!mesh || !parent_scene || !matrix_4x4) return;
    IPLMatrix4x4 transform;
    copy_matrix(&transform, matrix_4x4);
    iplInstancedMeshUpdateTransform((IPLInstancedMesh)mesh,
                                    (IPLScene)parent_scene, transform);
}

EMSCRIPTEN_KEEPALIVE
void sa_instanced_mesh_remove(void* mesh, void* parent_scene)
{
    if (mesh && parent_scene)
        iplInstancedMeshRemove((IPLInstancedMesh)mesh, (IPLScene)parent_scene);
}

EMSCRIPTEN_KEEPALIVE
void sa_instanced_mesh_release(void* mesh)
{
    if (mesh) iplInstancedMeshRelease((IPLInstancedMesh*)&mesh);
}

EMSCRIPTEN_KEEPALIVE
int sa_hrtf_create(void* ctx, int sample_rate, int frame_size, void** out_hrtf)
{
    if (!ctx || !out_hrtf) return 1;
    IPLAudioSettings audio;
    IPLHRTFSettings settings;
    memset(&audio, 0, sizeof(audio));
    memset(&settings, 0, sizeof(settings));
    audio.samplingRate = sample_rate;
    audio.frameSize = frame_size;
    settings.type = IPL_HRTFTYPE_DEFAULT;
    IPLerror error = iplHRTFCreate((IPLContext)ctx, &audio, &settings, (IPLHRTF*)out_hrtf);
    return error == IPL_STATUS_SUCCESS ? 0 : (int)error;
}

EMSCRIPTEN_KEEPALIVE
void sa_hrtf_release(void* hrtf)
{
    if (hrtf) iplHRTFRelease((IPLHRTF*)&hrtf);
}

EMSCRIPTEN_KEEPALIVE
int sa_binaural_effect_create(void* ctx, int sample_rate, int frame_size,
                              void* hrtf, void** out_effect)
{
    if (!ctx || !hrtf || !out_effect) return 1;
    IPLAudioSettings audio;
    IPLBinauralEffectSettings settings;
    memset(&audio, 0, sizeof(audio));
    memset(&settings, 0, sizeof(settings));
    audio.samplingRate = sample_rate;
    audio.frameSize = frame_size;
    settings.hrtf = (IPLHRTF)hrtf;
    IPLerror error = iplBinauralEffectCreate((IPLContext)ctx, &audio, &settings,
                                             (IPLBinauralEffect*)out_effect);
    return error == IPL_STATUS_SUCCESS ? 0 : (int)error;
}

EMSCRIPTEN_KEEPALIVE
void sa_binaural_effect_release(void* effect)
{
    if (effect) iplBinauralEffectRelease((IPLBinauralEffect*)&effect);
}

EMSCRIPTEN_KEEPALIVE
int sa_binaural_effect_apply(void* effect,
                             float dir_x, float dir_y, float dir_z,
                             float spatial_blend,
                             const float* in_buffer, float* out_buffer,
                             int num_channels, int num_samples)
{
    if (!effect || !in_buffer || !out_buffer || num_channels < 1 || num_channels > 2)
        return 1;
    const float* input_channels[2];
    float* output_channels[2];
    for (int channel = 0; channel < num_channels; ++channel)
        input_channels[channel] = in_buffer + channel * num_samples;
    for (int channel = 0; channel < 2; ++channel)
        output_channels[channel] = out_buffer + channel * num_samples;

    IPLAudioBuffer input = { num_channels, num_samples, (float**)input_channels };
    IPLAudioBuffer output = { 2, num_samples, output_channels };
    IPLBinauralEffectParams params;
    memset(&params, 0, sizeof(params));
    params.direction.x = dir_x;
    params.direction.y = dir_y;
    params.direction.z = dir_z;
    params.interpolation = IPL_HRTFINTERPOLATION_NEAREST;
    params.spatialBlend = spatial_blend;
    iplBinauralEffectApply((IPLBinauralEffect)effect, &params, &input, &output);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int sa_direct_effect_create(void* ctx, int sample_rate, int frame_size,
                            int num_channels, void** out_effect)
{
    if (!ctx || !out_effect || num_channels < 1 || num_channels > 2) return 1;
    IPLAudioSettings audio;
    IPLDirectEffectSettings settings;
    memset(&audio, 0, sizeof(audio));
    memset(&settings, 0, sizeof(settings));
    audio.samplingRate = sample_rate;
    audio.frameSize = frame_size;
    settings.numChannels = num_channels;
    IPLerror error = iplDirectEffectCreate((IPLContext)ctx, &audio, &settings,
                                           (IPLDirectEffect*)out_effect);
    return error == IPL_STATUS_SUCCESS ? 0 : (int)error;
}

EMSCRIPTEN_KEEPALIVE
void sa_direct_effect_release(void* effect)
{
    if (effect) iplDirectEffectRelease((IPLDirectEffect*)&effect);
}

EMSCRIPTEN_KEEPALIVE
int sa_direct_effect_apply(void* effect, int effect_flags, int transmission_type,
                           float distance_attenuation, const float* air_absorption,
                           float directivity, float occlusion,
                           const float* transmission,
                           const float* in_buffer, float* out_buffer,
                           int num_channels, int num_samples)
{
    if (!effect || !air_absorption || !transmission || !in_buffer || !out_buffer ||
        num_channels < 1 || num_channels > 2)
        return 1;
    const float* input_channels[2];
    float* output_channels[2];
    for (int channel = 0; channel < num_channels; ++channel) {
        input_channels[channel] = in_buffer + channel * num_samples;
        output_channels[channel] = out_buffer + channel * num_samples;
    }
    IPLAudioBuffer input = { num_channels, num_samples, (float**)input_channels };
    IPLAudioBuffer output = { num_channels, num_samples, output_channels };
    IPLDirectEffectParams params;
    memset(&params, 0, sizeof(params));
    params.flags = (IPLDirectEffectFlags)effect_flags;
    params.transmissionType = transmission_type
        ? IPL_TRANSMISSIONTYPE_FREQDEPENDENT
        : IPL_TRANSMISSIONTYPE_FREQINDEPENDENT;
    params.distanceAttenuation = distance_attenuation;
    params.directivity = directivity;
    params.occlusion = occlusion;
    for (int band = 0; band < IPL_NUM_BANDS; ++band) {
        params.airAbsorption[band] = air_absorption[band];
        params.transmission[band] = transmission[band];
    }
    iplDirectEffectApply((IPLDirectEffect)effect, &params, &input, &output);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int sa_simulator_create(void* ctx, void* scene,
                        int sample_rate, int frame_size,
                        int max_sources, int max_occlusion_samples,
                        void** out_sim)
{
    if (!ctx || !out_sim) return 1;
    IPLSimulationSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.flags = IPL_SIMULATIONFLAGS_DIRECT;
    settings.sceneType = IPL_SCENETYPE_DEFAULT;
    settings.reflectionType = IPL_REFLECTIONEFFECTTYPE_PARAMETRIC;
    settings.maxNumOcclusionSamples = max_occlusion_samples;
    settings.maxNumSources = max_sources;
    settings.numThreads = 1;
    settings.samplingRate = sample_rate;
    settings.frameSize = frame_size;
    IPLerror error = iplSimulatorCreate((IPLContext)ctx, &settings, (IPLSimulator*)out_sim);
    if (error != IPL_STATUS_SUCCESS) return (int)error;
    if (scene) {
        iplSimulatorSetScene((IPLSimulator)*out_sim, (IPLScene)scene);
        iplSimulatorCommit((IPLSimulator)*out_sim);
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_simulator_commit(void* sim)
{
    if (sim) iplSimulatorCommit((IPLSimulator)sim);
}

EMSCRIPTEN_KEEPALIVE
void sa_simulator_release(void* sim)
{
    if (sim) iplSimulatorRelease((IPLSimulator*)&sim);
}

EMSCRIPTEN_KEEPALIVE
int sa_simulator_run_direct(void* sim)
{
    if (!sim) return 1;
    iplSimulatorRunDirect((IPLSimulator)sim);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_simulator_set_listener(void* sim,
                               float x, float y, float z,
                               float ahead_x, float ahead_y, float ahead_z,
                               float up_x, float up_y, float up_z)
{
    if (!sim) return;
    IPLSimulationSharedInputs inputs;
    memset(&inputs, 0, sizeof(inputs));
    inputs.listener.origin = (IPLVector3){ x, y, z };
    inputs.listener.ahead = (IPLVector3){ ahead_x, ahead_y, ahead_z };
    inputs.listener.up = (IPLVector3){ up_x, up_y, up_z };
    inputs.listener.right = (IPLVector3){
        ahead_y * up_z - ahead_z * up_y,
        ahead_z * up_x - ahead_x * up_z,
        ahead_x * up_y - ahead_y * up_x
    };
    iplSimulatorSetSharedInputs((IPLSimulator)sim, IPL_SIMULATIONFLAGS_DIRECT, &inputs);
}

EMSCRIPTEN_KEEPALIVE
int sa_source_create(void* sim, void** out_source)
{
    if (!sim || !out_source) return 1;
    SASource* source = (SASource*)calloc(1, sizeof(SASource));
    if (!source) return (int)IPL_STATUS_OUTOFMEMORY;
    IPLSourceSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.flags = IPL_SIMULATIONFLAGS_DIRECT;
    IPLerror error = iplSourceCreate((IPLSimulator)sim, &settings, &source->handle);
    if (error != IPL_STATUS_SUCCESS) {
        free(source);
        return (int)error;
    }
    iplSourceAdd(source->handle, (IPLSimulator)sim);
    iplSimulatorCommit((IPLSimulator)sim);
    *out_source = source;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_source_release(void* source_ptr, void* sim)
{
    SASource* source = (SASource*)source_ptr;
    if (!source) return;
    if (source->handle && sim) {
        iplSourceRemove(source->handle, (IPLSimulator)sim);
        iplSimulatorCommit((IPLSimulator)sim);
    }
    if (source->handle) iplSourceRelease(&source->handle);
    free(source->distance_curve);
    free(source->air_curves);
    free(source);
}

EMSCRIPTEN_KEEPALIVE
void sa_source_set_inputs(void* source_ptr,
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
                          int occlusion_samples, int transmission_rays)
{
    SASource* source = (SASource*)source_ptr;
    if (!source || !source->handle) return;

    if (distance_model == 2) {
        if (!replace_curve(&source->distance_curve, &source->distance_samples,
                           distance_curve, distance_samples, 1))
            return;
        source->distance_min = min_distance;
        source->distance_max = distance_max;
    } else {
        replace_curve(&source->distance_curve, &source->distance_samples,
                      NULL, 0, 1);
        source->distance_min = 0.0f;
        source->distance_max = 0.0f;
    }
    if (air_model == 2) {
        if (!replace_curve(&source->air_curves, &source->air_samples,
                           air_curves, air_samples, IPL_NUM_BANDS))
            return;
        source->air_max = air_max;
    } else {
        replace_curve(&source->air_curves, &source->air_samples,
                      NULL, 0, IPL_NUM_BANDS);
        source->air_max = 0.0f;
    }

    IPLSimulationInputs inputs;
    memset(&inputs, 0, sizeof(inputs));
    inputs.flags = IPL_SIMULATIONFLAGS_DIRECT;
    inputs.directFlags = (IPLDirectSimulationFlags)direct_flags;
    inputs.source.origin = (IPLVector3){ x, y, z };
    inputs.source.ahead = (IPLVector3){ ahead_x, ahead_y, ahead_z };
    inputs.source.up = (IPLVector3){ up_x, up_y, up_z };
    inputs.source.right = (IPLVector3){
        ahead_y * up_z - ahead_z * up_y,
        ahead_z * up_x - ahead_x * up_z,
        ahead_x * up_y - ahead_y * up_x
    };

    inputs.distanceAttenuationModel.type = distance_model == 1
        ? IPL_DISTANCEATTENUATIONTYPE_INVERSEDISTANCE
        : distance_model == 2
            ? IPL_DISTANCEATTENUATIONTYPE_CALLBACK
            : IPL_DISTANCEATTENUATIONTYPE_DEFAULT;
    inputs.distanceAttenuationModel.minDistance = min_distance;
    if (distance_model == 2) {
        inputs.distanceAttenuationModel.callback = distance_callback;
        inputs.distanceAttenuationModel.userData = source;
        inputs.distanceAttenuationModel.dirty = IPL_TRUE;
    }

    inputs.airAbsorptionModel.type = air_model == 1
        ? IPL_AIRABSORPTIONTYPE_EXPONENTIAL
        : air_model == 2
            ? IPL_AIRABSORPTIONTYPE_CALLBACK
            : IPL_AIRABSORPTIONTYPE_DEFAULT;
    if (air_coefficients) {
        for (int band = 0; band < IPL_NUM_BANDS; ++band)
            inputs.airAbsorptionModel.coefficients[band] = air_coefficients[band];
    }
    if (air_model == 2) {
        inputs.airAbsorptionModel.callback = air_callback;
        inputs.airAbsorptionModel.userData = source;
        inputs.airAbsorptionModel.dirty = IPL_TRUE;
    }

    inputs.directivity.dipoleWeight = dipole_weight;
    inputs.directivity.dipolePower = dipole_power;
    inputs.occlusionType = occlusion_type
        ? IPL_OCCLUSIONTYPE_VOLUMETRIC
        : IPL_OCCLUSIONTYPE_RAYCAST;
    inputs.occlusionRadius = occlusion_radius;
    inputs.numOcclusionSamples = occlusion_samples;
    inputs.numTransmissionRays = transmission_rays;
    inputs.reverbScale[0] = 1.0f;
    inputs.reverbScale[1] = 1.0f;
    inputs.reverbScale[2] = 1.0f;
    iplSourceSetInputs(source->handle, IPL_SIMULATIONFLAGS_DIRECT, &inputs);
}

EMSCRIPTEN_KEEPALIVE
int sa_source_get_direct_outputs(void* source_ptr,
                                 float* out_distance_att,
                                 float* out_air_absorption,
                                 float* out_directivity,
                                 float* out_occlusion,
                                 float* out_transmission)
{
    SASource* source = (SASource*)source_ptr;
    if (!source || !source->handle) return 1;
    IPLSimulationOutputs outputs;
    memset(&outputs, 0, sizeof(outputs));
    iplSourceGetOutputs(source->handle, IPL_SIMULATIONFLAGS_DIRECT, &outputs);
    if (out_distance_att) *out_distance_att = outputs.direct.distanceAttenuation;
    if (out_directivity) *out_directivity = outputs.direct.directivity;
    if (out_occlusion) *out_occlusion = outputs.direct.occlusion;
    for (int band = 0; band < IPL_NUM_BANDS; ++band) {
        if (out_air_absorption)
            out_air_absorption[band] = outputs.direct.airAbsorption[band];
        if (out_transmission)
            out_transmission[band] = outputs.direct.transmission[band];
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
float* sa_buffer_alloc(int num_floats)
{
    return (float*)malloc((size_t)num_floats * sizeof(float));
}

EMSCRIPTEN_KEEPALIVE
void sa_buffer_free(float* buffer)
{
    free(buffer);
}

EMSCRIPTEN_KEEPALIVE
void sa_buffer_deinterleave(const float* interleaved, float* deinterleaved,
                            int num_channels, int num_samples)
{
    for (int channel = 0; channel < num_channels; ++channel)
        for (int sample = 0; sample < num_samples; ++sample)
            deinterleaved[channel * num_samples + sample] =
                interleaved[sample * num_channels + channel];
}

EMSCRIPTEN_KEEPALIVE
void sa_buffer_interleave(const float* deinterleaved, float* interleaved,
                          int num_channels, int num_samples)
{
    for (int channel = 0; channel < num_channels; ++channel)
        for (int sample = 0; sample < num_samples; ++sample)
            interleaved[sample * num_channels + channel] =
                deinterleaved[channel * num_samples + sample];
}
