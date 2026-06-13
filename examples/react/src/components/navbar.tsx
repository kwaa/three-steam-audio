import type { AudioMode } from '../app'
import type { AcousticMetrics } from './sound-source'

import { Container, Fullscreen, Text } from '@react-three/uikit'
import { Button, ButtonLabel, Panel } from '@react-three/uikit-horizon'
import { useXRStore } from '@react-three/xr'

export const Navbar = ({
  metrics,
  mode,
  onModeChange,
  onTogglePlayback,
  playing,
}: {
  metrics?: AcousticMetrics
  mode: AudioMode
  onModeChange: (mode: AudioMode) => void
  onTogglePlayback: () => void
  playing: boolean
}) => {
  const store = useXRStore()

  return (
    <Fullscreen
      alignItems="flex-start"
      flexDirection="column"
      justifyContent="flex-end"
      overflow="scroll"
      pointerEvents="auto"
    >
      <Panel color="black" dark={{ color: 'white' }} flexDirection="column" gap={16} margin={16} padding={16}>
        <Text fontSize={14} fontWeight="bold">
          Audio mode:
          {' '}
          {mode}
        </Text>
        <Text fontSize={12}>Start: left room, source: right room</Text>
        <Text fontSize={12}>Walk through the doorway at the far end of the divider.</Text>
        <Text fontSize={12}>
          Distance:
          {metrics?.distance.toFixed(2) ?? '--'}
          {' | '}
          Occlusion:
          {metrics?.occlusion.toFixed(2) ?? '--'}
        </Text>
        <Text fontSize={12}>
          Transmission:
          {metrics?.transmission.map(value => value.toFixed(2)).join(' / ') ?? '--'}
        </Text>
        <Container flexDirection="row" gap={8}>
          {(['dry', 'spatial', 'room'] as const).map(value => (
            <Button
              key={value}
              onClick={() => onModeChange(value)}
              variant={mode === value ? 'primary' : 'secondary'}
            >
              <ButtonLabel>
                <Text>{value}</Text>
              </ButtonLabel>
            </Button>
          ))}
        </Container>
        <Button onClick={onTogglePlayback}>
          <ButtonLabel>
            <Text>{playing ? 'Pause' : 'Play'}</Text>
          </ButtonLabel>
        </Button>
        <Button onClick={() => void store.enterVR()}>
          <ButtonLabel>
            <Text>Enter VR</Text>
          </ButtonLabel>
        </Button>
      </Panel>
    </Fullscreen>
  )
}
