import type { AcousticMaterial } from '../types'

const material = (
  absorption: AcousticMaterial['absorption'],
  scattering: number,
  transmission: AcousticMaterial['transmission'] = [0, 0, 0],
): AcousticMaterial => Object.freeze({
  absorption: Object.freeze([...absorption]) as unknown as AcousticMaterial['absorption'],
  scattering,
  transmission: Object.freeze([...transmission]) as unknown as AcousticMaterial['transmission'],
})

export const Materials = Object.freeze({
  concrete: material([0.10, 0.05, 0.02], 0.05),
  generic: material([0.10, 0.20, 0.30], 0.05),
  glass: material([0.13, 0.20, 0.24], 0.05, [0.06, 0.03, 0.02]),
  metal: material([0.20, 0.07, 0.06], 0.05, [0.03, 0.02, 0.01]),
  wood: material([0.11, 0.07, 0.06], 0.05),
})
