import type {
  ReflectionBusSettings,
  ReflectionConnection,
  ReverbBusSettings,
  ReverbConnection,
  Source,
} from '../types'

import { SteamAudioError } from '../three/errors'

const CONTROL_VALUE_COUNT = 23

export type SteamAudioNodeState
  = | 'disposed'
    | 'failed'
    | 'initializing'
    | 'ready'

export interface NodeControlValues {
  airAbsorption: readonly [number, number, number]
  direction: readonly [number, number, number]
  directivity: number
  distanceAttenuation: number
  effectFlags: number
  hrtf: boolean
  occlusion: number
  reflectionReverbTimes: readonly [number, number, number]
  reflectionWet: number
  reverbReverbTimes: readonly [number, number, number]
  reverbWet: number
  spatialBlend: number
  transmission: readonly [number, number, number]
  transmissionType: number
}

interface NodeOptions {
  frameSize: number
  onDispose: (node: SteamAudioNode) => void
  source: Source
  wasmBinary: ArrayBuffer
}

const MissingAudioWorkletNode = class {
  constructor() {
    throw new Error('AudioWorkletNode is not available in this environment')
  }
}

const AudioWorkletNodeBase = (
  globalThis.AudioWorkletNode ?? MissingAudioWorkletNode
)

const validateGain = (value: number): number => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError('gain must be a finite number >= 0')
  return value
}

const disposeWorkletNode = (
  node: InstanceType<typeof AudioWorkletNodeBase>,
  onDispose: () => void,
): void => {
  try {
    node.disconnect()
  }
  catch {}
  node.port.postMessage({ type: 'dispose' })
  node.port.close()
  onDispose()
}

interface BusNodeOptions {
  onDispose: (node: SteamAudioBusNode) => void
  wet: number
}

class SteamAudioBusNode extends AudioWorkletNodeBase {
  #disposed = false
  readonly #onDispose: (node: SteamAudioBusNode) => void

