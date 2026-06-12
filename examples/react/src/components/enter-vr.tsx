import { Fullscreen, Text } from '@react-three/uikit'
import { Button, ButtonLabel } from '@react-three/uikit-horizon'
import { useXRStore } from '@react-three/xr'

export const EnterVR = () => {
  const store = useXRStore()

  return (
    <Fullscreen
      alignItems="flex-start"
      flexDirection="column"
      justifyContent="flex-end"
      overflow="scroll"
    >
      <Button margin={16} onClick={() => void store.enterVR()}>
        <ButtonLabel>
          <Text>Enter VR</Text>
        </ButtonLabel>
      </Button>
    </Fullscreen>
  )
}
