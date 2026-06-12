import type { AcousticMetrics } from './components/sound-source'

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

import { Environment } from './components/environment'
import { Navbar } from './components/navbar'
import { Player } from './components/player'
import { SoundSource } from './components/sound-source'

export type AudioMode = 'dry' | 'room' | 'spatial'

export const App = () => {
  const store = createXRStore({ offerSession: 'immersive-vr' })
  const [audioMode, setAudioMode] = useState<AudioMode>('room')
  const [metrics, setMetrics] = useState<AcousticMetrics>()
  const [playing, setPlaying] = useState(false)
  const [{
    audio,
    audioContext,
    dryGain,
    input,
    roomGain,
    spatialGain,
  }] = useState(() => {
    const context = new AudioContext()
    const element = new Audio('/Snowfall (Looped ver.).ogg')
    const dry = context.createGain()
    const spatial = context.createGain()
    const room = context.createGain()
    element.crossOrigin = 'anonymous'
    element.loop = true
    dry.connect(context.destination)
    spatial.connect(context.destination)
    room.connect(context.destination)
    return {
      audio: element,
      audioContext: context,
      dryGain: dry,
      input: context.createMediaElementSource(element),
      roomGain: room,
      spatialGain: spatial,
    }
  })

  dryGain.gain.value = audioMode === 'dry' ? 1 : 0
  spatialGain.gain.value = audioMode === 'dry' ? 0 : 1
  roomGain.gain.value = audioMode === 'room' ? 1 : 0

  const togglePlayback = () => {
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    void audioContext.resume()
    void audio.play().then(() => setPlaying(true))
  }

  return (
    <>
      <Canvas shadows>
        <Suspense fallback={null}>
          <XR store={store}>
            <SteamAudio audioContext={audioContext}>
              <SteamAudioListener />
              <SteamAudioEnvironment
                destination={roomGain}
                reflections={{ wet: 1 }}
                reverb={{
                  reverbScale: [1.8, 1.6, 1.3],
                  wet: 1,
                }}
              >
                <BvhPhysicsWorld>
                  <Player />
                  <Environment />
                  <SoundSource
                    dryDestination={dryGain}
                    input={input}
                    onMetrics={setMetrics}
                    spatialDestination={spatialGain}
                  />
                </BvhPhysicsWorld>
              </SteamAudioEnvironment>
            </SteamAudio>
          </XR>
          <Navbar
            metrics={metrics}
            mode={audioMode}
            onEnterVR={() => void store.enterVR()}
            onModeChange={setAudioMode}
            onTogglePlayback={togglePlayback}
            playing={playing}
          />
        </Suspense>
      </Canvas>
      <Loader />
      <Leva oneLineLabels />
    </>
  )
}
