export class WorkletPort {
  onmessage?: (event: MessageEvent) => void

  close() {}
  postMessage() {}
}

export class FakeAudioWorkletProcessor {
  port = new WorkletPort()
}

const registeredProcessors = new Map<string, unknown>()

export const registerProcessor = (name: string, implementation: unknown): void => {
  registeredProcessors.set(name, implementation)
}

export const getRegisteredProcessor = <T>(
  name = 'steam-audio-processor',
): T => registeredProcessors.get(name) as T
