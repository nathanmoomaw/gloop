import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import fc from 'fast-check'
import {
  openLearnDB,
  addEntry,
  getAllEntries,
  getMeta,
  setMeta,
  clearEntries,
  migrateFromLocalStorage,
  loadLearnStore,
} from '../src/audio/learnStore.js'

function makeFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('learnStore', () => {
  it('opens DB with entries and meta stores, auto-increments ids, and strips passed-in id', async () => {
    const db = await openLearnDB(new IDBFactory())
    expect(db.objectStoreNames.contains('entries')).toBe(true)
    expect(db.objectStoreNames.contains('meta')).toBe(true)

    const id1 = await addEntry(db, { id: 999, kind: 'heart', t: '1' })
    const id2 = await addEntry(db, { id: 500, kind: 'star', t: '2' })
    expect(id1).toBe(1)
    expect(id2).toBe(2)

    const all = await getAllEntries(db)
    expect(all).toEqual([
      { id: 1, kind: 'heart', t: '1' },
      { id: 2, kind: 'star', t: '2' },
    ])
  })

  it('round-trips getMeta/setMeta including object values and clears entries', async () => {
    const db = await openLearnDB(new IDBFactory())
    expect(await getMeta(db, 'missing')).toBeUndefined()

    const handleLike = { name: 'feedback.jsonl', kind: 'file' }
    await setMeta(db, 'fileHandle', handleLike)
    expect(await getMeta(db, 'fileHandle')).toEqual(handleLike)

    await addEntry(db, { kind: 'sound' })
    expect((await getAllEntries(db)).length).toBe(1)
    await clearEntries(db)
    expect(await getAllEntries(db)).toEqual([])
  })

  it('migrates localStorage once in a single transaction, removes key, and is idempotent', async () => {
    const db = await openLearnDB(new IDBFactory())
    const legacy = [
      { id: 77, kind: 'heart', t: 'a' },
      { kind: 'sound', t: 'b' },
      { kind: 'star', t: 'c' },
    ]
    const storage = makeFakeStorage({ 'gloop.learn.v1': JSON.stringify(legacy) })

    const moved1 = await migrateFromLocalStorage(db, storage)
    expect(moved1).toBe(3)
    expect(storage.map.has('gloop.learn.v1')).toBe(false)

    // Re-populate storage to prove second call checks meta flag and does not duplicate.
    storage.setItem('gloop.learn.v1', JSON.stringify(legacy))
    const moved2 = await migrateFromLocalStorage(db, storage)
    expect(moved2).toBe(0)

    const all = await getAllEntries(db)
    expect(all.map(({ id, ...rest }) => ({ id, ...rest }))).toEqual([
      { id: 1, kind: 'heart', t: 'a' },
      { id: 2, kind: 'sound', t: 'b' },
      { id: 3, kind: 'star', t: 'c' },
    ])
  })

  it('handles bad JSON and throwing storage during migration without throwing', async () => {
    const db1 = await openLearnDB(new IDBFactory())
    const badStorage = makeFakeStorage({ 'gloop.learn.v1': '{broken json' })
    expect(await migrateFromLocalStorage(db1, badStorage)).toBe(0)
    expect(await getAllEntries(db1)).toEqual([])

    const db2 = await openLearnDB(new IDBFactory())
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(await migrateFromLocalStorage(db2, throwingStorage)).toBe(0)
  })

  it('loadLearnStore returns fallback when IDB is missing and migrates end-to-end when present', async () => {
    expect(await loadLearnStore(null, null)).toEqual({ db: null, entries: [] })

    const storage = makeFakeStorage({
      'gloop.learn.v1': JSON.stringify([{ kind: 'star', t: 'now' }]),
    })
    const { db, entries } = await loadLearnStore(new IDBFactory(), storage)
    expect(db).not.toBeNull()
    expect(entries).toEqual([{ id: 1, kind: 'star', t: 'now' }])
  })

  it('property: adding any sequence of entries preserves order in getAllEntries', async () => {
    const entryArb = fc.record({
      kind: fc.string({ maxLength: 10 }),
      v: fc.integer({ min: -1000, max: 1000 }),
    })
    await fc.assert(
      fc.asyncProperty(fc.array(entryArb, { maxLength: 20 }), async (items) => {
        const db = await openLearnDB(new IDBFactory())
        for (const item of items) {
          await addEntry(db, item)
        }
        const got = await getAllEntries(db)
        const stripped = got.map(({ kind, v }) => ({ kind, v }))
        expect(stripped).toEqual(items)
      }),
      { numRuns: 30 },
    )
  })
})

describe('fallback entries', () => {
  it('are imported and cleared on every load, after the one-time migration', async () => {
    const { IDBFactory } = await import('fake-indexeddb')
    const { FALLBACK_KEY, loadLearnStore, saveFallbackEntry } = await import('../src/audio/learnStore.js')
    const map = new Map()
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }
    const idb = new IDBFactory()
    const first = await loadLearnStore(idb, storage)
    first.db.close()
    saveFallbackEntry({ kind: 'heart', t: 'a' }, storage)
    saveFallbackEntry({ kind: 'star', t: 'b' }, storage)
    const second = await loadLearnStore(idb, storage)
    expect(second.entries.map((e) => e.t)).toEqual(['a', 'b'])
    expect(map.has(FALLBACK_KEY)).toBe(false)
    second.db.close()
    const third = await loadLearnStore(idb, storage)
    expect(third.entries).toHaveLength(2)
  })
})
