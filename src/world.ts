import type { Matrix4 } from 'three'

import type { NativeModule } from './native'
import type { PreparedRuntime } from './runtime'
import type {
  AcousticMeshHandle,
  AcousticScene,
  AirAbsorptionSettings,
  DirectOutputs,
  DirectOverrides,
  DirectSimulationSettings,
  DistanceAttenuationSettings,
  DynamicAcousticMeshHandle,
  DynamicMeshInput,
  Listener,
  QuaternionLike,
  Source,
  SourceSettings,
  StaticMeshInput,
  Vector3Like,
  WorldOptions,
} from './types'

import { Quaternion, Matrix4 as ThreeMatrix4, Vector3 } from 'three'

import { SteamAudioNode } from './audio-node'
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
import { prepareWorldRuntime } from './runtime'

const DIRECT_DISTANCE = 1 << 0
const DIRECT_AIR = 1 << 1
const DIRECT_DIRECTIVITY = 1 << 2
const DIRECT_OCCLUSION = 1 << 3
const DIRECT_TRANSMISSION = 1 << 4

const DEFAULT_FRAME_SIZE = 1024
const DEFAULT_MAX_SOURCES = 32
const DEFAULT_SIMULATION_RATE = 60
const DEFAULT_MAX_OCCLUSION_SAMPLES = 128
const QUALITY_MAX_OCCLUSION_SAMPLES = {
  high: 256,
  low: 32,
  medium: DEFAULT_MAX_OCCLUSION_SAMPLES,
} as const

const ahead = new Vector3()
const up = new Vector3()
const orientationScratch = new Quaternion()

interface NativeMesh {
  dispose: () => void
}

interface NormalizedSourceSettings {
  directivity: {
    dipolePower: number
    dipoleWeight: number
  }
  directSimulation: DirectSimulationSettings
  distanceAttenuation: DistanceAttenuationSettings | false
  hrtf: boolean
  spatialBlend: number
}

const clampUnit = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError(`${name} must be a finite number in [0, 1]`)
  return value
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

const normalizeSettings = (
  settings: SourceSettings = {},
  maximumOcclusionSamples = DEFAULT_MAX_OCCLUSION_SAMPLES,
): NormalizedSourceSettings => {
  const simulation = settings.directSimulation === false
    ? {}
    : settings.directSimulation === true || settings.directSimulation === undefined
      ? {}
      : settings.directSimulation
  const directivity = settings.directivity ?? {}
  const normalized: NormalizedSourceSettings = {
    directivity: {
      dipolePower: directivity.dipolePower ?? 0,
      dipoleWeight: clampUnit('directivity.dipoleWeight', directivity.dipoleWeight ?? 0),
    },
    directSimulation: settings.directSimulation === false
      ? {
          airAbsorption: false,
          occlusion: false,
          transmission: false,
        }
      : {
          airAbsorption: simulation.airAbsorption ?? false,
          airAbsorptionModel: simulation.airAbsorptionModel,
          occlusion: simulation.occlusion ?? false,
          occlusionRadius: simulation.occlusionRadius ?? 1,
          occlusionSamples: simulation.occlusionSamples ?? 16,
          transmission: simulation.transmission ?? false,
        },
    distanceAttenuation: settings.distanceAttenuation === undefined
      ? { model: 'default' }
      : settings.distanceAttenuation,
    hrtf: settings.hrtf ?? true,
    spatialBlend: clampUnit('spatialBlend', settings.spatialBlend ?? 1),
  }

  if (!Number.isFinite(normalized.directivity.dipolePower) || normalized.directivity.dipolePower < 0)
    throw new RangeError('directivity.dipolePower must be a finite number >= 0')
  const transmissionEnabled = normalized.directSimulation.transmission !== false
    && normalized.directSimulation.transmission !== undefined
  const occlusionEnabled = normalized.directSimulation.occlusion !== false
    && normalized.directSimulation.occlusion !== undefined
  if (transmissionEnabled && !occlusionEnabled)
    throw new Error('Transmission requires occlusion to be enabled')
  if (normalized.directSimulation.occlusion === 'volumetric') {
    positive('directSimulation.occlusionRadius', normalized.directSimulation.occlusionRadius!)
    const samples = integer('directSimulation.occlusionSamples', normalized.directSimulation.occlusionSamples!)
    if (samples > maximumOcclusionSamples)
      throw new RangeError(`directSimulation.occlusionSamples cannot exceed World maxOcclusionSamples (${maximumOcclusionSamples})`)
  }
  return normalized
}

