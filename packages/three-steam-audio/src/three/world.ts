import type { Matrix4 } from 'three'

import type {
  AcousticMeshHandle,
  AcousticScene,
  AirAbsorptionSettings,
  DirectOutputs,
  DirectOverrides,
  DirectSettings,
  DistanceAttenuationSettings,
  DynamicAcousticMeshHandle,
  DynamicMeshInput,
  HRTFSettings,
  Listener,
  OcclusionSettings,
  QuaternionLike,
  ReflectionBusSettings,
  ReflectionSettings,
  ReflectionSimulationSettings,
  ReverbBusSettings,
  ReverbSettings,
  Source,
  SourceSettings,
  SpatializationSettings,
  StaticMeshInput,
  Vector3Like,
  WorldOptions,
} from '../types'
import type { PreparedRuntime } from '../worker/runtime'
import type { NativeModule } from './native'

import { Quaternion, Matrix4 as ThreeMatrix4, Vector3 } from 'three'

import { ReflectionBusNode, ReverbBusNode, SteamAudioNode } from '../worker/audio-node'
import {
  canUseReflectionWorker,
  ReflectionSimulationWorker,
} from '../worker/reflection-simulation'
import { prepareWorldRuntime } from '../worker/runtime'
import { assertNativeStatus, SteamAudioError } from './errors'
import {
  convertGeometry,
  matrixToRowMajor,
  rigidMatrixForScale,
  splitDynamicTransform,
} from './geometry'
import {
  createHandle,

  withFloatArray,
  withIntArray,
  withOptionalFloatArray,
} from './native'

const DIRECT_DISTANCE = 1 << 0
const DIRECT_AIR = 1 << 1
const DIRECT_DIRECTIVITY = 1 << 2
const DIRECT_OCCLUSION = 1 << 3
const DIRECT_TRANSMISSION = 1 << 4
const SIMULATION_DIRECT = 1 << 0
const SIMULATION_REFLECTIONS = 1 << 1

const DEFAULT_FRAME_SIZE = 1024
const DEFAULT_MAX_SOURCES = 32
const DEFAULT_SIMULATION_RATE = 60
const DEFAULT_REFLECTION_RATE = 10
const DEFAULT_MAX_OCCLUSION_SAMPLES = 128
const MAX_TRANSMISSION_SURFACES = 8
const QUALITY_MAX_OCCLUSION_SAMPLES = {
  high: 256,
  low: 32,
  medium: DEFAULT_MAX_OCCLUSION_SAMPLES,
} as const

const ahead = new Vector3()
const up = new Vector3()
const orientationScratch = new Quaternion()

export interface NormalizedReflectionSimulationSettings {
  bounces: number
  diffuseSamples: number
  duration: number
  enabled: boolean
  irradianceMinDistance: number
  maxDuration: number
  maxOrder: number
  maxRays: number
  order: number
  rays: number
}

interface NativeMesh {
  dispose: () => void
}

interface NormalizedHRTFSettings {
  cacheKey: string
  data?: ArrayBuffer
  normalization: 'none' | 'rms'
  type: 'default' | 'sofa'
  volume: number
}

const sofaCacheKeyCounter = { value: 1 }

interface NormalizedSourceSettings {
  direct: Required<Pick<DirectSettings, 'mixLevel'>> & {
    airAbsorption: AirAbsorptionSettings | boolean
    directivity: false | {
      dipolePower: number
      dipoleWeight: number
    }
    distanceAttenuation: DistanceAttenuationSettings | false
    occlusion: false | Required<OcclusionSettings>
    transmission: false | {
      maxSurfaces: number
      type: 'frequency-dependent' | 'frequency-independent'
    }
  }
  reflections: Required<Pick<ReflectionSettings, 'mixLevel' | 'reverbScale'>> & {
    enabled: boolean
  }
  spatialization: NormalizedSpatializationSettings
}

type NormalizedSpatializationSettings
  = | {
    blend: number
    interpolation: 'bilinear' | 'nearest'
    mode: 'binaural'
  }
  | {
    blend: number
    mode: 'panning'
  }
  | {
    mode: 'none'
  }

const clampUnit = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError(`${name} must be a finite number in [0, 1]`)
  return value
}

const gain = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a finite number >= 0`)
  return value
}

const normalizeHRTFSettings = (
  settings: HRTFSettings | undefined,
): NormalizedHRTFSettings => {
  const input = settings ?? {}
  const normalization = input.normalization ?? 'none'
  if (normalization !== 'none' && normalization !== 'rms')
    throw new RangeError('hrtf.normalization must be none or rms')
  if (input.type === 'sofa') {
    if (!(input.data instanceof ArrayBuffer))
      throw new TypeError('hrtf.data must be an ArrayBuffer when hrtf.type is sofa')
    if (input.data.byteLength === 0)
      throw new RangeError('hrtf.data must not be empty')
    if (input.data.byteLength > 0x7FFFFFFF)
      throw new RangeError('hrtf.data must not exceed 2147483647 bytes')
    const data = input.data.slice(0)
    return {
      cacheKey: `sofa-${sofaCacheKeyCounter.value++}`,
      data,
      normalization,
      type: 'sofa',
      volume: gain('hrtf.volume', input.volume ?? 1),
    }
  }
  if (input.type !== undefined && input.type !== 'default')
    throw new RangeError('hrtf.type must be default or sofa')
  return {
    cacheKey: 'default',
    normalization,
    type: 'default',
    volume: gain('hrtf.volume', input.volume ?? 1),
  }
}

const positive = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be a positive finite number`)
  return value
}

const integer = (name: string, value: number, minimum = 1): number => {
  if (!Number.isInteger(value) || value < minimum)
    throw new RangeError(`${name} must be an integer >= ${minimum}`)
  return value
}

const unitThreeBand = (name: string, values: readonly number[]): void => {
  if (values.length !== 3)
    throw new RangeError(`${name} must contain exactly three bands`)
  for (let band = 0; band < 3; band++)
    clampUnit(`${name}[${band}]`, values[band])
}

const normalizeQuaternion = (value: QuaternionLike): Quaternion => {
  orientationScratch.set(value.x, value.y, value.z, value.w)
  if (orientationScratch.lengthSq() < 1e-12)
    throw new RangeError('orientation must not be a zero quaternion')
  return orientationScratch.normalize()
}

