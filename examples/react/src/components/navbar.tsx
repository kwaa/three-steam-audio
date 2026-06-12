import { Container, Fullscreen, Text } from '@react-three/uikit'
import { Button, ButtonLabel } from '@react-three/uikit-horizon'
import { useXRStore } from '@react-three/xr'
import { useState } from 'react'

export const Navbar = ({
  audio,
  audioContext,
}: {
  audio: HTMLAudioElement
  audioContext: AudioContext
}) => {
  const store = useXRStore()
  const [playing, setPlaying] = useState(false)

  const togglePlayback = () => {
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    void audioContext.resume()
    void audio.play().then(
      () => setPlaying(true),
      error => console.error('Unable to start audio playback', error),
    )
  }

  return (
    <Fullscreen
      alignItems="flex-start"
      flexDirection="column"
      justifyContent="flex-end"
      overflow="scroll"
    >
      <Container flexDirection="column" gap={8} padding={16}>
        <Button onClick={togglePlayback}>
          <ButtonLabel>
            <Text>{playing ? 'Pause' : 'Play'}</Text>
          </ButtonLabel>
        </Button>
        <Button onClick={() => void store.enterVR()}>
          <ButtonLabel>
            <Text>Enter VR</Text>
          </ButtonLabel>
        </Button>
      </Container>
    </Fullscreen>
  )
}
