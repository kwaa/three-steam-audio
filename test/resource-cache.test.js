import assert from 'node:assert/strict'
import test from 'node:test'

import { RenderResourceCache } from '../src/react/resource-cache.ts'

const wait = delay => new Promise(resolve => setTimeout(resolve, delay))

test('reuses StrictMode render initializers and cancels transient effect cleanup', async () => {
  const owner = {}
  const disposed = []
  const cache = new RenderResourceCache(10)
  let created = 0
  const create = () => ({ id: ++created })
  const dispose = resource => disposed.push(resource.id)

  const firstRender = cache.get(owner, ':r0:', create, dispose)
  const strictModeRender = cache.get(owner, ':r0:', create, dispose)
  assert.equal(firstRender, strictModeRender)
  assert.equal(created, 1)

  const firstCleanup = cache.retain(firstRender)
  firstCleanup()
  const finalCleanup = cache.retain(strictModeRender)
  await wait(20)
  assert.deepEqual(disposed, [])

  finalCleanup()
  await wait(20)
  assert.deepEqual(disposed, [1])
})

test('releases render-created resources that never commit', async () => {
  const owner = {}
  const disposed = []
  const cache = new RenderResourceCache(5)
  cache.get(owner, ':abandoned:', () => ({ id: 1 }), resource => disposed.push(resource.id))
  await wait(15)
  assert.deepEqual(disposed, [1])
})
