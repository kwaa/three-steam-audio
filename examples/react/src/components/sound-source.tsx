import type { Group } from 'three'
import type { Source } from 'three-steam-audio'

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { SteamAudioSource } from 'three-steam-audio/react'

export interface AcousticMetrics {
  distance: number
  occlusion: number
  transmission: [number, number, number]
}

export const SoundSource = ({
  dryDestination,
  input,
  onMetrics,
  spatialDestination,
}: {
  dryDestination: AudioNode
  input: AudioNode
  onMetrics: (metrics: AcousticMetrics) => void
  spatialDestination: AudioNode
}) => {
  const ref = useRef<Group>(null)
  const sourceRef = useRef<Source>(null)
  const elapsedRef = useRef(0)

  useEffect(() => {
    input.connect(dryDestination)
    return () => input.disconnect(dryDestination)
  }, [dryDestination, input])

  useFrame((_, delta) => {
    elapsedRef.current += delta
    if (elapsedRef.current < 0.2 || !sourceRef.current)
      return
    elapsedRef.current = 0
    const outputs = sourceRef.current.getDirectOutputs()
    onMetrics({
      distance: outputs.distanceAttenuation,
      occlusion: outputs.occlusion,
      transmission: outputs.transmission,
    })
  })

  return (
    <SteamAudioSource
      airAbsorption
      destination={spatialDestination}
      hrtf
      input={input}
      occlusion="raycast"
      onReady={({ source }) => {
        sourceRef.current = source
      }}
      position={[4, 1.5, -2]}
      ref={ref}
      reflections
      reflectionSend={0.8}
      reverbSend={1.2}
      settings={{
        distanceAttenuation: {
          curve: distance => Math.max(0, 1 - distance / 18) ** 1.5,
          maxDistance: 18,
          minDistance: 1,
          model: 'curve',
        },
      }}
      transmission="frequency-dependent"
    >
      <mesh>
        <sphereGeometry args={[0.35]} />
        <meshStandardMaterial color="#ff2020" emissive="#aa0000" emissiveIntensity={2} />
        <pointLight color="#ff3333" distance={3} intensity={20} />
      </mesh>
    </SteamAudioSource>
  )
}
