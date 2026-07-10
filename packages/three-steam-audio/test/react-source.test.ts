import { describe, expect, it } from 'vitest'

import { mergeSourceSettings } from '../src/react/source.tsx'

describe('steamAudioSource settings merge', () => {
  it('preserves an explicit direct=false prop', () => {
    expect(mergeSourceSettings(undefined, {
      direct: false,
    }).direct).toBe(false)
  })

  it('lets an object direct prop reopen settings-level direct=false', () => {
    expect(mergeSourceSettings({ direct: false }, {
      direct: {
        mixLevel: 0.5,
      },
    }).direct).toEqual({ mixLevel: 0.5 })
  })

  it('keeps P0 direct settings available through the direct prop', () => {
    expect(mergeSourceSettings(undefined, {
      direct: {
        mixLevel: 0.5,
        occlusion: { type: 'raycast' },
        transmission: { maxSurfaces: 4 },
      },
    }).direct).toEqual({
      mixLevel: 0.5,
      occlusion: { type: 'raycast' },
      transmission: { maxSurfaces: 4 },
    })
  })

  it('merges partial spatialization props with settings', () => {
    expect(mergeSourceSettings({
      spatialization: { blend: 0.5, mode: 'binaural' },
    }, {
      spatialization: { interpolation: 'bilinear' },
    }).spatialization).toEqual({
      blend: 0.5,
      interpolation: 'bilinear',
      mode: 'binaural',
    })
  })
})
