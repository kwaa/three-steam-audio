import type { Source } from '../types'

const CONTROL_VALUE_COUNT = 15

export interface NodeControlValues {
  airAbsorption: readonly [number, number, number]
  direction: readonly [number, number, number]
  directivity: number
  distanceAttenuation: number
  effectFlags: number
  hrtf: boolean
  occlusion: number
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

export class SteamAudioNode extends AudioWorkletNodeBase {
  readonly source: Source
  readonly #controlData?: Float32Array
  readonly #controlSequence?: Int32Array
  #disposed = false
  readonly #onDispose: (node: SteamAudioNode) => void

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
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        controlBuffer,
        frameSize: options.frameSize,
        wasmBinary: options.wasmBinary,
      },
    })
    this.source = options.source
    this.#onDispose = options.onDispose
    if (controlBuffer) {
      this.#controlSequence = new Int32Array(controlBuffer, 0, 1)
      this.#controlData = new Float32Array(controlBuffer, 4, CONTROL_VALUE_COUNT)
    }
  }

  dispose(): void {
    if (this.#disposed)
      return
    this.#disposed = true
    try {
      this.disconnect()
    }
    catch {}
    this.port.postMessage({ type: 'dispose' })
    this.port.close()
    this.#onDispose(this)
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

    if (this.#controlData && this.#controlSequence) {
      Atomics.add(this.#controlSequence, 0, 1)
      this.#controlData.set(packet)
      Atomics.add(this.#controlSequence, 0, 1)
    }
    else {
      this.port.postMessage({ type: 'control', values: packet }, [packet.buffer])
    }
  }
}
