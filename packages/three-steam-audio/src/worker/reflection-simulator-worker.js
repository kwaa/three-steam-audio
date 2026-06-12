import createSteamAudioModule from './bindings/phonon_bindings.js'

let runtime
const meshes = new Map()
const pendingMeshReleases = []
const sources = new Map()

const allocate = (module, byteLength) => {
  const pointer = module._malloc(byteLength)
  if (!pointer)
    throw new Error(`Steam Audio reflection worker could not allocate ${byteLength} bytes`)
  return pointer
}

const createHandle = (module, create) => {
  const out = allocate(module, 4)
  try {
    module.HEAPU32[out >>> 2] = 0
    const status = create(out)
    if (status !== 0)
      throw new Error(`Steam Audio reflection worker failed with status ${status}`)
    const handle = module.HEAPU32[out >>> 2]
    if (!handle)
      throw new Error('Steam Audio reflection worker returned a null handle')
    return handle
  }
  finally {
    module._free(out)
  }
}

const withArray = (module, heap, values, callback) => {
  const pointer = allocate(module, values.length * 4)
  try {
    heap.set(values, pointer >>> 2)
    return callback(pointer)
  }
  finally {
    module._free(pointer)
  }
}

const createStaticMesh = (scene, geometry, materialCount) => {
  const { module } = runtime
  return createHandle(module, out =>
    withArray(module, module.HEAPF32, geometry.vertices, vertices =>
      withArray(module, module.HEAP32, geometry.indices, indices =>
        withArray(module, module.HEAPF32, geometry.absorption, absorption =>
          withArray(module, module.HEAPF32, geometry.scattering, scattering =>
            withArray(module, module.HEAPF32, geometry.transmission, transmission =>
              withArray(module, module.HEAP32, geometry.materialIndices, materialIndices =>
                module._sa_static_mesh_create(
                  scene,
                  geometry.vertices.length / 3,
                  vertices,
                  geometry.indices.length / 3,
                  indices,
                  materialCount,
                  absorption,
                  scattering,
                  transmission,
                  materialIndices,
                  out,
                ))))))))
}

const setSource = (source, input) => {
  const { module } = runtime
  withArray(module, module.HEAPF32, input.reverbScale, reverbScale =>
    module._sa_source_set_reflection_inputs(
      source,
      ...input.position,
      ...input.ahead,
      ...input.up,
      input.enabled ? 1 : 0,
      reverbScale,
    ))
}

const handlers = {
  'add-dynamic-mesh': (message) => {
    const { module, scene } = runtime
    const subScene = createHandle(module, out => module._sa_scene_create(runtime.context, out))
    const staticMesh = createStaticMesh(subScene, message.geometry, message.materialCount)
    module._sa_static_mesh_add(staticMesh, subScene)
    module._sa_scene_commit(subScene)
    const instance = createHandle(module, out =>
      withArray(module, module.HEAPF32, message.transform, transform =>
        module._sa_instanced_mesh_create(scene, subScene, transform, out)))
    meshes.set(message.id, { instance, staticMesh, subScene, type: 'dynamic' })
  },
  'add-source': (message) => {
    const { module, simulator } = runtime
    const source = createHandle(module, out =>
      module._sa_source_create(simulator, 2, out))
    sources.set(message.input.id, source)
    setSource(source, message.input)
  },
  'add-static-mesh': (message) => {
    const { module, scene } = runtime
    const mesh = createStaticMesh(scene, message.geometry, message.materialCount)
    module._sa_static_mesh_add(mesh, scene)
    meshes.set(message.id, { mesh, type: 'static' })
  },
  'commit-scene': () => {
    runtime.module._sa_scene_commit(runtime.scene)
    runtime.module._sa_simulator_commit(runtime.simulator)
    for (const release of pendingMeshReleases.splice(0))
      release()
  },
  'remove-mesh': (message) => {
    const entry = meshes.get(message.id)
    if (!entry)
      return
    const { module, scene } = runtime
    if (entry.type === 'static') {
      module._sa_static_mesh_remove(entry.mesh, scene)
      pendingMeshReleases.push(() => module._sa_static_mesh_release(entry.mesh))
    }
    else {
      module._sa_instanced_mesh_remove(entry.instance, scene)
      pendingMeshReleases.push(() => {
        module._sa_instanced_mesh_release(entry.instance)
        module._sa_static_mesh_release(entry.staticMesh)
        module._sa_scene_release(entry.subScene)
      })
    }
    meshes.delete(message.id)
  },
  'remove-source': (message) => {
    const source = sources.get(message.id)
    if (!source)
      return
    runtime.module._sa_source_release(source, runtime.simulator)
    sources.delete(message.id)
  },
  'run': () => {
    const { module, simulator } = runtime
    module._sa_simulator_run_reflections(simulator)
    const pointer = allocate(module, 3 * 4)
    const outputs = []
    for (const [id, source] of sources) {
      module._sa_source_get_reflection_outputs(source, pointer)
      const offset = pointer >>> 2
      outputs.push({
        id,
        reverbTimes: [
          module.HEAPF32[offset],
          module.HEAPF32[offset + 1],
          module.HEAPF32[offset + 2],
        ],
      })
    }
    module._free(pointer)
    postMessage({ outputs, type: 'result' })
  },
  'set-listener': (message) => {
    const { module, simulator } = runtime
    module._sa_simulator_set_listener(
      simulator,
      ...message.position,
      ...message.ahead,
      ...message.up,
      message.settings.rays,
      message.settings.bounces,
      message.settings.duration,
      message.settings.order,
      message.settings.irradianceMinDistance,
    )
  },
  'update-dynamic-mesh': (message) => {
    const entry = meshes.get(message.id)
    if (!entry || entry.type !== 'dynamic')
      return
    const { module, scene } = runtime
    withArray(module, module.HEAPF32, message.transform, transform =>
      module._sa_instanced_mesh_update_transform(entry.instance, scene, transform))
  },
  'update-source': (message) => {
    const source = sources.get(message.input.id)
    if (source)
      setSource(source, message.input)
  },
}

const initialize = async (message) => {
  const module = await createSteamAudioModule({ wasmBinary: message.wasmBinary })
  const context = createHandle(module, out => module._sa_context_create(out))
  const scene = createHandle(module, out => module._sa_scene_create(context, out))
  const settings = message.settings
  const simulator = createHandle(module, out => module._sa_simulator_create(
    context,
    scene,
    message.sampleRate,
    message.frameSize,
    message.maxSources,
    1,
    1,
    settings.maxRays,
    settings.diffuseSamples,
    settings.maxDuration,
    settings.maxOrder,
    1,
    out,
  ))
  runtime = { context, module, scene, simulator }
}

const dispose = () => {
  if (!runtime)
    return
  for (const id of [...sources.keys()])
    handlers['remove-source']({ id })
  for (const id of [...meshes.keys()])
    handlers['remove-mesh']({ id })
  handlers['commit-scene']()
  runtime.module._sa_simulator_release(runtime.simulator)
  runtime.module._sa_scene_release(runtime.scene)
  runtime.module._sa_context_release(runtime.context)
  postMessage({ type: 'disposed' })
  close()
}

let ready

onmessage = async ({ data }) => {
  try {
    if (data?.type === 'init') {
      ready = initialize(data)
      await ready
      return
    }
    await ready
    if (data?.type === 'dispose') {
      dispose()
      return
    }
    handlers[data?.type]?.(data)
  }
  catch (error) {
    postMessage({
      message: error instanceof Error ? error.message : String(error),
      type: 'error',
    })
  }
}
