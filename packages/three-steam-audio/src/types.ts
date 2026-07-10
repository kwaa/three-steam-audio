import type { BufferGeometry, Matrix4 } from 'three'

export interface AcousticMaterial {
  absorption: ThreeBand
  scattering: number
  transmission?: ThreeBand
}
export interface AcousticMeshHandle {
  dispose: () => void
}

export interface AcousticScene {
  addDynamicMesh: (input: DynamicMeshInput) => DynamicAcousticMeshHandle
  addStaticMesh: (input: StaticMeshInput) => AcousticMeshHandle
  commit: () => void
}

export type AirAbsorptionSettings
  = | { coefficients: ThreeBand, model: 'exponential' }
    | {
      curves: readonly [
        (distance: number) => number,
        (distance: number) => number,
        (distance: number) => number,
      ]
      maxDistance: number
      model: 'curve'
      sampleCount?: number
    }
    | { model?: 'default' }

export interface DirectivitySettings {
  dipolePower?: number
  dipoleWeight?: number
}

export interface DirectOutputs {
  airAbsorption: [number, number, number]
  directivity: number
  distanceAttenuation: number
  occlusion: number
  transmission: [number, number, number]
}

export interface DirectOverrides {
  airAbsorption?: ThreeBand
  directivity?: number
  distanceAttenuation?: number
  occlusion?: number
  transmission?: ThreeBand
}

export interface DirectSettings {
  airAbsorption?: AirAbsorptionSettings | boolean
  directivity?: DirectivitySettings | false
  distanceAttenuation?: DistanceAttenuationSettings | false
  mixLevel?: number
  occlusion?: false | OcclusionSettings
  transmission?: false | {
    maxSurfaces?: number
    type?: 'frequency-dependent' | 'frequency-independent'
  }
}

export interface DirectWorldSettings {
  maxOcclusionSamples?: number
  updateRate?: number
}

export type DistanceAttenuationSettings
  = | {
    curve: (distance: number) => number
    maxDistance: number
    minDistance: number
    model: 'curve'
    sampleCount?: number
  }
  | { minDistance?: number, model: 'inverse' }
  | { model?: 'default' }

export interface DynamicAcousticMeshHandle extends AcousticMeshHandle {
  setTransform: (matrixWorld: Matrix4) => void
}

export interface DynamicMeshInput extends StaticMeshInput {
  matrixWorld: Matrix4
}

export type HRTFSettings
  = | {
    /** Bytes of a SimpleFreeFieldHRIR SOFA file. */
    data: ArrayBuffer
    normalization?: 'none' | 'rms'
    type: 'sofa'
    volume?: number
  }
  | {
    normalization?: 'none' | 'rms'
    type?: 'default'
    volume?: number
  }

export interface Listener {
  setOrientation: (orientation: QuaternionLike) => void
  setPosition: (position: Vector3Like) => void
  setReverb: (settings: false | ReverbSettings) => void
  setTransform: (position: Vector3Like, orientation: QuaternionLike) => void
}

export type OcclusionQualityPreset = 'high' | 'low' | 'medium'

export interface OcclusionSettings {
  radius?: number
  samples?: number
  type?: 'raycast' | 'volumetric'
}

export interface QuaternionLike {
  w: number
  x: number
  y: number
  z: number
}

export interface ReflectionBusSettings {
  wet?: number
}

export interface ReflectionConnection {
  disconnect: () => void
  setGain: (gain: number) => void
}

export interface ReflectionSettings {
  mixLevel?: number
  reverbScale?: ThreeBand
}

export interface ReflectionSimulationSettings {
  ambisonicOrder?: number
  bounces?: number
  duration?: number
  irradianceMinDistance?: number
  rays?: number
}

export interface ReverbBusSettings {
  wet?: number
}

export type ReverbConnection = ReflectionConnection

export interface ReverbSettings {
  reverbScale?: ThreeBand
}

export interface Source {
  dispose: () => void
  getDirectOutputs: (target?: DirectOutputs) => DirectOutputs
  readonly id: number
  setDirectOverrides: (overrides: DirectOverrides | null) => void
  setOrientation: (orientation: QuaternionLike) => void
  setPosition: (position: Vector3Like) => void
  setSettings: (settings: Partial<SourceSettings>) => void
  setTransform: (position: Vector3Like, orientation: QuaternionLike) => void
}

export interface SourceSettings {
  direct?: DirectSettings | false
  reflections?: false | ReflectionSettings
  spatialization?: SpatializationSettings
}

export type SpatializationSettings
  = | {
    blend?: number
    interpolation?: 'bilinear' | 'nearest'
    mode?: 'binaural'
  }
  | {
    blend?: number
    mode: 'panning'
  }
  | {
    mode: 'none'
  }

export interface StaticMeshInput {
  geometry: BufferGeometry
  material: AcousticMaterial | readonly AcousticMaterial[]
  matrixWorld?: Matrix4
}

export interface SteamAudioCapabilities {
  audioWorklet: boolean
  crossOriginIsolated: boolean
  gpuSimulation: false
  runtimeBaking: boolean
  sharedArrayBuffer: boolean
  webAssembly: boolean
}

export type SteamAudioModuleFactory = (
  options?: SteamAudioModuleOptions,
) => Promise<unknown>

export interface SteamAudioModuleOptions {
  locateFile?: (path: string, prefix: string) => string
  wasmBinary?: ArrayBuffer
}

export type ThreeBand = readonly [number, number, number]

export interface Vector3Like {
  x: number
  y: number
  z: number
}

export interface WorldOptions {
  audioContext: AudioContext
  direct?: DirectWorldSettings
  frameSize?: number
  hrtf?: HRTFSettings
  maxSources?: number
  moduleFactory?: SteamAudioModuleFactory
  occlusionQuality?: OcclusionQualityPreset
  reflections?: false | {
    diffuseSamples?: number
    initial?: ReflectionSimulationSettings
    maxDuration?: number
    maxOrder?: number
    maxRays?: number
    maxSources?: number
    updateRate?: number
  }
}
