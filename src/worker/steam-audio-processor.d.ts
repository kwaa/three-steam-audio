import type { SteamAudioBindings } from '../bindings/phonon_bindings.js'

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

export class SteamAudioProcessor extends AudioWorkletProcessor {
  airPointer?: number
  binauralEffect?: number
  control: Float32Array
  controlBuffer?: SharedArrayBuffer
  controlSequence?: Int32Array
  directEffect?: number
  directPointer?: number
  disposed: boolean
  frameSize: number
  hrtfMix: number
  inputCount: number
  inputLeft: Float32Array
  inputPointer?: number
  inputRead: number
  inputRight: Float32Array
  inputWrite: number
  outputCount: number
  outputLeft: Float32Array
  outputPointer?: number
  outputRead: number
  outputRight: Float32Array
  outputWrite: number
  ready: boolean
  runtime?: SteamAudioProcessorRuntime
  sharedControl?: Float32Array
  transmissionPointer?: number

  constructor(options: SteamAudioProcessorOptions)

  dispose(): void
  initialize(runtime: SteamAudioProcessorRuntime): void
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
  processBlock(): void
  pullOutput(output: Float32Array[], quantumSize: number): void
  pushInput(input: Float32Array[][] | undefined, quantumSize: number): void
  readSharedControl(): void
}
