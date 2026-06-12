import { readFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it } from 'vitest'

import { getRegisteredProcessor } from './helpers/audio-worklet.ts'

import '../dist/steam-audio-processor.js'

interface BusProcessorInstance {
  port: {
    onmessage?: (event: MessageEvent) => void
  }
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
  wet: number
}

interface ProcessorInstance {
  dispose: () => void
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
  ready: boolean
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  const timeout = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > timeout)
      throw new Error('Timed out waiting for AudioWorklet initialization')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('steamAudioProcessor', () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      Atomics,
      SharedArrayBuffer,
    })
  })

  it('initializes the real worklet WASM runtime and adapts 128-frame render quanta', async () => {
    const wasm = await readFile(new URL('../dist/bindings/phonon_bindings.wasm', import.meta.url))
    const Processor = getRegisteredProcessor<new (options: { processorOptions: { frameSize: number, wasmBinary: ArrayBuffer } }) => ProcessorInstance>()
    const processor = new Processor({
      processorOptions: {
        frameSize: 256,
        wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      },
    })
    await waitUntil(() => processor.ready)

    const input = new Float32Array(128)
    for (let index = 0; index < input.length; index++)
      input[index] = Math.sin(index / 10)
    const first = [new Float32Array(128), new Float32Array(128)]
    const second = [new Float32Array(128), new Float32Array(128)]
    const firstReflections = [new Float32Array(128), new Float32Array(128)]
    const secondReflections = [new Float32Array(128), new Float32Array(128)]
    const firstReverb = [new Float32Array(128), new Float32Array(128)]
    const secondReverb = [new Float32Array(128), new Float32Array(128)]

    expect(processor.process([[input]], [first, firstReflections, firstReverb])).toBe(true)
    expect([...first[0]]).toEqual([...new Float32Array(128)])
    expect(processor.process([[input]], [second, secondReflections, secondReverb])).toBe(true)
    expect(second[0].every(Number.isFinite)).toBe(true)
    expect(second[1].every(Number.isFinite)).toBe(true)
    expect(secondReflections[0].every(Number.isFinite)).toBe(true)
    expect(secondReverb[0].every(Number.isFinite)).toBe(true)

    processor.dispose()
    expect(processor.process([[input]], [second, secondReflections, secondReverb])).toBe(false)
  })

  it('sanitizes invalid bus wet values at the worklet boundary', () => {
    const Processor = getRegisteredProcessor<new (
      options: { processorOptions: { wet: number } },
    ) => BusProcessorInstance>('steam-audio-bus-processor')
    const processor = new Processor({
      processorOptions: { wet: Number.NaN },
    })
    expect(processor.wet).toBe(1)

    processor.port.onmessage?.({
      data: { type: 'wet', value: -1 },
    } as MessageEvent)
    expect(processor.wet).toBe(1)

    const input = [new Float32Array([0.25, -0.5])]
    const output = [new Float32Array(2)]
    expect(processor.process([input], [output])).toBe(true)
    expect([...output[0]]).toEqual([0.25, -0.5])
  })
})
