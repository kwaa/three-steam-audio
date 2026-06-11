import assert from 'node:assert/strict'
import test from 'node:test'

import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three'

class FakePort {
  closed = false
  messages = []

  close() {
    this.closed = true
  }

  postMessage(message) {
    this.messages.push(message)
  }
}

class FakeAudioWorkletNode {
  connections = []
  disconnections = []
  port = new FakePort()

  constructor(context, name, options) {
    this.context = context
    this.name = name
    this.options = options
  }

  connect(destination) {
    this.connections.push(destination)
    return destination
  }

  disconnect(destination) {
    this.disconnections.push(destination)
  }
}

globalThis.AudioWorkletNode = FakeAudioWorkletNode
globalThis.crossOriginIsolated = false

const { createWorld, Materials } = await import('../dist/index.mjs')

const createNativeModule = () => {
  const memory = new ArrayBuffer(1024 * 1024)
  const calls = []
  let allocation = 1024
  let handle = 100
  const module = {
    _free() {},
    _malloc(size) {
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
          return target[property]
        if (property === '_sa_source_get_direct_outputs') {
          return (source, distance, air, directivity, occlusion, transmission) => {
            calls.push([property, source])
            target.HEAPF32[distance >>> 2] = 0.25
            target.HEAPF32.set([0.5, 0.6, 0.7], air >>> 2)
            target.HEAPF32[directivity >>> 2] = 0.8
            target.HEAPF32[occlusion >>> 2] = 0.9
            target.HEAPF32.set([0.1, 0.2, 0.3], transmission >>> 2)
            return 0
          }
        }
        if (typeof property === 'string' && property.startsWith('_sa_')) {
          return (...arguments_) => {
            calls.push([property, ...arguments_])
            if (creates.has(property)) {
              const out = arguments_.at(-1)
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

const createAudioContext = () => {
  const modules = []
  return {
    context: {
      audioWorklet: {
        async addModule(url) {
          modules.push(url.href)
        },
      },
      destination: { name: 'destination' },
      sampleRate: 48_000,
      state: 'running',
    },
    modules,
  }
}

test('caches runtime preparation and advances direct simulation at the configured rate', async () => {
  const native = createNativeModule()
  const audio = createAudioContext()
  let factoryCalls = 0
  const moduleFactory = async () => {
    factoryCalls++
    return native.module
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(new Uint8Array([0, 97, 115, 109]))

  try {
    const first = await createWorld({
      audioContext: audio.context,
      moduleFactory,
      simulationRate: 60,
    })
    const second = await createWorld({
      audioContext: audio.context,
      moduleFactory,
    })
    assert.equal(factoryCalls, 1)
    assert.equal(audio.modules.length, 1)

    const source = first.createSource({
      directSimulation: {
        airAbsorption: true,
        occlusion: 'raycast',
        transmission: { type: 'frequency-dependent' },
      },
    })
    const node = first.createNode(source)
    first.step(0.01)
    assert.equal(native.calls.filter(([name]) => name === '_sa_simulator_run_direct').length, 0)
    first.step(0.01)
    assert.equal(native.calls.filter(([name]) => name === '_sa_simulator_run_direct').length, 1)

    assert.deepEqual(source.getDirectOutputs(), {
      airAbsorption: [0.5, 0.6000000238418579, 0.699999988079071],
      directivity: 0.800000011920929,
      distanceAttenuation: 0.25,
      occlusion: 0.8999999761581421,
      transmission: [0.10000000149011612, 0.20000000298023224, 0.30000001192092896],
    })
    assert.equal(node.port.messages.at(-1).type, 'control')

    source.dispose()
    const release = native.calls.find(([name]) => name === '_sa_source_release')
    assert.ok(release)
    assert.notEqual(release[2], 0, 'source release receives its simulator for remove + commit')
    assert.equal(node.port.closed, true)

    first.dispose()
    first.dispose()
    assert.throws(() => first.step(0), /World has been disposed/)
    second.dispose()
  }
  finally {
    globalThis.fetch = originalFetch
  }
})

test('validates source capacity and transmission requirements at the JS boundary', async () => {
  const native = createNativeModule()
  const audio = createAudioContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(new Uint8Array([0, 97, 115, 109]))
  try {
    const world = await createWorld({
      audioContext: audio.context,
      maxSources: 1,
      moduleFactory: async () => native.module,
    })
    assert.throws(
      () => world.createSource({
        directSimulation: {
          occlusion: false,
          transmission: {},
        },
      }),
      /Transmission requires occlusion/,
    )
    const source = world.createSource({
      directSimulation: {
        airAbsorption: true,
        occlusion: 'raycast',
      },
    })
    const node = world.createNode(source)
    source.setSettings({ hrtf: false })
    const latestInputs = native.calls
      .filter(([name]) => name === '_sa_source_set_inputs')
      .at(-1)
    assert.equal(latestInputs[11] & 0b1010, 0b1010, 'partial settings preserve direct simulation fields')

    source.setDirectOverrides({ transmission: [0.2, 0.3, 0.4] })
    const control = node.port.messages.at(-1).values
    assert.equal(control[13] & 0b10000, 0b10000, 'an override enables its DSP stage')
    assert.throws(() => world.createSource(), /maxSources/)
    source.dispose()
    world.dispose()
  }
  finally {
    globalThis.fetch = originalFetch
  }
})

test('uses sequence-locked shared control memory only on isolated pages', async () => {
  const native = createNativeModule()
  const audio = createAudioContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(new Uint8Array([0, 97, 115, 109]))
  globalThis.crossOriginIsolated = true
  try {
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })
    const source = world.createSource()
    const node = world.createNode(source)
    const buffer = node.options.processorOptions.controlBuffer
    assert.ok(buffer instanceof SharedArrayBuffer)
    const sequence = new Int32Array(buffer, 0, 1)
    assert.equal(Atomics.load(sequence, 0) % 2, 0)
    assert.equal(node.port.messages.length, 0)
    source.dispose()
    world.dispose()
  }
  finally {
    globalThis.crossOriginIsolated = false
    globalThis.fetch = originalFetch
  }
})

test('batches scene changes and updates rigid dynamic transforms', async () => {
  const native = createNativeModule()
  const audio = createAudioContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(new Uint8Array([0, 97, 115, 109]))
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

  try {
    const world = await createWorld({
      audioContext: audio.context,
      moduleFactory: async () => native.module,
    })
    const commits = () => native.calls.filter(([name]) => name === '_sa_scene_commit').length
    const beforeStatic = commits()
    const staticMesh = world.scene.addStaticMesh({
      geometry,
      material: Materials.concrete,
    })
    assert.equal(commits(), beforeStatic)
    world.scene.commit()
    assert.equal(commits(), beforeStatic + 1)
    staticMesh.dispose()
    assert.equal(
      native.calls.filter(([name]) => name === '_sa_static_mesh_release').length,
      0,
    )
    world.scene.commit()
    assert.equal(
      native.calls.filter(([name]) => name === '_sa_static_mesh_release').length,
      1,
    )

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
    assert.equal(updates(), 0)
    dynamicMesh.setTransform(new Matrix4().makeTranslation(1, 2, 3).scale({
      x: 2,
      y: 3,
      z: 4,
    }))
    assert.equal(updates(), 1)
    assert.throws(
      () => dynamicMesh.setTransform(new Matrix4().makeScale(2, 3, 5)),
      /Changing the scale/,
    )
    dynamicMesh.dispose()
    world.scene.commit()
    world.dispose()
  }
  finally {
    globalThis.fetch = originalFetch
  }
})
