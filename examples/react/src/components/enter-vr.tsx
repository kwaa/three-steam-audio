import { Fullscreen, Text } from '@react-three/uikit'
import { Button, ButtonLabel } from '@react-three/uikit-horizon'
import { useXRStore } from '@react-three/xr'

export const EnterVR = ({ audioContext }: { audioContext: AudioContext }) => {
  const store = useXRStore()

  const handleClick = async () => {
    await audioContext.resume()
    try {
      await store.enterVR()
    }
    catch {
      // VR may be unavailable; audio is still resumed.
    }
  }

  return (
    <Fullscreen
      alignItems="flex-start"
      flexDirection="column"
      justifyContent="flex-end"
      overflow="scroll"
    >
      <Button margin={16} onClick={() => void handleClick()}>
        <ButtonLabel>
          <Text>Enter VR</Text>
        </ButtonLabel>
      </Button>
    </Fullscreen>
  )
}
