import { Loader } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { BvhPhysicsWorld } from '@react-three/viverse'
import { createXRStore, XR } from '@react-three/xr'
import {
  Leva,
  // useControls,
} from 'leva'
import { Suspense } from 'react'

import { EnterVR } from './components/enter-vr'
import { Environment } from './components/environment'
import { Player } from './components/player'

export const App = () => {
  const store = createXRStore({ offerSession: 'immersive-vr' })
  // const { enableSteamAudio } = useControls({ enableSteamAudio: true })

  return (
    <>
      <Canvas shadows>
        <Suspense fallback={null}>
          <XR store={store}>
            <BvhPhysicsWorld>
              <Player />
              <Environment />
            </BvhPhysicsWorld>
            <EnterVR />
          </XR>
        </Suspense>
      </Canvas>
      <Loader />
      <Leva oneLineLabels />
    </>
  )
}
