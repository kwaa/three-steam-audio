import type { SteamAudioBindings } from '../bindings/phonon_bindings.js'

export interface SteamAudioAmbisonicProcessorOptions extends AudioWorkletNodeOptions {
  processorOptions: {
    controlBuffer?: SharedArrayBuffer
    frameSize: number
    hrtf?: {
      cacheKey: string
      data?: ArrayBuffer
      normalization: 'none' | 'rms'
      type: 'default' | 'sofa'
      volume: number
    }
    wasmBinary: ArrayBuffer
  }
}

export interface SteamAudioAmbisonicProcessorRuntime {
  context: number
  hrtf: number
  key: string
  module: SteamAudioBindings
  references: number
}

export class SteamAudioAmbisonicProcessor extends AudioWorkletProcessor {
  control: Float32Array
  controlBuffer?: SharedArrayBuffer
  controlSequence?: Int32Array
  decodeEffect?: number
  disposed: boolean
  failed: boolean
  frameSize: number
  input: Float32Array[]
  inputCount: number
  inputPointer?: number
  inputRead: number
  inputWrite: number
  n3dPointer?: number
  output: Float32Array[]
  outputCount: number
  outputPointer?: number
  outputRead: number
  outputWrite: number
  ready: boolean
  runtime?: SteamAudioAmbisonicProcessorRuntime
  sharedControl?: Float32Array

  constructor(options: SteamAudioAmbisonicProcessorOptions)

  dispose(): void
  fail(message: string): void
  initialize(runtime: SteamAudioAmbisonicProcessorRuntime): void
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
  processBlock(): boolean
  pullOutput(output: Float32Array[], outputIndex: number, quantumSize: number): number
  pushInput(
    input: Float32Array[] | undefined,
    inputIndex: number,
    sampleCount: number,
  ): void
  readSharedControl(): void
  releaseResources(): void
  validateInput(input: Float32Array[] | undefined): boolean
}
