import type { NativeModule } from './native'

import { assertNativeStatus } from './errors'

/** Thin native-resource wrapper corresponding to Unity's Simulator.cs and IPLSimulator. */
export class Simulator {
  readonly native: number
  readonly #module: NativeModule

  constructor(module: NativeModule, native: number) {
    this.#module = module
    this.native = native
  }

  commit(): void {
    this.#module._sa_simulator_commit(this.native)
  }

  release(): void {
    this.#module._sa_simulator_release(this.native)
  }

  runDirect(): void {
    assertNativeStatus(
      'iplSimulatorRunDirect',
      this.#module._sa_simulator_run_direct(this.native),
    )
  }

  runReflections(): void {
    assertNativeStatus(
      'iplSimulatorRunReflections',
      this.#module._sa_simulator_run_reflections(this.native),
    )
  }

  setListener(
    position: readonly [number, number, number],
    ahead: readonly [number, number, number],
    up: readonly [number, number, number],
    rays: number,
    bounces: number,
    duration: number,
    order: number,
    irradianceMinDistance: number,
  ): void {
    this.#module._sa_simulator_set_listener(
      this.native,
      position[0],
      position[1],
      position[2],
      ahead[0],
      ahead[1],
      ahead[2],
      up[0],
      up[1],
      up[2],
      rays,
      bounces,
      duration,
      order,
      irradianceMinDistance,
    )
  }
}
