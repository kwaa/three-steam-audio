/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import createSteamAudioModule from './bindings/phonon_bindings.js'

const CONTROL_VALUE_COUNT = 10
const CHANNEL_COUNT = 4
const OUTPUT_CHANNEL_COUNT = 2
const runtimePromises = new Map()
const NORMALIZATION = 1 / Math.sqrt(4 * Math.PI)

const runtimeKey = (frameSize, hrtfSettings) =>
  `${frameSize}:${hrtfSettings.cacheKey}:${hrtfSettings.volume}:${hrtfSettings.normalization}`

const allocate = (module, byteLength) => {
  const pointer = module._malloc(byteLength)
  if (!pointer)
    throw new Error(`Steam Audio worklet could not allocate ${byteLength} bytes`)
  return pointer
}

const createHandle = (module, create) => {
  const out = allocate(module, 4)
  try {
    module.HEAPU32[out >>> 2] = 0
    const status = create(out)
    if (status !== 0)
      throw new Error(`Steam Audio worklet initialization failed with status ${status}`)
    const handle = module.HEAPU32[out >>> 2]
    if (!handle)
      throw new Error('Steam Audio worklet initialization returned a null handle')
    return handle
  }
  finally {
    module._free(out)
  }
}

const getRuntime = (wasmBinary, frameSize, hrtfSettings) => {
  const key = runtimeKey(frameSize, hrtfSettings)
  let promise = runtimePromises.get(key)
  if (!promise) {
    promise = createSteamAudioModule({
      locateFile: path => path,
      wasmBinary,
    }).then((module) => {
      const context = createHandle(module, out => module._sa_context_create(out))
      try {
        let sofaPointer = 0
        try {
          if (hrtfSettings.type === 'sofa') {
            const data = hrtfSettings.data
            if (!(data instanceof ArrayBuffer) || data.byteLength === 0)
              throw new Error('Custom SOFA HRTF data is missing or empty')
            sofaPointer = allocate(module, data.byteLength)
            module.HEAPU8.set(new Uint8Array(data), sofaPointer)
          }
          const hrtf = createHandle(module, out => module._sa_hrtf_create(
            context,
            sampleRate,
            frameSize,
            hrtfSettings.volume,
            hrtfSettings.normalization === 'rms' ? 1 : 0,
            hrtfSettings.type === 'sofa' ? 1 : 0,
            sofaPointer,
            hrtfSettings.data?.byteLength ?? 0,
            out,
          ))
          return { context, hrtf, key, module, references: 0 }
        }
        finally {
          if (sofaPointer)
            module._free(sofaPointer)
        }
      }
      catch (error) {
        module._sa_context_release(context)
        throw error
      }
    }).catch((error) => {
      if (runtimePromises.get(key) === promise)
        runtimePromises.delete(key)
      throw error
    })
    runtimePromises.set(key, promise)
  }
  return promise
}

const releaseRuntime = (runtime) => {
  runtime.references--
  if (runtime.references !== 0)
    return
  runtime.module._sa_hrtf_release(runtime.hrtf)
  runtime.module._sa_context_release(runtime.context)
  runtimePromises.delete(runtime.key)
}

class SteamAudioAmbisonicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const processorOptions = options.processorOptions ?? {}
    this.frameSize = processorOptions.frameSize
    this.controlBuffer = processorOptions.controlBuffer
    this.controlSequence = this.controlBuffer
      ? new Int32Array(this.controlBuffer, 0, 1)
      : undefined
    this.sharedControl = this.controlBuffer
      ? new Float32Array(this.controlBuffer, 4, CONTROL_VALUE_COUNT)
      : undefined
    this.control = new Float32Array(CONTROL_VALUE_COUNT)
    this.control[0] = 1
    // Decoder orientation for an unrotated AmbiX source/listener pair.
    this.control.set([0, 0, 1, 0, 1, 0, -1, 0, 0], 1)

    const ringSize = this.frameSize * 2
    this.input = Array.from({ length: CHANNEL_COUNT }, () => new Float32Array(ringSize))
    this.output = Array.from({ length: OUTPUT_CHANNEL_COUNT }, () => new Float32Array(ringSize))
    this.inputRead = 0
    this.inputWrite = 0
    this.inputCount = 0
    this.outputRead = 0
    this.outputWrite = 0
    this.outputCount = 0
    this.disposed = false
    this.failed = false
    this.ready = false
    this.invalidInputReported = false

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'control' && data.values)
        this.control.set(data.values)
      else if (data?.type === 'dispose')
        this.dispose()
    }

    const hrtf = processorOptions.hrtf ?? {
      cacheKey: 'default',
      normalization: 'none',
      type: 'default',
      volume: 1,
    }
    getRuntime(processorOptions.wasmBinary, this.frameSize, hrtf)
      .then((runtime) => {
        runtime.references++
        return runtime
      })
      .then(runtime => this.initialize(runtime))
      .catch(error => this.fail(error instanceof Error ? error.message : String(error)))
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    this.releaseResources()
    if (this.runtime) {
      const runtime = this.runtime
      this.runtime = undefined
      releaseRuntime(runtime)
    }
  }

  ensureRingCapacity(minimumCapacity) {
    const currentCapacity = this.input[0].length
    if (currentCapacity >= minimumCapacity)
      return
    const capacity = Math.max(minimumCapacity, currentCapacity * 2)
    const input = Array.from(
      { length: CHANNEL_COUNT },
      () => new Float32Array(capacity),
    )
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      for (let index = 0; index < this.inputCount; index++) {
        input[channel][index]
          = this.input[channel][(this.inputRead + index) % currentCapacity]
      }
    }
    const output = Array.from(
      { length: OUTPUT_CHANNEL_COUNT },
      () => new Float32Array(capacity),
    )
    for (let channel = 0; channel < OUTPUT_CHANNEL_COUNT; channel++) {
      for (let index = 0; index < this.outputCount; index++) {
        output[channel][index]
          = this.output[channel][(this.outputRead + index) % currentCapacity]
      }
    }
    this.input = input
    this.inputRead = 0
    this.inputWrite = this.inputCount
    this.output = output
    this.outputRead = 0
    this.outputWrite = this.outputCount
  }

  fail(message) {
    if (this.failed || this.disposed)
      return
    this.failed = true
    this.port.postMessage({ message, type: 'error' })
    this.releaseResources()
    if (this.runtime) {
      const runtime = this.runtime
      this.runtime = undefined
      releaseRuntime(runtime)
    }
  }

  initialize(runtime) {
    if (this.disposed) {
      releaseRuntime(runtime)
      return
    }
    this.runtime = runtime
    try {
      const { context, hrtf, module } = runtime
      this.decodeEffect = createHandle(module, out =>
        module._sa_ambisonic_decode_effect_create(
          context,
          sampleRate,
          this.frameSize,
          hrtf,
          1,
          out,
        ))
      this.inputPointer = allocate(module, CHANNEL_COUNT * this.frameSize * 4)
      this.n3dPointer = allocate(module, CHANNEL_COUNT * this.frameSize * 4)
      this.outputPointer = allocate(module, OUTPUT_CHANNEL_COUNT * this.frameSize * 4)
      this.ready = true
      this.port.postMessage({ type: 'ready' })
    }
    catch (error) {
      this.releaseResources()
      this.runtime = undefined
      releaseRuntime(runtime)
      throw error
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!output?.[0] || !output?.[1])
      return !this.disposed
    const quantumSize = output[0].length
    if (!this.ready || this.failed) {
      for (const channel of output)
        channel.fill(0)
      return !this.disposed
    }

    this.readSharedControl()
    const pendingInputCount = this.inputCount + quantumSize
    const producedSampleCount
      = Math.floor(pendingInputCount / this.frameSize) * this.frameSize
    this.ensureRingCapacity(Math.max(
      pendingInputCount,
      this.outputCount + producedSampleCount,
    ))
    if (!this.pushInput(inputs[0], quantumSize)) {
      for (const channel of output)
        channel.fill(0)
      return !this.disposed
    }
    while (this.inputCount >= this.frameSize) {
      if (!this.processBlock()) {
        for (const channel of output)
          channel.fill(0)
        return !this.disposed
      }
    }
    this.pullOutput(output, quantumSize)
    return !this.disposed
  }

  processBlock() {
    const { module } = this.runtime
    const heap = module.HEAPF32
    const inputOffset = this.inputPointer >>> 2
    for (let index = 0; index < this.frameSize; index++) {
      for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
        const channelOffset = inputOffset + channel * this.frameSize
        heap[channelOffset + index] = this.input[channel][this.inputRead]
      }
      this.inputRead = (this.inputRead + 1) % this.input[0].length
    }
    this.inputCount -= this.frameSize

    const orientation = this.control
    const status = module._sa_ambisonic_decode_effect_apply(
      this.decodeEffect,
      this.runtime.hrtf,
      this.control[0],
      orientation[1],
      orientation[2],
      orientation[3],
      orientation[4],
      orientation[5],
      orientation[6],
      orientation[7],
      orientation[8],
      orientation[9],
      this.inputPointer,
      this.n3dPointer,
      this.outputPointer,
      this.frameSize,
    )
    if (status !== 0) {
      this.fail(`Ambisonic decode failed with status ${status}`)
      return false
    }
    const outputOffset = this.outputPointer >>> 2
    for (let index = 0; index < this.frameSize; index++) {
      this.output[0][this.outputWrite] = heap[outputOffset + index] * NORMALIZATION
      this.output[1][this.outputWrite] = heap[outputOffset + this.frameSize + index] * NORMALIZATION
      this.outputWrite = (this.outputWrite + 1) % this.output[0].length
      this.outputCount++
    }
    return true
  }

  pullOutput(output, quantumSize) {
    for (let index = 0; index < quantumSize; index++) {
      if (this.outputCount > 0) {
        output[0][index] = this.output[0][this.outputRead]
        output[1][index] = this.output[1][this.outputRead]
        this.outputRead = (this.outputRead + 1) % this.output[0].length
        this.outputCount--
      }
      else {
        output[0][index] = 0
        output[1][index] = 0
      }
    }
  }

  pushInput(input, quantumSize) {
    const channelCount = input?.length ?? 0
    if (channelCount !== 0 && channelCount !== CHANNEL_COUNT) {
      if (!this.invalidInputReported) {
        this.invalidInputReported = true
        this.fail(`Ambisonic input must have exactly ${CHANNEL_COUNT} channels`)
      }
      return false
    }
    const active = channelCount === CHANNEL_COUNT
    for (let index = 0; index < quantumSize; index++) {
      for (let channel = 0; channel < CHANNEL_COUNT; channel++)
        this.input[channel][this.inputWrite] = active ? (input[channel]?.[index] ?? 0) : 0
      this.inputWrite = (this.inputWrite + 1) % this.input[0].length
      this.inputCount++
    }
    return true
  }

  readSharedControl() {
    if (!this.controlSequence || !this.sharedControl)
      return
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = Atomics.load(this.controlSequence, 0)
      if (before & 1)
        continue
      this.control.set(this.sharedControl)
      const after = Atomics.load(this.controlSequence, 0)
      if (before === after)
        return
    }
  }

  releaseResources() {
    const module = this.runtime?.module
    if (!module)
      return
    if (this.decodeEffect) {
      module._sa_ambisonic_decode_effect_release(this.decodeEffect)
      this.decodeEffect = undefined
    }
    for (const property of ['inputPointer', 'n3dPointer', 'outputPointer']) {
      if (!this[property])
        continue
      module._free(this[property])
      this[property] = undefined
    }
    this.ready = false
  }
}

registerProcessor('steam-audio-ambisonic-processor', SteamAudioAmbisonicProcessor)
