import type { AmbisonicSource, AmbisonicSourceSettings, QuaternionLike } from '../types'
import type { AmbisonicNodeControlValues, SteamAudioAmbisonicNode } from '../worker/audio-node'
import type { WorldImpl } from './world'

import { Quaternion, Vector3 } from 'three'

import { SteamAudioError } from './errors'
import { normalizeQuaternion } from './settings'

/** Integration-layer ambisonic source corresponding to Unity's SteamAudioAmbisonicSource. */
export class AmbisonicSourceImpl implements AmbisonicSource {
  readonly nodes = new Set<SteamAudioAmbisonicNode>()

  readonly #ahead = new Vector3()
  #binaural: boolean
  #disposed = false
  readonly #listenerAhead = new Vector3()
  readonly #listenerInverse = new Quaternion()
  readonly #listenerRight = new Vector3()
  readonly #listenerUp = new Vector3()
  readonly #orientation = new Quaternion()
  readonly #right = new Vector3()
  readonly #sourceAhead = new Vector3()
  readonly #sourceUp = new Vector3()
  readonly #up = new Vector3()
  readonly #world: WorldImpl

  constructor(world: WorldImpl, settings?: AmbisonicSourceSettings) {
    this.#world = world
    this.#binaural = settings?.binaural ?? true
    if (typeof this.#binaural !== 'boolean')
      throw new TypeError('AmbisonicSource.binaural must be a boolean')
    world.ambisonicSources.add(this)
  }

  assertActive(operation: string): void {
    if (this.#disposed)
      throw new SteamAudioError(operation, 'AmbisonicSource has been disposed')
    this.#world.assertActive(operation)
  }

  dispose(): void {
    if (this.#disposed)
      return
    for (const node of [...this.nodes])
      node.dispose()
    this.#disposed = true
    this.#world.ambisonicSources.delete(this)
  }

  publishControl(): void {
    this.assertActive('AmbisonicSource.publishControl')
    const listenerOrientation = this.#world.listenerImpl.orientation
    this.#listenerInverse.copy(listenerOrientation).invert()
    this.#sourceAhead.set(0, 0, -1).applyQuaternion(this.#orientation)
    this.#sourceUp.set(0, 1, 0).applyQuaternion(this.#orientation)
    this.#sourceAhead.applyQuaternion(this.#listenerInverse)
    this.#sourceUp.applyQuaternion(this.#listenerInverse)

    this.#ahead.set(this.#sourceAhead.x, this.#sourceAhead.y, -this.#sourceAhead.z).normalize()
    this.#up.set(this.#sourceUp.x, this.#sourceUp.y, -this.#sourceUp.z).normalize()
    this.#right.crossVectors(this.#ahead, this.#up).normalize()
    this.#listenerAhead.set(-this.#right.z, -this.#up.z, this.#ahead.z).normalize()
    this.#listenerUp.set(this.#right.y, this.#up.y, -this.#ahead.y).normalize()
    this.#listenerRight.crossVectors(this.#listenerAhead, this.#listenerUp).normalize()

    const orientation: AmbisonicNodeControlValues['orientation'] = [
      this.#listenerAhead.x,
      this.#listenerAhead.y,
      this.#listenerAhead.z,
      this.#listenerUp.x,
      this.#listenerUp.y,
      this.#listenerUp.z,
      this.#listenerRight.x,
      this.#listenerRight.y,
      this.#listenerRight.z,
    ]
    for (const node of this.nodes)
      node.setControl({ binaural: this.#binaural, orientation })
  }

  setBinaural(enabled: boolean): void {
    this.assertActive('AmbisonicSource.setBinaural')
    if (typeof enabled !== 'boolean')
      throw new TypeError('AmbisonicSource.binaural must be a boolean')
    this.#binaural = enabled
    this.publishControl()
  }

  setOrientation(orientation: QuaternionLike): void {
    this.assertActive('AmbisonicSource.setOrientation')
    this.#orientation.copy(normalizeQuaternion(orientation))
    this.publishControl()
  }
}
