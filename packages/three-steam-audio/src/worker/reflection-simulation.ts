import type { Matrix4 } from 'three'

import type { ConvertedGeometry } from '../three/geometry'
import type { NormalizedReflectionSimulationSettings } from '../three/world'

import { matrixToRowMajor } from '../three/geometry'

interface ReflectionSourceInput {
  ahead: readonly [number, number, number]
  enabled: boolean
  id: number
  position: readonly [number, number, number]
  reverbScale: readonly [number, number, number]
  up: readonly [number, number, number]
}

interface ReflectionWorkerDisposed {
  type: 'disposed'
}

interface ReflectionWorkerError {
  message: string
  type: 'error'
}

type ReflectionWorkerMessage
  = | ReflectionWorkerDisposed
    | ReflectionWorkerError
    | ReflectionWorkerResult

interface ReflectionWorkerResult {
  outputs: Array<{
    id: number
    reverbTimes: [number, number, number]
  }>
  type: 'result'
}

export class ReflectionSimulationWorker {
  #disposed = false
  #disposeTimer?: ReturnType<typeof setTimeout>
  #error?: Error
  #pending = false
  readonly #worker: Worker

  constructor(
    wasmBinary: ArrayBuffer,
    sampleRate: number,
    frameSize: number,
    maxSources: number,
    settings: NormalizedReflectionSimulationSettings,
    onResult: (result: ReflectionWorkerResult['outputs']) => void,
  ) {
    this.#worker = new Worker(
      new URL('./reflection-simulator-worker.js', import.meta.url),
      { type: 'module' },
    )
    this.#worker.onmessage = ({ data }: MessageEvent<ReflectionWorkerMessage>) => {
      if (data?.type === 'error') {
        this.#pending = false
        this.#error = new Error(data.message)
        return
      }
      if (data?.type === 'disposed') {
        if (this.#disposeTimer !== undefined)
          clearTimeout(this.#disposeTimer)
        this.#worker.terminate()
        return
      }
      if (data?.type !== 'result')
        return
      this.#pending = false
      onResult(data.outputs)
    }
    this.#worker.onerror = (event) => {
      this.#pending = false
      this.#error = new Error(
        event.message || 'Steam Audio reflection worker failed',
      )
    }
    const binary = wasmBinary.slice(0)
    this.#worker.postMessage({
      frameSize,
      maxSources,
      sampleRate,
      settings,
      type: 'init',
      wasmBinary: binary,
    }, [binary])
  }

  addDynamicMesh(
    id: number,
    geometry: ConvertedGeometry,
    materialCount: number,
    transform: Matrix4,
  ): void {
    this.#post({
      geometry,
      id,
      materialCount,
      transform: matrixToRowMajor(transform),
      type: 'add-dynamic-mesh',
    })
  }

  addSource(input: ReflectionSourceInput): void {
    this.#post({ input, type: 'add-source' })
  }

  addStaticMesh(
    id: number,
    geometry: ConvertedGeometry,
    materialCount: number,
  ): void {
    this.#post({ geometry, id, materialCount, type: 'add-static-mesh' })
  }

  commitScene(): void {
    this.#post({ type: 'commit-scene' })
  }

  dispose(): void {
    if (this.#disposed)
      return
    this.#disposed = true
    this.#disposeTimer = setTimeout(() => this.#worker.terminate(), 100)
    this.#worker.postMessage({ type: 'dispose' })
  }

  removeMesh(id: number): void {
    this.#post({ id, type: 'remove-mesh' })
  }

  removeSource(id: number): void {
    this.#post({ id, type: 'remove-source' })
  }

  run(): void {
    if (this.#error)
      throw this.#error
    if (this.#disposed || this.#pending)
      return
    this.#pending = true
    this.#worker.postMessage({ type: 'run' })
  }

  setListener(
    position: readonly [number, number, number],
    ahead: readonly [number, number, number],
    up: readonly [number, number, number],
    settings: NormalizedReflectionSimulationSettings,
  ): void {
    this.#post({ ahead, position, settings, type: 'set-listener', up })
  }

  updateDynamicMesh(id: number, transform: Matrix4): void {
    this.#post({
      id,
      transform: matrixToRowMajor(transform),
      type: 'update-dynamic-mesh',
    })
  }

  updateSource(input: ReflectionSourceInput): void {
    this.#post({ input, type: 'update-source' })
  }

  #post(message: object): void {
    if (this.#disposed)
      return
    this.#worker.postMessage(message)
  }
}

export const canUseReflectionWorker = (): boolean =>
  typeof Worker !== 'undefined'

export type { ReflectionSourceInput }
