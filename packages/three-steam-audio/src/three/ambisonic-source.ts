import type { AmbisonicSource, AmbisonicSourceSettings, QuaternionLike } from '../types'
import type { AmbisonicNodeControlValues, SteamAudioAmbisonicNode } from '../worker/audio-node'
import type { WorldImpl } from './world'

import { Quaternion, Vector3 } from 'three'

import { SteamAudioError } from './errors'
import { normalizeQuaternion } from './settings'

const sourceAhead = new Vector3()
const sourceUp = new Vector3()
const ahead = new Vector3()
const up = new Vector3()
const right = new Vector3()
const listenerAhead = new Vector3()
const listenerUp = new Vector3()
const listenerRight = new Vector3()
const listenerInverse = new Quaternion()

/** Integration-layer ambisonic source corresponding to Unity's SteamAudioAmbisonicSource. */
export class AmbisonicSourceImpl implements AmbisonicSource {
  readonly nodes = new Set<SteamAudioAmbisonicNode>()

  #binaural: boolean
  #disposed = false
  readonly #orientation = new Quaternion()
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
    listenerInverse.copy(listenerOrientation).invert()
    sourceAhead.set(0, 0, -1).applyQuaternion(this.#orientation)
    sourceUp.set(0, 1, 0).applyQuaternion(this.#orientation)
    sourceAhead.applyQuaternion(listenerInverse)
    sourceUp.applyQuaternion(listenerInverse)

    ahead.set(sourceAhead.x, sourceAhead.y, -sourceAhead.z).normalize()
    up.set(sourceUp.x, sourceUp.y, -sourceUp.z).normalize()
    right.crossVectors(ahead, up).normalize()
    listenerAhead.set(-right.z, -up.z, ahead.z).normalize()
    listenerUp.set(right.y, up.y, -ahead.y).normalize()
    listenerRight.crossVectors(listenerAhead, listenerUp).normalize()

    const orientation: AmbisonicNodeControlValues['orientation'] = [
      listenerAhead.x,
      listenerAhead.y,
      listenerAhead.z,
      listenerUp.x,
      listenerUp.y,
      listenerUp.z,
      listenerRight.x,
      listenerRight.y,
      listenerRight.z,
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