  constructor(context: AudioContext, options: BusNodeOptions) {
    super(context, 'steam-audio-bus-processor', {
      channelCount: 2,
      channelCountMode: 'clamped-max',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        wet: validateGain(options.wet),
      },
    })
    this.#onDispose = options.onDispose
  }

  dispose(): void {
    if (this.#disposed)
      return
    this.port.postMessage({ type: 'wet', value: 0 })
    this.#disposed = true
    disposeWorkletNode(this, () => this.#onDispose(this))
  }

  setWet(wet: number): void {
    if (this.#disposed)
      return
    this.port.postMessage({ type: 'wet', value: validateGain(wet) })
  }
}

export class ReflectionBusNode extends SteamAudioBusNode {
  constructor(
    context: AudioContext,
    settings: ReflectionBusSettings = {},
    onDispose: (node: SteamAudioBusNode) => void = () => {},
  ) {
    super(context, { onDispose, wet: settings.wet ?? 1 })
  }
}

export class ReverbBusNode extends SteamAudioBusNode {
  constructor(
    context: AudioContext,
    settings: ReverbBusSettings = {},
    onDispose: (node: SteamAudioBusNode) => void = () => {},
  ) {
    super(context, { onDispose, wet: settings.wet ?? 1 })
  }
}

export class SteamAudioNode extends AudioWorkletNodeBase {
  #error?: Error
  readonly source: Source
  readonly #controlData?: Float32Array
  readonly #controlSequence?: Int32Array
  #disposed = false
  readonly #onDispose: (node: SteamAudioNode) => void
  readonly ready: Promise<void>
  #rejectReady!: (reason: Error) => void
  #resolveReady!: () => void
  #state: SteamAudioNodeState = 'initializing'

  constructor(context: AudioContext, options: NodeOptions) {
    const useSharedMemory = globalThis.crossOriginIsolated === true
      && typeof SharedArrayBuffer !== 'undefined'
    const controlBuffer = useSharedMemory
      ? new SharedArrayBuffer(4 + CONTROL_VALUE_COUNT * 4)
      : undefined
    super(context, 'steam-audio-processor', {
      channelCount: 2,
      channelCountMode: 'clamped-max',
      numberOfInputs: 1,
      numberOfOutputs: 3,
      outputChannelCount: [2, 2, 2],
      processorOptions: {
        controlBuffer,
        frameSize: options.frameSize,
        wasmBinary: options.wasmBinary,
      },
    })
    this.source = options.source
    this.#onDispose = options.onDispose
    this.ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    // Consumers may observe readiness through state/error instead of awaiting.
    void this.ready.catch(() => {})
    this.port.onmessage = ({ data }: MessageEvent<{ message?: unknown, type: string }>) => {
      if (data.type === 'ready') {
        if (this.#state !== 'initializing')
          return
        this.#state = 'ready'
        this.#resolveReady()
        return
      }
      if (data.type === 'error')
        this.#fail(String(data.message))
    }
    const eventTarget = this as unknown as {
      addEventListener?: (type: string, listener: () => void) => void
    }
    eventTarget.addEventListener?.('processorerror', () => {
      this.#fail('AudioWorklet processor crashed')
    })
    if (controlBuffer) {
      this.#controlSequence = new Int32Array(controlBuffer, 0, 1)
      this.#controlData = new Float32Array(controlBuffer, 4, CONTROL_VALUE_COUNT)
    }
  }

  get error(): Error | undefined {
    return this.#error
  }

  get state(): SteamAudioNodeState {
    return this.#state
  }

  connectReflections(
    bus: ReflectionBusNode,
    options: { gain?: number } = {},
  ): ReflectionConnection {
    return this.#connectSend(bus, 1, options.gain ?? 1)
  }

  connectReverb(
    bus: ReverbBusNode,
    options: { gain?: number } = {},
  ): ReverbConnection {
    return this.#connectSend(bus, 2, options.gain ?? 1)
  }

  dispose(): void {
    if (this.#disposed)
      return
    this.#disposed = true
    if (this.#state === 'initializing') {
      this.#error = new SteamAudioError(
        'AudioWorklet.initialize',
        'node was disposed before initialization completed',
      )
      this.#rejectReady(this.#error)
    }
    this.#state = 'disposed'
    disposeWorkletNode(this, () => this.#onDispose(this))
  }

  setControl(values: NodeControlValues): void {
    if (this.#disposed)
      return
    const packet = new Float32Array(CONTROL_VALUE_COUNT)
    packet[0] = values.distanceAttenuation
    packet.set(values.airAbsorption, 1)
    packet[4] = values.directivity
    packet[5] = values.occlusion
    packet.set(values.transmission, 6)
    packet.set(values.direction, 9)
    packet[12] = values.spatialBlend
    packet[13] = values.effectFlags
    packet[14] = values.hrtf ? values.transmissionType + 1 : -(values.transmissionType + 1)
    packet.set(values.reflectionReverbTimes, 15)
    packet[18] = values.reflectionWet
    packet.set(values.reverbReverbTimes, 19)
    packet[22] = values.reverbWet

    if (this.#controlData && this.#controlSequence) {
      Atomics.add(this.#controlSequence, 0, 1)
      this.#controlData.set(packet)
      Atomics.add(this.#controlSequence, 0, 1)
    }
    else {
      this.port.postMessage({ type: 'control', values: packet }, [packet.buffer])
    }
  }

  #connectSend(
    bus: ReflectionBusNode | ReverbBusNode,
    output: number,
    initialGain: number,
  ): ReflectionConnection {
    if (this.#disposed)
      throw new Error('Cannot connect a disposed SteamAudioNode')
    if (bus.context !== this.context)
      throw new Error('Steam Audio send and bus must use the same AudioContext')
    const gainNode = this.context.createGain()
    gainNode.gain.value = validateGain(initialGain)
    this.connect(gainNode, output, 0)
    gainNode.connect(bus)
    let connected = true
    return {
      disconnect: () => {
        if (!connected)
          return
        connected = false
        try {
          this.disconnect(gainNode, output, 0)
        }
        catch {}
        try {
          gainNode.disconnect(bus)
        }
        catch {}
      },
      setGain: (gain: number) => {
        gainNode.gain.value = validateGain(gain)
      },
    }
  }

  #fail(message: string): void {
    if (this.#state !== 'initializing')
      return
    this.#error = new SteamAudioError('AudioWorklet.initialize', message)
    this.#state = 'failed'
    this.#rejectReady(this.#error)
  }
}
