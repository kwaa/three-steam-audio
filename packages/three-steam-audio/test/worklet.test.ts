import { readFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  port: {
    onmessage?: (event: MessageEvent) => void
  }
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
  ready: boolean
}

const writeSharedControl = (
  buffer: SharedArrayBuffer,
  values: Float32Array,
): void => {
  const sequence = new Int32Array(buffer, 0, 1)
  const control = new Float32Array(buffer, 4, values.length)
  Atomics.add(sequence, 0, 1)
  control.set(values)
  Atomics.add(sequence, 0, 1)
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

  it('outputs silence while the DSP runtime is still initializing', () => {
    const Processor = getRegisteredProcessor<new (options: { processorOptions: {
      frameSize: number
      wasmBinary: ArrayBuffer
    } }) => ProcessorInstance>()
    const processor = new Processor({
      processorOptions: {
        frameSize: 256,
        wasmBinary: new ArrayBuffer(0),
      },
    })
    const input = new Float32Array(128).fill(0.5)
    const directOutput = [
      new Float32Array(128).fill(1),
      new Float32Array(128).fill(1),
    ]
    const reflectionOutput = [
      new Float32Array(128).fill(1),
      new Float32Array(128).fill(1),
    ]
    const reverbOutput = [
      new Float32Array(128).fill(1),
      new Float32Array(128).fill(1),
    ]

    expect(processor.process(
      [[input]],
      [directOutput, reflectionOutput, reverbOutput],
    )).toBe(true)
    for (const output of [
      ...directOutput,
      ...reflectionOutput,
      ...reverbOutput,
    ]) {
      expect([...output]).toEqual([...new Float32Array(128)])
    }
    processor.dispose()
  })

  it('produces directional HRTF and non-zero parametric room outputs', async () => {
    const wasm = await readFile(new URL('../dist/bindings/phonon_bindings.wasm', import.meta.url))
    const Processor = getRegisteredProcessor<new (options: { processorOptions: { frameSize: number, wasmBinary: ArrayBuffer } }) => ProcessorInstance>()
    const processor = new Processor({
      processorOptions: {
        frameSize: 256,
        wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      },
    })
    await waitUntil(() => processor.ready)

    const control = new Float32Array(23)
    control.set([1, 1, 1, 1, 1, 1, 1, 1, 1])
    control.set([1, 0, 0], 9)
    control[12] = 1
    control[13] = 1
    control[14] = 1
    control.set([2, 2, 2], 15)
    control[18] = 1
    control.set([2, 2, 2], 19)
    control[22] = 1
    processor.port.onmessage?.({
      data: { type: 'control', values: control },
    } as MessageEvent)

    let directLeft = 0
    let directRight = 0
    let directStereoDifference = 0
    let reflections = 0
    let reverb = 0
    for (let block = 0; block < 40; block++) {
      const input = new Float32Array(128)
      for (let index = 0; index < input.length; index++)
        input[index] = Math.sin((block * 128 + index) * 0.1)
      const directOutput = [new Float32Array(128), new Float32Array(128)]
      const reflectionOutput = [new Float32Array(128), new Float32Array(128)]
      const reverbOutput = [new Float32Array(128), new Float32Array(128)]
      processor.process([[input]], [directOutput, reflectionOutput, reverbOutput])
      directLeft += directOutput[0].reduce((sum, value) => sum + value * value, 0)
      directRight += directOutput[1].reduce((sum, value) => sum + value * value, 0)
      directStereoDifference += directOutput[0].reduce((sum, value, index) => {
        const difference = value - directOutput[1][index]
        return sum + difference * difference
      }, 0)
      reflections += reflectionOutput[0].reduce((sum, value) => sum + value * value, 0)
      reverb += reverbOutput[0].reduce((sum, value) => sum + value * value, 0)
    }

    expect(reflections).toBeGreaterThan(1)
    expect(reverb).toBeGreaterThan(1)
    expect(directLeft).toBeGreaterThan(1)
    expect(directRight).toBeGreaterThan(1)
    expect(directStereoDifference).toBeGreaterThan(1)
    processor.dispose()
  })

  it('applies controls delivered through isolated-page shared memory', async () => {
    const wasm = await readFile(new URL('../dist/bindings/phonon_bindings.wasm', import.meta.url))
    const controlBuffer = new SharedArrayBuffer(4 + 23 * 4)
    const Processor = getRegisteredProcessor<new (options: { processorOptions: {
      controlBuffer: SharedArrayBuffer
      frameSize: number
      wasmBinary: ArrayBuffer
    } }) => ProcessorInstance>()
    const processor = new Processor({
      processorOptions: {
        controlBuffer,
        frameSize: 256,
        wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      },
    })
    await waitUntil(() => processor.ready)

    const control = new Float32Array(23)
    control.set([0, 1, 1, 1, 1, 1, 1, 1, 1])
    control[11] = -1
    control[12] = 1
    control[13] = 1
    control[14] = 1
    writeSharedControl(controlBuffer, control)

    let outputEnergy = 0
    for (let block = 0; block < 8; block++) {
      const input = new Float32Array(128).fill(0.5)
      const directOutput = [new Float32Array(128), new Float32Array(128)]
      const reflectionOutput = [new Float32Array(128), new Float32Array(128)]
      const reverbOutput = [new Float32Array(128), new Float32Array(128)]
      processor.process([[input]], [directOutput, reflectionOutput, reverbOutput])
      outputEnergy += directOutput[0].reduce(
        (sum, value) => sum + value * value,
        0,
      )
      outputEnergy += directOutput[1].reduce(
        (sum, value) => sum + value * value,
        0,
      )
    }

    expect(outputEnergy).toBeLessThan(1e-6)
    processor.dispose()
  })

  it('initializes without URL in the AudioWorklet global scope', async () => {
    const wasm = await readFile(new URL('../dist/bindings/phonon_bindings.wasm', import.meta.url))
    const Processor = getRegisteredProcessor<new (options: { processorOptions: {
      frameSize: number
      wasmBinary: ArrayBuffer
    } }) => ProcessorInstance>()
    const originalUrl = globalThis.URL
    vi.stubGlobal('URL', undefined)
    try {
      const processor = new Processor({
        processorOptions: {
          frameSize: 512,
          wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
        },
      })
      await waitUntil(() => processor.ready)
      expect(processor.ready).toBe(true)
      processor.dispose()
    }
    finally {
      vi.stubGlobal('URL', originalUrl)
    }
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
