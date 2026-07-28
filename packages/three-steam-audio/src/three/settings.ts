import type {
  AirAbsorptionSettings,
  DirectOverrides,
  DirectSettings,
  DistanceAttenuationSettings,
  HRTFSettings,
  PerspectiveCorrectionSettings,
  QuaternionLike,
  ReflectionSettings,
  SourceSettings,
  SpatializationSettings,
} from '../types'

import { Quaternion, Vector3 } from 'three'

export const DIRECT_DISTANCE = 1 << 0
export const DIRECT_AIR = 1 << 1
export const DIRECT_DIRECTIVITY = 1 << 2
export const DIRECT_OCCLUSION = 1 << 3
export const DIRECT_TRANSMISSION = 1 << 4
export const SIMULATION_DIRECT = 1 << 0
export const SIMULATION_REFLECTIONS = 1 << 1

export const DEFAULT_FRAME_SIZE = 1024
export const DEFAULT_MAX_SOURCES = 32
export const DEFAULT_SIMULATION_RATE = 60
export const DEFAULT_REFLECTION_RATE = 10
export const DEFAULT_MAX_OCCLUSION_SAMPLES = 128
export const MAX_TRANSMISSION_SURFACES = 8
export const QUALITY_MAX_OCCLUSION_SAMPLES = {
  high: 256,
  low: 32,
  medium: DEFAULT_MAX_OCCLUSION_SAMPLES,
} as const

const ahead = new Vector3()
const up = new Vector3()
const orientationScratch = new Quaternion()
const sofaCacheKeyCounter = { value: 1 }

export interface NormalizedHRTFSettings {
  cacheKey: string
  data?: ArrayBuffer
  normalization: 'none' | 'rms'
  type: 'default' | 'sofa'
  volume: number
}

export interface NormalizedPerspectiveCorrectionSettings {
  applyInXR: boolean
  enabled: boolean
  factor: number
}

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

export interface NormalizedSourceSettings {
  direct: Required<Pick<DirectSettings, 'mixLevel'>> & {
    airAbsorption: AirAbsorptionSettings | boolean
    directivity: false | {
      dipolePower: number
      dipoleWeight: number
    }
    distanceAttenuation: DistanceAttenuationSettings | false
    occlusion: false | Required<import('../types').OcclusionSettings>
    transmission: false | {
      maxSurfaces: number
      type: 'frequency-dependent' | 'frequency-independent'
    }
  }
  perspectiveCorrection: boolean
  reflections: Required<Pick<ReflectionSettings, 'mixLevel' | 'reverbScale'>> & {
    enabled: boolean
  }
  spatialization: NormalizedSpatializationSettings
}

export type NormalizedSpatializationSettings
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

export const clampUnit = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError(`${name} must be a finite number in [0, 1]`)
  return value
}

export const gain = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a finite number >= 0`)
  return value
}

export const positive = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be a positive finite number`)
  return value
}

export const integer = (name: string, value: number, minimum = 1): number => {
  if (!Number.isInteger(value) || value < minimum)
    throw new RangeError(`${name} must be an integer >= ${minimum}`)
  return value
}

export const unitThreeBand = (name: string, values: readonly number[]): void => {
  if (values.length !== 3)
    throw new RangeError(`${name} must contain exactly three bands`)
  for (let band = 0; band < 3; band++)
    clampUnit(`${name}[${band}]`, values[band])
}

export const normalizeQuaternion = (value: QuaternionLike): Quaternion => {
  orientationScratch.set(value.x, value.y, value.z, value.w)
  if (orientationScratch.lengthSq() < 1e-12)
    throw new RangeError('orientation must not be a zero quaternion')
  return orientationScratch.normalize()
}

export const directionsFromQuaternion = (value: QuaternionLike): [Vector3, Vector3] => {
  const quaternion = normalizeQuaternion(value)
  ahead.set(0, 0, -1).applyQuaternion(quaternion)
  up.set(0, 1, 0).applyQuaternion(quaternion)
  return [ahead, up]
}

export const normalizePerspectiveCorrectionSettings = (
  settings: PerspectiveCorrectionSettings | undefined,
): NormalizedPerspectiveCorrectionSettings => {
  if (settings?.enabled !== undefined && typeof settings.enabled !== 'boolean')
    throw new TypeError('perspectiveCorrection.enabled must be a boolean')
  if (settings?.applyInXR !== undefined && typeof settings.applyInXR !== 'boolean')
    throw new TypeError('perspectiveCorrection.applyInXR must be a boolean')
  return {
    applyInXR: settings?.applyInXR ?? false,
    enabled: settings?.enabled ?? false,
    factor: gain('perspectiveCorrection.factor', settings?.factor ?? 1),
  }
}

export const normalizeHRTFSettings = (
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

export const normalizeReflectionSettings = (
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
export const normalizeDirectivity = (
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

export const normalizeOcclusion = (
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

export const normalizeTransmission = (
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

export const normalizeDirectSettings = (
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

export const normalizeSpatializationSettings = (
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

export const normalizeSettings = (
  settings: SourceSettings = {},
  maximumOcclusionSamples = DEFAULT_MAX_OCCLUSION_SAMPLES,
): NormalizedSourceSettings => {
  if (settings.perspectiveCorrection !== undefined
    && typeof settings.perspectiveCorrection !== 'boolean') {
    throw new TypeError('perspectiveCorrection must be a boolean')
  }
  return {
    direct: normalizeDirectSettings(settings.direct, maximumOcclusionSamples),
    perspectiveCorrection: settings.perspectiveCorrection ?? false,
    reflections: normalizeReflectionSettings(settings.reflections),
    spatialization: normalizeSpatializationSettings(settings.spatialization),
  }
}

export const sampleCurve = (
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

export const distanceModel = (settings: DistanceAttenuationSettings | false) => {
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

export const airModel = (settings: AirAbsorptionSettings | boolean | undefined) => {
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

export const directEffectFlags = (
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

export const spatializationModeCode = (settings: NormalizedSpatializationSettings): number => {
  if (settings.mode === 'none')
    return 0
  if (settings.mode === 'binaural')
    return 1
  return 2
}

export const spatializationBlend = (settings: NormalizedSpatializationSettings): number =>
  settings.mode === 'none' ? 0 : settings.blend

export const hrtfInterpolationCode = (settings: NormalizedSpatializationSettings): number =>
  settings.mode === 'binaural' && settings.interpolation === 'bilinear' ? 1 : 0
