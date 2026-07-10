import type { SteamAudioNode } from '../dist/index.js'
import type { FakePort } from './helpers/audio-context.ts'

import { ArrayCamera, BufferGeometry, Float32BufferAttribute, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorld, Materials } from '../dist/index.js'
import { createAudioContext } from './helpers/audio-context.ts'

interface NativeModule {
  [key: string]: unknown
  _free: () => void
  _malloc: (size: number) => number
  HEAP32: Int32Array
  HEAPF32: Float32Array
  HEAPU8: Uint8Array
  HEAPU32: Uint32Array
}

class FakeWorker {
  static readonly instances: FakeWorker[] = []
  messages: unknown[] = []
  onmessage?: (event: MessageEvent) => void
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }
}

const createNativeModule = () => {
  const memory = new ArrayBuffer(1024 * 1024)
  const calls: [string, ...unknown[]][] = []
  let allocation = 1024
  let handle = 100
  const module: NativeModule = {
    _free() {},
    _malloc(size: number) {
      const pointer = allocation
      allocation += Math.ceil(size / 8) * 8
      return pointer
    },
    HEAP32: new Int32Array(memory),
    HEAPF32: new Float32Array(memory),
    HEAPU8: new Uint8Array(memory),
    HEAPU32: new Uint32Array(memory),
  }

  const creates = new Set([
    '_sa_context_create',
    '_sa_instanced_mesh_create',
    '_sa_scene_create',
    '_sa_simulator_create',
    '_sa_source_create',
    '_sa_static_mesh_create',
  ])

  return {
    calls,
    module: new Proxy(module, {
      get(target, property) {
        if (property in target)
          return target[property as keyof NativeModule]
        if (property === '_sa_source_get_direct_outputs') {
          return (source: number, distance: number, air: number, directivity: number, occlusion: number, transmission: number) => {
            calls.push([property, source])
            target.HEAPF32[distance >>> 2] = 0.25
            target.HEAPF32.set([0.5, 0.6, 0.7], air >>> 2)
            target.HEAPF32[directivity >>> 2] = 0.8
            target.HEAPF32[occlusion >>> 2] = 0.9
            target.HEAPF32.set([0.1, 0.2, 0.3], transmission >>> 2)
            return 0
          }
        }
        if (property === '_sa_source_get_reflection_outputs') {
          return (source: number, reverbTimes: number) => {
            calls.push([property, source])
            target.HEAPF32.set([1.2, 1.4, 1.6], reverbTimes >>> 2)
            return 0
          }
        }
        if (typeof property === 'string' && property.startsWith('_sa_')) {
          return (...args: unknown[]) => {
            calls.push([property, ...args])
            if (creates.has(property)) {
              const out = args.at(-1) as number
              target.HEAPU32[out >>> 2] = handle++
            }
            return 0
          }
        }
        return undefined
      },
    }),
  }
}

