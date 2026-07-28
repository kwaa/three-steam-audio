import type { Matrix4 } from 'three'

import type {
  AcousticMeshHandle,
  AcousticScene,
  DynamicAcousticMeshHandle,
  DynamicMeshInput,
  StaticMeshInput,
} from '../types'
import type { WorldImpl } from './world'

import { Matrix4 as ThreeMatrix4 } from 'three'

import { SteamAudioError } from './errors'
import {
  convertGeometry,
  matrixToRowMajor,
  rigidMatrixForScale,
  splitDynamicTransform,
} from './geometry'
import { createHandle, withFloatArray, withIntArray } from './native'

interface NativeMesh {
  dispose: () => void
}

/** TypeScript's scene object corresponding to the C API's IPLScene. */
export class SceneImpl implements AcousticScene {
  #dirty = false
  readonly #handles = new Set<NativeMesh>()
  #nextReflectionMeshId = 1
  readonly #pendingReleases: Array<() => void> = []
  readonly #world: WorldImpl

  constructor(world: WorldImpl) {
    this.#world = world
  }

  addDynamicMesh(input: DynamicMeshInput): DynamicAcousticMeshHandle {
    this.#world.assertActive('AcousticScene.addDynamicMesh')
    const transform = splitDynamicTransform(input.matrixWorld)
    const reflectionMeshId = this.#nextReflectionMeshId++
    let currentRigidMatrix = transform.rigidMatrix.clone()
    const subScene = createHandle(this.#world.module, 'iplSceneCreate', out =>
      this.#world.module._sa_scene_create(this.#world.context, out))
    let staticMesh = 0
    let instance = 0
    try {
      const created = this.#createStaticMesh(subScene, input, transform.bakedMatrix)
      staticMesh = created.native
      this.#world.module._sa_static_mesh_add(staticMesh, subScene)
      this.#world.module._sa_scene_commit(subScene)
      instance = createHandle(this.#world.module, 'iplInstancedMeshCreate', out =>
        withFloatArray(this.#world.module, matrixToRowMajor(transform.rigidMatrix), matrixPointer =>
          this.#world.module._sa_instanced_mesh_create(
            this.#world.sceneHandle,
            subScene,
            matrixPointer,
            out,
          )))
      this.#world.reflectionWorker?.addDynamicMesh(
        reflectionMeshId,
        created.converted,
        Array.isArray(input.material) ? input.material.length : 1,
        transform.rigidMatrix,
      )
    }
    catch (error) {
      if (staticMesh !== 0)
        this.#world.module._sa_static_mesh_release(staticMesh)
      this.#world.module._sa_scene_release(subScene)
      throw error
    }
    this.#dirty = true
    let disposed = false
    const handle: DynamicAcousticMeshHandle & NativeMesh = {
      dispose: () => {
        if (disposed)
          return
        disposed = true
        this.#world.module._sa_instanced_mesh_remove(instance, this.#world.sceneHandle)
        this.#world.reflectionWorker?.removeMesh(reflectionMeshId)
        this.#pendingReleases.push(() => {
          this.#world.module._sa_instanced_mesh_release(instance)
          this.#world.module._sa_static_mesh_release(staticMesh)
          this.#world.module._sa_scene_release(subScene)
        })
        this.#handles.delete(handle)
        this.#dirty = true
      },
      setTransform: (matrixWorld: Matrix4) => {
        if (disposed)
          throw new SteamAudioError('DynamicAcousticMeshHandle.setTransform', 'mesh has been disposed')
        const rigid = rigidMatrixForScale(matrixWorld, transform.scale)
        if (rigid.equals(currentRigidMatrix))
          return
        currentRigidMatrix = rigid.clone()
        withFloatArray(this.#world.module, matrixToRowMajor(rigid), pointer =>
          this.#world.module._sa_instanced_mesh_update_transform(
            instance,
            this.#world.sceneHandle,
            pointer,
          ))
        this.#world.reflectionWorker?.updateDynamicMesh(reflectionMeshId, rigid)
        this.#dirty = true
      },
    }
    this.#handles.add(handle)
    return handle
  }

  addStaticMesh(input: StaticMeshInput): AcousticMeshHandle {
    this.#world.assertActive('AcousticScene.addStaticMesh')
    const reflectionMeshId = this.#nextReflectionMeshId++
    const created = this.#createStaticMesh(this.#world.sceneHandle, input, input.matrixWorld)
    const mesh = created.native
    this.#world.module._sa_static_mesh_add(mesh, this.#world.sceneHandle)
    this.#world.reflectionWorker?.addStaticMesh(
      reflectionMeshId,
      created.converted,
      Array.isArray(input.material) ? input.material.length : 1,
    )
    this.#dirty = true
    let disposed = false
    const handle: NativeMesh = {
      dispose: () => {
        if (disposed)
          return
        disposed = true
        this.#world.module._sa_static_mesh_remove(mesh, this.#world.sceneHandle)
        this.#world.reflectionWorker?.removeMesh(reflectionMeshId)
        this.#pendingReleases.push(() => this.#world.module._sa_static_mesh_release(mesh))
        this.#handles.delete(handle)
        this.#dirty = true
      },
    }
    this.#handles.add(handle)
    return handle
  }

  commit(): void {
    this.#world.assertActive('AcousticScene.commit')
    if (!this.#dirty)
      return
    this.#world.module._sa_scene_commit(this.#world.sceneHandle)
    this.#world.simulator.commit()
    this.#world.reflectionWorker?.commitScene()
    this.#dirty = false
    for (const release of this.#pendingReleases.splice(0))
      release()
  }

  dispose(): void {
    for (const handle of [...this.#handles])
      handle.dispose()
    if (this.#dirty)
      this.commit()
  }

  #createStaticMesh(
    scene: number,
    input: Pick<StaticMeshInput, 'geometry' | 'material'>,
    matrixWorld: Matrix4 = new ThreeMatrix4(),
  ): { converted: ReturnType<typeof convertGeometry>, native: number } {
    const converted = convertGeometry(input.geometry, input.material, matrixWorld)
    const materialCount = Array.isArray(input.material) ? input.material.length : 1
    const native = createHandle(this.#world.module, 'iplStaticMeshCreate', out =>
      withFloatArray(this.#world.module, converted.vertices, vertices =>
        withIntArray(this.#world.module, converted.indices, indices =>
          withFloatArray(this.#world.module, converted.absorption, absorption =>
            withFloatArray(this.#world.module, converted.scattering, scattering =>
              withFloatArray(this.#world.module, converted.transmission, transmission =>
                withIntArray(this.#world.module, converted.materialIndices, materialIndices =>
                  this.#world.module._sa_static_mesh_create(
                    scene,
                    converted.vertices.length / 3,
                    vertices,
                    converted.indices.length / 3,
                    indices,
                    materialCount,
                    absorption,
                    scattering,
                    transmission,
                    materialIndices,
                    out,
                  ))))))))
    return { converted, native }
  }
}
