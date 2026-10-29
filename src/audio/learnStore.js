import { loadLog } from './learn.js'

/** IndexedDB database name for learn-mode feedback entries. */
export const DB_NAME = 'gloop-learn'

/** IndexedDB schema version for learn-mode store. */
export const DB_VERSION = 1

const ENTRIES_STORE = 'entries'
const META_STORE = 'meta'
const MIGRATED_KEY = 'migratedLocalStorage'

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
  })
}

function stripId(entry) {
  const copy = { ...(entry || {}) }
  delete copy.id
  return copy
}

/** Open (and upgrade if needed) the learn-mode IndexedDB database. */
export function openLearnDB(idb = globalThis.indexedDB) {
  if (!idb || typeof idb.open !== 'function') {
    return Promise.reject(new Error('IndexedDB is not available'))
  }
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        db.createObjectStore(ENTRIES_STORE, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Add a feedback entry (ignoring any existing id) and resolve with its new id. */
export async function addEntry(db, entry) {
  const tx = db.transaction(ENTRIES_STORE, 'readwrite')
  const store = tx.objectStore(ENTRIES_STORE)
  const request = store.add(stripId(entry))
  const [id] = await Promise.all([req(request), done(tx)])
  return id
}

/** Return all stored feedback entries ordered by ascending id. */
export function getAllEntries(db) {
  const tx = db.transaction(ENTRIES_STORE, 'readonly')
  return req(tx.objectStore(ENTRIES_STORE).getAll())
}

/** Read a metadata value by key, or undefined if not set. */
export function getMeta(db, key) {
  const tx = db.transaction(META_STORE, 'readonly')
  return req(tx.objectStore(META_STORE).get(key))
}

/** Store a structured-cloneable metadata value under key. */
export async function setMeta(db, key, value) {
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).put(value, key)
  await done(tx)
}

/** Remove all entries from the entries store. */
export async function clearEntries(db) {
  const tx = db.transaction(ENTRIES_STORE, 'readwrite')
  tx.objectStore(ENTRIES_STORE).clear()
  await done(tx)
}

function readLegacyEntries(storage, key) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return []
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** One-shot migration from legacy localStorage into IndexedDB inside a single transaction. */
export async function migrateFromLocalStorage(db, storage = globalThis.localStorage, key = 'gloop.learn.v1') {
  if ((await getMeta(db, MIGRATED_KEY)) === true) return 0
  return moveFromStorage(db, storage, key, true)
}

/** localStorage key for presses whose db write failed; imported and cleared on every load. */
export const FALLBACK_KEY = 'gloop.learn.fallback'

/** Park one entry in FALLBACK_KEY (used when the db is open but a write fails). Never throws. */
export function saveFallbackEntry(entry, storage = globalThis.localStorage) {
  try {
    storage.setItem(FALLBACK_KEY, JSON.stringify([...readLegacyEntries(storage, FALLBACK_KEY), entry]))
  } catch {
    // Nowhere left to put it.
  }
}

// Moves a localStorage array of entries into the db in one transaction
// (plus the migrated flag when asked), then removes the key.
async function moveFromStorage(db, storage, key, setMigrated) {
  const items = readLegacyEntries(storage, key)
  if (!items.length && !setMigrated) return 0
  const tx = db.transaction([ENTRIES_STORE, META_STORE], 'readwrite')
  const entriesStore = tx.objectStore(ENTRIES_STORE)
  let moved = 0
  for (const item of items) {
    if (item && typeof item === 'object') {
      entriesStore.add(stripId(item))
      moved++
    }
  }
  if (setMigrated) tx.objectStore(META_STORE).put(true, MIGRATED_KEY)
  await done(tx)
  try {
    if (storage && typeof storage.removeItem === 'function') {
      storage.removeItem(key)
    }
  } catch {
    // Ignore storage cleanup errors after successful commit.
  }
  return moved
}

/** Open DB, run legacy migration, and load all entries; never throws (falls back to the localStorage log). */
export async function loadLearnStore(idb = globalThis.indexedDB, storage = globalThis.localStorage) {
  let db
  try {
    db = await openLearnDB(idb)
  } catch {
    // No IndexedDB (private mode): the localStorage log is all there is.
    return { db: null, entries: loadLog(storage) }
  }
  try {
    await migrateFromLocalStorage(db, storage)
    await moveFromStorage(db, storage, FALLBACK_KEY, false)
    return { db, entries: await getAllEntries(db) }
  } catch {
    // The db opened, so keep saving there even if reading it back failed.
    return { db, entries: [] }
  }
}
