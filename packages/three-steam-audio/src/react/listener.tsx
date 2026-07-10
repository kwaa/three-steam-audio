import type { RefObject } from 'react'
import type { Object3D } from 'three'

import type { PerspectiveCorrectionSettings } from '../types'

import { useEffect } from 'react'

import { useInternalContext } from './context'

export interface SteamAudioListenerProps {
  object?: RefObject<null | Object3D>
  perspectiveCorrection?: boolean | Omit<PerspectiveCorrectionSettings, 'enabled'>
}

export const SteamAudioListener = ({ object, perspectiveCorrection }: SteamAudioListenerProps) => {
  const { listenerObjectRef, setListenerMounted, world } = useInternalContext('SteamAudioListener')

  useEffect(() => {
    listenerObjectRef.current = object
    setListenerMounted(true)
    return () => {
      setListenerMounted(false)
      listenerObjectRef.current = undefined
    }
  }, [object, setListenerMounted, listenerObjectRef])

  useEffect(() => {
    if (perspectiveCorrection === undefined)
      return
    world.setPerspectiveCorrection(perspectiveCorrection === false
      ? false
      : {
          ...(perspectiveCorrection === true ? {} : perspectiveCorrection),
          enabled: true,
        })
  }, [perspectiveCorrection, world])

  return null
}