describe('world', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([0, 97, 115, 109])))
  })

  it('caches runtime preparation and advances direct simulation at the configured rate', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    let factoryCalls = 0
    const moduleFactory = async () => {
      factoryCalls++
      return native.module
    }

    const first = await createWorld({
      audioContext: audio.context,
      direct: { updateRate: 60 },
      moduleFactory,
    })
    const second = await createWorld({
      audioContext: audio.context,
      moduleFactory,
    })
    expect(factoryCalls).toBe(1)
    expect(audio.modules.length).toBe(1)

    const source = first.createSource({
      direct: {
        airAbsorption: true,
        occlusion: { type: 'raycast' },
        transmission: { type: 'frequency-dependent' },
      },
    })
    const node = first.createNode(source)
    first.step(0.01)
    expect(native.calls.filter(([name]) => name === '_sa_simulator_run_direct').length).toBe(0)
    first.step(0.01)
    expect(native.calls.filter(([name]) => name === '_sa_simulator_run_direct').length).toBe(1)

    expect(source.getDirectOutputs()).toEqual({
      airAbsorption: [0.5, 0.6000000238418579, 0.699999988079071],
      directivity: 0.800000011920929,
      distanceAttenuation: 0.25,
      occlusion: 0.8999999761581421,
      transmission: [0.10000000149011612, 0.20000000298023224, 0.30000001192092896],
    })
    expect(((node.port as unknown) as FakePort).messages.at(-1)).toMatchObject({ type: 'control' })

    source.dispose()
    const release = native.calls.find(([name]) => name === '_sa_source_release')
    expect(release).toBeTruthy()
    expect(release![2]).not.toBe(0)
    expect(((node.port as unknown) as FakePort).closed).toBe(true)

    first.dispose()
    first.dispose()
    expect(() => first.step(0)).toThrow(/World has been disposed/)
    second.dispose()
  })

  it('validates source capacity and transmission requirements at the JS boundary', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()

    const world = await createWorld({
      audioContext: audio.context,
      maxSources: 1,
      moduleFactory: async () => native.module,
    })
    expect(() => world.createSource({
      direct: {
        occlusion: false,
        transmission: {},
      },
    })).toThrow(/Transmission requires occlusion/)
    expect(() => world.createSource({
      direct: {
        occlusion: { type: 'raycast' },
        transmission: { maxSurfaces: 9 },
      },
    })).toThrow(/maxSurfaces cannot exceed 8/)
    expect(() => world.createSource({
      direct: { mixLevel: 1.01 },
    })).toThrow(/direct\.mixLevel.*\[0, 1\]/)
    const source = world.createSource({
      direct: {
        airAbsorption: true,
        occlusion: { type: 'raycast' },
      },
    })
    const node = world.createNode(source)
    source.setSettings({ spatialization: { mode: 'none' } })
    const latestInputs = native.calls
      .filter(([name]) => name === '_sa_source_set_inputs')
      .at(-1)
    expect((latestInputs![11] as number) & 0b1010).toBe(0b1010)

    source.setDirectOverrides({ transmission: [0.2, 0.3, 0.4] })
    const control = ((node.port as unknown) as FakePort).messages.at(-1) as { values: Float32Array }
    expect(control.values[13] & 0b10000).toBe(0b10000)
    expect(control.values[14]).toBe(1)
    expect(() => source.setDirectOverrides({
      airAbsorption: [0.2, 0.3] as unknown as [number, number, number],
    })).toThrow(/exactly three bands/)
    // eslint-disable-next-line no-sparse-arrays -- Covers untyped JavaScript callers.
    const sparseTransmission = [0.2, , 0.4]
    expect(() => source.setDirectOverrides({
      transmission: sparseTransmission as [number, number, number],
    })).toThrow(/overrides\.transmission\[1\].*\[0, 1\]/)
    expect(() => world.createSource()).toThrow(/maxSources/)
    source.dispose()
    world.dispose()
  })

  it('passes one validated HRTF configuration to every audio worklet', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      hrtf: { normalization: 'rms', volume: 0.75 },
      moduleFactory: async () => native.module,
    })
    const source = world.createSource()
    const node = world.createNode(source) as unknown as {
      options: { processorOptions: { hrtf: unknown } }
    }

    expect(node.options.processorOptions.hrtf).toMatchObject({
      cacheKey: 'default',
      normalization: 'rms',
      type: 'default',
      volume: 0.75,
    })
    source.dispose()
    world.dispose()

    await expect(createWorld({
      audioContext: audio.context,
      hrtf: { volume: -1 },
      moduleFactory: async () => native.module,
    })).rejects.toThrow('hrtf.volume')
  })

  it('passes custom SOFA bytes to every audio worklet with a stable HRTF cache key', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const data = new Uint8Array([1, 2, 3, 4]).buffer
    const world = await createWorld({
      audioContext: audio.context,
      hrtf: { data, normalization: 'rms', type: 'sofa', volume: 0.75 },
      moduleFactory: async () => native.module,
    })
    new Uint8Array(data)[0] = 9
    const source = world.createSource()
    const first = world.createNode(source) as unknown as {
      options: { processorOptions: { hrtf: Record<string, unknown> & { data: ArrayBuffer } } }
    }
    const second = world.createNode(source) as unknown as typeof first

    expect(first.options.processorOptions.hrtf).toMatchObject({
      normalization: 'rms',
      type: 'sofa',
      volume: 0.75,
    })
    expect(first.options.processorOptions.hrtf.data).not.toBe(data)
    expect([...new Uint8Array(first.options.processorOptions.hrtf.data)])
      .toEqual([1, 2, 3, 4])
    expect(second.options.processorOptions.hrtf.cacheKey)
      .toBe(first.options.processorOptions.hrtf.cacheKey)

    source.dispose()
    world.dispose()

    await expect(createWorld({
      audioContext: audio.context,
      hrtf: { data: new ArrayBuffer(0), type: 'sofa' },
      moduleFactory: async () => native.module,
    })).rejects.toThrow('hrtf.data must not be empty')
  })

  it('keeps reflections disabled unless the World explicitly enables them', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })

    expect(() => world.createReflectionBus()).toThrow(
      'Reflections are disabled for this World',
    )
    expect(() => world.createReverbBus()).toThrow(
      'Reflections are disabled for this World',
    )
    expect(() => world.createSource({ reflections: {} })).toThrow(
      'Source reflections require World reflections to be enabled',
    )

    const simulatorCreate = native.calls.find(
      ([name]) => name === '_sa_simulator_create',
    )
    expect(simulatorCreate?.[7]).toBe(0)
    world.dispose()
  })

  it('publishes source direction in listener-local coordinates', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })
    const source = world.createSource()
    const node = world.createNode(source)

    world.listener.setOrientation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    )
    source.setPosition({ x: 1, y: 0, z: 0 })

    const control = ((node.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect([...control.values.slice(9, 12)]).toEqual([
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(1),
    ])

    source.dispose()
    world.dispose()
  })

  it('uses Steam Audio perspective correction only for opted-in sources', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
      perspectiveCorrection: { enabled: true, factor: 1 },
    })
    const camera = new PerspectiveCamera(90, 2, 0.1, 100)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    world.listener.setCamera(camera)
    const corrected = world.createSource({ perspectiveCorrection: true })
    const uncorrected = world.createSource()
    const correctedNode = world.createNode(corrected)
    const uncorrectedNode = world.createNode(uncorrected)

    corrected.setPosition({ x: 2, y: 0, z: -10 })
    uncorrected.setPosition({ x: 2, y: 0, z: -10 })

    const correctedControl = ((correctedNode.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    const uncorrectedControl = ((uncorrectedNode.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect(correctedControl.values[9]).toBeLessThan(uncorrectedControl.values[9])
    expect(correctedControl.values[11]).toBeLessThan(0)
    expect(uncorrectedControl.values[11]).toBeLessThan(0)

    corrected.setSettings({ perspectiveCorrection: false })
    const disabledControl = ((correctedNode.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect([...disabledControl.values.slice(9, 12)]).toEqual([
      expect.closeTo(uncorrectedControl.values[9]),
      expect.closeTo(uncorrectedControl.values[10]),
      expect.closeTo(uncorrectedControl.values[11]),
    ])

    corrected.dispose()
    uncorrected.dispose()
    world.dispose()
  })

  it('disables perspective correction for XR cameras unless explicitly enabled', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
      perspectiveCorrection: { enabled: true, factor: 1 },
    })
    const eye = new PerspectiveCamera(90, 2, 0.1, 100)
    eye.updateProjectionMatrix()
    eye.updateMatrixWorld()
    const xrCamera = new ArrayCamera([eye])
    world.listener.setCamera(xrCamera)
    const source = world.createSource({ perspectiveCorrection: true })
    const node = world.createNode(source)

    source.setPosition({ x: 2, y: 0, z: -10 })
    const disabled = ((node.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect(disabled.values[9]).toBeCloseTo(0.196116)

    world.setPerspectiveCorrection({ applyInXR: true, enabled: true, factor: 1 })
    const enabled = ((node.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect(enabled.values[9]).toBeLessThan(disabled.values[9])

    source.dispose()
    world.dispose()
  })

  it('uses sequence-locked shared control memory only on isolated pages', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    vi.stubGlobal('crossOriginIsolated', true)

    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })
    const source = world.createSource()
    const node = world.createNode(source) as unknown as SteamAudioNode & { options: { processorOptions: { controlBuffer?: SharedArrayBuffer } } }
    const buffer = node.options.processorOptions.controlBuffer
    expect(buffer).toBeInstanceOf(SharedArrayBuffer)
    const sequence = new Int32Array(buffer!, 0, 1)
    expect(Atomics.load(sequence, 0) % 2).toBe(0)
    expect(((node.port as unknown) as FakePort).messages.length).toBe(0)
    source.dispose()
    world.dispose()

    vi.stubGlobal('crossOriginIsolated', false)
  })

  it('exposes AudioWorklet initialization success and failure', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })
    const source = world.createSource()
    const readyNode = world.createNode(source)
    expect(readyNode.state).toBe('initializing')
    readyNode.port.onmessage?.({
      data: { type: 'ready' },
    } as MessageEvent)
    await expect(readyNode.ready).resolves.toBeUndefined()
    expect(readyNode.state).toBe('ready')
    expect(readyNode.error).toBeUndefined()

    const failedNode = world.createNode(source)
    failedNode.port.onmessage?.({
      data: { message: 'WASM initialization failed', type: 'error' },
    } as MessageEvent)
    await expect(failedNode.ready).rejects.toThrow(
      /AudioWorklet\.initialize: WASM initialization failed/,
    )
    expect(failedNode.state).toBe('failed')
    expect(failedNode.error).toBeInstanceOf(Error)

    source.dispose()
    world.dispose()
  })

  it('runs parametric reflections at a separate rate and exposes reflection and reverb sends', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
      reflections: {
        maxDuration: 2,
        maxOrder: 1,
        maxRays: 4096,
        updateRate: 10,
      },
    })
    const source = world.createSource({
      reflections: {
        mixLevel: 0.7,
        reverbScale: [1, 0.8, 0.6],
      },
    })
    const node = world.createNode(source) as unknown as SteamAudioNode & {
      connections: unknown[][]
    }
    const reflections = world.createReflectionBus({ wet: 0.9 })
    const reverb = world.createReverbBus({ wet: 0.5 })
    const reflectionSend = node.connectReflections(reflections, { gain: 0.4 })
    const reverbSend = node.connectReverb(reverb, { gain: 0.2 })

    expect(node.connections.map(connection => connection.slice(1))).toEqual([
      [1, 0],
      [2, 0],
    ])
    world.listener.setReverb({ reverbScale: [1, 1, 1] })
    world.step(0.05)
    expect(native.calls.filter(([name]) => name === '_sa_simulator_run_reflections')).toHaveLength(0)
    world.step(0.05)
    expect(native.calls.filter(([name]) => name === '_sa_simulator_run_reflections')).toHaveLength(1)

    const control = ((node.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect([...control.values.slice(18, 21)]).toEqual([
      expect.closeTo(1.2),
      expect.closeTo(1.4),
      expect.closeTo(1.6),
    ])
    expect(control.values[21]).toBeCloseTo(0.7)
    expect([...control.values.slice(22, 25)]).toEqual([
      expect.closeTo(1.2),
      expect.closeTo(1.4),
      expect.closeTo(1.6),
    ])
    expect(control.values[25]).toBe(1)

    reflectionSend.setGain(0.8)
    reverbSend.disconnect()
    reflectionSend.disconnect()
    reflections.dispose()
    reverb.dispose()
    source.dispose()
    world.dispose()
  })

  it('moves reflection simulation and scene mirroring to a dedicated worker when available', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
      reflections: {},
    })
    const worker = FakeWorker.instances[0]
    const simulatorCreate = native.calls.find(
      ([name]) => name === '_sa_simulator_create',
    )
    expect(simulatorCreate?.[7]).toBe(0)
    const source = world.createSource({ reflections: {} })
    const sourceCreate = native.calls
      .filter(([name]) => name === '_sa_source_create')
      .at(-1)
    expect(sourceCreate?.[2]).toBe(1)
    const node = world.createNode(source)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
    ], 3))
    world.scene.addStaticMesh({
      geometry,
      material: Materials.concrete,
    })
    world.scene.commit()
    world.step(0.1)

    const messageTypes = worker.messages.map((message) => {
      if (typeof message !== 'object' || message === null || !('type' in message))
        return undefined
      return message.type
    })
    expect(messageTypes).toEqual(expect.arrayContaining([
      'init',
      'add-source',
      'add-static-mesh',
      'commit-scene',
      'run',
    ]))
    expect(native.calls.filter(([name]) => name === '_sa_simulator_run_reflections')).toHaveLength(0)

    worker.emit({
      outputs: [{
        id: source.id,
        reverbTimes: [2, 2.5, 3],
      }],
      type: 'result',
    })
    const control = ((node.port as unknown) as FakePort).messages.at(-1) as {
      values: Float32Array
    }
    expect([...control.values.slice(18, 21)]).toEqual([2, 2.5, 3])

    source.dispose()
    world.dispose()
    worker.emit({ type: 'disposed' })
    expect(worker.terminated).toBe(true)
    vi.unstubAllGlobals()
  })

  it('surfaces structured reflection worker initialization failures on step', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const native = createNativeModule()
    const audio = createAudioContext()
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
      reflections: {},
    })
    const worker = FakeWorker.instances[0]
    const source = world.createSource({ reflections: {} })
    worker.emit({
      message: 'WASM initialization failed',
      type: 'error',
    })

    expect(() => world.step(0.1)).toThrow(/WASM initialization failed/)

    source.dispose()
    world.dispose()
    worker.emit({ type: 'disposed' })
    vi.unstubAllGlobals()
  })

  it('batches scene changes and updates rigid dynamic transforms', async () => {
    const native = createNativeModule()
    const audio = createAudioContext()

    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })
    const commits = () => native.calls.filter(([name]) => name === '_sa_scene_commit').length
    const beforeStatic = commits()
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
    ], 3))

    const staticMesh = world.scene.addStaticMesh({
      geometry,
      material: Materials.concrete,
    })
    expect(commits()).toBe(beforeStatic)
    world.scene.commit()
    expect(commits()).toBe(beforeStatic + 1)
    staticMesh.dispose()
    expect(native.calls.filter(([name]) => name === '_sa_static_mesh_release').length).toBe(0)
    world.scene.commit()
    expect(native.calls.filter(([name]) => name === '_sa_static_mesh_release').length).toBe(1)

    const initial = new Matrix4().makeScale(2, 3, 4)
    const dynamicMesh = world.scene.addDynamicMesh({
      geometry,
      material: Materials.wood,
      matrixWorld: initial,
    })
    world.scene.commit()
    const updates = () => native.calls
      .filter(([name]) => name === '_sa_instanced_mesh_update_transform')
      .length
    dynamicMesh.setTransform(initial)
    expect(updates()).toBe(0)
    dynamicMesh.setTransform(new Matrix4().makeTranslation(1, 2, 3).scale(new Vector3(2, 3, 4)))
    expect(updates()).toBe(1)
    expect(() => dynamicMesh.setTransform(new Matrix4().makeScale(2, 3, 5))).toThrow(/Changing the scale/)
    dynamicMesh.dispose()
    world.scene.commit()
    world.dispose()
  })
})
