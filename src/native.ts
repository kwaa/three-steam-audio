import type { SteamAudioBindings } from './bindings/phonon_bindings.js'

import { assertNativeStatus } from './errors'

export type NativeModule = SteamAudioBindings

export const createHandle = (
  module: NativeModule,
  operation: string,
  create: (outPointer: number) => number,
): number => {
  const out = module._malloc(4)
  try {
    module.HEAPU32[out >>> 2] = 0
    assertNativeStatus(operation, create(out))
    const handle = module.HEAPU32[out >>> 2]
    if (handle === 0)
      throw new Error(`${operation} returned a null handle`)
    return handle
  }
  finally {
    module._free(out)
  }
}

export const withFloatArray = <T>(
  module: NativeModule,
  values: ArrayLike<number>,
  callback: (pointer: number) => T,
): T => {
  const pointer = module._malloc(values.length * 4)
  try {
    module.HEAPF32.set(values, pointer >>> 2)
    return callback(pointer)
  }
  finally {
    module._free(pointer)
  }
}

export const withIntArray = <T>(
  module: NativeModule,
  values: ArrayLike<number>,
  callback: (pointer: number) => T,
): T => {
  const pointer = module._malloc(values.length * 4)
  try {
    module.HEAP32.set(values, pointer >>> 2)
    return callback(pointer)
  }
  finally {
    module._free(pointer)
  }
}

export const withOptionalFloatArray = <T>(
  module: NativeModule,
  values: ArrayLike<number> | undefined,
  callback: (pointer: number) => T,
): T => values ? withFloatArray(module, values, callback) : callback(0)
