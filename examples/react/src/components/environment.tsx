/* eslint-disable react/no-array-index-key */
import { Sky } from '@react-three/drei'
import { BvhPhysicsBody, PrototypeBox } from '@react-three/viverse'
import { Materials } from 'three-steam-audio'
import { AcousticMesh } from 'three-steam-audio/react'

const roomBoxes = [
  { color: '#b8b8b8', position: [0, -0.25, 0], scale: [16, 0.5, 12] },
  { color: '#8aa0aa', position: [0, 4.25, 0], scale: [16, 0.5, 12] },
  { color: '#c7a6a6', position: [-8.25, 2, 0], scale: [0.5, 4, 12] },
  { color: '#a6b8c7', position: [8.25, 2, 0], scale: [0.5, 4, 12] },
  { color: '#b7a6c7', position: [0, 2, -6.25], scale: [16, 4, 0.5] },
  { color: '#a6c7b1', position: [0, 2, 6.25], scale: [16, 4, 0.5] },
] as const

const dividerBoxes = [
  { color: '#705f68', position: [0, 2, -1.5], scale: [0.5, 4, 7] },
  { color: '#705f68', position: [0, 2, 5], scale: [0.5, 4, 2] },
] as const

const wallMaterial = {
  absorption: [0.08, 0.05, 0.03],
  scattering: 0.1,
  transmission: [0.12, 0.035, 0.008],
} as const

export const Environment = () => {
  return (
    <>
      <Sky />
      <directionalLight castShadow intensity={1.2} position={[5, 10, 10]} />
      <ambientLight intensity={1} />
      <AcousticMesh material={Materials.concrete}>
        {roomBoxes.map(({ color, position, scale }) => (
          <PrototypeBox
            color={color}
            key={color}
            position={position}
            scale={scale}
          />
        ))}
      </AcousticMesh>
      <AcousticMesh material={wallMaterial}>
        {dividerBoxes.map(({ color, position, scale }, index) => (
          <PrototypeBox
            color={color}
            key={index}
            position={position}
            scale={scale}
          />
        ))}
      </AcousticMesh>
      <BvhPhysicsBody>
        {[...roomBoxes, ...dividerBoxes].map(({ position, scale }, index) => (
          <mesh key={index} position={position} scale={scale}>
            <boxGeometry />
            <meshBasicMaterial colorWrite={false} depthWrite={false} />
          </mesh>
        ))}
      </BvhPhysicsBody>
    </>
  )
}
