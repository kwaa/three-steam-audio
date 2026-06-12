import type { RefObject } from 'react'
import type { Object3D } from 'three'

import { useEffect } from 'react'

import { useInternalContext } from './context'

export interface SteamAudioListenerProps {
  object?: RefObject<null | Object3D>
}

export const SteamAudioListener = ({ object }: SteamAudioListenerProps) => {
  const { listenerObjectRef, setListenerMounted } = useInternalContext('SteamAudioListener')

  useEffect(() => {
    listenerObjectRef.current = object
    setListenerMounted(true)
    return () => {
      setListenerMounted(false)
      listenerObjectRef.current = undefined
    }
  }, [object, setListenerMounted, listenerObjectRef])

  return null
}
