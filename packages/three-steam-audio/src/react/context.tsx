/* eslint-disable react-refresh/only-export-components */
import type { RootState } from '@react-three/fiber'
import type { ReactNode, RefObject } from 'react'
import type { Object3D } from 'three'

import type { World } from '../three/world'
import type {
  Listener,
  WorldOptions,
} from '../types'

import { useFrame } from '@react-three/fiber'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react'
import { Camera, Quaternion, Vector3 } from 'three'

import { createWorldFromRuntime } from '../three/world'
import { defaultModuleFactory, getPreparedRuntimePromise } from '../worker/runtime'
import { RenderResourceCache } from './resource-cache'

export interface InternalContextValue {
  listener: Listener
  listenerObjectRef: RefObject<RefObject<null | Object3D> | undefined>
  register: (kind: SyncKind, synchronizer: Synchronizer) => () => void
  scene: World['scene']
  setListenerMounted: (mounted: boolean) => void
  world: World
}
export interface SteamAudioContextValue {
  listener: Listener
  scene: World['scene']
  world: World
}

export type Synchronizer = (state: RootState) => void

export type SyncKind = 'dynamic' | 'source'

const SteamAudioContext = createContext<InternalContextValue | null>(null)

export const useInternalContext = (component: string): InternalContextValue => {
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

interface ListenerCameraBinding {
  camera: Camera | null
  world: World
}

interface ProviderProps extends SteamAudioCommonProps {
  world: World
}

export const hasChangedListenerCameraBinding = (
  previous: ListenerCameraBinding | null,
  camera: Camera | null,
  world: World,
): boolean => previous?.camera !== camera || previous?.world !== world

const SteamAudioProvider = ({
  children,
  paused = false,
  updatePriority = -100,
  world,
}: ProviderProps) => {
  const synchronizersRef = useRef<Record<SyncKind, Set<Synchronizer>>>({
    dynamic: new Set(),
    source: new Set(),
  })
  const listenerCountRef = useRef(0)
  const previousCameraRef = useRef<ListenerCameraBinding | null>(null)
  const warnedRef = useRef(false)
  const listenerObjectRef = useRef<RefObject<null | Object3D> | undefined>(undefined)
  const listenerPosition = useMemo(() => new Vector3(), [])
  const listenerOrientation = useMemo(() => new Quaternion(), [])

  const register = useCallback((kind: SyncKind, synchronizer: Synchronizer) => {
    synchronizersRef.current[kind].add(synchronizer)
    return () => synchronizersRef.current[kind].delete(synchronizer)
  }, [])

  const setListenerMounted = useCallback((mounted: boolean) => {
    if (mounted && listenerCountRef.current > 0)
      throw new Error('Only one <SteamAudioListener> may be mounted per <SteamAudio>')
    listenerCountRef.current += mounted ? 1 : -1
  }, [])

  const syncListener = (state: RootState): void => {
    const object = listenerObjectRef.current
    if (object && !object.current) {
      if (!warnedRef.current) {
        warnedRef.current = true
        console.warn('SteamAudioListener object ref is null; retaining the last listener transform')
      }
      return
    }
    const target = state.gl.xr.isPresenting
      ? state.gl.xr.getCamera()
      : object?.current ?? state.camera
    target.getWorldPosition(listenerPosition)
    target.getWorldQuaternion(listenerOrientation)
    const camera = target instanceof Camera ? target : null
    const previous = previousCameraRef.current
    if (hasChangedListenerCameraBinding(previous, camera, world)) {
      previousCameraRef.current = { camera, world }
      world.listener.setCamera(camera)
    }
    world.listener.setTransform(listenerPosition, listenerOrientation)
  }

  useFrame((state, delta) => {
    if (paused)
      return
    state.scene.updateWorldMatrix(true, true)

    if (listenerCountRef.current > 0)
      syncListener(state)

    for (const synchronizer of synchronizersRef.current.dynamic) synchronizer(state)
    for (const synchronizer of synchronizersRef.current.source) synchronizer(state)
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
    listenerObjectRef,
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
