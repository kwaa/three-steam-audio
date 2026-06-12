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
      samples?: number
    }
    | { model?: 'default' }

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

export interface DirectSimulationSettings {
  airAbsorption?: boolean
  airAbsorptionModel?: AirAbsorptionSettings
  occlusion?: 'raycast' | 'volumetric' | false
  occlusionRadius?: number
  occlusionSamples?: number
  transmission?: false | {
    type?: 'frequency-dependent' | 'frequency-independent'
  }
}

export type DistanceAttenuationSettings
  = | {
    curve: (distance: number) => number
    maxDistance: number
    minDistance: number
    model: 'curve'
    samples?: number
  }
  | { minDistance?: number, model: 'inverse' }
  | { model?: 'default' }

export interface DynamicAcousticMeshHandle extends AcousticMeshHandle {
  setTransform: (matrixWorld: Matrix4) => void
}

export interface DynamicMeshInput extends StaticMeshInput {
  matrixWorld: Matrix4
}

export interface HRTFSettings { type?: 'default' }

export interface Listener {
  setOrientation: (orientation: QuaternionLike) => void
  setPosition: (position: Vector3Like) => void
  setTransform: (position: Vector3Like, orientation: QuaternionLike) => void
}

export type QualityPreset = 'high' | 'low' | 'medium'

export interface QuaternionLike {
  w: number
  x: number
  y: number
  z: number
}

export interface RuntimeSimulationSettings {
  bounces?: number
  duration?: number
  irradianceMinDistance?: number
  order?: number
  rays?: number
}

export interface SimulationSettings {
  diffuseSamples?: number
  maxDuration?: number
  maxOcclusionSamples?: number
  maxOrder?: number
  maxRays?: number
  pathingVisibilitySamples?: number
  rayBatchSize?: number
  reflectionEffect?: 'convolution' | 'hybrid' | 'parametric'
  reflectionThreads?: number
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
  directivity?: {
    dipolePower?: number
    dipoleWeight?: number
  }
  directSimulation?: boolean | DirectSimulationSettings
  distanceAttenuation?: DistanceAttenuationSettings | false
  hrtf?: boolean
  spatialBlend?: number
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
  frameSize?: number
  hrtf?: HRTFSettings
  maxSources?: number
  moduleFactory?: SteamAudioModuleFactory
  quality?: QualityPreset
  simulation?: SimulationSettings
  simulationRate?: number
}
