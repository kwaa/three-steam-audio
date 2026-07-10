import type { World } from '../src/three/world.ts'

import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'

import { hasChangedListenerCameraBinding } from '../src/react/context.tsx'

describe('steam audio listener camera binding', () => {
  it('rebinds the same camera when its World changes', () => {
    const camera = new PerspectiveCamera()
    const worldA = {} as World
    const worldB = {} as World

    expect(hasChangedListenerCameraBinding(null, camera, worldA)).toBe(true)
    expect(hasChangedListenerCameraBinding({ camera, world: worldA }, camera, worldA)).toBe(false)
    expect(hasChangedListenerCameraBinding({ camera, world: worldA }, camera, worldB)).toBe(true)
  })
})
