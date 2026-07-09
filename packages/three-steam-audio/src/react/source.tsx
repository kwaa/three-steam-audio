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
  airAbsorption?: SourceSettings['direct'] extends false ? never : boolean
  destination?: AudioNode | null
  direct?: SourceSettings['direct']
  directivity?: SourceSettings['direct'] extends false ? never : NonNullable<Exclude<SourceSettings['direct'], false>>['directivity']
  input?: AudioNode | null
  occlusion?: NonNullable<Exclude<SourceSettings['direct'], false>>['occlusion']
  onReady?: (api: SteamAudioSourceApi) => void
  ref?: Ref<Group>
  reflections?: SourceSettings['reflections']
  reflectionsSend?: number
  reverbSend?: number
  settings?: SourceSettings
  spatialization?: SourceSettings['spatialization']
  transmission?: 'frequency-dependent' | 'frequency-independent' | boolean
}

type SourceDirectSettings = Exclude<NonNullable<SourceSettings['direct']>, false>

const directObject = (direct: SourceSettings['direct'] | undefined): SourceDirectSettings =>
  typeof direct === 'object' ? direct : {}

/* eslint-disable sonarjs/function-return-type -- API uses false to disable transmission. */
const transmissionSetting = (
  transmission: SteamAudioSourceProps['transmission'],
  fallback: SourceDirectSettings['transmission'],
): SourceDirectSettings['transmission'] => {
  if (transmission === undefined)
    return fallback
  if (transmission === false)
    return false
  return {
    type: transmission === true ? 'frequency-independent' : transmission,
  }
}
/* eslint-enable sonarjs/function-return-type */

const mergeSourceSettings = (
  settings: SourceSettings | undefined,
  props: Pick<
    SteamAudioSourceProps,
    | 'airAbsorption'
    | 'direct'
    | 'directivity'
    | 'occlusion'
    | 'reflections'
    | 'spatialization'
    | 'transmission'
  >,
): SourceSettings => {
  const settingsDirect = directObject(settings?.direct)
  const propDirect = directObject(props.direct)
  const hasDirectProps = props.airAbsorption !== undefined
    || props.direct !== undefined
    || props.directivity !== undefined
    || props.occlusion !== undefined
    || props.transmission !== undefined
  const direct = settings?.direct === false && !hasDirectProps
    ? false
    : {
        ...settingsDirect,
        ...propDirect,
        airAbsorption: props.airAbsorption ?? propDirect.airAbsorption ?? settingsDirect.airAbsorption,
        directivity: props.directivity ?? propDirect.directivity ?? settingsDirect.directivity,
        occlusion: props.occlusion ?? propDirect.occlusion ?? settingsDirect.occlusion,
        transmission: transmissionSetting(
          props.transmission,
          propDirect.transmission ?? settingsDirect.transmission,
        ),
      }
  return {
    ...settings,
    direct,
    reflections: props.reflections ?? settings?.reflections,
    spatialization: props.spatialization ?? settings?.spatialization,
  }
}

export const SteamAudioSource = ({
  airAbsorption,
  destination,
  direct,
  directivity,
  input,
  occlusion,
  onReady,
  ref,
  reflections,
  reflectionsSend,
  reverbSend,
  settings,
  spatialization,
  transmission,
  ...groupProps
}: SteamAudioSourceProps) => {
  const groupRef = useRef<Group>(null)
  const { world } = useInternalContext('SteamAudioSource')
  const environment = useSteamAudioEnvironment()
  const mergedSettings = useMemo<SourceSettings>(() => mergeSourceSettings(settings, {
    airAbsorption,
    direct,
    directivity,
    occlusion,
    reflections,
    spatialization,
    transmission,
  }), [airAbsorption, direct, directivity, occlusion, reflections, settings, spatialization, transmission])
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
    if (!environment.reflectionBus || reflectionsSend === undefined)
      return
    const connection = api.node.connectReflections(
      environment.reflectionBus,
      { gain: reflectionsSend },
    )
    return () => connection.disconnect()
  }, [api.node, environment.reflectionBus, reflectionsSend])

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
