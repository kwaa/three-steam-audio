export class WorkletPort {
  close() {}
  postMessage() {}
}

export class FakeAudioWorkletProcessor {
  port = new WorkletPort()
}

let registeredProcessor: unknown

export const registerProcessor = (name: string, implementation: unknown): void => {
  if (name !== 'steam-audio-processor')
    return
  registeredProcessor = implementation
}

export const getRegisteredProcessor = <T>(): T => registeredProcessor as T
