import type { RefObject } from 'react'
import type { Object3D } from 'three'

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'

import { useInternalContext } from './context'

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
