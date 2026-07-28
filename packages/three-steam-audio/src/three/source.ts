import type {
  DirectOutputs,
  DirectOverrides,
  QuaternionLike,
  Source,
  SourceSettings,
  SpatializationSettings,
  Vector3Like,
} from '../types'
import type { SteamAudioNode } from '../worker/audio-node'
import type { NormalizedSourceSettings } from './settings'
import type { WorldImpl } from './world'

import { Quaternion, Vector3 } from 'three'

import { assertNativeStatus, SteamAudioError } from './errors'
import { createHandle, withFloatArray, withOptionalFloatArray } from './native'
import {
  airModel,
  clampUnit,
  DIRECT_AIR,
  DIRECT_DIRECTIVITY,
  DIRECT_DISTANCE,
  DIRECT_OCCLUSION,
  DIRECT_TRANSMISSION,
  directEffectFlags,
  directionsFromQuaternion,
  distanceModel,
  hrtfInterpolationCode,

  normalizeQuaternion,
  normalizeSettings,
  SIMULATION_DIRECT,
  SIMULATION_REFLECTIONS,
  spatializationBlend,
  spatializationModeCode,
  unitThreeBand,
} from './settings'

/** TypeScript's source object corresponding to the C API's IPLSource. */
export class SourceImpl implements Source {
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
        world.simulator.native,
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
    this.#world.module._sa_source_release(this.#native, this.#world.simulator.native)
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
    const correctedDirection = this.#world.getPerspectiveCorrectedDirection(
      this.#position,
      this.#settings.perspectiveCorrection,
    )
    const direction = correctedDirection
      ?? this.#position.clone().sub(this.#world.listenerImpl.position)
    if (direction.lengthSq() < 1e-12)
      direction.set(0, 0, -1)
    else
      direction.normalize()
    if (correctedDirection === undefined) {
      direction.applyQuaternion(
        this.#world.listenerImpl.orientation.clone().invert(),
      )
    }
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
      perspectiveCorrection: this.#settings.perspectiveCorrection,
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
