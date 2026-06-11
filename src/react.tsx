/* eslint-disable react-refresh/only-export-components */
import type { RootState, ThreeElements } from '@react-three/fiber'
import type { ForwardedRef, ReactNode, RefObject } from 'react'
import type { Group, Mesh, Object3D } from 'three'

import type { SteamAudioNode } from './audio-node'
import type {
  AcousticMaterial,
  DynamicAcousticMeshHandle,
  Listener,
  Source,
  SourceSettings,
  WorldOptions,
} from './types'
import type { World } from './world'

import { useFrame, useThree } from '@react-three/fiber'
import {
  createContext,
  forwardRef,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { Quaternion, Vector3 } from 'three'

import { connectManagedAudioEdges } from './audio-connections'
import { RenderResourceCache } from './resource-cache'
import { defaultModuleFactory, getPreparedRuntimePromise } from './runtime'
import { createWorldFromRuntime } from './world'

export interface SteamAudioContextValue {
  listener: Listener
  scene: World['scene']
  world: World
}
interface InternalContextValue {
  listener: Listener
  register: (kind: SyncKind, synchronizer: Synchronizer) => () => void
  scene: World['scene']
  setListenerMounted: (mounted: boolean) => void
  world: World
}

type Synchronizer = (state: RootState) => void

type SyncKind = 'dynamic' | 'listener' | 'source'

const SteamAudioContext = createContext<InternalContextValue | null>(null)

const useInternalContext = (component: string): InternalContextValue => {
  const value = use(SteamAudioContext)
  if (!value)
    throw new Error(`${component} must be used inside <SteamAudio>`)
  return value
}

export const useSteamAudio = (): SteamAudioContextValue => {
  const { listener, scene, world } = useInternalContext('useSteamAudio')
  return { listener, scene, world }
}

export interface SteamAudioCommonProps {
  children?: ReactNode
  paused?: boolean
  updatePriority?: number
}

export type SteamAudioProps
  = | (SteamAudioCommonProps & {
    audioContext: AudioContext
    options?: Omit<WorldOptions, 'audioContext'>
    world?: never
  })
  | (SteamAudioCommonProps & {
    audioContext?: never
    options?: never
    world: World
  })

interface ProviderProps extends SteamAudioCommonProps {
  world: World
}

const SteamAudioProvider = ({
  children,
  paused = false,
  updatePriority = -100,
  world,
}: ProviderProps) => {
  const synchronizers = useRef<Record<SyncKind, Set<Synchronizer>>>({
    dynamic: new Set(),
    listener: new Set(),
    source: new Set(),
  })
  const listenerCount = useRef(0)

  const register = useCallback((kind: SyncKind, synchronizer: Synchronizer) => {
    synchronizers.current[kind].add(synchronizer)
    return () => synchronizers.current[kind].delete(synchronizer)
  }, [])

  const setListenerMounted = useCallback((mounted: boolean) => {
    if (mounted && listenerCount.current > 0)
      throw new Error('Only one <SteamAudioListener> may be mounted per <SteamAudio>')
    listenerCount.current += mounted ? 1 : -1
  }, [])

  useFrame((state, delta) => {
    if (paused)
      return
    state.scene.updateWorldMatrix(true, true)
    for (const synchronizer of synchronizers.current.listener) synchronizer(state)
    for (const synchronizer of synchronizers.current.dynamic) synchronizer(state)
    for (const synchronizer of synchronizers.current.source) synchronizer(state)
    world.scene.commit()
    world.step(delta)
  }, updatePriority)

  useEffect(() => () => {
    queueMicrotask(() => {
      try {
        world.scene.commit()
      }
      catch {}
    })
  }, [world])

  const value = useMemo<InternalContextValue>(() => ({
    listener: world.listener,
    register,
    scene: world.scene,
    setListenerMounted,
    world,
  }), [register, setListenerMounted, world])

  return (
    <SteamAudioContext value={value}>
      {children}
    </SteamAudioContext>
  )
}

const ownedWorlds = new RenderResourceCache<AudioContext, World>()

const getOwnedWorld = (
  id: string,
  props: Extract<SteamAudioProps, { audioContext: AudioContext }>,
  runtime: Parameters<typeof createWorldFromRuntime>[0],
): ReturnType<typeof ownedWorlds.get> => {
  const moduleFactory = props.options?.moduleFactory ?? defaultModuleFactory
  return ownedWorlds.get(
    props.audioContext,
    id,
    () => createWorldFromRuntime(runtime, {
      ...props.options,
      audioContext: props.audioContext,
      moduleFactory,
    }),
    world => world.dispose(),
  )
}

const SteamAudioOwned = (
  props: Extract<SteamAudioProps, { audioContext: AudioContext }>,
) => {
  const moduleFactory = props.options?.moduleFactory ?? defaultModuleFactory
  const runtime = use(getPreparedRuntimePromise(props.audioContext, moduleFactory))
  const id = useId()
  const entry = getOwnedWorld(id, props, runtime)
  useEffect(
    () => ownedWorlds.retain(entry),
    [entry],
  )
  return <SteamAudioProvider {...props} world={entry.resource} />
}

export const SteamAudio = (props: SteamAudioProps) => {
  if (props.world)
    return <SteamAudioProvider {...props} world={props.world} />
  return <SteamAudioOwned {...props} />
}

export interface SteamAudioListenerProps {
  object?: RefObject<null | Object3D>
}

export const SteamAudioListener = ({ object }: SteamAudioListenerProps) => {
  const { listener, register, setListenerMounted } = useInternalContext('SteamAudioListener')
  const camera = useThree(state => state.camera)
  const position = useMemo(() => camera.position.clone(), [camera])
  const orientation = useMemo(() => camera.quaternion.clone(), [camera])
  const warned = useRef(false)

  useEffect(() => {
    setListenerMounted(true)
    return () => setListenerMounted(false)
  }, [setListenerMounted])

  useEffect(() => register('listener', (state) => {
    let target = object?.current ?? camera
    if (object && !object.current) {
      if (!warned.current) {
        warned.current = true
        console.warn('SteamAudioListener object ref is null; retaining the last listener transform')
      }
      return
    }
    if (state.gl.xr.isPresenting)
      target = state.gl.xr.getCamera()
    target.getWorldPosition(position)
    target.getWorldQuaternion(orientation)
    listener.setTransform(position, orientation)
  }), [camera, listener, object, orientation, position, register])

  return null
}

interface SourceResource {
  node: SteamAudioNode
  source: Source
}

const sourceResources = new RenderResourceCache<World, SourceResource>()

const disposeSourceResource = (resource: SourceResource): void => {
  resource.node.dispose()
  resource.source.dispose()
}

const getSourceResource = (
  world: World,
  id: string,
  create: () => SourceResource,
): ReturnType<typeof sourceResources.get> =>
  sourceResources.get(world, id, create, disposeSourceResource)

export const useSteamAudioSource = (
  object: RefObject<null | Object3D>,
  settings?: SourceSettings,
): { node: SteamAudioNode, source: Source } => {
  const { register, world } = useInternalContext('useSteamAudioSource')
  const id = useId()
  const entry = getSourceResource(world, id, () => {
    const source = world.createSource(settings)
    return { node: world.createNode(source), source }
  })
  const api = entry.resource
  const position = useMemo(() => new Vector3(), [])
  const orientation = useMemo(() => new Quaternion(), [])

  useEffect(
    () => sourceResources.retain(entry),
    [entry],
  )

  useEffect(() => {
    if (settings) {
      api.source.setSettings(settings)
    }
  }, [api.source, settings])

  useEffect(() => register('source', () => {
    const target = object.current
    if (!target)
      return
    target.getWorldPosition(position)
    target.getWorldQuaternion(orientation)
    api.source.setTransform(position, orientation)
  }), [api.source, object, orientation, position, register])

  return api
}

const setForwardedRef = <T,>(ref: ForwardedRef<T>, value: null | T): void => {
  if (typeof ref === 'function')
    ref(value)
  else if (ref)
    ref.current = value
}

export interface SteamAudioSourceApi {
  group: Group
  node: SteamAudioNode
  source: Source
}

export interface SteamAudioSourceProps extends Omit<ThreeElements['group'], 'ref'> {
  airAbsorption?: boolean
  destination?: AudioNode | null
  directivity?: SourceSettings['directivity']
  hrtf?: boolean
  input?: AudioNode | null
  occlusion?: 'raycast' | 'volumetric' | false
  onReady?: (api: SteamAudioSourceApi) => void
  settings?: SourceSettings
  spatialBlend?: number
  transmission?: 'frequency-dependent' | 'frequency-independent' | boolean
}

export const SteamAudioSource = forwardRef<Group, SteamAudioSourceProps>(({
  airAbsorption,
  destination,
  directivity,
  hrtf,
  input,
  occlusion,
  onReady,
  settings,
  spatialBlend,
  transmission,
  ...groupProps
}, forwardedRef) => {
  const groupRef = useRef<Group>(null)
  const { world } = useInternalContext('SteamAudioSource')
  const mergedSettings = useMemo<SourceSettings>(() => {
    const direct = typeof settings?.directSimulation === 'object'
      ? settings.directSimulation
      : {}
    const hasDirectProps = airAbsorption !== undefined
      || occlusion !== undefined
      || transmission !== undefined
    const directSimulation = settings?.directSimulation === false && !hasDirectProps
      ? false
      : {
          ...direct,
          airAbsorption: airAbsorption ?? direct.airAbsorption,
          occlusion: occlusion ?? direct.occlusion,
          transmission: transmission === undefined
            ? direct.transmission
            : transmission === false
              ? false
              : {
                  type: transmission === true ? 'frequency-independent' : transmission,
                },
        }
    return {
      ...settings,
      directivity: directivity ?? settings?.directivity,
      directSimulation,
      hrtf: hrtf ?? settings?.hrtf,
      spatialBlend: spatialBlend ?? settings?.spatialBlend,
    }
  }, [airAbsorption, directivity, hrtf, occlusion, settings, spatialBlend, transmission])
  const api = useSteamAudioSource(groupRef, mergedSettings)

  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group
    setForwardedRef(forwardedRef, group)
  }, [forwardedRef])

  useEffect(() => {
    const output = destination === undefined ? world.audioContext.destination : destination
    return connectManagedAudioEdges(input, api.node, output)
  }, [api.node, destination, input, world.audioContext.destination])

  useEffect(() => {
    if (groupRef.current) {
      onReady?.({ ...api, group: groupRef.current })
    }
  }, [api, onReady])

  return <group {...groupProps} ref={setGroupRef} />
})
SteamAudioSource.displayName = 'SteamAudioSource'

