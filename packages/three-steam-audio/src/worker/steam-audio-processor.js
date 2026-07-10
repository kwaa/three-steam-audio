/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import createSteamAudioModule from './bindings/phonon_bindings.js'

const CONTROL_VALUE_COUNT = 26
const runtimePromises = new Map()

const runtimeKey = (frameSize, hrtfSettings) =>
  `${frameSize}:${hrtfSettings.volume}:${hrtfSettings.normalization}`

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
        const hrtf = createHandle(module, out =>
          module._sa_hrtf_create(
            context,
            sampleRate,
            frameSize,
            hrtfSettings.volume,
            hrtfSettings.normalization === 'rms' ? 1 : 0,
            out,
          ))
        return { context, hrtf, key, module, references: 0 }
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

class SteamAudioProcessor extends AudioWorkletProcessor {
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
    this.control[1] = 1
    this.control[2] = 1
    this.control[3] = 1
    this.control[4] = 1
    this.control[5] = 1
    this.control[6] = 1
    this.control[7] = 1
    this.control[8] = 1
    this.control[11] = -1
    this.control[12] = 1
    this.control[15] = 1
    this.control[17] = 1
    this.controlInitialized = false
    this.directMix = 0
    this.rendererWeights = new Float32Array(3)
    this.spatializationMix = 0

