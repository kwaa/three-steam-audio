import type { NativeModule } from '../three/native'
import type {
  SteamAudioCapabilities,
  SteamAudioModuleFactory,
  WorldOptions,
} from '../types'

import createSteamAudioModule from '../bindings/phonon_bindings.js'

export interface PreparedRuntime {
  module: NativeModule
  wasmBinary: ArrayBuffer
}

export const defaultModuleFactory: SteamAudioModuleFactory = createSteamAudioModule as SteamAudioModuleFactory

const runtimeCache = new WeakMap<
  AudioContext,
  Map<SteamAudioModuleFactory, Promise<PreparedRuntime>>
>()

const wasmUrl = new URL('./bindings/phonon_bindings.wasm', import.meta.url)
const workletUrl = new URL('./steam-audio-processor.js', import.meta.url)

export const detectCapabilities = (): SteamAudioCapabilities => {
  const isolated = globalThis.crossOriginIsolated === true
  return {
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    crossOriginIsolated: isolated,
    gpuSimulation: false,
    runtimeBaking: false,
    sharedArrayBuffer: isolated && typeof SharedArrayBuffer !== 'undefined',
    webAssembly: typeof WebAssembly !== 'undefined',
  }
}

const prepareRuntime = async (
  audioContext: AudioContext,
  moduleFactory: SteamAudioModuleFactory,
): Promise<PreparedRuntime> => {
  if (typeof WebAssembly === 'undefined')
    throw new Error('three-steam-audio requires WebAssembly')
  if (!('audioWorklet' in audioContext) || typeof audioContext.audioWorklet.addModule !== 'function')
    throw new Error('three-steam-audio requires AudioWorklet support')

  const wasmResponse = await fetch(wasmUrl)
  if (!wasmResponse.ok)
    throw new Error(`Unable to load Steam Audio WASM (${wasmResponse.status} ${wasmResponse.statusText})`)
  const wasmBinary = await wasmResponse.arrayBuffer()

  const [module] = await Promise.all([
    moduleFactory({
      locateFile: path => path.endsWith('.wasm') ? wasmUrl.href : path,
      wasmBinary,
    }) as Promise<NativeModule>,
    audioContext.audioWorklet.addModule(workletUrl),
  ])

  return { module, wasmBinary }
}

// The cached promise identity must remain stable for React use().
/* eslint-disable ts/promise-function-async */
export const getPreparedRuntimePromise = (
  audioContext: AudioContext,
  moduleFactory: SteamAudioModuleFactory = defaultModuleFactory,
): Promise<PreparedRuntime> => {
  let byFactory = runtimeCache.get(audioContext)
  if (!byFactory) {
    byFactory = new Map()
    runtimeCache.set(audioContext, byFactory)
  }
  let promise = byFactory.get(moduleFactory)
  if (!promise) {
    promise = prepareRuntime(audioContext, moduleFactory)
    byFactory.set(moduleFactory, promise)
  }
  return promise
}
/* eslint-enable ts/promise-function-async */

export const prepareWorldRuntime = async (
  options: WorldOptions,
): Promise<PreparedRuntime> => getPreparedRuntimePromise(
  options.audioContext,
  options.moduleFactory ?? defaultModuleFactory,
)
