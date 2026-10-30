// Sends learn entries to gloop's learn Lambda (infra/learn/), which stores
// them in the gloop-learn DynamoDB table, so entries from any device (phone,
// Safari) reach `npm run learn:pull`. Entries wait in a localStorage
// outbox (survives reloads and offline) and go out in batches: after a quiet
// spell, or by sendBeacon when the page is hidden. The body is text/plain
// JSON so the browser sends it without a CORS preflight, which is also what
// lets sendBeacon carry it.
//
// Every entry gets an `id`, and a resend overwrites the same row, so
// sending something twice is harmless. That's what lets a beacon (no
// response to read) leave its batch in the outbox to be resent, and
// lets several tabs share one outbox: it's re-read from storage on every
// change, entries leave it only by id once a send succeeds, and flushes are
// serialized across tabs with the Web Locks API where it exists.
//
// The build carries only the URL. No key; the Lambda checks the origin
// and the fields.

export const OUTBOX_KEY = 'gloop.learn.outbox'
// Where the keyless capture-era build queued entries; folded in on start.
const LEGACY_OUTBOX_KEY = 'gloop.learn.outbox.anon'
const OUTBOX_CAP = 500
// Under the Lambda's 64KB body cap and sendBeacon's 64KB limit, and its
// 50-entry cap per batch.
const MAX_BATCH_BYTES = 48 * 1024
const MAX_BATCH_ENTRIES = 50
const DELAY_MS = 15000
const RETRY_MS = 60000
const LOCK_NAME = 'gloop-learn-outbox'

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // blocked site data: touching localStorage throws
  }
}

function readOutbox(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(OUTBOX_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeOutbox(storage, outbox) {
  try {
    if (outbox.length) storage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
    else storage.removeItem(OUTBOX_KEY)
    return true
  } catch {
    return false
  }
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** The learn store URL, or null when this build has no remote (dev, or unset secret). */
export function remoteUrl(env = import.meta.env) {
  return env.PROD && env.VITE_LEARN_URL ? env.VITE_LEARN_URL : null
}

/**
 * Batching sender: { add(entry), flush({ beacon }), pending(), dispose() }.
 * Deps are injectable for tests.
 */
export function createRemoteSender({
  url,
  host = globalThis.location?.host ?? 'unknown',
  storage = defaultStorage(),
  fetchImpl = (...args) => globalThis.fetch(...args),
  beacon = (u, data) => globalThis.navigator?.sendBeacon?.(u, data) ?? false,
  withLock = (fn) => (globalThis.navigator?.locks ? globalThis.navigator.locks.request(LOCK_NAME, fn) : fn()),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  delayMs = DELAY_MS,
  retryMs = RETRY_MS,
} = {}) {
  // Storage is the truth (shared across tabs) until it fails a read or a
  // write; then this tab keeps its outbox in memory for the session.
  let storageOk = !!storage
  try {
    storage?.getItem(OUTBOX_KEY)
    const legacy = storage?.getItem(LEGACY_OUTBOX_KEY)
    if (legacy) {
      let old = []
      try {
        old = JSON.parse(legacy)
      } catch {
        // Unreadable: nothing to fold in.
      }
      // Only drop the old outbox once its entries are safely in the new one.
      if (!Array.isArray(old) || writeOutbox(storage, [...readOutbox(storage), ...old].slice(-OUTBOX_CAP))) {
        storage.removeItem(LEGACY_OUTBOX_KEY)
      }
    }
  } catch {
    storageOk = false
  }
  let memory = []
  let timer = null
  let inFlight = false

  const load = () => (storageOk ? readOutbox(storage) : memory)
  const save = (outbox) => {
    if (storageOk && writeOutbox(storage, outbox)) return
    storageOk = false
    memory = outbox
  }

  const schedule = (ms) => {
    if (timer) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      return flush()
    }, ms)
  }

  // Oldest entries, up to MAX_BATCH_BYTES of body or MAX_BATCH_ENTRIES.
  const takeBatch = (outbox) => {
    const batch = []
    let bytes = 64
    for (const entry of outbox.slice(0, MAX_BATCH_ENTRIES)) {
      const size = JSON.stringify(entry).length + 1
      if (batch.length && bytes + size > MAX_BATCH_BYTES) break
      batch.push(entry)
      bytes += size
    }
    return batch
  }

  const body = (batch) => JSON.stringify({ host, entries: batch })

  const remove = (batch) => {
    const sent = new Set(batch.map((e) => e.id))
    save(load().filter((e) => !sent.has(e.id)))
  }

  async function flush({ beacon: useBeacon = false } = {}) {
    if (useBeacon) {
      // Page is going away: hand it to the browser and leave it in the
      // outbox — the next visit resends it over the same rows.
      const batch = takeBatch(load())
      if (batch.length) beacon(url, new Blob([body(batch)], { type: 'text/plain' }))
      return
    }
    if (inFlight) return
    inFlight = true
    try {
      await withLock(async () => {
        const batch = takeBatch(load())
        if (!batch.length) return
        let resp
        try {
          resp = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body(batch) })
        } catch {
          schedule(retryMs) // offline
          return
        }
        if (resp.ok || resp.status === 400 || resp.status === 413) {
          // Sent, or never going to be accepted as is: either way, out.
          remove(batch)
          if (load().length) schedule(0)
        } else {
          schedule(retryMs) // 403 (origin not allowed yet), 429, 5xx: try again later
        }
      })
    } finally {
      inFlight = false
    }
  }

  return {
    add(entry) {
      save([...load(), { ...entry, id: newId() }].slice(-OUTBOX_CAP))
      schedule(delayMs)
    },
    flush,
    pending: () => load().length,
    dispose() {
      if (timer) clearTimer(timer)
      timer = null
    },
  }
}
