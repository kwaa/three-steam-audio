import type { SteamAudioBindings } from '../bindings/phonon_bindings.js'

export interface SteamAudioBusProcessorOptions extends AudioWorkletNodeOptions {
  processorOptions?: {
    wet?: number
  }
}

export interface SteamAudioProcessorOptions extends AudioWorkletNodeOptions {
  processorOptions: {
    controlBuffer?: SharedArrayBuffer
    frameSize: number
    wasmBinary: ArrayBuffer
  }
}

export interface SteamAudioProcessorRuntime {
  context: number
  hrtf: number
  module: SteamAudioBindings
}

export class SteamAudioBusProcessor extends AudioWorkletProcessor {
  disposed: boolean
  wet: number

  constructor(options: SteamAudioBusProcessorOptions)

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

export class SteamAudioProcessor extends AudioWorkletProcessor {
  airPointer?: number
  binauralEffect?: number
  control: Float32Array
  controlBuffer?: SharedArrayBuffer
  controlSequence?: Int32Array
  directEffect?: number
  directPointer?: number
  disposed: boolean
  failed: boolean
  frameSize: number
  inputActive: Uint8Array
  inputCount: number
  inputLeft: Float32Array
  inputPointer?: number
  inputRead: number
  inputRight: Float32Array
  inputWrite: number
  monoPointer?: number
  outputCount: number
  outputLeft: Float32Array
  outputPointer?: number
  outputRead: number
  outputRight: Float32Array
  outputWrite: number
  panningEffect?: number
  ready: boolean
  reflectionEffect?: number
  reflectionLeft: Float32Array
  reflectionPointer?: number
  reflectionRight: Float32Array
  reflectionTimesPointer?: number
  reverbEffect?: number
  reverbLeft: Float32Array
  reverbPointer?: number
  reverbRight: Float32Array
  reverbTimesPointer?: number
  runtime?: SteamAudioProcessorRuntime
  sharedControl?: Float32Array
  spatializationMix: number
  transmissionPointer?: number

  constructor(options: SteamAudioProcessorOptions)

  dispose(): void
  initialize(runtime: SteamAudioProcessorRuntime): void
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
  processBlock(): void
  pullOutput(
    output: Float32Array[],
    reflectionOutput: Float32Array[],
    reverbOutput: Float32Array[],
    quantumSize: number,
  ): void
  pushInput(input: Float32Array[] | undefined, quantumSize: number): void
  readSharedControl(): void
}
