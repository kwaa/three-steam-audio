/*
 * three-steam-audio C bridge layer — implementation
 *
 * Built against Steam Audio 4.8.x (phonon.h)
 */

#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include "phonon.h"
#include "bindings.h"

/* ================================================================ */
/*  Context                                                         */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_context_create(void** out_ctx)
{
    if (!out_ctx) return 1;

    IPLContextSettings settings;
    memset(&settings, 0, sizeof(settings));
    settings.version = STEAMAUDIO_VERSION;

    IPLerror err = iplContextCreate(&settings, (IPLContext*)out_ctx);
    return (err == IPL_STATUS_SUCCESS) ? 0 : (int)err;
}

EMSCRIPTEN_KEEPALIVE
void sa_context_release(void* ctx)
{
    if (ctx)
        iplContextRelease((IPLContext*)&ctx);
}

/* ================================================================ */
/*  Scene                                                           */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_scene_create(void* ctx,
                    int num_verts, const float* verts,
                    int num_tris,  const int* indices,
                    int num_materials,
                    const float* absorption,
                    const float* scattering,
                    const int* tri_materials,
                    void** out_scene)
{
    if (!ctx || !out_scene) return 1;

    IPLSceneSettings scene_settings;
    memset(&scene_settings, 0, sizeof(scene_settings));
    scene_settings.type = IPL_SCENETYPE_DEFAULT;

    IPLerror err = iplSceneCreate((IPLContext)ctx, &scene_settings, (IPLScene*)out_scene);
    if (err != IPL_STATUS_SUCCESS) return (int)err;

    /* Build material array */
    IPLMaterial* materials = (IPLMaterial*)calloc(num_materials, sizeof(IPLMaterial));
    if (!materials) return (int)IPL_STATUS_OUTOFMEMORY;

    for (int i = 0; i < num_materials; ++i) {
        materials[i].absorption[0] = absorption[i * 3 + 0];
        materials[i].absorption[1] = absorption[i * 3 + 1];
        materials[i].absorption[2] = absorption[i * 3 + 2];
        materials[i].scattering    = scattering[i];
        materials[i].transmission[0] = 0.0f;
        materials[i].transmission[1] = 0.0f;
        materials[i].transmission[2] = 0.0f;
    }

    /* Build vertex / triangle arrays */
    IPLVector3* ipl_verts = (IPLVector3*)calloc(num_verts, sizeof(IPLVector3));
    IPLTriangle* ipl_tris = (IPLTriangle*)calloc(num_tris, sizeof(IPLTriangle));
    if (!ipl_verts || !ipl_tris) {
        free(materials);
        free(ipl_verts);
        free(ipl_tris);
        return (int)IPL_STATUS_OUTOFMEMORY;
    }

    for (int i = 0; i < num_verts; ++i) {
        ipl_verts[i].x = verts[i * 3 + 0];
        ipl_verts[i].y = verts[i * 3 + 1];
        ipl_verts[i].z = verts[i * 3 + 2];
    }

    for (int i = 0; i < num_tris; ++i) {
        ipl_tris[i].indices[0] = indices[i * 3 + 0];
        ipl_tris[i].indices[1] = indices[i * 3 + 1];
        ipl_tris[i].indices[2] = indices[i * 3 + 2];
    }

    IPLStaticMeshSettings mesh_settings;
    memset(&mesh_settings, 0, sizeof(mesh_settings));
    mesh_settings.numVertices   = num_verts;
    mesh_settings.numTriangles  = num_tris;
    mesh_settings.numMaterials  = num_materials;
    mesh_settings.vertices      = ipl_verts;
    mesh_settings.triangles     = ipl_tris;
    mesh_settings.materialIndices = (int*)tri_materials;
    mesh_settings.materials     = materials;

    IPLStaticMesh mesh = NULL;
    err = iplStaticMeshCreate((IPLScene)(*out_scene), &mesh_settings, &mesh);

    free(materials);
    free(ipl_verts);
    free(ipl_tris);

    if (err != IPL_STATUS_SUCCESS) {
        iplSceneRelease((IPLScene*)out_scene);
        return (int)err;
    }

    iplStaticMeshAdd(mesh, (IPLScene)(*out_scene));
    iplSceneCommit((IPLScene)(*out_scene));
    iplStaticMeshRelease(&mesh);

    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_scene_release(void* scene)
{
    if (scene)
        iplSceneRelease((IPLScene*)&scene);
}

/* ================================================================ */
/*  HRTF                                                            */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_hrtf_create(void* ctx, int sample_rate, int frame_size, void** out_hrtf)
{
    if (!ctx || !out_hrtf) return 1;

    IPLAudioSettings audio_settings;
    memset(&audio_settings, 0, sizeof(audio_settings));
    audio_settings.samplingRate = sample_rate;
    audio_settings.frameSize    = frame_size;

    IPLHRTFSettings hrtf_settings;
    memset(&hrtf_settings, 0, sizeof(hrtf_settings));
    hrtf_settings.type = IPL_HRTFTYPE_DEFAULT;

    IPLerror err = iplHRTFCreate((IPLContext)ctx, &audio_settings, &hrtf_settings, (IPLHRTF*)out_hrtf);
    return (err == IPL_STATUS_SUCCESS) ? 0 : (int)err;
}

EMSCRIPTEN_KEEPALIVE
void sa_hrtf_release(void* hrtf)
{
    if (hrtf)
        iplHRTFRelease((IPLHRTF*)&hrtf);
}

/* ================================================================ */
/*  Binaural Effect                                                 */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_binaural_effect_create(void* ctx, int sample_rate, int frame_size,
                              void* hrtf, void** out_effect)
{
    if (!ctx || !hrtf || !out_effect) return 1;

    IPLAudioSettings audio_settings;
    memset(&audio_settings, 0, sizeof(audio_settings));
    audio_settings.samplingRate = sample_rate;
    audio_settings.frameSize    = frame_size;

    IPLBinauralEffectSettings effect_settings;
    memset(&effect_settings, 0, sizeof(effect_settings));
    effect_settings.hrtf = (IPLHRTF)hrtf;

    IPLerror err = iplBinauralEffectCreate((IPLContext)ctx, &audio_settings, &effect_settings,
                                           (IPLBinauralEffect*)out_effect);
    return (err == IPL_STATUS_SUCCESS) ? 0 : (int)err;
}

EMSCRIPTEN_KEEPALIVE
void sa_binaural_effect_release(void* effect)
{
    if (effect)
        iplBinauralEffectRelease((IPLBinauralEffect*)&effect);
}

EMSCRIPTEN_KEEPALIVE
int sa_binaural_effect_apply(void* effect,
                             float dir_x, float dir_y, float dir_z,
                             const float* in_buffer, float* out_buffer,
                             int num_channels, int num_samples)
{
    if (!effect || !in_buffer || !out_buffer) return 1;

    /* Build deinterleaved IPLAudioBuffer wrappers */
    const float* in_channels[2];
    float* out_channels[2];

    for (int ch = 0; ch < num_channels && ch < 2; ++ch)
        in_channels[ch] = in_buffer + ch * num_samples;

    for (int ch = 0; ch < 2; ++ch)
        out_channels[ch] = out_buffer + ch * num_samples;

    IPLAudioBuffer in_buf  = { num_channels, num_samples, (float**)in_channels };
    IPLAudioBuffer out_buf = { 2,            num_samples, out_channels };

    IPLBinauralEffectParams params;
    memset(&params, 0, sizeof(params));
    params.direction.x = dir_x;
    params.direction.y = dir_y;
    params.direction.z = dir_z;
    params.interpolation = IPL_HRTFINTERPOLATION_NEAREST;
    params.spatialBlend = 1.0f;

    iplBinauralEffectApply((IPLBinauralEffect)effect, &params, &in_buf, &out_buf);
    return 0;
}

/* ================================================================ */
/*  Direct Effect                                                   */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_direct_effect_create(void* ctx, int sample_rate, int frame_size,
                            int num_channels, void** out_effect)
{
    if (!ctx || !out_effect) return 1;

    IPLAudioSettings audio_settings;
    memset(&audio_settings, 0, sizeof(audio_settings));
    audio_settings.samplingRate = sample_rate;
    audio_settings.frameSize    = frame_size;

    IPLDirectEffectSettings effect_settings;
    memset(&effect_settings, 0, sizeof(effect_settings));
    effect_settings.numChannels = num_channels;

    IPLerror err = iplDirectEffectCreate((IPLContext)ctx, &audio_settings, &effect_settings,
                                         (IPLDirectEffect*)out_effect);
    return (err == IPL_STATUS_SUCCESS) ? 0 : (int)err;
}

EMSCRIPTEN_KEEPALIVE
void sa_direct_effect_release(void* effect)
{
    if (effect)
        iplDirectEffectRelease((IPLDirectEffect*)&effect);
}

EMSCRIPTEN_KEEPALIVE
int sa_direct_effect_apply(void* effect,
                           float distance_attenuation,
                           const float* air_absorption,
                           float directivity,
                           float occlusion,
                           const float* transmission,
                           const float* in_buffer, float* out_buffer,
                           int num_channels, int num_samples)
{
    if (!effect || !in_buffer || !out_buffer) return 1;

    const float* in_channels[8];
    float* out_channels[8];

    for (int ch = 0; ch < num_channels && ch < 8; ++ch) {
        in_channels[ch]  = in_buffer + ch * num_samples;
        out_channels[ch] = out_buffer + ch * num_samples;
    }

    IPLAudioBuffer in_buf  = { num_channels, num_samples, (float**)in_channels };
    IPLAudioBuffer out_buf = { num_channels, num_samples, out_channels };

    IPLDirectEffectParams params;
    memset(&params, 0, sizeof(params));
    params.flags = IPL_DIRECTEFFECTFLAGS_APPLYDISTANCEATTENUATION
                 | IPL_DIRECTEFFECTFLAGS_APPLYAIRABSORPTION
                 | IPL_DIRECTEFFECTFLAGS_APPLYDIRECTIVITY
                 | IPL_DIRECTEFFECTFLAGS_APPLYOCCLUSION;
    params.transmissionType = IPL_TRANSMISSIONTYPE_FREQINDEPENDENT;
    params.distanceAttenuation = distance_attenuation;
    params.airAbsorption[0] = air_absorption[0];
    params.airAbsorption[1] = air_absorption[1];
    params.airAbsorption[2] = air_absorption[2];
    params.directivity = directivity;
    params.occlusion = occlusion;
    params.transmission[0] = transmission[0];
    params.transmission[1] = transmission[1];
    params.transmission[2] = transmission[2];

    iplDirectEffectApply((IPLDirectEffect)effect, &params, &in_buf, &out_buf);
    return 0;
}

/* ================================================================ */
/*  Simulator                                                       */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_simulator_create(void* ctx, void* scene,
                        int sample_rate, int frame_size,
                        void** out_sim)
{
    if (!ctx || !out_sim) return 1;

    IPLSimulationSettings sim_settings;
    memset(&sim_settings, 0, sizeof(sim_settings));
    sim_settings.flags             = IPL_SIMULATIONFLAGS_DIRECT;
    sim_settings.sceneType         = IPL_SCENETYPE_DEFAULT;
    sim_settings.reflectionType    = IPL_REFLECTIONEFFECTTYPE_PARAMETRIC;
    sim_settings.maxNumOcclusionSamples = 128;
    sim_settings.maxNumRays        = 0;
    sim_settings.numDiffuseSamples = 0;
    sim_settings.maxDuration       = 0.0f;
    sim_settings.maxOrder          = 0;
    sim_settings.maxNumSources     = 32;
    sim_settings.numThreads        = 1;
    sim_settings.samplingRate      = sample_rate;
    sim_settings.frameSize         = frame_size;

    IPLerror err = iplSimulatorCreate((IPLContext)ctx, &sim_settings, (IPLSimulator*)out_sim);
    if (err != IPL_STATUS_SUCCESS) return (int)err;

    if (scene) {
        iplSimulatorSetScene((IPLSimulator)(*out_sim), (IPLScene)scene);
        iplSimulatorCommit((IPLSimulator)(*out_sim));
    }

    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_simulator_release(void* sim)
{
    if (sim)
        iplSimulatorRelease((IPLSimulator*)&sim);
}

EMSCRIPTEN_KEEPALIVE
int sa_simulator_run_direct(void* sim)
{
    if (!sim) return 1;
    iplSimulatorRunDirect((IPLSimulator)sim);
    return 0;
}

/* ================================================================ */
/*  Source                                                          */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
int sa_source_create(void* sim, void** out_source)
{
    if (!sim || !out_source) return 1;

    IPLSourceSettings src_settings;
    memset(&src_settings, 0, sizeof(src_settings));
    src_settings.flags = IPL_SIMULATIONFLAGS_DIRECT;

    IPLerror err = iplSourceCreate((IPLSimulator)sim, &src_settings, (IPLSource*)out_source);
    if (err != IPL_STATUS_SUCCESS) return (int)err;

    iplSourceAdd((IPLSource)(*out_source), (IPLSimulator)sim);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sa_source_release(void* source)
{
    if (source)
        iplSourceRelease((IPLSource*)&source);
}

EMSCRIPTEN_KEEPALIVE
void sa_simulator_set_listener(void* sim,
                               float x, float y, float z,
                               float ahead_x, float ahead_y, float ahead_z,
                               float up_x, float up_y, float up_z)
{
    if (!sim) return;

    IPLSimulationSharedInputs shared;
    memset(&shared, 0, sizeof(shared));
    shared.listener.origin.x = x;
    shared.listener.origin.y = y;
    shared.listener.origin.z = z;
    shared.listener.ahead.x = ahead_x;
    shared.listener.ahead.y = ahead_y;
    shared.listener.ahead.z = ahead_z;
    shared.listener.up.x = up_x;
    shared.listener.up.y = up_y;
    shared.listener.up.z = up_z;
    shared.listener.right.x = 1.0f;
    shared.listener.right.y = 0.0f;
    shared.listener.right.z = 0.0f;

    iplSimulatorSetSharedInputs((IPLSimulator)sim, IPL_SIMULATIONFLAGS_DIRECT, &shared);
}

EMSCRIPTEN_KEEPALIVE
void sa_source_set_transform(void* source,
                             float x, float y, float z,
                             float ahead_x, float ahead_y, float ahead_z,
                             float up_x, float up_y, float up_z,
                             float occlusion)
{
    if (!source) return;

    IPLSimulationInputs inputs;
    memset(&inputs, 0, sizeof(inputs));
    inputs.flags = IPL_SIMULATIONFLAGS_DIRECT;
    inputs.directFlags = IPL_DIRECTSIMULATIONFLAGS_DISTANCEATTENUATION
                       | IPL_DIRECTSIMULATIONFLAGS_AIRABSORPTION
                       | IPL_DIRECTSIMULATIONFLAGS_DIRECTIVITY
                       | IPL_DIRECTSIMULATIONFLAGS_OCCLUSION;

    inputs.source.origin.x = x;
    inputs.source.origin.y = y;
    inputs.source.origin.z = z;
    inputs.source.ahead.x = ahead_x;
    inputs.source.ahead.y = ahead_y;
    inputs.source.ahead.z = ahead_z;
    inputs.source.up.x = up_x;
    inputs.source.up.y = up_y;
    inputs.source.up.z = up_z;
    inputs.source.right.x = 1.0f;
    inputs.source.right.y = 0.0f;
    inputs.source.right.z = 0.0f;

    inputs.occlusionType = IPL_OCCLUSIONTYPE_RAYCAST;
    inputs.numOcclusionSamples = 1;
    inputs.occlusionRadius = 0.0f;
    inputs.numTransmissionRays = 1;

    /* Default models */
    inputs.distanceAttenuationModel.type = IPL_DISTANCEATTENUATIONTYPE_DEFAULT;
    inputs.airAbsorptionModel.type = IPL_AIRABSORPTIONTYPE_DEFAULT;
    inputs.directivity.dipoleWeight = 0.0f;
    inputs.directivity.dipolePower = 0.0f;

    iplSourceSetInputs((IPLSource)source, IPL_SIMULATIONFLAGS_DIRECT, &inputs);
}

EMSCRIPTEN_KEEPALIVE
int sa_source_get_direct_outputs(void* source,
                                 float* out_distance_att,
                                 float* out_air_absorption,
                                 float* out_directivity,
                                 float* out_occlusion,
                                 float* out_transmission)
{
    if (!source) return 1;

    IPLSimulationOutputs outputs;
    memset(&outputs, 0, sizeof(outputs));
    iplSourceGetOutputs((IPLSource)source, IPL_SIMULATIONFLAGS_DIRECT, &outputs);

    if (out_distance_att)   *out_distance_att   = outputs.direct.distanceAttenuation;
    if (out_air_absorption) {
        out_air_absorption[0] = outputs.direct.airAbsorption[0];
        out_air_absorption[1] = outputs.direct.airAbsorption[1];
        out_air_absorption[2] = outputs.direct.airAbsorption[2];
    }
    if (out_directivity)    *out_directivity    = outputs.direct.directivity;
    if (out_occlusion)      *out_occlusion      = outputs.direct.occlusion;
    if (out_transmission) {
        out_transmission[0] = outputs.direct.transmission[0];
        out_transmission[1] = outputs.direct.transmission[1];
        out_transmission[2] = outputs.direct.transmission[2];
    }
    return 0;
}

/* ================================================================ */
/*  Buffer Helpers                                                  */
/* ================================================================ */

EMSCRIPTEN_KEEPALIVE
float* sa_buffer_alloc(int num_floats)
{
    return (float*)malloc(num_floats * sizeof(float));
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
    for (int ch = 0; ch < num_channels; ++ch) {
        for (int i = 0; i < num_samples; ++i) {
            deinterleaved[ch * num_samples + i] = interleaved[i * num_channels + ch];
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void sa_buffer_interleave(const float* deinterleaved, float* interleaved,
                          int num_channels, int num_samples)
{
    for (int ch = 0; ch < num_channels; ++ch) {
        for (int i = 0; i < num_samples; ++i) {
            interleaved[i * num_channels + ch] = deinterleaved[ch * num_samples + i];
        }
    }
}
