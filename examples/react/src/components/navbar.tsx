import { Container, Fullscreen, Text } from '@react-three/uikit'
import { Button, ButtonLabel } from '@react-three/uikit-horizon'
import { useXRStore } from '@react-three/xr'

export const Navbar = ({ audioContext }: { audioContext: AudioContext }) => {
  const store = useXRStore()

  return (
    <Fullscreen
      alignItems="flex-start"
      flexDirection="column"
      justifyContent="flex-end"
      overflow="scroll"
    >
      <Container flexDirection="column" gap={8} padding={16}>
        <Button onClick={() => void audioContext.resume()}>
          <ButtonLabel>
            <Text>Play / Pause</Text>
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
