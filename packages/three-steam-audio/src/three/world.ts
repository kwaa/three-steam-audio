import type { Camera, Vector3 as ThreeVector3 } from 'three'

import type {
  AmbisonicSource,
  AmbisonicSourceSettings,
  PerspectiveCorrectionSettings,
  ReflectionBusSettings,
  ReflectionSimulationSettings,
  ReverbBusSettings,
  ReverbSettings,
  Source,
  SourceSettings,
  WorldOptions,
} from '../types'
import type { PreparedRuntime } from '../worker/runtime'
import type { NativeModule } from './native'
import type { NormalizedHRTFSettings, NormalizedPerspectiveCorrectionSettings, NormalizedReflectionSimulationSettings } from './settings'

import { Matrix4 as ThreeMatrix4, Vector3 } from 'three'

import {
  ReflectionBusNode,
  ReverbBusNode,
  SteamAudioAmbisonicNode,
  SteamAudioNode,
} from '../worker/audio-node'
import {
  canUseReflectionWorker,
  ReflectionSimulationWorker,
} from '../worker/reflection-simulation'
import { prepareWorldRuntime } from '../worker/runtime'
import { AmbisonicSourceImpl } from './ambisonic-source'
import { SteamAudioError } from './errors'
import { ListenerImpl } from './listener'
import { createHandle } from './native'
import { SceneImpl } from './scene'
import {
  DEFAULT_FRAME_SIZE,
  DEFAULT_MAX_SOURCES,
  DEFAULT_REFLECTION_RATE,
  DEFAULT_SIMULATION_RATE,
  integer,

  normalizeHRTFSettings,
  normalizePerspectiveCorrectionSettings,
  positive,
  QUALITY_MAX_OCCLUSION_SAMPLES,
} from './settings'
import { Simulator } from './simulator'
import { SourceImpl } from './source'

const perspectiveMatrix = new ThreeMatrix4()
const perspectiveDirection = new Vector3()

/** The public composition root for a Steam Audio simulation. */
export type World = Pick<
  WorldImpl,
  | 'audioContext'
  | 'createAmbisonicNode'
  | 'createAmbisonicSource'
  | 'createNode'
  | 'createReflectionBus'
  | 'createReverbBus'
  | 'createSource'
  | 'dispose'
  | 'listener'
  | 'scene'
  | 'setPerspectiveCorrection'
  | 'setReflectionSettings'
  | 'step'
>

export class WorldImpl {
  readonly ambisonicSources = new Set<AmbisonicSourceImpl>()
  readonly audioContext: AudioContext
  readonly context: number
  readonly frameSize: number
  readonly hrtf: NormalizedHRTFSettings
  readonly listener: ListenerImpl
  readonly listenerImpl: ListenerImpl
  listenerReverbEnabled = false
  listenerReverbTimes: [number, number, number] = [0, 0, 0]
  readonly mainThreadReflections: boolean
  readonly maxOcclusionSamples: number
  readonly maxSources: number
  readonly module: NativeModule
  readonly reflectionSettings: NormalizedReflectionSimulationSettings
  readonly reflectionWorker?: ReflectionSimulationWorker
  readonly scene: SceneImpl
  readonly sceneHandle: number
  readonly simulator: Simulator
  #accumulator = 0
  #disposed = false
  #listenerReverbSource?: SourceImpl
  #nextSourceId = 1
  #perspectiveCamera?: Camera
  #perspectiveCorrection: NormalizedPerspectiveCorrectionSettings
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
    this.#perspectiveCorrection = normalizePerspectiveCorrectionSettings(
      options.perspectiveCorrection,
    )
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
        const simulator = createHandle(this.module, 'iplSimulatorCreate', out =>
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
        this.simulator = new Simulator(this.module, simulator)
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
    this.scene = new SceneImpl(this)
    this.listenerImpl = new ListenerImpl(this)
    this.listener = this.listenerImpl
    this.listener.setTransform({ x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 })
  }

  assertActive(operation: string): void {
    if (this.#disposed)
      throw new SteamAudioError(operation, 'World has been disposed')
  }

  createAmbisonicNode(sourceValue: AmbisonicSource): SteamAudioAmbisonicNode {
    this.assertActive('World.createAmbisonicNode')
    if (!(sourceValue instanceof AmbisonicSourceImpl)
      || !this.ambisonicSources.has(sourceValue)) {
      throw new TypeError(
        'World.createAmbisonicNode requires an AmbisonicSource created by this World',
      )
    }
    sourceValue.assertActive('World.createAmbisonicNode')
    const node = new SteamAudioAmbisonicNode(this.audioContext, {
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

  createAmbisonicSource(settings?: AmbisonicSourceSettings): AmbisonicSource {
    this.assertActive('World.createAmbisonicSource')
    return new AmbisonicSourceImpl(this, settings)
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
    for (const source of [...this.ambisonicSources])
      source.dispose()
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
    this.simulator.release()
    this.module._sa_scene_release(this.sceneHandle)
    this.module._sa_context_release(this.context)
  }

  getPerspectiveCorrectedDirection(
    position: ThreeVector3,
    enabledForSource: boolean,
  ): ThreeVector3 | undefined {
    const camera = this.#perspectiveCamera
    if (!enabledForSource || !this.#perspectiveCorrection.enabled || !camera)
      return undefined
    const arrayCamera = camera as Camera & { cameras?: Camera[], isArrayCamera?: boolean }
    if (!this.#perspectiveCorrection.applyInXR && arrayCamera.isArrayCamera)
      return undefined
    const projectionCamera = arrayCamera.isArrayCamera
      ? arrayCamera.cameras?.[0]
      : camera
    if (!projectionCamera)
      return undefined
    const aspect = (projectionCamera as Camera & { aspect?: number }).aspect
    if (!Number.isFinite(aspect) || aspect === undefined || aspect <= 0)
      return undefined
    perspectiveMatrix.multiplyMatrices(
      projectionCamera.projectionMatrix,
      projectionCamera.matrixWorldInverse,
    )
    const elements = perspectiveMatrix.elements
    const { x, y, z } = position
    const projectedX = elements[0] * x + elements[4] * y + elements[8] * z + elements[12]
    const projectedY = elements[1] * x + elements[5] * y + elements[9] * z + elements[13]
    const projectedZ = elements[2] * x + elements[6] * y + elements[10] * z + elements[14]
    const projectedW = elements[3] * x + elements[7] * y + elements[11] * z + elements[15]
    if (!Number.isFinite(projectedW) || Math.abs(projectedW) <= 1e-6)
      return undefined
    return perspectiveDirection.set(
      0.5 * projectedX * this.#perspectiveCorrection.factor / Math.abs(projectedW),
      0.5 * projectedY * this.#perspectiveCorrection.factor / aspect / Math.abs(projectedW),
      -projectedZ / Math.abs(projectedW),
    )
  }

  publishSourceControls(): void {
    for (const source of this.#sources)
      source.publishControl()
    for (const source of this.ambisonicSources)
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

  setPerspectiveCorrection(settings: false | PerspectiveCorrectionSettings): void {
    this.assertActive('World.setPerspectiveCorrection')
    this.#perspectiveCorrection = normalizePerspectiveCorrectionSettings(
      settings === false ? { enabled: false } : settings,
    )
    this.publishSourceControls()
  }

  setPerspectiveCorrectionCamera(camera: Camera | null): void {
    this.assertActive('Listener.setCamera')
    this.#perspectiveCamera = camera ?? undefined
    this.publishSourceControls()
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
      this.simulator.runDirect()
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
    this.simulator.runReflections()
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
