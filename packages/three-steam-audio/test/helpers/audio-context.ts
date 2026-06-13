export interface FakeAudioContext {
  context: AudioContext
  modules: string[]
}

class FakeGainNode {
  connections: unknown[] = []
  disconnections: unknown[] = []
  gain = { value: 1 }

  connect(destination: unknown): unknown {
    this.connections.push(destination)
    return destination
  }

  disconnect(destination?: unknown): void {
    this.disconnections.push(destination)
  }
}

export class FakePort {
  closed = false
  messages: unknown[] = []
  onmessage?: (event: MessageEvent) => void

  close(): void {
    this.closed = true
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }
}

export class FakeAudioWorkletNode {
  connections: unknown[][] = []
  context: AudioContext
  disconnections: unknown[][] = []
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

  connect(destination: unknown, output?: number, input?: number): unknown {
    this.connections.push([destination, output, input])
    return destination
  }

  disconnect(destination?: unknown, output?: number, input?: number): void {
    this.disconnections.push([destination, output, input])
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
      createGain: () => new FakeGainNode() as unknown as GainNode,
      destination: { name: 'destination' } as unknown as AudioNode,
      sampleRate: 48_000,
      state: 'running',
    } as unknown as AudioContext,
    modules,
  }
}
