export interface FakeAudioContext {
  context: AudioContext
  modules: string[]
}

export class FakePort {
  closed = false
  messages: unknown[] = []

  close(): void {
    this.closed = true
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }
}

export class FakeAudioWorkletNode {
  connections: unknown[] = []
  context: AudioContext
  disconnections: unknown[] = []
  name: string
  options: unknown
  port = new FakePort()

  constructor(
    context: AudioContext,
    name: string,
    options: unknown,
  ) {
    this.context = context
    this.name = name
    this.options = options
  }

  connect(destination: unknown): unknown {
    this.connections.push(destination)
    return destination
  }

  disconnect(destination: unknown): void {
    this.disconnections.push(destination)
  }
}

export const createAudioContext = (): FakeAudioContext => {
  const modules: string[] = []
  return {
    context: {
      audioWorklet: {
        addModule: async (url: URL) => {
          modules.push(url.href)
        },
      },
      destination: { name: 'destination' } as unknown as AudioNode,
      sampleRate: 48_000,
      state: 'running',
    } as unknown as AudioContext,
    modules,
  }
}