export interface AcousticMeshProps extends Omit<ThreeElements['group'], 'ref'> {
  dynamic?: boolean
  material:
    | ((mesh: Mesh) => AcousticMaterial | readonly AcousticMaterial[])
    | AcousticMaterial
    | readonly AcousticMaterial[]
}

interface AcousticEntry {
  dynamic: boolean
  geometry: Mesh['geometry']
  handle: World['scene'] extends never ? never : ReturnType<World['scene']['addStaticMesh']>
  material: AcousticMaterial | readonly AcousticMaterial[]
  mesh: Mesh
}

export const AcousticMesh = forwardRef<Group, AcousticMeshProps>(({
  dynamic = false,
  material,
  ...groupProps
}, forwardedRef) => {
  const groupRef = useRef<Group>(null)
  const entries = useRef(new Map<Mesh, AcousticEntry>())
  const { register, scene } = useInternalContext('AcousticMesh')

  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group
    setForwardedRef(forwardedRef, group)
  }, [forwardedRef])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group)
      return
    const present = new Set<Mesh>()
    group.updateWorldMatrix(true, true)
    group.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh)
        return
      if ((mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh)
        throw new Error('AcousticMesh does not support SkinnedMesh in the MVP')
      if (mesh.morphTargetInfluences !== undefined && mesh.morphTargetInfluences.length > 0)
        throw new Error('AcousticMesh does not support morph targets in the MVP')
      present.add(mesh)
      const resolvedMaterial = typeof material === 'function' ? material(mesh) : material
      const previous = entries.current.get(mesh)
      if (
        previous
        && previous.dynamic === dynamic
        && previous.geometry === mesh.geometry
        && previous.material === resolvedMaterial
      ) {
        return
      }
      const replacement = dynamic
        ? scene.addDynamicMesh({
            geometry: mesh.geometry,
            material: resolvedMaterial,
            matrixWorld: mesh.matrixWorld,
          })
        : scene.addStaticMesh({
            geometry: mesh.geometry,
            material: resolvedMaterial,
            matrixWorld: mesh.matrixWorld,
          })
      previous?.handle.dispose()
      entries.current.set(mesh, {
        dynamic,
        geometry: mesh.geometry,
        handle: replacement,
        material: resolvedMaterial,
        mesh,
      })
    })
    for (const [mesh, entry] of entries.current) {
      if (!present.has(mesh)) {
        entry.handle.dispose()
        entries.current.delete(mesh)
      }
    }
  })

  useEffect(() => register('dynamic', () => {
    for (const entry of entries.current.values()) {
      if (entry.dynamic)
        (entry.handle as DynamicAcousticMeshHandle).setTransform(entry.mesh.matrixWorld)
    }
  }), [register])

  useEffect(() => () => {
    for (const entry of entries.current.values())
      entry.handle.dispose()
    entries.current.clear()
  }, [])

  return <group {...groupProps} ref={setGroupRef} />
})
AcousticMesh.displayName = 'AcousticMesh'

export type { World }