const directionsFromQuaternion = (value: QuaternionLike): [Vector3, Vector3] => {
  const quaternion = normalizeQuaternion(value)
  ahead.set(0, 0, -1).applyQuaternion(quaternion)
  up.set(0, 1, 0).applyQuaternion(quaternion)
  return [ahead, up]
}

const normalizeReflectionSettings = (
  settings: SourceSettings['reflections'],
): NormalizedSourceSettings['reflections'] => {
  const input = settings === false || settings === undefined
    ? undefined
    : settings
  const reverbScale = input?.reverbScale ?? [1, 1, 1]
  reverbScale.forEach((value, band) => {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError(`reflections.reverbScale[${band}] must be a finite number >= 0`)
  })
  return {
    enabled: input !== undefined,
    mixLevel: gain('reflections.mixLevel', input?.mixLevel ?? 1),
    reverbScale,
  }
}

/* eslint-disable sonarjs/function-return-type -- API uses false to disable direct-path subfeatures. */
const normalizeDirectivity = (
  directivity: DirectSettings['directivity'],
): NormalizedSourceSettings['direct']['directivity'] => {
  if (directivity === false)
    return false
  const input = directivity ?? { dipolePower: 0, dipoleWeight: 0 }
  const normalized = {
    dipolePower: input.dipolePower ?? 0,
    dipoleWeight: clampUnit('direct.directivity.dipoleWeight', input.dipoleWeight ?? 0),
  }
  if (!Number.isFinite(normalized.dipolePower) || normalized.dipolePower < 0)
    throw new RangeError('direct.directivity.dipolePower must be a finite number >= 0')
  return normalized
}

const normalizeOcclusion = (
  occlusion: DirectSettings['occlusion'],
  maximumOcclusionSamples: number,
): NormalizedSourceSettings['direct']['occlusion'] => {
  if (occlusion === false || occlusion === undefined)
    return false
  const normalized = {
    radius: occlusion.radius ?? 1,
    samples: occlusion.samples ?? 16,
    type: occlusion.type ?? 'raycast',
  }
  if (normalized.type !== 'volumetric')
    return normalized
  if (!Number.isFinite(normalized.radius) || normalized.radius < 0)
    throw new RangeError('direct.occlusion.radius must be a finite number >= 0')
  normalized.samples = integer('direct.occlusion.samples', normalized.samples)
  if (normalized.samples > maximumOcclusionSamples)
    throw new RangeError(`direct.occlusion.samples cannot exceed World direct.maxOcclusionSamples (${maximumOcclusionSamples})`)
  return normalized
}

const normalizeTransmission = (
  transmission: DirectSettings['transmission'],
): NormalizedSourceSettings['direct']['transmission'] => {
  if (transmission === false || transmission === undefined)
    return false
  const maxSurfaces = integer(
    'direct.transmission.maxSurfaces',
    transmission.maxSurfaces ?? 1,
  )
  if (maxSurfaces > MAX_TRANSMISSION_SURFACES) {
    throw new RangeError(
      `direct.transmission.maxSurfaces cannot exceed ${MAX_TRANSMISSION_SURFACES}`,
    )
  }
  return {
    maxSurfaces,
    type: transmission.type ?? 'frequency-independent',
  }
}
/* eslint-enable sonarjs/function-return-type */

const normalizeDirectSettings = (
  settings: SourceSettings['direct'],
  maximumOcclusionSamples: number,
): NormalizedSourceSettings['direct'] => {
  if (settings === false) {
    return {
      airAbsorption: false,
      directivity: false,
      distanceAttenuation: false,
      mixLevel: 0,
      occlusion: false,
      transmission: false,
    }
  }

  const input = settings ?? {}
  const occlusion = normalizeOcclusion(input.occlusion, maximumOcclusionSamples)
  const transmission = normalizeTransmission(input.transmission)
  if (transmission !== false && occlusion === false)
    throw new Error('Transmission requires occlusion to be enabled')

  return {
    airAbsorption: input.airAbsorption ?? false,
    directivity: normalizeDirectivity(input.directivity),
    distanceAttenuation: input.distanceAttenuation === undefined
      ? { model: 'default' }
      : input.distanceAttenuation,
    mixLevel: clampUnit('direct.mixLevel', input.mixLevel ?? 1),
    occlusion,
    transmission,
  }
}

const normalizeSpatializationSettings = (
  settings: SpatializationSettings | undefined,
): NormalizedSpatializationSettings => {
  const input = settings ?? { mode: 'binaural' }
  if (input.mode === 'none')
    return { mode: 'none' }
  if (input.mode === 'panning') {
    return {
      blend: clampUnit('spatialization.blend', input.blend ?? 1),
      mode: 'panning',
    }
  }
  return {
    blend: clampUnit('spatialization.blend', input.blend ?? 1),
    interpolation: input.interpolation ?? 'nearest',
    mode: 'binaural',
  }
}

const normalizeSettings = (
  settings: SourceSettings = {},
  maximumOcclusionSamples = DEFAULT_MAX_OCCLUSION_SAMPLES,
): NormalizedSourceSettings => {
  return {
    direct: normalizeDirectSettings(settings.direct, maximumOcclusionSamples),
    reflections: normalizeReflectionSettings(settings.reflections),
    spatialization: normalizeSpatializationSettings(settings.spatialization),
  }
}

const sampleCurve = (
  callback: (distance: number) => number,
  maximum: number,
  count: number,
  name: string,
  minimum = 0,
): Float32Array => {
  positive(`${name}.maxDistance`, maximum)
  integer(`${name}.sampleCount`, count, 2)
  if (maximum <= minimum)
    throw new RangeError(`${name}.maxDistance must be greater than minDistance`)
  const values = new Float32Array(count)
  for (let index = 0; index < count; index++) {
    values[index] = clampUnit(
      `${name}.curve result`,
      callback(minimum + (maximum - minimum) * index / (count - 1)),
    )
  }
  return values
}

