/* eslint-disable react-refresh/only-export-components */
import type { ThreeElements } from '@react-three/fiber'
import type { Ref, RefObject } from 'react'
import type { Group, Object3D } from 'three'

import type { World } from '../three/world'
import type {
  Source,
  SourceSettings,
} from '../types'
import type { SteamAudioNode } from '../worker/audio-node'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react'
import { Quaternion, Vector3 } from 'three'

import { connectManagedAudioEdges } from '../worker/audio-connections'
import { useInternalContext } from './context'
import { useSteamAudioEnvironment } from './environment'
import { RenderResourceCache } from './resource-cache'
import { setForwardedRef } from './shared'

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
    if (!settings)
      return
    api.source.setSettings(settings)
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
  ref?: Ref<Group>
  reflections?: SourceSettings['reflections']
  reflectionSend?: number
  reverbSend?: number
  settings?: SourceSettings
  spatialBlend?: number
  transmission?: 'frequency-dependent' | 'frequency-independent' | boolean
}

export const SteamAudioSource = ({
  airAbsorption,
  destination,
  directivity,
  hrtf,
  input,
  occlusion,
  onReady,
  ref,
  reflections,
  reflectionSend,
  reverbSend,
  settings,
  spatialBlend,
  transmission,
  ...groupProps
}: SteamAudioSourceProps) => {
  const groupRef = useRef<Group>(null)
  const { world } = useInternalContext('SteamAudioSource')
  const environment = useSteamAudioEnvironment()
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
      reflections: reflections ?? settings?.reflections,
      spatialBlend: spatialBlend ?? settings?.spatialBlend,
    }
  }, [airAbsorption, directivity, hrtf, occlusion, reflections, settings, spatialBlend, transmission])
  const api = useSteamAudioSource(groupRef, mergedSettings)

  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group
    setForwardedRef(ref, group)
    if (group) {
      onReady?.({ ...api, group })
    }
  }, [api, onReady, ref])

  useEffect(() => {
    const output = destination === undefined ? world.audioContext.destination : destination
    return connectManagedAudioEdges(input, api.node, output)
  }, [api.node, destination, input, world.audioContext.destination])

  useEffect(() => {
    if (!environment.reflectionBus || reflectionSend === undefined)
      return
    const connection = api.node.connectReflections(
      environment.reflectionBus,
      { gain: reflectionSend },
    )
    return () => connection.disconnect()
  }, [api.node, environment.reflectionBus, reflectionSend])

  useEffect(() => {
    if (!environment.reverbBus || reverbSend === undefined)
      return
    const connection = api.node.connectReverb(
      environment.reverbBus,
      { gain: reverbSend },
    )
    return () => connection.disconnect()
  }, [api.node, environment.reverbBus, reverbSend])

  return <group {...groupProps} ref={setGroupRef} />
}

SteamAudioSource.displayName = 'SteamAudioSource'
