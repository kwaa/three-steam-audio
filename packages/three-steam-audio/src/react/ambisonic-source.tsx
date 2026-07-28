/* eslint-disable react-refresh/only-export-components */
import type { ThreeElements } from '@react-three/fiber'
import type { Ref, RefObject } from 'react'
import type { Group, Object3D } from 'three'

import type { World } from '../three/world'
import type {
  AmbisonicSource,
  AmbisonicSourceSettings,
} from '../types'
import type { SteamAudioAmbisonicNode } from '../worker/audio-node'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react'
import { Quaternion } from 'three'

import { connectManagedAudioEdges } from '../worker/audio-connections'
import { useInternalContext } from './context'
import { RenderResourceCache } from './resource-cache'
import { setForwardedRef } from './shared'

interface AmbisonicSourceResource {
  node: SteamAudioAmbisonicNode
  source: AmbisonicSource
}

const sourceResources = new RenderResourceCache<World, AmbisonicSourceResource>()

const disposeSourceResource = (resource: AmbisonicSourceResource): void => {
  resource.node.dispose()
  resource.source.dispose()
}

const getSourceResource = (
  world: World,
  id: string,
  create: () => AmbisonicSourceResource,
): ReturnType<typeof sourceResources.get> =>
  sourceResources.get(world, id, create, disposeSourceResource)

export const useSteamAudioAmbisonicSource = (
  object: RefObject<null | Object3D>,
  settings?: AmbisonicSourceSettings,
): { node: SteamAudioAmbisonicNode, source: AmbisonicSource } => {
  const { register, world } = useInternalContext('useSteamAudioAmbisonicSource')
  const id = useId()
  const entry = getSourceResource(world, id, () => {
    const source = world.createAmbisonicSource(settings)
    return { node: world.createAmbisonicNode(source), source }
  })
  const api = entry.resource
  const orientation = useMemo(() => new Quaternion(), [])

  useEffect(
    () => sourceResources.retain(entry),
    [entry],
  )

  useEffect(() => {
    if (settings?.binaural === undefined)
      return
    api.source.setBinaural(settings.binaural)
  }, [api.source, settings?.binaural])

  useEffect(() => register('source', () => {
    const target = object.current
    if (!target)
      return
    target.getWorldQuaternion(orientation)
    api.source.setOrientation(orientation)
  }), [api.source, object, orientation, register])

  return api
}

export interface SteamAudioAmbisonicSourceApi {
  group: Group
  node: SteamAudioAmbisonicNode
  source: AmbisonicSource
}

export interface SteamAudioAmbisonicSourceProps extends Omit<ThreeElements['group'], 'ref'> {
  binaural?: boolean
  destination?: AudioNode | null
  input?: AudioNode | null
  onReady?: (api: SteamAudioAmbisonicSourceApi) => void
  ref?: Ref<Group>
  settings?: AmbisonicSourceSettings
}

export const SteamAudioAmbisonicSource = ({
  binaural,
  destination,
  input,
  onReady,
  ref,
  settings,
  ...groupProps
}: SteamAudioAmbisonicSourceProps) => {
  const groupRef = useRef<Group>(null)
  const { world } = useInternalContext('SteamAudioAmbisonicSource')
  const mergedSettings = useMemo<AmbisonicSourceSettings>(() => ({
    ...settings,
    binaural: binaural ?? settings?.binaural,
  }), [binaural, settings])
  const api = useSteamAudioAmbisonicSource(groupRef, mergedSettings)

  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group
    setForwardedRef(ref, group)
    if (group)
      onReady?.({ ...api, group })
  }, [api, onReady, ref])

  useEffect(() => {
    const output = destination === undefined ? world.audioContext.destination : destination
    return connectManagedAudioEdges(input, api.node, output)
  }, [api.node, destination, input, world.audioContext.destination])

  return <group {...groupProps} ref={setGroupRef} />
}

SteamAudioAmbisonicSource.displayName = 'SteamAudioAmbisonicSource'