const distanceModel = (settings: DistanceAttenuationSettings | false) => {
  if (settings === false)
    return { curve: undefined, maximum: 0, minimum: 1, model: 0 }
  if (settings.model === 'inverse')
    return { curve: undefined, maximum: 0, minimum: positive('distanceAttenuation.minDistance', settings.minDistance ?? 1), model: 1 }
  if (settings.model === 'curve') {
    positive('distanceAttenuation.minDistance', settings.minDistance)
    return {
      curve: sampleCurve(
        settings.curve,
        settings.maxDistance,
        settings.sampleCount ?? 256,
        'distanceAttenuation',
        settings.minDistance,
      ),
      maximum: settings.maxDistance,
      minimum: settings.minDistance,
      model: 2,
    }
  }
  return { curve: undefined, maximum: 0, minimum: 1, model: 0 }
}

const airModel = (settings: AirAbsorptionSettings | boolean | undefined) => {
  if (settings === undefined || settings === false || settings === true || !settings.model || settings.model === 'default')
    return { coefficients: undefined, curves: undefined, maximum: 0, model: 0, samples: 0 }
  if (settings.model === 'exponential') {
    settings.coefficients.forEach((value, band) => clampUnit(`airAbsorption.coefficients[${band}]`, value))
    return {
      coefficients: new Float32Array(settings.coefficients),
      curves: undefined,
      maximum: 0,
      model: 1,
      samples: 0,
    }
  }
  if (!('curves' in settings))
    throw new Error(`Unsupported air absorption model: ${String(settings.model)}`)
  const count = settings.sampleCount ?? 256
  const curves = new Float32Array(count * 3)
  settings.curves.forEach((curve, band) => {
    curves.set(sampleCurve(curve, settings.maxDistance, count, `airAbsorption.curves[${band}]`), band * count)
  })
  return {
    coefficients: undefined,
    curves,
    maximum: settings.maxDistance,
    model: 2,
    samples: count,
  }
}

const directEffectFlags = (
  settings: NormalizedSourceSettings,
  overrides: DirectOverrides | null,
): number => {
  const direct = settings.direct
  let flags = 0
  if (direct.distanceAttenuation !== false || overrides?.distanceAttenuation !== undefined)
    flags |= DIRECT_DISTANCE
  if (direct.airAbsorption !== false || overrides?.airAbsorption !== undefined)
    flags |= DIRECT_AIR
  if ((direct.directivity !== false && direct.directivity.dipoleWeight > 0) || overrides?.directivity !== undefined)
    flags |= DIRECT_DIRECTIVITY
  if (direct.occlusion !== false || overrides?.occlusion !== undefined)
    flags |= DIRECT_OCCLUSION
  if (direct.transmission !== false || overrides?.transmission !== undefined)
    flags |= DIRECT_TRANSMISSION
  return flags
}

const spatializationModeCode = (settings: NormalizedSpatializationSettings): number => {
  if (settings.mode === 'none')
    return 0
  if (settings.mode === 'binaural')
    return 1
  return 2
}

const spatializationBlend = (settings: NormalizedSpatializationSettings): number =>
  settings.mode === 'none' ? 0 : settings.blend

const hrtfInterpolationCode = (settings: NormalizedSpatializationSettings): number =>
  settings.mode === 'binaural' && settings.interpolation === 'bilinear' ? 1 : 0

export type World = Pick<
  WorldImpl,
  | 'audioContext'
  | 'createNode'
  | 'createReflectionBus'
  | 'createReverbBus'
  | 'createSource'
  | 'dispose'
  | 'listener'
  | 'scene'
  | 'setReflectionSettings'
  | 'step'
>

class AcousticSceneImpl implements AcousticScene {
  #dirty = false
  readonly #handles = new Set<NativeMesh>()
  #nextReflectionMeshId = 1
  readonly #pendingReleases: Array<() => void> = []
  readonly #world: WorldImpl

  constructor(world: WorldImpl) {
    this.#world = world
  }

