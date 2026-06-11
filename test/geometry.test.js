import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'

import {
  convertGeometry,
  matrixToRowMajor,
  rigidMatrixForScale,
  splitDynamicTransform,
} from '../src/geometry.ts'

const concrete = {
  absorption: [0.1, 0.2, 0.3],
  scattering: 0.4,
  transmission: [0.5, 0.6, 0.7],
}

test('converts interleaved indexed geometry, drawRange, groups, and negative winding', () => {
  const geometry = new BufferGeometry()
  const interleaved = new InterleavedBuffer(new Float32Array([
    0,
    0,
    0,
    99,
    1,
    0,
    0,
    99,
    1,
    1,
    0,
    99,
    0,
    1,
    0,
    99,
  ]), 4)
  geometry.setAttribute('position', new InterleavedBufferAttribute(interleaved, 3, 0))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)
  geometry.setDrawRange(3, 3)

  const converted = convertGeometry(
    geometry,
    [concrete, { ...concrete, scattering: 0.8 }],
    new Matrix4().makeScale(-2, 3, 1),
  )

  assert.deepEqual([...converted.indices], [0, 3, 2])
  assert.deepEqual([...converted.materialIndices], [1])
  assert.deepEqual([...converted.vertices], [
    0,
    0,
    0,
    -2,
    0,
    0,
    -2,
    3,
    0,
    0,
    3,
    0,
  ])
  assert.deepEqual([...converted.transmission.slice(3)], [
    0.5,
    0.6000000238418579,
    0.699999988079071,
  ])
})

test('transposes Three.js Matrix4 elements for Steam Audio row-major input', () => {
  const matrix = new Matrix4().set(
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
  )
  assert.deepEqual([...matrixToRowMajor(matrix)], [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
  ])
})

test('bakes dynamic scale and rejects runtime scale changes', () => {
  const initial = new Matrix4().compose(
    new Vector3(1, 2, 3),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5),
    new Vector3(2, 3, 4),
  )
  const split = splitDynamicTransform(initial)
  assert.ok(split.scale.equals(new Vector3(2, 3, 4)))
  assert.ok(new Vector3().setFromMatrixScale(split.rigidMatrix).equals(new Vector3(1, 1, 1)))

  const moved = new Matrix4().compose(
    new Vector3(4, 5, 6),
    new Quaternion(),
    new Vector3(2, 3, 4),
  )
  assert.doesNotThrow(() => rigidMatrixForScale(moved, split.scale))

  const rescaled = new Matrix4().makeScale(2, 3, 5)
  assert.throws(
    () => rigidMatrixForScale(rescaled, split.scale),
    /Changing the scale/,
  )
})
