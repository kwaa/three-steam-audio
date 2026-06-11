import assert from 'node:assert/strict'
import test from 'node:test'

import { readFile } from 'node:fs/promises'

let Processor

class WorkletPort {
  close() {}
  postMessage() {}
}

class FakeAudioWorkletProcessor {
  port = new WorkletPort()
}

globalThis.AudioWorkletProcessor = FakeAudioWorkletProcessor
globalThis.registerProcessor = (name, implementation) => {
  assert.equal(name, 'steam-audio-processor')
  Processor = implementation
}
globalThis.sampleRate = 48_000

await import('../dist/steam-audio-processor.js')

const waitUntil = async (predicate) => {
  const timeout = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > timeout)
      throw new Error('Timed out waiting for AudioWorklet initialization')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('initializes the real worklet WASM runtime and adapts 128-frame render quanta', async () => {
  const wasm = await readFile(new URL('../dist/bindings/phonon_bindings.wasm', import.meta.url))
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

  assert.equal(processor.process([[input]], [first]), true)
  assert.deepEqual([...first[0]], [...new Float32Array(128)])
  assert.equal(processor.process([[input]], [second]), true)
  assert.ok(second[0].every(Number.isFinite))
  assert.ok(second[1].every(Number.isFinite))

  processor.dispose()
  assert.equal(processor.process([[input]], [second]), false)
})
