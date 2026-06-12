import type { BufferGeometry, Matrix4 } from 'three'

import type { AcousticMaterial } from '../types'

import { Quaternion, Matrix4 as ThreeMatrix4, Vector3 } from 'three'

const identity = new ThreeMatrix4()
const scratch = new Vector3()

export interface ConvertedGeometry {
  absorption: Float32Array
  indices: Int32Array
  materialIndices: Int32Array
  scattering: Float32Array
  transmission: Float32Array
  vertices: Float32Array
}

export interface DynamicTransform {
  bakedMatrix: Matrix4
  rigidMatrix: Matrix4
  scale: Vector3
}

const assertFiniteUnit = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError(`${name} must be a finite number in [0, 1]`)
  return value
}

const validateMaterial = (value: AcousticMaterial, index: number): void => {
  value.absorption.forEach((coefficient, band) => assertFiniteUnit(`material[${index}].absorption[${band}]`, coefficient))
  assertFiniteUnit(`material[${index}].scattering`, value.scattering)
  value.transmission?.forEach((coefficient, band) => assertFiniteUnit(`material[${index}].transmission[${band}]`, coefficient))
}

const getDrawRange = (geometry: BufferGeometry, elementCount: number) => {
  const drawStart = Math.max(0, geometry.drawRange.start)
  const requestedCount = Number.isFinite(geometry.drawRange.count)
    ? geometry.drawRange.count
    : elementCount - drawStart
  const drawEnd = Math.min(elementCount, drawStart + Math.max(0, requestedCount))
  const triangleStart = Math.ceil(drawStart / 3) * 3
  const triangleEnd = drawEnd - ((drawEnd - triangleStart) % 3)
  const triangleCount = Math.max(0, (triangleEnd - triangleStart) / 3)
  if (triangleCount === 0)
    throw new Error('Acoustic geometry drawRange does not contain any complete triangles')
  return { triangleCount, triangleStart }
}

const convertVertices = (
  geometry: BufferGeometry,
  matrix: Matrix4,
): Float32Array => {
  const position = geometry.getAttribute('position')
  const vertices = new Float32Array(position.count * 3)
  for (let vertex = 0; vertex < position.count; vertex++) {
    scratch.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex)).applyMatrix4(matrix)
    vertices[vertex * 3] = scratch.x
    vertices[vertex * 3 + 1] = scratch.y
    vertices[vertex * 3 + 2] = scratch.z
  }
  return vertices
}

const convertTriangles = (
  geometry: BufferGeometry,
  materialCount: number,
  matrix: Matrix4,
) => {
  const sourceIndices = geometry.getIndex()
  const position = geometry.getAttribute('position')
  const elementCount = sourceIndices?.count ?? position.count
  const { triangleCount, triangleStart } = getDrawRange(geometry, elementCount)
  const indices = new Int32Array(triangleCount * 3)
  const materialIndices = new Int32Array(triangleCount)
  const flipWinding = matrix.determinant() < 0

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const sourceOffset = triangleStart + triangle * 3
    const a = sourceIndices ? sourceIndices.getX(sourceOffset) : sourceOffset
    const b = sourceIndices ? sourceIndices.getX(sourceOffset + 1) : sourceOffset + 1
    const c = sourceIndices ? sourceIndices.getX(sourceOffset + 2) : sourceOffset + 2
    indices[triangle * 3] = a
    indices[triangle * 3 + 1] = flipWinding ? c : b
    indices[triangle * 3 + 2] = flipWinding ? b : c

    const group = geometry.groups.find(({ count, start }) =>
      sourceOffset >= start && sourceOffset < start + count,
    )
    const materialIndex = group?.materialIndex ?? 0
    if (materialIndex < 0 || materialIndex >= materialCount)
      throw new RangeError(`Geometry group references missing acoustic material ${materialIndex}`)
    materialIndices[triangle] = materialIndex
  }
  return { indices, materialIndices }
}

export const matrixToRowMajor = (matrix: Matrix4): Float32Array => {
  const source = matrix.elements
  return new Float32Array([
    source[0],
    source[4],
    source[8],
    source[12],
    source[1],
    source[5],
    source[9],
    source[13],
    source[2],
    source[6],
    source[10],
    source[14],
    source[3],
    source[7],
    source[11],
    source[15],
  ])
}

export const splitDynamicTransform = (matrixWorld: Matrix4): DynamicTransform => {
  const position = new Vector3()
  const orientation = new Quaternion()
  const scale = new Vector3()
  matrixWorld.decompose(position, orientation, scale)
  if (Math.abs(scale.x) < 1e-8 || Math.abs(scale.y) < 1e-8 || Math.abs(scale.z) < 1e-8)
    throw new RangeError('Dynamic acoustic meshes cannot have a zero scale component')
  return {
    bakedMatrix: new ThreeMatrix4().makeScale(scale.x, scale.y, scale.z),
    rigidMatrix: new ThreeMatrix4().compose(position, orientation, new Vector3(1, 1, 1)),
    scale,
  }
}

export const rigidMatrixForScale = (
  matrixWorld: Matrix4,
  expectedScale: Vector3,
): Matrix4 => {
  const next = splitDynamicTransform(matrixWorld)
  if (next.scale.distanceToSquared(expectedScale) > 1e-10)
    throw new Error('Changing the scale of a dynamic acoustic mesh at runtime is not supported')
  return next.rigidMatrix
}

export const convertGeometry = (
  geometry: BufferGeometry,
  materialInput: AcousticMaterial | readonly AcousticMaterial[],
  matrix: Matrix4 = identity,
): ConvertedGeometry => {
  const position = geometry.getAttribute('position')
  if (position.itemSize < 3)
    throw new Error('Acoustic geometry requires a position attribute with itemSize >= 3')

  const materials: readonly AcousticMaterial[] = Array.isArray(materialInput)
    ? materialInput as readonly AcousticMaterial[]
    : [materialInput as AcousticMaterial]
  if (materials.length === 0)
    throw new Error('Acoustic geometry requires at least one material')
  materials.forEach(validateMaterial)

  const vertices = convertVertices(geometry, matrix)
  const { indices, materialIndices } = convertTriangles(geometry, materials.length, matrix)

  const absorption = new Float32Array(materials.length * 3)
  const scattering = new Float32Array(materials.length)
  const transmission = new Float32Array(materials.length * 3)
  materials.forEach((value, index) => {
    absorption.set(value.absorption, index * 3)
    scattering[index] = value.scattering
    transmission.set(value.transmission ?? [0, 0, 0], index * 3)
  })

  return { absorption, indices, materialIndices, scattering, transmission, vertices }
}
