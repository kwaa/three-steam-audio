import type { Group } from 'three'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { SteamAudioSource } from 'three-steam-audio/react'

export const SoundSource = ({ audioContext }: { audioContext: AudioContext }) => {
  const ref = useRef<Group>(null)
  const input = useMemo(() => {
    const audio = new Audio('/Snowfall (Looped ver.).ogg')
    audio.crossOrigin = 'anonymous'
    audio.loop = true
    void audio.play()
    return audioContext.createMediaElementSource(audio)
  }, [audioContext])

  useFrame(({ clock }) => {
    if (!ref.current)
      return
    const t = clock.getElapsedTime()
    ref.current.position.set(Math.sin(t) * 3, 1.5, Math.cos(t) * 3)
  })

  return (
    <SteamAudioSource
      airAbsorption
      hrtf
      input={input}
      occlusion="raycast"
      ref={ref}
      reflections
      reflectionSend={0.4}
      reverbSend={0.4}
    >
      <mesh>
        <sphereGeometry args={[0.2]} />
        <meshStandardMaterial color="#ff4444" emissive="#550000" />
      </mesh>
    </SteamAudioSource>
  )
}
