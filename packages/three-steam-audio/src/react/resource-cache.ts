export interface ResourceLease<T> {
  references: number
  resource: T
  timer?: ReturnType<typeof setTimeout>
}

interface ManagedResourceLease<T> extends ResourceLease<T> {
  dispose: (resource: T) => void
  remove: () => void
}

export class RenderResourceCache<Owner extends object, Resource> {
  readonly #abandonedReleaseDelay: number
  readonly #byOwner = new WeakMap<Owner, Map<string, ManagedResourceLease<Resource>>>()
  readonly #releaseDelay: number

  constructor(releaseDelay = 50, abandonedReleaseDelay = 30_000) {
    this.#abandonedReleaseDelay = abandonedReleaseDelay
    this.#releaseDelay = releaseDelay
  }

  get(
    owner: Owner,
    id: string,
    create: () => Resource,
    dispose: (resource: Resource) => void,
  ): ResourceLease<Resource> {
    let byId = this.#byOwner.get(owner)
    if (!byId) {
      byId = new Map()
      this.#byOwner.set(owner, byId)
    }
    let entry = byId.get(id)
    if (!entry) {
      entry = {
        dispose,
        references: 0,
        remove: () => byId.delete(id),
        resource: create(),
      }
      byId.set(id, entry)
      this.#scheduleRelease(entry, this.#abandonedReleaseDelay)
    }
    return entry
  }

  retain(entry: ResourceLease<Resource>): () => void {
    const managed = entry as ManagedResourceLease<Resource>
    if (managed.timer !== undefined)
      clearTimeout(managed.timer)
    managed.timer = undefined
    managed.references++
    return () => {
      managed.references--
      this.#scheduleRelease(managed)
    }
  }

  #scheduleRelease(
    entry: ManagedResourceLease<Resource>,
    delay = this.#releaseDelay,
  ): void {
    entry.timer = setTimeout(() => {
      if (entry.references !== 0)
        return
      entry.dispose(entry.resource)
      entry.remove()
    }, delay)
  }
}