  addDynamicMesh(input: DynamicMeshInput): DynamicAcousticMeshHandle {
    this.#world.assertActive('AcousticScene.addDynamicMesh')
    const transform = splitDynamicTransform(input.matrixWorld)
    const reflectionMeshId = this.#nextReflectionMeshId++
    let currentRigidMatrix = transform.rigidMatrix.clone()
    const subScene = createHandle(this.#world.module, 'iplSceneCreate', out =>
      this.#world.module._sa_scene_create(this.#world.context, out))
    let staticMesh = 0
    let instance = 0
    try {
      const created = this.#createStaticMesh(subScene, input, transform.bakedMatrix)
      staticMesh = created.native
      this.#world.module._sa_static_mesh_add(staticMesh, subScene)
      this.#world.module._sa_scene_commit(subScene)
      instance = createHandle(this.#world.module, 'iplInstancedMeshCreate', out =>
        withFloatArray(this.#world.module, matrixToRowMajor(transform.rigidMatrix), matrixPointer =>
          this.#world.module._sa_instanced_mesh_create(
            this.#world.sceneHandle,
            subScene,
            matrixPointer,
            out,
          )))
      this.#world.reflectionWorker?.addDynamicMesh(
        reflectionMeshId,
        created.converted,
        Array.isArray(input.material) ? input.material.length : 1,
        transform.rigidMatrix,
      )
    }
    catch (error) {
      if (staticMesh !== 0)
        this.#world.module._sa_static_mesh_release(staticMesh)
      this.#world.module._sa_scene_release(subScene)
      throw error
    }
    this.#dirty = true
    let disposed = false
    const handle: DynamicAcousticMeshHandle & NativeMesh = {
      dispose: () => {
        if (disposed)
          return
        disposed = true
        this.#world.module._sa_instanced_mesh_remove(instance, this.#world.sceneHandle)
        this.#world.reflectionWorker?.removeMesh(reflectionMeshId)
        this.#pendingReleases.push(() => {
          this.#world.module._sa_instanced_mesh_release(instance)
          this.#world.module._sa_static_mesh_release(staticMesh)
          this.#world.module._sa_scene_release(subScene)
        })
        this.#handles.delete(handle)
        this.#dirty = true
      },
      setTransform: (matrixWorld: Matrix4) => {
        if (disposed)
          throw new SteamAudioError('DynamicAcousticMeshHandle.setTransform', 'mesh has been disposed')
        const rigid = rigidMatrixForScale(matrixWorld, transform.scale)
        if (rigid.equals(currentRigidMatrix))
          return
        currentRigidMatrix = rigid.clone()
        withFloatArray(this.#world.module, matrixToRowMajor(rigid), pointer =>
          this.#world.module._sa_instanced_mesh_update_transform(
            instance,
            this.#world.sceneHandle,
            pointer,
          ))
        this.#world.reflectionWorker?.updateDynamicMesh(reflectionMeshId, rigid)
        this.#dirty = true
      },
    }
    this.#handles.add(handle)
    return handle
  }

  addStaticMesh(input: StaticMeshInput): AcousticMeshHandle {
    this.#world.assertActive('AcousticScene.addStaticMesh')
    const reflectionMeshId = this.#nextReflectionMeshId++
    const created = this.#createStaticMesh(this.#world.sceneHandle, input, input.matrixWorld)
    const mesh = created.native
    this.#world.module._sa_static_mesh_add(mesh, this.#world.sceneHandle)
    this.#world.reflectionWorker?.addStaticMesh(
      reflectionMeshId,
      created.converted,
      Array.isArray(input.material) ? input.material.length : 1,
    )
    this.#dirty = true
    let disposed = false
    const handle: NativeMesh = {
      dispose: () => {
        if (disposed)
          return
        disposed = true
        this.#world.module._sa_static_mesh_remove(mesh, this.#world.sceneHandle)
        this.#world.reflectionWorker?.removeMesh(reflectionMeshId)
        this.#pendingReleases.push(() => this.#world.module._sa_static_mesh_release(mesh))
        this.#handles.delete(handle)
        this.#dirty = true
      },
    }
    this.#handles.add(handle)
    return handle
  }

  commit(): void {
    this.#world.assertActive('AcousticScene.commit')
    if (!this.#dirty)
      return
    this.#world.module._sa_scene_commit(this.#world.sceneHandle)
    this.#world.module._sa_simulator_commit(this.#world.simulator)
    this.#world.reflectionWorker?.commitScene()
    this.#dirty = false
    for (const release of this.#pendingReleases.splice(0))
      release()
  }

  dispose(): void {
    for (const handle of [...this.#handles])
      handle.dispose()
    if (this.#dirty)
      this.commit()
  }

  #createStaticMesh(
    scene: number,
    input: Pick<StaticMeshInput, 'geometry' | 'material'>,
    matrixWorld: Matrix4 = new ThreeMatrix4(),
  ): { converted: ReturnType<typeof convertGeometry>, native: number } {
    const converted = convertGeometry(input.geometry, input.material, matrixWorld)
    const materialCount = Array.isArray(input.material) ? input.material.length : 1
    const native = createHandle(this.#world.module, 'iplStaticMeshCreate', out =>
      withFloatArray(this.#world.module, converted.vertices, vertices =>
        withIntArray(this.#world.module, converted.indices, indices =>
          withFloatArray(this.#world.module, converted.absorption, absorption =>
            withFloatArray(this.#world.module, converted.scattering, scattering =>
              withFloatArray(this.#world.module, converted.transmission, transmission =>
                withIntArray(this.#world.module, converted.materialIndices, materialIndices =>
                  this.#world.module._sa_static_mesh_create(
                    scene,
                    converted.vertices.length / 3,
                    vertices,
                    converted.indices.length / 3,
                    indices,
                    materialCount,
                    absorption,
                    scattering,
                    transmission,
                    materialIndices,
                    out,
                  ))))))))
    return { converted, native }
  }
}

class ListenerImpl implements Listener {
  readonly orientation = new Quaternion()
  readonly position = new Vector3()
  readonly #world: WorldImpl

  constructor(world: WorldImpl) {
    this.#world = world
  }

  setOrientation(orientation: QuaternionLike): void {
    this.setTransform(this.position, orientation)
  }

  setPosition(position: Vector3Like): void {
    this.setTransform(position, this.orientation)
  }

  setReverb(settings: false | ReverbSettings): void {
    this.#world.setListenerReverb(settings)
  }

  setTransform(position: Vector3Like, orientation: QuaternionLike): void {
    this.#world.assertActive('Listener.setTransform')
    this.position.set(position.x, position.y, position.z)
    this.orientation.copy(normalizeQuaternion(orientation))
    const [listenerAhead, listenerUp] = directionsFromQuaternion(this.orientation)
    this.#world.module._sa_simulator_set_listener(
      this.#world.simulator,
      this.position.x,
      this.position.y,
      this.position.z,
      listenerAhead.x,
      listenerAhead.y,
      listenerAhead.z,
      listenerUp.x,
      listenerUp.y,
      listenerUp.z,
      this.#world.reflectionSettings.rays,
      this.#world.reflectionSettings.bounces,
      this.#world.reflectionSettings.duration,
      this.#world.reflectionSettings.order,
      this.#world.reflectionSettings.irradianceMinDistance,
    )
    this.#world.reflectionWorker?.setListener(
      [this.position.x, this.position.y, this.position.z],
      [listenerAhead.x, listenerAhead.y, listenerAhead.z],
      [listenerUp.x, listenerUp.y, listenerUp.z],
      this.#world.reflectionSettings,
    )
    this.#world.syncListenerReverbSource()
    this.#world.publishSourceControls()
  }
}

class SourceImpl implements Source {
  readonly id: number
  readonly nodes = new Set<SteamAudioNode>()
  get native(): number {
    return this.#native
  }

  get reflectionOutputs(): readonly [number, number, number] {
    return this.#reflectionOutputs
  }

  get settings(): NormalizedSourceSettings {
    return this.#settings
  }

