/* eslint-disable react-refresh/only-export-components */
import type { RootState } from '@react-three/fiber'
import type { ReactNode } from 'react'

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

import { createWorldFromRuntime } from '../three/world'
import { defaultModuleFactory, getPreparedRuntimePromise } from '../worker/runtime'
import { RenderResourceCache } from './resource-cache'

export interface InternalContextValue {
  listener: Listener
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

export type SyncKind = 'dynamic' | 'listener' | 'source'

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

interface ProviderProps extends SteamAudioCommonProps {
  world: World
}

const SteamAudioProvider = ({
  children,
  paused = false,
  updatePriority = -100,
  world,
}: ProviderProps) => {
  const synchronizersRef = useRef<Record<SyncKind, Set<Synchronizer>>>({
    dynamic: new Set(),
    listener: new Set(),
    source: new Set(),
  })
  const listenerCountRef = useRef(0)

  const register = useCallback((kind: SyncKind, synchronizer: Synchronizer) => {
    synchronizersRef.current[kind].add(synchronizer)
    return () => synchronizersRef.current[kind].delete(synchronizer)
  }, [])

  const setListenerMounted = useCallback((mounted: boolean) => {
    if (mounted && listenerCountRef.current > 0)
      throw new Error('Only one <SteamAudioListener> may be mounted per <SteamAudio>')
    listenerCountRef.current += mounted ? 1 : -1
  }, [])

  useFrame((state, delta) => {
    if (paused)
      return
    state.scene.updateWorldMatrix(true, true)
    for (const synchronizer of synchronizersRef.current.listener) synchronizer(state)
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
