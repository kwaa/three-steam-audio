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
})