    const ringSize = this.frameSize * 2
    this.inputLeft = new Float32Array(ringSize)
    this.inputRight = new Float32Array(ringSize)
    this.inputActive = new Uint8Array(ringSize)
    this.outputLeft = new Float32Array(ringSize)
    this.outputRight = new Float32Array(ringSize)
    this.reflectionLeft = new Float32Array(ringSize)
    this.reflectionRight = new Float32Array(ringSize)
    this.reverbLeft = new Float32Array(ringSize)
    this.reverbRight = new Float32Array(ringSize)
    this.inputRead = 0
    this.inputWrite = 0
    this.inputCount = 0
    this.outputRead = 0
    this.outputWrite = 0
    this.outputCount = 0
    this.disposed = false
    this.failed = false
    this.ready = false

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'control' && data.values)
        this.control.set(data.values)
      else if (data?.type === 'dispose')
        this.dispose()
    }

    const hrtf = processorOptions.hrtf ?? { normalization: 'none', volume: 1 }
    getRuntime(processorOptions.wasmBinary, this.frameSize, hrtf)
      .then((runtime) => {
        runtime.references++
        return runtime
      })
      .then(runtime => this.initialize(runtime))
      .catch((error) => {
        this.failed = true
        this.port.postMessage({
          message: error instanceof Error ? error.message : String(error),
          type: 'error',
        })
      })
  }

  applySpatialization(mode, outputPointer) {
    const { module } = this.runtime
    if (mode === 0) {
      const heap = module.HEAPF32
      const inputOffset = this.directPointer >>> 2
      const outputOffset = outputPointer >>> 2
      heap.set(
        heap.subarray(inputOffset, inputOffset + this.frameSize * 2),
        outputOffset,
      )
      return
    }
    if (mode === 1) {
      module._sa_binaural_effect_apply(
        this.binauralEffect,
        this.runtime.hrtf,
        this.control[9],
        this.control[10],
        this.control[11],
        1,
        this.control[16],
        this.monoPointer,
        outputPointer,
        1,
        this.frameSize,
      )
      return
    }
    module._sa_panning_effect_apply(
      this.panningEffect,
      this.control[9],
      this.control[10],
      this.control[11],
      this.monoPointer,
      outputPointer,
      1,
      this.frameSize,
    )
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    if (!this.ready)
      return
    const runtime = this.runtime
    this.releaseResources()
    this.ready = false
    this.runtime = undefined
    releaseRuntime(runtime)
  }

  initialize(runtime) {
    if (this.disposed) {
      releaseRuntime(runtime)
      return
    }
    this.runtime = runtime
    try {
      const { context, hrtf, module } = runtime
      this.directEffect = createHandle(module, out =>
        module._sa_direct_effect_create(context, sampleRate, this.frameSize, 2, out))
      this.binauralEffect = createHandle(module, out =>
        module._sa_binaural_effect_create(context, sampleRate, this.frameSize, hrtf, out))
      this.panningEffect = createHandle(module, out =>
        module._sa_panning_effect_create(context, sampleRate, this.frameSize, out))
      this.reflectionEffect = createHandle(module, out =>
        module._sa_reflection_effect_create(context, sampleRate, this.frameSize, 1, out))
      this.reverbEffect = createHandle(module, out =>
        module._sa_reflection_effect_create(context, sampleRate, this.frameSize, 1, out))
      this.inputPointer = allocate(module, this.frameSize * 2 * 4)
      this.directPointer = allocate(module, this.frameSize * 2 * 4)
      this.outputPointer = allocate(module, this.frameSize * 2 * 4)
      this.panningPointer = allocate(module, this.frameSize * 2 * 4)
      this.airPointer = allocate(module, 3 * 4)
      this.transmissionPointer = allocate(module, 3 * 4)
      this.monoPointer = allocate(module, this.frameSize * 4)
      this.reflectionPointer = allocate(module, this.frameSize * 4)
      this.reverbPointer = allocate(module, this.frameSize * 4)
      this.reflectionTimesPointer = allocate(module, 3 * 4)
      this.reverbTimesPointer = allocate(module, 3 * 4)
      this.ready = true
      this.port.postMessage({ type: 'ready' })
    }
    catch (error) {
      this.releaseResources()
      this.ready = false
      this.runtime = undefined
      releaseRuntime(runtime)
      throw error
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    const reflectionOutput = outputs[1]
    const reverbOutput = outputs[2]
    if (!output?.[0] || !output?.[1]
      || !reflectionOutput?.[0] || !reflectionOutput?.[1]
      || !reverbOutput?.[0] || !reverbOutput?.[1]) {
      return !this.disposed
    }
    const quantumSize = output[0].length
    if (!this.ready) {
      for (const target of [output, reflectionOutput, reverbOutput]) {
        for (const channel of target)
          channel.fill(0)
      }
      return !this.disposed
    }

    this.readSharedControl()
    this.pushInput(inputs[0], quantumSize)
    while (this.inputCount >= this.frameSize)
      this.processBlock()
    this.pullOutput(output, reflectionOutput, reverbOutput, quantumSize)
    return !this.disposed
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  processBlock() {
    const { module } = this.runtime
    const heap = module.HEAPF32
    const inputOffset = this.inputPointer >>> 2
    let inputActive = false
    for (let index = 0; index < this.frameSize; index++) {
      heap[inputOffset + index] = this.inputLeft[this.inputRead]
      heap[inputOffset + this.frameSize + index] = this.inputRight[this.inputRead]
      inputActive ||= this.inputActive[this.inputRead] !== 0
      this.inputRead = (this.inputRead + 1) % this.inputLeft.length
    }
    this.inputCount -= this.frameSize

    const airOffset = this.airPointer >>> 2
    const transmissionOffset = this.transmissionPointer >>> 2
    for (let band = 0; band < 3; band++) {
      heap[airOffset + band] = this.control[1 + band]
      heap[transmissionOffset + band] = this.control[6 + band]
    }
    const transmissionType = this.control[14]
    const requestedSpatializationMode = this.control[15]
    if (!this.controlInitialized) {
      this.rendererWeights[requestedSpatializationMode] = 1
      this.spatializationMix = requestedSpatializationMode === 0 ? 0 : this.control[12]
      this.directMix = this.control[17]
      this.controlInitialized = true
    }
    module._sa_direct_effect_apply(
      this.directEffect,
      this.control[13],
      transmissionType,
      this.control[0],
      this.airPointer,
      this.control[4],
      this.control[5],
      this.transmissionPointer,
      this.inputPointer,
      this.directPointer,
      2,
      this.frameSize,
    )
    const directOffset = this.directPointer >>> 2
    const monoOffset = this.monoPointer >>> 2
    for (let index = 0; index < this.frameSize; index++) {
      heap[monoOffset + index] = 0.5 * (
        heap[directOffset + index]
        + heap[directOffset + this.frameSize + index]
      )
    }
    if (this.rendererWeights[1] > 0 || requestedSpatializationMode === 1)
      this.applySpatialization(1, this.outputPointer)
    if (this.rendererWeights[2] > 0 || requestedSpatializationMode === 2)
      this.applySpatialization(2, this.panningPointer)

    const reflectionTimesOffset = this.reflectionTimesPointer >>> 2
    const reverbTimesOffset = this.reverbTimesPointer >>> 2
    for (let index = 0; index < this.frameSize; index++) {
      heap[monoOffset + index] = 0.5 * (
        heap[inputOffset + index]
        + heap[inputOffset + this.frameSize + index]
      )
    }
    for (let band = 0; band < 3; band++) {
      heap[reflectionTimesOffset + band] = this.control[18 + band]
      heap[reverbTimesOffset + band] = this.control[22 + band]
    }
    if (inputActive) {
      module._sa_reflection_effect_apply(
        this.reflectionEffect,
        this.reflectionTimesPointer,
        this.monoPointer,
        this.reflectionPointer,
        this.frameSize,
      )
      module._sa_reflection_effect_apply(
        this.reverbEffect,
        this.reverbTimesPointer,
        this.monoPointer,
        this.reverbPointer,
        this.frameSize,
      )
    }
    else {
      module._sa_reflection_effect_get_tail(
        this.reflectionEffect,
        this.reflectionPointer,
        this.frameSize,
      )
      module._sa_reflection_effect_get_tail(
        this.reverbEffect,
        this.reverbPointer,
        this.frameSize,
      )
    }

    const targetMix = requestedSpatializationMode === 0 ? 0 : this.control[12]
    const targetDirectMix = this.control[17]
    const mixStep = 1 / (sampleRate * 0.02)
    const outputOffset = this.outputPointer >>> 2
    const panningOffset = this.panningPointer >>> 2
    const reflectionOffset = this.reflectionPointer >>> 2
    const reverbOffset = this.reverbPointer >>> 2
    for (let index = 0; index < this.frameSize; index++) {
      this.updateRendererWeights(requestedSpatializationMode, mixStep)
      if (this.spatializationMix < targetMix)
        this.spatializationMix = Math.min(targetMix, this.spatializationMix + mixStep)
      else if (this.spatializationMix > targetMix)
        this.spatializationMix = Math.max(targetMix, this.spatializationMix - mixStep)
      if (this.directMix < targetDirectMix)
        this.directMix = Math.min(targetDirectMix, this.directMix + mixStep)
      else if (this.directMix > targetDirectMix)
        this.directMix = Math.max(targetDirectMix, this.directMix - mixStep)
      const dryMix = 1 - this.spatializationMix
      const spatializedLeft = (
        heap[directOffset + index] * this.rendererWeights[0]
        + heap[outputOffset + index] * this.rendererWeights[1]
        + heap[panningOffset + index] * this.rendererWeights[2]
      )
      const spatializedRight = (
        heap[directOffset + this.frameSize + index] * this.rendererWeights[0]
        + heap[outputOffset + this.frameSize + index] * this.rendererWeights[1]
        + heap[panningOffset + this.frameSize + index] * this.rendererWeights[2]
      )
      heap[outputOffset + index] = (
        spatializedLeft * this.spatializationMix
        + heap[directOffset + index] * dryMix
      ) * this.directMix
      heap[outputOffset + this.frameSize + index]
        = (
          spatializedRight * this.spatializationMix
          + heap[directOffset + this.frameSize + index] * dryMix
        ) * this.directMix
    }

    for (let index = 0; index < this.frameSize; index++) {
      this.outputLeft[this.outputWrite] = heap[outputOffset + index]
      this.outputRight[this.outputWrite] = heap[outputOffset + this.frameSize + index]
      const reflectionSample = heap[reflectionOffset + index] * this.control[21]
      const reverbSample = heap[reverbOffset + index] * this.control[25]
      this.reflectionLeft[this.outputWrite] = reflectionSample
      this.reflectionRight[this.outputWrite] = reflectionSample
      this.reverbLeft[this.outputWrite] = reverbSample
      this.reverbRight[this.outputWrite] = reverbSample
      this.outputWrite = (this.outputWrite + 1) % this.outputLeft.length
      this.outputCount++
    }
  }

  pullOutput(output, reflectionOutput, reverbOutput, quantumSize) {
    const left = output[0]
    const right = output[1]
    for (let index = 0; index < quantumSize; index++) {
      if (this.outputCount > 0) {
        left[index] = this.outputLeft[this.outputRead]
        right[index] = this.outputRight[this.outputRead]
        reflectionOutput[0][index] = this.reflectionLeft[this.outputRead]
        reflectionOutput[1][index] = this.reflectionRight[this.outputRead]
        reverbOutput[0][index] = this.reverbLeft[this.outputRead]
        reverbOutput[1][index] = this.reverbRight[this.outputRead]
        this.outputRead = (this.outputRead + 1) % this.outputLeft.length
        this.outputCount--
      }
      else {
        left[index] = 0
        right[index] = 0
        reflectionOutput[0][index] = 0
        reflectionOutput[1][index] = 0
        reverbOutput[0][index] = 0
        reverbOutput[1][index] = 0
      }
    }
  }

  pushInput(input, quantumSize) {
    const left = input?.[0]
    const right = input?.[1] ?? left
    const active = left !== undefined
    for (let index = 0; index < quantumSize; index++) {
      this.inputLeft[this.inputWrite] = left?.[index] ?? 0
      this.inputRight[this.inputWrite] = right?.[index] ?? 0
      this.inputActive[this.inputWrite] = active ? 1 : 0
      this.inputWrite = (this.inputWrite + 1) % this.inputLeft.length
      this.inputCount++
    }
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
    const effects = [
      ['binauralEffect', '_sa_binaural_effect_release'],
      ['panningEffect', '_sa_panning_effect_release'],
      ['directEffect', '_sa_direct_effect_release'],
      ['reflectionEffect', '_sa_reflection_effect_release'],
      ['reverbEffect', '_sa_reflection_effect_release'],
    ]
    for (const [property, release] of effects) {
      if (!this[property])
        continue
      module[release](this[property])
      this[property] = undefined
    }
    const pointers = [
      'inputPointer',
      'directPointer',
      'outputPointer',
      'panningPointer',
      'airPointer',
      'transmissionPointer',
      'monoPointer',
      'reflectionPointer',
      'reverbPointer',
      'reflectionTimesPointer',
      'reverbTimesPointer',
    ]
    for (const property of pointers) {
      if (!this[property])
        continue
      module._free(this[property])
      this[property] = undefined
    }
  }

  updateRendererWeights(targetMode, step) {
    let total = 0
    for (let mode = 0; mode < this.rendererWeights.length; mode++) {
      const target = mode === targetMode ? 1 : 0
      const weight = this.rendererWeights[mode]
      this.rendererWeights[mode] = weight < target
        ? Math.min(target, weight + step)
        : Math.max(target, weight - step)
      total += this.rendererWeights[mode]
    }
    for (let mode = 0; mode < this.rendererWeights.length; mode++)
      this.rendererWeights[mode] /= total
  }
}

registerProcessor('steam-audio-processor', SteamAudioProcessor)

class SteamAudioBusProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const wet = options.processorOptions?.wet
    this.wet = Number.isFinite(wet) && wet >= 0 ? wet : 1
    this.disposed = false
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'wet') {
        this.wet = Number.isFinite(data.value) && data.value >= 0
          ? data.value
          : this.wet
      }
      else if (data?.type === 'dispose') {
        this.disposed = true
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    for (let channel = 0; channel < output.length; channel++) {
      const source = input?.[channel] ?? input?.[0]
      for (let index = 0; index < output[channel].length; index++)
        output[channel][index] = (source?.[index] ?? 0) * this.wet
    }
    return !this.disposed
  }
}

registerProcessor('steam-audio-bus-processor', SteamAudioBusProcessor)
