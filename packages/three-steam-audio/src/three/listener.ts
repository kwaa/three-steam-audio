import type { Camera } from 'three'

import type { Listener, QuaternionLike, ReverbSettings, Vector3Like } from '../types'
import type { WorldImpl } from './world'

import { Quaternion, Vector3 } from 'three'

import { directionsFromQuaternion, normalizeQuaternion } from './settings'

/** Integration-layer listener corresponding to SteamAudioListener in Unity. */
export class ListenerImpl implements Listener {
  readonly orientation = new Quaternion()
  readonly position = new Vector3()
  readonly #world: WorldImpl

  constructor(world: WorldImpl) {
    this.#world = world
  }

  setCamera(camera: Camera | null): void {
    this.#world.setPerspectiveCorrectionCamera(camera)
  }

  setOrientation(orientation: QuaternionLike): void {
    this.setTransform(this.position, orientation)
  }

  setPosition(position: Vector3Like): void {
    this.setTransform(position, this.orientation)
  }

  setReverb(settings: false | ReverbSettings): void {
    this.#world.setListenerReverb(settings)
  }

  setTransform(position: Vector3Like, orientation: QuaternionLike): void {
    this.#world.assertActive('Listener.setTransform')
    this.position.set(position.x, position.y, position.z)
    this.orientation.copy(normalizeQuaternion(orientation))
    const [listenerAhead, listenerUp] = directionsFromQuaternion(this.orientation)
    this.#world.simulator.setListener(
      [this.position.x, this.position.y, this.position.z],
      [listenerAhead.x, listenerAhead.y, listenerAhead.z],
      [listenerUp.x, listenerUp.y, listenerUp.z],
      this.#world.reflectionSettings.rays,
      this.#world.reflectionSettings.bounces,
      this.#world.reflectionSettings.duration,
      this.#world.reflectionSettings.order,
      this.#world.reflectionSettings.irradianceMinDistance,
    )
    this.#world.reflectionWorker?.setListener(
      [this.position.x, this.position.y, this.position.z],
      [listenerAhead.x, listenerAhead.y, listenerAhead.z],
      [listenerUp.x, listenerUp.y, listenerUp.z],
      this.#world.reflectionSettings,
    )
    this.#world.syncListenerReverbSource()
    this.#world.publishSourceControls()
  }
}
