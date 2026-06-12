import { describe, expect, it } from 'vitest'

import { connectManagedAudioEdges } from '../src/worker/audio-connections.ts'

describe('connectManagedAudioEdges', () => {
  it('disconnects only the audio edges established by React glue', () => {
    const inputConnections: unknown[] = []
    const inputDisconnections: unknown[] = []
    const outputConnections: unknown[] = []
    const outputDisconnections: unknown[] = []
    const destination = {}
    const node = {
      connect: (target: unknown) => outputConnections.push(target),
      disconnect: (target: unknown) => outputDisconnections.push(target),
    }
    const input = {
      connect: (target: unknown) => inputConnections.push(target),
      disconnect: (target: unknown) => inputDisconnections.push(target),
    }

    const cleanup = connectManagedAudioEdges(input as unknown as AudioNode, node as unknown as AudioNode, destination as unknown as AudioNode)
    expect(inputConnections).toEqual([node])
    expect(outputConnections).toEqual([destination])
    cleanup()
    expect(inputDisconnections).toEqual([node])
    expect(outputDisconnections).toEqual([destination])
    expect(outputDisconnections).not.toContain(undefined)
  })
})
