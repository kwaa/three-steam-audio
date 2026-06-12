import { describe, expect, it } from 'vitest'

import { RenderResourceCache } from '../src/react/resource-cache.ts'

const wait = async (delay: number): Promise<void> => new Promise(resolve => setTimeout(resolve, delay))

interface Resource {
  id: number
}

describe('renderResourceCache', () => {
  it('reuses StrictMode render initializers and cancels transient effect cleanup', async () => {
    const owner = {}
    const disposed: number[] = []
    const cache = new RenderResourceCache<object, Resource>(10)
    let created = 0
    const create = (): Resource => ({ id: ++created })
    const dispose = (resource: Resource) => disposed.push(resource.id)

    const firstRender = cache.get(owner, ':r0:', create, dispose)
    const strictModeRender = cache.get(owner, ':r0:', create, dispose)
    expect(firstRender).toBe(strictModeRender)
    expect(created).toBe(1)

    const firstCleanup = cache.retain(firstRender)
    firstCleanup()
    const finalCleanup = cache.retain(strictModeRender)
    await wait(20)
    expect(disposed).toEqual([])

    finalCleanup()
    await wait(20)
    expect(disposed).toEqual([1])
  })

  it('does not release a render-created resource before a delayed commit', async () => {
    const owner = {}
    const disposed: number[] = []
    const cache = new RenderResourceCache<object, Resource>(5, 30)
    const entry = cache.get(owner, ':slow:', () => ({ id: 1 }), resource => disposed.push(resource.id))

    await wait(15)
    const cleanup = cache.retain(entry)
    await wait(25)
    expect(disposed).toEqual([])

    cleanup()
    await wait(10)
    expect(disposed).toEqual([1])
  })

  it('releases render-created resources that never commit', async () => {
    const owner = {}
    const disposed: number[] = []
    const cache = new RenderResourceCache<object, Resource>(5, 5)
    cache.get(owner, ':abandoned:', () => ({ id: 1 }), resource => disposed.push(resource.id))
    await wait(15)
    expect(disposed).toEqual([1])
  })
})
