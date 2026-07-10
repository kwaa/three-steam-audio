export class WorkletPort {
  messages: unknown[] = []
  onmessage?: (event: MessageEvent) => void

  close() {}
  postMessage(message: unknown) {
    this.messages.push(message)
  }
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
