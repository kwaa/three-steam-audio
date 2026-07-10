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

  it('merges direct-simulation shortcut props without dropping nested settings', () => {
    expect(mergeSourceSettings({
      direct: {
        airAbsorption: true,
        mixLevel: 0.2,
        transmission: { maxSurfaces: 2 },
      },
    }, {
      directMixLevel: 0.75,
      distanceAttenuation: { minDistance: 3, model: 'inverse' },
      transmission: { maxSurfaces: 4, type: 'frequency-dependent' },
    }).direct).toEqual({
      airAbsorption: true,
      distanceAttenuation: { minDistance: 3, model: 'inverse' },
      mixLevel: 0.75,
      transmission: { maxSurfaces: 4, type: 'frequency-dependent' },
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

  it('uses the perspectiveCorrection prop as the source opt-in', () => {
    expect(mergeSourceSettings({ perspectiveCorrection: false }, {
      perspectiveCorrection: true,
    })).toMatchObject({ perspectiveCorrection: true })
  })
})