  #disposed = false
  readonly #native: number
  readonly #orientation = new Quaternion()
  #outputs: DirectOutputs = {
    airAbsorption: [1, 1, 1],
    directivity: 1,
    distanceAttenuation: 1,
    occlusion: 1,
    transmission: [1, 1, 1],
  }

  readonly #outputsPointer: number

  #overrides: DirectOverrides | null = null
  readonly #position = new Vector3()
  #reflectionOutputs: [number, number, number] = [0, 0, 0]

  #settings: NormalizedSourceSettings

  readonly #world: WorldImpl

  constructor(world: WorldImpl, id: number, settings?: SourceSettings) {
    this.#world = world
    this.id = id
    this.#settings = normalizeSettings(settings, world.maxOcclusionSamples)
    this.#native = createHandle(world.module, 'iplSourceCreate', out =>
      world.module._sa_source_create(
        world.simulator,
        SIMULATION_DIRECT
        | (world.mainThreadReflections ? SIMULATION_REFLECTIONS : 0),
        out,
      ))
    this.#outputsPointer = world.module._malloc(12 * 4)
    this.#syncInputs()
    world.reflectionWorker?.addSource(this.#reflectionWorkerInput())
  }

  assertActive(operation: string): void {
    if (this.#disposed)
      throw new SteamAudioError(operation, `Source ${this.id} has been disposed`)
    this.#world.assertActive(operation)
  }

  dispose(): void {
    if (this.#disposed)
      return
    for (const node of [...this.nodes])
      node.dispose()
    this.#disposed = true
    this.#world.module._sa_source_release(this.#native, this.#world.simulator)
    this.#world.reflectionWorker?.removeSource(this.id)
    this.#world.module._free(this.#outputsPointer)
    this.#world.removeSource(this)
  }

  getDirectOutputs(target?: DirectOutputs): DirectOutputs {
    this.assertActive('Source.getDirectOutputs')
    const output = target ?? {
      airAbsorption: [1, 1, 1],
      directivity: 1,
      distanceAttenuation: 1,
      occlusion: 1,
      transmission: [1, 1, 1],
    }
    output.distanceAttenuation = this.#outputs.distanceAttenuation
    output.directivity = this.#outputs.directivity
    output.occlusion = this.#outputs.occlusion
    output.airAbsorption.splice(0, 3, ...this.#outputs.airAbsorption)
    output.transmission.splice(0, 3, ...this.#outputs.transmission)
    return output
  }

  publishControl(): void {
    const direct = this.#settings.direct
    const overrides = this.#overrides
    const result = this.#outputs
    const direction = this.#position.clone().sub(this.#world.listenerImpl.position)
    if (direction.lengthSq() < 1e-12)
      direction.set(0, 0, -1)
    else
      direction.normalize()
    direction.applyQuaternion(
      this.#world.listenerImpl.orientation.clone().invert(),
    )
    for (const node of this.nodes) {
      node.setControl({
        airAbsorption: overrides?.airAbsorption ?? result.airAbsorption,
        direction: [direction.x, direction.y, direction.z],
        directivity: overrides?.directivity ?? result.directivity,
        directMixLevel: direct.mixLevel,
        distanceAttenuation: overrides?.distanceAttenuation ?? result.distanceAttenuation,
        effectFlags: directEffectFlags(this.#settings, overrides),
        hrtfInterpolation: hrtfInterpolationCode(this.#settings.spatialization),
        occlusion: overrides?.occlusion ?? result.occlusion,
        reflectionReverbTimes: this.#reflectionOutputs,
        reflectionsMixLevel: this.#settings.reflections.enabled
          ? this.#settings.reflections.mixLevel
          : 0,
        reverbReverbTimes: this.#world.listenerReverbTimes,
        reverbWet: this.#world.listenerReverbEnabled ? 1 : 0,
        spatializationBlend: spatializationBlend(this.#settings.spatialization),
        spatializationMode: spatializationModeCode(this.#settings.spatialization),
        transmission: overrides?.transmission ?? result.transmission,
        transmissionType: overrides?.transmission !== undefined
          || (direct.transmission !== false
            && direct.transmission.type === 'frequency-dependent')
          ? 1
          : 0,
      })
    }
  }

  readOutputs(): void {
    const base = this.#outputsPointer
    assertNativeStatus('iplSourceGetOutputs', this.#world.module._sa_source_get_direct_outputs(
      this.#native,
      base,
      base + 4,
      base + 16,
      base + 20,
      base + 24,
    ))
    const heap = this.#world.module.HEAPF32
    const offset = base >>> 2
    this.#outputs = {
      airAbsorption: [heap[offset + 1], heap[offset + 2], heap[offset + 3]],
      directivity: heap[offset + 4],
      distanceAttenuation: heap[offset],
      occlusion: heap[offset + 5],
      transmission: [heap[offset + 6], heap[offset + 7], heap[offset + 8]],
    }
    this.publishControl()
  }

  readReflectionOutputs(): readonly [number, number, number] {
    assertNativeStatus(
      'iplSourceGetReflectionOutputs',
      this.#world.module._sa_source_get_reflection_outputs(
        this.#native,
        this.#outputsPointer + 36,
      ),
    )
    const heap = this.#world.module.HEAPF32
    const offset = (this.#outputsPointer + 36) >>> 2
    this.#reflectionOutputs = [
      heap[offset],
      heap[offset + 1],
      heap[offset + 2],
    ]
    this.publishControl()
    return this.#reflectionOutputs
  }

  setDirectOverrides(overrides: DirectOverrides | null): void {
    this.assertActive('Source.setDirectOverrides')
    if (overrides) {
      if (overrides.distanceAttenuation !== undefined)
        clampUnit('overrides.distanceAttenuation', overrides.distanceAttenuation)
      if (overrides.directivity !== undefined)
        clampUnit('overrides.directivity', overrides.directivity)
      if (overrides.occlusion !== undefined)
        clampUnit('overrides.occlusion', overrides.occlusion)
      if (overrides.airAbsorption)
        unitThreeBand('overrides.airAbsorption', overrides.airAbsorption)
      if (overrides.transmission)
        unitThreeBand('overrides.transmission', overrides.transmission)
    }
    this.#overrides = overrides
    this.publishControl()
  }

  setOrientation(orientation: QuaternionLike): void {
    this.setTransform(this.#position, orientation)
  }

  setPosition(position: Vector3Like): void {
    this.setTransform(position, this.#orientation)
  }

  setReflectionOutputs(outputs: readonly [number, number, number]): void {
    this.#reflectionOutputs = [...outputs]
    this.publishControl()
  }

  setSettings(settings: Partial<SourceSettings>): void {
    this.assertActive('Source.setSettings')
    const current: SourceSettings = {
      direct: this.#settings.direct,
      reflections: this.#settings.reflections.enabled
        ? {
            mixLevel: this.#settings.reflections.mixLevel,
            reverbScale: this.#settings.reflections.reverbScale,
          }
        : false,
      spatialization: this.#settings.spatialization,
    }
    const nextDirect = settings.direct === false
      ? false
      : typeof settings.direct === 'object'
        ? {
            ...this.#settings.direct,
            ...settings.direct,
          }
        : current.direct
    const nextReflections = settings.reflections === false
      ? false
      : typeof settings.reflections === 'object'
        ? {
            ...(current.reflections === false ? {} : current.reflections),
            ...settings.reflections,
          }
        : current.reflections
    const nextSpatialization = settings.spatialization
      ? {
          ...this.#settings.spatialization,
          ...settings.spatialization,
        } as SpatializationSettings
      : current.spatialization
    const nextSettings = normalizeSettings({
      ...current,
      ...settings,
      direct: nextDirect,
      reflections: nextReflections,
      spatialization: nextSpatialization,
    }, this.#world.maxOcclusionSamples)
    if (nextSettings.reflections.enabled && !this.#world.reflectionSettings.enabled)
      throw new Error('Source reflections require World reflections to be enabled')
    this.#settings = nextSettings
    this.#syncInputs()
    this.#world.reflectionWorker?.updateSource(this.#reflectionWorkerInput())
    this.publishControl()
  }

  setTransform(position: Vector3Like, orientation: QuaternionLike): void {
    this.assertActive('Source.setTransform')
    this.#position.set(position.x, position.y, position.z)
    this.#orientation.copy(normalizeQuaternion(orientation))
    this.#syncInputs()
    this.#world.reflectionWorker?.updateSource(this.#reflectionWorkerInput())
    this.publishControl()
  }

  #reflectionWorkerInput() {
    const [sourceAhead, sourceUp] = directionsFromQuaternion(this.#orientation)
    return {
      ahead: [sourceAhead.x, sourceAhead.y, sourceAhead.z] as const,
      enabled: this.#settings.reflections.enabled,
      id: this.id,
      position: [this.#position.x, this.#position.y, this.#position.z] as const,
      reverbScale: this.#settings.reflections.reverbScale,
      up: [sourceUp.x, sourceUp.y, sourceUp.z] as const,
    }
  }

  #syncInputs(): void {
    const settings = this.#settings
    const direct = settings.direct
    const distance = distanceModel(direct.distanceAttenuation)
    const air = airModel(direct.airAbsorption)
    const [sourceAhead, sourceUp] = directionsFromQuaternion(this.#orientation)
    let flags = 0
    if (direct.distanceAttenuation !== false)
      flags |= DIRECT_DISTANCE
    if (direct.airAbsorption !== false)
      flags |= DIRECT_AIR
    if (direct.directivity !== false && direct.directivity.dipoleWeight > 0)
      flags |= DIRECT_DIRECTIVITY
    if (direct.occlusion !== false)
      flags |= DIRECT_OCCLUSION
    if (direct.transmission !== false)
      flags |= DIRECT_TRANSMISSION

    withOptionalFloatArray(this.#world.module, distance.curve, distancePointer =>
      withOptionalFloatArray(this.#world.module, air.coefficients, coefficientPointer =>
        withOptionalFloatArray(this.#world.module, air.curves, airPointer =>
          withFloatArray(this.#world.module, settings.reflections.reverbScale, reverbScalePointer =>
            this.#world.module._sa_source_set_inputs(
              this.#native,
              this.#position.x,
              this.#position.y,
              this.#position.z,
              sourceAhead.x,
              sourceAhead.y,
              sourceAhead.z,
              sourceUp.x,
              sourceUp.y,
              sourceUp.z,
              flags,
              distance.model,
              distance.minimum,
              distance.maximum,
              distance.curve?.length ?? 0,
              distancePointer,
              air.model,
              coefficientPointer,
              air.maximum,
              air.samples,
              airPointer,
              direct.directivity === false ? 0 : direct.directivity.dipoleWeight,
              direct.directivity === false ? 0 : direct.directivity.dipolePower,
              direct.occlusion !== false && direct.occlusion.type === 'volumetric' ? 1 : 0,
              direct.occlusion === false ? 1 : direct.occlusion.radius,
              direct.occlusion !== false && direct.occlusion.type === 'volumetric' ? direct.occlusion.samples : 1,
              direct.transmission === false ? 0 : direct.transmission.maxSurfaces,
              this.#world.mainThreadReflections
                ? settings.reflections.enabled ? 1 : 0
                : -1,
              reverbScalePointer,
            )))))
  }
}

export class WorldImpl {
  readonly audioContext: AudioContext
  readonly context: number
  readonly frameSize: number
  readonly hrtf: NormalizedHRTFSettings
  readonly listener: Listener
  readonly listenerImpl: ListenerImpl
  listenerReverbEnabled = false
  listenerReverbTimes: [number, number, number] = [0, 0, 0]
  readonly mainThreadReflections: boolean
  readonly maxOcclusionSamples: number
  readonly maxSources: number
  readonly module: NativeModule
  readonly reflectionSettings: NormalizedReflectionSimulationSettings
  readonly reflectionWorker?: ReflectionSimulationWorker
  readonly scene: AcousticSceneImpl
  readonly sceneHandle: number
  readonly simulator: number
  #accumulator = 0
  #disposed = false
  #listenerReverbSource?: SourceImpl
  #nextSourceId = 1
  #reflectionAccumulator = 0
  readonly #reflectionBuses = new Set<ReflectionBusNode>()
  readonly #reflectionInterval: number
  readonly #reverbBuses = new Set<ReverbBusNode>()
  readonly #simulationInterval: number
  readonly #sources = new Set<SourceImpl>()
  readonly #wasmBinary: ArrayBuffer

  constructor(runtime: PreparedRuntime, options: WorldOptions) {
    this.audioContext = options.audioContext
    this.module = runtime.module
    this.#wasmBinary = runtime.wasmBinary
    this.frameSize = integer('frameSize', options.frameSize ?? DEFAULT_FRAME_SIZE)
    this.hrtf = normalizeHRTFSettings(options.hrtf)
    this.maxSources = integer('maxSources', options.maxSources ?? DEFAULT_MAX_SOURCES)
    this.maxOcclusionSamples = integer(
      'direct.maxOcclusionSamples',
      options.direct?.maxOcclusionSamples
      ?? QUALITY_MAX_OCCLUSION_SAMPLES[options.occlusionQuality ?? 'medium'],
    )
    const reflectionOptions = options.reflections === false
      ? undefined
      : options.reflections
    this.#simulationInterval = 1 / positive(
      'direct.updateRate',
      options.direct?.updateRate ?? DEFAULT_SIMULATION_RATE,
    )
    this.#reflectionInterval = 1 / positive(
      'reflections.updateRate',
      reflectionOptions?.updateRate ?? DEFAULT_REFLECTION_RATE,
    )
    const maxRays = integer(
      'reflections.maxRays',
      reflectionOptions?.maxRays ?? 4096,
    )
    const maxDuration = positive(
      'reflections.maxDuration',
      reflectionOptions?.maxDuration ?? 1,
    )
    const maxOrder = integer(
      'reflections.maxOrder',
      reflectionOptions?.maxOrder ?? 1,
      0,
    )
    const diffuseSamples = integer(
      'reflections.diffuseSamples',
      reflectionOptions?.diffuseSamples ?? 32,
    )
    this.reflectionSettings = {
      bounces: integer('reflections.initial.bounces', reflectionOptions?.initial?.bounces ?? 4),
      diffuseSamples,
      duration: positive('reflections.initial.duration', reflectionOptions?.initial?.duration ?? maxDuration),
      enabled: reflectionOptions !== undefined,
      irradianceMinDistance: positive(
        'reflections.initial.irradianceMinDistance',
        reflectionOptions?.initial?.irradianceMinDistance ?? 1,
      ),
      maxDuration,
      maxOrder,
      maxRays,
      order: integer('reflections.initial.ambisonicOrder', reflectionOptions?.initial?.ambisonicOrder ?? maxOrder, 0),
      rays: integer('reflections.initial.rays', reflectionOptions?.initial?.rays ?? maxRays),
    }
    if (this.reflectionSettings.duration > maxDuration)
      throw new RangeError(`reflections.initial.duration cannot exceed reflections.maxDuration (${maxDuration})`)
    if (this.reflectionSettings.order > maxOrder)
      throw new RangeError(`reflections.initial.ambisonicOrder cannot exceed reflections.maxOrder (${maxOrder})`)
    if (this.reflectionSettings.rays > maxRays)
      throw new RangeError(`reflections.initial.rays cannot exceed reflections.maxRays (${maxRays})`)
    const useReflectionWorker = this.reflectionSettings.enabled
      && canUseReflectionWorker()
    this.mainThreadReflections = this.reflectionSettings.enabled
      && !useReflectionWorker

    const reflectionMaxSources = integer(
      'reflections.maxSources',
      reflectionOptions?.maxSources ?? this.maxSources,
    )
    this.context = createHandle(this.module, 'iplContextCreate', out =>
      this.module._sa_context_create(out))
    try {
      this.sceneHandle = createHandle(this.module, 'iplSceneCreate', out =>
        this.module._sa_scene_create(this.context, out))
      try {
        this.simulator = createHandle(this.module, 'iplSimulatorCreate', out =>
          this.module._sa_simulator_create(
            this.context,
            this.sceneHandle,
            this.audioContext.sampleRate,
            this.frameSize,
            reflectionMaxSources + 1,
            this.maxOcclusionSamples,
            this.mainThreadReflections ? 1 : 0,
            maxRays,
            diffuseSamples,
            maxDuration,
            maxOrder,
            1,
            out,
          ))
      }
      catch (error) {
        this.module._sa_scene_release(this.sceneHandle)
        throw error
      }
    }
    catch (error) {
      this.module._sa_context_release(this.context)
      throw error
    }
    if (useReflectionWorker) {
      this.reflectionWorker = new ReflectionSimulationWorker(
        this.#wasmBinary,
        this.audioContext.sampleRate,
        this.frameSize,
        reflectionMaxSources + 1,
        this.reflectionSettings,
        outputs => this.#receiveReflectionOutputs(outputs),
      )
    }
    this.scene = new AcousticSceneImpl(this)
    this.listenerImpl = new ListenerImpl(this)
    this.listener = this.listenerImpl
    this.listener.setTransform({ x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 })
  }

  assertActive(operation: string): void {
    if (this.#disposed)
      throw new SteamAudioError(operation, 'World has been disposed')
  }

  createNode(sourceValue: Source): SteamAudioNode {
    this.assertActive('World.createNode')
    if (!(sourceValue instanceof SourceImpl) || !this.#sources.has(sourceValue))
      throw new TypeError('World.createNode requires a Source created by this World')
    sourceValue.assertActive('World.createNode')
    const node = new SteamAudioNode(this.audioContext, {
      frameSize: this.frameSize,
      hrtf: this.hrtf,
      onDispose: disposedNode => sourceValue.nodes.delete(disposedNode),
      source: sourceValue,
      wasmBinary: this.#wasmBinary,
    })
    sourceValue.nodes.add(node)
    sourceValue.publishControl()
    return node
  }

  createReflectionBus(settings?: ReflectionBusSettings): ReflectionBusNode {
    this.assertActive('World.createReflectionBus')
    if (!this.reflectionSettings.enabled)
      throw new Error('Reflections are disabled for this World')
    const bus = new ReflectionBusNode(
      this.audioContext,
      settings,
      disposed => this.#reflectionBuses.delete(disposed),
    )
    this.#reflectionBuses.add(bus)
    return bus
  }

  createReverbBus(settings?: ReverbBusSettings): ReverbBusNode {
    this.assertActive('World.createReverbBus')
    if (!this.reflectionSettings.enabled)
      throw new Error('Reflections are disabled for this World')
    const bus = new ReverbBusNode(
      this.audioContext,
      settings,
      disposed => this.#reverbBuses.delete(disposed),
    )
    this.#reverbBuses.add(bus)
    return bus
  }

  createSource(settings?: SourceSettings): Source {
    this.assertActive('World.createSource')
    if (this.#sources.size >= this.maxSources)
      throw new SteamAudioError('World.createSource', `maxSources (${this.maxSources}) exceeded`)
    const source = new SourceImpl(this, this.#nextSourceId++, settings)
    if (source.settings.reflections.enabled && !this.reflectionSettings.enabled) {
      source.dispose()
      throw new Error('Source reflections require World reflections to be enabled')
    }
    this.#sources.add(source)
    return source
  }

  dispose(): void {
    if (this.#disposed)
      return
    for (const source of [...this.#sources])
      source.dispose()
    this.#listenerReverbSource?.dispose()
    for (const bus of [...this.#reflectionBuses])
      bus.dispose()
    for (const bus of [...this.#reverbBuses])
      bus.dispose()
    this.scene.dispose()
    this.reflectionWorker?.dispose()
    this.#disposed = true
    this.module._sa_simulator_release(this.simulator)
    this.module._sa_scene_release(this.sceneHandle)
    this.module._sa_context_release(this.context)
  }

  publishSourceControls(): void {
    for (const source of this.#sources)
      source.publishControl()
  }

  removeSource(source: SourceImpl): void {
    this.#sources.delete(source)
  }

  setListenerReverb(settings: false | ReverbSettings): void {
    this.assertActive('Listener.setReverb')
    if (settings !== false && !this.reflectionSettings.enabled)
      throw new Error('Reflections are disabled for this World')
    this.listenerReverbEnabled = settings !== false
    if (this.listenerReverbEnabled && !this.#listenerReverbSource) {
      this.#listenerReverbSource = new SourceImpl(this, 0, {
        direct: false,
        reflections: {
          reverbScale: settings === false
            ? [1, 1, 1]
            : settings.reverbScale,
        },
      })
    }
    else if (this.#listenerReverbSource && settings !== false) {
      this.#listenerReverbSource.setSettings({
        reflections: {
          reverbScale: settings.reverbScale,
        },
      })
    }
    else if (this.#listenerReverbSource) {
      this.#listenerReverbSource.setSettings({ reflections: false })
    }
    this.syncListenerReverbSource()
    for (const source of this.#sources)
      source.publishControl()
  }

  setReflectionSettings(settings: ReflectionSimulationSettings): void {
    this.assertActive('World.setReflectionSettings')
    if (settings.rays !== undefined) {
      const rays = integer('rays', settings.rays)
      if (rays > this.reflectionSettings.maxRays)
        throw new RangeError(`rays cannot exceed World maxRays (${this.reflectionSettings.maxRays})`)
      this.reflectionSettings.rays = rays
    }
    if (settings.bounces !== undefined)
      this.reflectionSettings.bounces = integer('bounces', settings.bounces)
    if (settings.duration !== undefined) {
      const duration = positive('duration', settings.duration)
      if (duration > this.reflectionSettings.maxDuration)
        throw new RangeError(`duration cannot exceed World maxDuration (${this.reflectionSettings.maxDuration})`)
      this.reflectionSettings.duration = duration
    }
    if (settings.ambisonicOrder !== undefined) {
      const order = integer('ambisonicOrder', settings.ambisonicOrder, 0)
      if (order > this.reflectionSettings.maxOrder)
        throw new RangeError(`ambisonicOrder cannot exceed World maxOrder (${this.reflectionSettings.maxOrder})`)
      this.reflectionSettings.order = order
    }
    if (settings.irradianceMinDistance !== undefined) {
      this.reflectionSettings.irradianceMinDistance = positive(
        'irradianceMinDistance',
        settings.irradianceMinDistance,
      )
    }
    this.listenerImpl.setTransform(
      this.listenerImpl.position,
      this.listenerImpl.orientation,
    )
  }

  step(delta: number): void {
    this.assertActive('World.step')
    if (!Number.isFinite(delta) || delta < 0)
      throw new RangeError('World.step delta must be a finite number >= 0')
    if (this.audioContext.state !== 'running')
      return
    this.#runDirectSimulation(delta)
    this.#runReflectionSimulation(delta)
  }

  syncListenerReverbSource(): void {
    this.#listenerReverbSource?.setTransform(
      this.listenerImpl.position,
      this.listenerImpl.orientation,
    )
  }

  #receiveReflectionOutputs(
    outputs: Array<{
      id: number
      reverbTimes: [number, number, number]
    }>,
  ): void {
    for (const output of outputs) {
      if (output.id === 0) {
        this.listenerReverbTimes = output.reverbTimes
        continue
      }
      const source = [...this.#sources].find(value => value.id === output.id)
      source?.setReflectionOutputs(output.reverbTimes)
    }
    for (const source of this.#sources)
      source.publishControl()
  }

  #runDirectSimulation(delta: number): void {
    this.#accumulator += delta
    while (this.#accumulator >= this.#simulationInterval) {
      this.#accumulator -= this.#simulationInterval
      assertNativeStatus('iplSimulatorRunDirect', this.module._sa_simulator_run_direct(this.simulator))
      for (const source of this.#sources)
        source.readOutputs()
    }
  }

  #runReflectionSimulation(delta: number): void {
    if (!this.reflectionSettings.enabled)
      return
    this.#reflectionAccumulator += delta
    while (this.#reflectionAccumulator >= this.#reflectionInterval) {
      this.#reflectionAccumulator -= this.#reflectionInterval
      const hasSourceReflections = [...this.#sources]
        .some(source => source.settings.reflections.enabled)
      if (!hasSourceReflections && !this.listenerReverbEnabled)
        continue
      if (this.reflectionWorker) {
        this.reflectionWorker.run()
        continue
      }
      this.#runReflectionsNow()
    }
  }

  #runReflectionsNow(): void {
    assertNativeStatus(
      'iplSimulatorRunReflections',
      this.module._sa_simulator_run_reflections(this.simulator),
    )
    for (const source of this.#sources) {
      if (source.settings.reflections.enabled)
        source.readReflectionOutputs()
    }
    if (!this.#listenerReverbSource)
      return
    this.listenerReverbTimes = [
      ...this.#listenerReverbSource.readReflectionOutputs(),
    ]
    for (const source of this.#sources)
      source.publishControl()
  }
}

export const createWorldFromRuntime = (
  runtime: PreparedRuntime,
  options: WorldOptions,
): World => new WorldImpl(runtime, options)

export const createWorld = async (options: WorldOptions): Promise<World> => {
  const runtime = await prepareWorldRuntime(options)
  return createWorldFromRuntime(runtime, options)
}