const sampleCurve = (
  callback: (distance: number) => number,
  maximum: number,
  count: number,
  name: string,
  minimum = 0,
): Float32Array => {
  positive(`${name}.maxDistance`, maximum)
  integer(`${name}.samples`, count, 2)
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
        settings.samples ?? 256,
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

const airModel = (settings: AirAbsorptionSettings | undefined) => {
  if (!settings || !settings.model || settings.model === 'default')
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
  const count = settings.samples ?? 256
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

export type World = Pick<
  WorldImpl,
  | 'audioContext'
  | 'createNode'
  | 'createSource'
  | 'dispose'
  | 'listener'
  | 'scene'
  | 'setSimulationSettings'
  | 'step'
>

class AcousticSceneImpl implements AcousticScene {
  #dirty = false
  readonly #handles = new Set<NativeMesh>()
  readonly #pendingReleases: Array<() => void> = []
  readonly #world: WorldImpl

  constructor(world: WorldImpl) {
    this.#world = world
  }

  addDynamicMesh(input: DynamicMeshInput): DynamicAcousticMeshHandle {
    this.#world.assertActive('AcousticScene.addDynamicMesh')
    const transform = splitDynamicTransform(input.matrixWorld)
    let currentRigidMatrix = transform.rigidMatrix.clone()
    const subScene = createHandle(this.#world.module, 'iplSceneCreate', out =>
      this.#world.module._sa_scene_create(this.#world.context, out))
    let staticMesh = 0
    let instance = 0
    try {
      staticMesh = this.#createStaticMesh(subScene, input, transform.bakedMatrix)
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
        this.#dirty = true
      },
    }
    this.#handles.add(handle)
    return handle
  }

  addStaticMesh(input: StaticMeshInput): AcousticMeshHandle {
    this.#world.assertActive('AcousticScene.addStaticMesh')
    const mesh = this.#createStaticMesh(this.#world.sceneHandle, input, input.matrixWorld)
    this.#world.module._sa_static_mesh_add(mesh, this.#world.sceneHandle)
    this.#dirty = true
    let disposed = false
    const handle: NativeMesh = {
      dispose: () => {
        if (disposed)
          return
        disposed = true
        this.#world.module._sa_static_mesh_remove(mesh, this.#world.sceneHandle)
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
  ): number {
    const converted = convertGeometry(input.geometry, input.material, matrixWorld)
    const materialCount = Array.isArray(input.material) ? input.material.length : 1
    return createHandle(this.#world.module, 'iplStaticMeshCreate', out =>
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
    )
  }
}

class SourceImpl implements Source {
  readonly id: number
  readonly nodes = new Set<SteamAudioNode>()
  get native(): number {
    return this.#native
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

  #settings: NormalizedSourceSettings

  readonly #world: WorldImpl

  constructor(world: WorldImpl, id: number, settings?: SourceSettings) {
    this.#world = world
    this.id = id
    this.#settings = normalizeSettings(settings, world.maxOcclusionSamples)
    this.#native = createHandle(world.module, 'iplSourceCreate', out =>
      world.module._sa_source_create(world.simulator, out))
    this.#outputsPointer = world.module._malloc(9 * 4)
    this.#syncInputs()
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
    const direct = this.#settings.directSimulation
    const overrides = this.#overrides
    let effectFlags = 0
    const occlusionSimulated = direct.occlusion !== false && direct.occlusion !== undefined
    const transmissionSimulated = direct.transmission !== false && direct.transmission !== undefined
    if (this.#settings.distanceAttenuation !== false || overrides?.distanceAttenuation !== undefined)
      effectFlags |= DIRECT_DISTANCE
    if (direct.airAbsorption === true || overrides?.airAbsorption !== undefined)
      effectFlags |= DIRECT_AIR
    if (this.#settings.directivity.dipoleWeight > 0 || overrides?.directivity !== undefined)
      effectFlags |= DIRECT_DIRECTIVITY
    if (occlusionSimulated || overrides?.occlusion !== undefined)
      effectFlags |= DIRECT_OCCLUSION
    if (transmissionSimulated || overrides?.transmission !== undefined)
      effectFlags |= DIRECT_TRANSMISSION

    const result = this.#outputs
    const direction = this.#position.clone().sub(this.#world.listenerImpl.position)
    if (direction.lengthSq() < 1e-12)
      direction.set(0, 0, -1)
    else
      direction.normalize()
    for (const node of this.nodes) {
      node.setControl({
        airAbsorption: overrides?.airAbsorption ?? result.airAbsorption,
        direction: [direction.x, direction.y, direction.z],
        directivity: overrides?.directivity ?? result.directivity,
        distanceAttenuation: overrides?.distanceAttenuation ?? result.distanceAttenuation,
        effectFlags,
        hrtf: this.#settings.hrtf,
        occlusion: overrides?.occlusion ?? result.occlusion,
        spatialBlend: this.#settings.spatialBlend,
        transmission: overrides?.transmission ?? result.transmission,
        transmissionType: direct.transmission !== false
          && direct.transmission !== undefined
          && direct.transmission.type === 'frequency-dependent'
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

  setDirectOverrides(overrides: DirectOverrides | null): void {
    this.assertActive('Source.setDirectOverrides')
    if (overrides) {
      if (overrides.distanceAttenuation !== undefined)
        clampUnit('overrides.distanceAttenuation', overrides.distanceAttenuation)
      if (overrides.directivity !== undefined)
        clampUnit('overrides.directivity', overrides.directivity)
      if (overrides.occlusion !== undefined)
        clampUnit('overrides.occlusion', overrides.occlusion)
      overrides.airAbsorption?.forEach((value, band) => clampUnit(`overrides.airAbsorption[${band}]`, value))
      overrides.transmission?.forEach((value, band) => clampUnit(`overrides.transmission[${band}]`, value))
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

  setSettings(settings: Partial<SourceSettings>): void {
    this.assertActive('Source.setSettings')
    const current: SourceSettings = {
      directivity: this.#settings.directivity,
      directSimulation: this.#settings.directSimulation,
      distanceAttenuation: this.#settings.distanceAttenuation,
      hrtf: this.#settings.hrtf,
      spatialBlend: this.#settings.spatialBlend,
    }
    const nextDirectSimulation = typeof settings.directSimulation === 'object'
      ? {
          ...this.#settings.directSimulation,
          ...settings.directSimulation,
        }
      : settings.directSimulation ?? current.directSimulation
    this.#settings = normalizeSettings({
      ...current,
      ...settings,
      directivity: settings.directivity
        ? { ...this.#settings.directivity, ...settings.directivity }
        : current.directivity,
      directSimulation: nextDirectSimulation,
    }, this.#world.maxOcclusionSamples)
    this.#syncInputs()
    this.publishControl()
  }

  setTransform(position: Vector3Like, orientation: QuaternionLike): void {
    this.assertActive('Source.setTransform')
    this.#position.set(position.x, position.y, position.z)
    this.#orientation.copy(normalizeQuaternion(orientation))
    this.#syncInputs()
  }

  #syncInputs(): void {
    const settings = this.#settings
    const direct = settings.directSimulation
    const distance = distanceModel(settings.distanceAttenuation)
    const air = airModel(direct.airAbsorptionModel)
    const [sourceAhead, sourceUp] = directionsFromQuaternion(this.#orientation)
    let flags = 0
    if (settings.distanceAttenuation !== false)
      flags |= DIRECT_DISTANCE
    if (direct.airAbsorption === true)
      flags |= DIRECT_AIR
    if (settings.directivity.dipoleWeight > 0)
      flags |= DIRECT_DIRECTIVITY
    if (direct.occlusion !== false && direct.occlusion !== undefined)
      flags |= DIRECT_OCCLUSION
    if (direct.transmission !== false && direct.transmission !== undefined)
      flags |= DIRECT_TRANSMISSION

    withOptionalFloatArray(this.#world.module, distance.curve, distancePointer =>
      withOptionalFloatArray(this.#world.module, air.coefficients, coefficientPointer =>
        withOptionalFloatArray(this.#world.module, air.curves, airPointer =>
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
            settings.directivity.dipoleWeight,
            settings.directivity.dipolePower,
            direct.occlusion === 'volumetric' ? 1 : 0,
            direct.occlusionRadius ?? 1,
            direct.occlusion === 'volumetric' ? direct.occlusionSamples ?? 16 : 1,
            direct.transmission !== false && direct.transmission !== undefined ? 1 : 0,
          ))))
  }
}

export class WorldImpl {
  readonly audioContext: AudioContext
  readonly context: number
  readonly frameSize: number
  readonly listener: Listener
  readonly listenerImpl: ListenerImpl
  readonly maxOcclusionSamples: number
  readonly maxSources: number
  readonly module: NativeModule
  readonly scene: AcousticSceneImpl
  readonly sceneHandle: number
  readonly simulator: number
  #accumulator = 0
  #disposed = false
  #nextSourceId = 1
  readonly #simulationInterval: number
  readonly #sources = new Set<SourceImpl>()
  readonly #wasmBinary: ArrayBuffer

  constructor(runtime: PreparedRuntime, options: WorldOptions) {
    this.audioContext = options.audioContext
    this.module = runtime.module
    this.#wasmBinary = runtime.wasmBinary
    this.frameSize = integer('frameSize', options.frameSize ?? DEFAULT_FRAME_SIZE)
    this.maxSources = integer('maxSources', options.maxSources ?? DEFAULT_MAX_SOURCES)
    this.maxOcclusionSamples = integer(
      'simulation.maxOcclusionSamples',
      options.simulation?.maxOcclusionSamples
      ?? QUALITY_MAX_OCCLUSION_SAMPLES[options.quality ?? 'medium'],
    )
    this.#simulationInterval = 1 / positive(
      'simulationRate',
      options.simulationRate ?? DEFAULT_SIMULATION_RATE,
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
            this.maxSources,
            this.maxOcclusionSamples,
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
      onDispose: disposedNode => sourceValue.nodes.delete(disposedNode),
      source: sourceValue,
      wasmBinary: this.#wasmBinary,
    })
    sourceValue.nodes.add(node)
    sourceValue.publishControl()
    return node
  }

  createSource(settings?: SourceSettings): Source {
    this.assertActive('World.createSource')
    if (this.#sources.size >= this.maxSources)
      throw new SteamAudioError('World.createSource', `maxSources (${this.maxSources}) exceeded`)
    const source = new SourceImpl(this, this.#nextSourceId++, settings)
    this.#sources.add(source)
    return source
  }

  dispose(): void {
    if (this.#disposed)
      return
    for (const source of [...this.#sources])
      source.dispose()
    this.scene.dispose()
    this.#disposed = true
    this.module._sa_simulator_release(this.simulator)
    this.module._sa_scene_release(this.sceneHandle)
    this.module._sa_context_release(this.context)
  }

  removeSource(source: SourceImpl): void {
    this.#sources.delete(source)
  }

  setSimulationSettings(): void {
    this.assertActive('World.setSimulationSettings')
    throw new Error('Runtime reflection simulation settings are not part of the MVP')
  }

  step(delta: number): void {
    this.assertActive('World.step')
    if (!Number.isFinite(delta) || delta < 0)
      throw new RangeError('World.step delta must be a finite number >= 0')
    if (this.audioContext.state !== 'running')
      return
    this.#accumulator += delta
    if (this.#accumulator < this.#simulationInterval)
      return
    this.#accumulator %= this.#simulationInterval
    assertNativeStatus('iplSimulatorRunDirect', this.module._sa_simulator_run_direct(this.simulator))
    for (const source of this.#sources)
      source.readOutputs()
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
