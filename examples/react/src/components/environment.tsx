import { Sky } from '@react-three/drei'
import { BvhPhysicsBody, PrototypeBox } from '@react-three/viverse'
import { Materials } from 'three-steam-audio'
import { AcousticMesh } from 'three-steam-audio/react'

export const Environment = () => {
  return (
    <>
      <Sky />
      <directionalLight castShadow intensity={1.2} position={[5, 10, 10]} />
      <ambientLight intensity={1} />
      <BvhPhysicsBody>
        <AcousticMesh material={Materials.concrete}>
          <PrototypeBox position={[0, -0.5, 0]} scale={[100, 1, 100]} />

          <PrototypeBox color="#cccccc" position={[3.91, 0, 0]} scale={[2, 1, 3]} />
          <PrototypeBox color="#ffccff" position={[2.92, 1.5, -1.22]} scale={[3, 1, 3]} />
          <PrototypeBox color="#ccffff" position={[1.92, 2.5, -3.22]} scale={[2, 0.5, 3]} />
          <PrototypeBox color="#ffccff" position={[-2.92, 0, -2.22]} scale={[2, 1, 3]} />
          <PrototypeBox color="#ccffff" position={[0.08, -1, 0]} scale={[1, 1, 4]} />
          <PrototypeBox color="#ffffcc" position={[0.08, 3.5, 0]} scale={[4, 1, 1]} />
          <PrototypeBox color="#ffffff" position={[0.08, -2, 0]} scale={[10, 0.5, 10]} />
        </AcousticMesh>
      </BvhPhysicsBody>
    </>
  )
}
