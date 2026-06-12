import { Loader } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { BvhPhysicsWorld } from '@react-three/viverse'
import { createXRStore, XR } from '@react-three/xr'
import { Leva } from 'leva'
import { Suspense, useState } from 'react'
import {
  SteamAudio,
  SteamAudioEnvironment,
  SteamAudioListener,
} from 'three-steam-audio/react'

import { EnterVR } from './components/enter-vr'
import { Environment } from './components/environment'
import { Player } from './components/player'
import { SoundSource } from './components/sound-source'

export const App = () => {
  const store = createXRStore({ offerSession: 'immersive-vr' })
  const [audioContext] = useState(() => new AudioContext())

  return (
    <>
      <Canvas shadows>
        <Suspense fallback={null}>
          <XR store={store}>
            <SteamAudio audioContext={audioContext}>
              <SteamAudioListener />
              <SteamAudioEnvironment reverb={{ wet: 0.3 }}>
                <BvhPhysicsWorld>
                  <Player />
                  <Environment />
                  <SoundSource audioContext={audioContext} />
                </BvhPhysicsWorld>
                <EnterVR audioContext={audioContext} />
              </SteamAudioEnvironment>
            </SteamAudio>
          </XR>
        </Suspense>
      </Canvas>
      <Loader />
      <Leva oneLineLabels />
    </>
  )
}
