/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'

import type {
  ReflectionBusSettings,
  ReverbBusSettings,
  ReverbSettings,
} from '../types'
import type {
  ReflectionBusNode,
  ReverbBusNode,
} from '../worker/audio-node'

import {
  createContext,
  use,
  useEffect,
  useId,
  useMemo,
} from 'react'

import { useInternalContext } from './context'
import { RenderResourceCache } from './resource-cache'

interface EnvironmentResource extends EnvironmentValue {
  dispose: () => void
}

interface EnvironmentValue {
  reflectionBus?: ReflectionBusNode
  reverbBus?: ReverbBusNode
}

const EnvironmentContext = createContext<EnvironmentValue | null>(null)
const resources = new RenderResourceCache<object, EnvironmentResource>()

export interface SteamAudioEnvironmentProps {
  children?: ReactNode
  destination?: AudioNode | null
  reflections?: boolean | ReflectionBusSettings
  reverb?: false | (ReverbBusSettings & ReverbSettings)
}

export const useSteamAudioEnvironment = (): EnvironmentValue =>
  use(EnvironmentContext) ?? {}

export const SteamAudioEnvironment = ({
  children,
  destination,
  reflections = true,
  reverb = false,
}: SteamAudioEnvironmentProps) => {
  const { world } = useInternalContext('SteamAudioEnvironment')
  const id = useId()
  const entry = resources.get(
    world,
    id,
    () => {
      const reflectionBus = reflections !== false
        ? world.createReflectionBus(reflections === true ? undefined : reflections)
        : undefined
      const reverbBus = reverb !== false
        ? world.createReverbBus(reverb)
        : undefined
      return {
        dispose: () => {
          reflectionBus?.dispose()
          reverbBus?.dispose()
        },
        reflectionBus,
        reverbBus,
      }
    },
    resource => resource.dispose(),
  )

  useEffect(() => resources.retain(entry), [entry])

  useEffect(() => {
    world.listener.setReverb(reverb !== false
      ? {
          enabled: reverb.enabled,
          reverbScale: reverb.reverbScale,
        }
      : false)
    return () => world.listener.setReverb(false)
  }, [reverb, world.listener])

  useEffect(() => {
    const output = destination === undefined
      ? world.audioContext.destination
      : destination
    if (!output)
      return
    entry.resource.reflectionBus?.connect(output)
    entry.resource.reverbBus?.connect(output)
    return () => {
      try {
        entry.resource.reflectionBus?.disconnect(output)
      }
      catch {}
      try {
        entry.resource.reverbBus?.disconnect(output)
      }
      catch {}
    }
  }, [destination, entry.resource, world.audioContext.destination])

  const value = useMemo<EnvironmentValue>(() => ({
    reflectionBus: entry.resource.reflectionBus,
    reverbBus: entry.resource.reverbBus,
  }), [entry.resource])

  return (
    <EnvironmentContext value={value}>
      {children}
    </EnvironmentContext>
  )
}
