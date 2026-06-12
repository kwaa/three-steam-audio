import assert from 'node:assert/strict'
import test from 'node:test'

import { connectManagedAudioEdges } from '../src/worker/audio-connections.ts'

test('disconnects only the audio edges established by React glue', () => {
  const inputConnections = []
  const inputDisconnections = []
  const outputConnections = []
  const outputDisconnections = []
  const destination = {}
  const node = {
    connect: target => outputConnections.push(target),
    disconnect: target => outputDisconnections.push(target),
  }
  const input = {
    connect: target => inputConnections.push(target),
    disconnect: target => inputDisconnections.push(target),
  }

  const cleanup = connectManagedAudioEdges(input, node, destination)
  assert.deepEqual(inputConnections, [node])
  assert.deepEqual(outputConnections, [destination])
  cleanup()
  assert.deepEqual(inputDisconnections, [node])
  assert.deepEqual(outputDisconnections, [destination])
  assert.ok(!outputDisconnections.includes(undefined))
})
