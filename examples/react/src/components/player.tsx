import type { Group } from 'three'

import { useFrame } from '@react-three/fiber'
import { FirstPersonCharacterCameraBehavior, SimpleCharacter, useXRControllerLocomotionActionBindings } from '@react-three/viverse'
import { useXR, useXRInputSourceState, XROrigin } from '@react-three/xr'
import { useRef } from 'react'

const spawnPosition = [-4, 0, -2] as const

// https://pmndrs.github.io/viverse/tutorials/augmented-and-virtual-reality#step-4:-place-the-xrorigin-into-the-simple-character-and-optionally-add-snap-rotation
const SnapRotateXROrigin = () => {
  const ref = useRef<Group>(null)
  const rightController = useXRInputSourceState('controller', 'right')
  const prevRef = useRef(0)

  useFrame(() => {
    if (ref.current == null)
      return

    const current = Math.round(rightController?.gamepad?.['xr-standard-thumbstick']?.xAxis ?? 0)
    if (current < 0 && prevRef.current >= 0)
      // rotate left
      ref.current.rotation.y += Math.PI / 2

    if (current > 0 && prevRef.current <= 0)
      // rotate right
      ref.current.rotation.y -= Math.PI / 2

    prevRef.current = current
  })

  return <XROrigin ref={ref} />
}

export const Player = () => {
  const inSession = useXR(state => state.session != null)

  // https://pmndrs.github.io/viverse/tutorials/augmented-and-virtual-reality#step-4:-use-xr-controller-action-bindings
  useXRControllerLocomotionActionBindings()

  // https://pmndrs.github.io/viverse/tutorials/simple-game#step-5:-adding-respawn-logic
  const playerRef = useRef<Group>(null)
  useFrame(() => {
    if (playerRef.current == null)
      return

    if (playerRef.current.position.y < -10)
      playerRef.current.position.fromArray(spawnPosition)
  })

  return (
    <SimpleCharacter
      // https://pmndrs.github.io/viverse/tutorials/first-person
      cameraBehavior={inSession ? false : FirstPersonCharacterCameraBehavior}
      model={false}
      position={spawnPosition}
      ref={playerRef}
    >
      <SnapRotateXROrigin />
    </SimpleCharacter>
  )
}
