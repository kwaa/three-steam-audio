import { Sky } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { BvhPhysicsBody, BvhPhysicsWorld, PrototypeBox, SimpleCharacter } from '@react-three/viverse'

export const App = () => {
  return (
    <Canvas shadows>
      <BvhPhysicsWorld>
        <Sky />
        <directionalLight castShadow intensity={1.2} position={[5, 10, 10]} />
        <ambientLight intensity={1} />
        <SimpleCharacter />
        <BvhPhysicsBody>
          <PrototypeBox position={[0, -0.5, 0]} scale={[10, 1, 15]} />
        </BvhPhysicsBody>
      </BvhPhysicsWorld>
    </Canvas>
  )
}
