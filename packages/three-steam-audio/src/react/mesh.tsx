import type { ThreeElements } from '@react-three/fiber'
import type { Ref } from 'react'
import type { Group, Mesh } from 'three'

import type { World } from '../three/world'
import type {
  AcousticMaterial,
  DynamicAcousticMeshHandle,
} from '../types'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'

import { useInternalContext } from './context'
import { setForwardedRef } from './shared'

export interface AcousticMeshProps extends Omit<ThreeElements['group'], 'ref'> {
  dynamic?: boolean
  material:
    | ((mesh: Mesh) => AcousticMaterial | readonly AcousticMaterial[])
    | AcousticMaterial
    | readonly AcousticMaterial[]
  ref?: Ref<Group>
}

interface AcousticEntry {
  dynamic: boolean
  geometry: Mesh['geometry']
  handle: World['scene'] extends never ? never : ReturnType<World['scene']['addStaticMesh']>
  material: AcousticMaterial | readonly AcousticMaterial[]
  mesh: Mesh
}

export const AcousticMesh = ({
  dynamic = false,
  material,
  ref,
  ...groupProps
}: AcousticMeshProps) => {
  const groupRef = useRef<Group>(null)
  const entriesRef = useRef<Map<Mesh, AcousticEntry> | null>(null)
  if (entriesRef.current === null) {
    entriesRef.current = new Map<Mesh, AcousticEntry>()
  }
  const entries = entriesRef.current
  const { register, scene } = useInternalContext('AcousticMesh')

  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group
    setForwardedRef(ref, group)
  }, [ref])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group)
      return
    const present = new Set<Mesh>()
    group.updateWorldMatrix(true, true)
    group.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh)
        return
      if ((mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh)
        throw new Error('AcousticMesh does not support SkinnedMesh in the MVP')
      if (mesh.morphTargetInfluences !== undefined && mesh.morphTargetInfluences.length > 0)
        throw new Error('AcousticMesh does not support morph targets in the MVP')
      present.add(mesh)
      const resolvedMaterial = typeof material === 'function' ? material(mesh) : material
      const previous = entries.get(mesh)
      if (
        previous
        && previous.dynamic === dynamic
        && previous.geometry === mesh.geometry
        && previous.material === resolvedMaterial
      ) {
        return
      }
      const replacement = dynamic
        ? scene.addDynamicMesh({
            geometry: mesh.geometry,
            material: resolvedMaterial,
            matrixWorld: mesh.matrixWorld,
          })
        : scene.addStaticMesh({
            geometry: mesh.geometry,
            material: resolvedMaterial,
            matrixWorld: mesh.matrixWorld,
          })
      previous?.handle.dispose()
      entries.set(mesh, {
        dynamic,
        geometry: mesh.geometry,
        handle: replacement,
        material: resolvedMaterial,
        mesh,
      })
    })
    for (const [mesh, entry] of entries) {
      if (!present.has(mesh)) {
        entry.handle.dispose()
        entries.delete(mesh)
      }
    }
  })

  useEffect(() => register('dynamic', () => {
    for (const entry of entries.values()) {
      if (entry.dynamic)
        (entry.handle as DynamicAcousticMeshHandle).setTransform(entry.mesh.matrixWorld)
    }
  }), [entries, register])

  useEffect(() => () => {
    for (const entry of entries.values())
      entry.handle.dispose()
    entries.clear()
  }, [entries])

  return <group {...groupProps} ref={setGroupRef} />
}

AcousticMesh.displayName = 'AcousticMesh'
