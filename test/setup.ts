import { FakeAudioWorkletNode } from './helpers/audio-context'
import { FakeAudioWorkletProcessor, registerProcessor } from './helpers/audio-worklet'

Object.assign(globalThis, {
  AudioWorkletNode: FakeAudioWorkletNode,
  AudioWorkletProcessor: FakeAudioWorkletProcessor,
  crossOriginIsolated: false,
  registerProcessor,
  sampleRate: 48_000,
})
