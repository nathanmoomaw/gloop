// Sends learn presses to the capture Lambda's /learn route, which appends
// them to LIFE/learn/gloop/<date>.jsonl — so presses from any device (phone,
// Safari) reach Claude via the LIFE repo. Presses wait in a localStorage
// outbox (survives reloads and offline) and go out in batches: after a quiet
// spell, or by sendBeacon when the page is hidden. The body is text/plain
// JSON so the browser sends it without a CORS preflight, which is also what
// lets sendBeacon carry it.
//
// Every press gets an `id`, and the Lambda skips ids already in the day's
// file, so sending something twice is harmless. That's what lets a beacon
// (no response to read) leave its batch in the outbox to be resent, and
// lets several tabs share one outbox: it's re-read from storage on every
// change, entries leave it only by id once a send succeeds, and flushes are
// serialized across tabs with the Web Locks API where it exists.
//
// The build carries only the URL. The key is pasted into the learn panel
// once per device and kept in that browser, so only paired devices send:
// it never ships in the bundle, and other people's presses stay local.

export const OUTBOX_KEY = 'gloop.learn.outbox'
export const PAIR_KEY = 'gloop.learn.key'
const OUTBOX_CAP = 500
// Under the Lambda's 64KB body cap and sendBeacon's 64KB limit.
const MAX_BATCH_BYTES = 48 * 1024
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

/** The capture URL, or null when this build has no remote (dev, or unset secret). */
export function remoteUrl(env = import.meta.env) {
  return env.PROD && env.VITE_LEARN_URL ? env.VITE_LEARN_URL : null
}

/** This device's pairing key, or '' when it isn't paired. */
export function loadPairKey(storage = defaultStorage()) {
  try {
    return storage?.getItem(PAIR_KEY) || ''
  } catch {
    return ''
  }
}

/** Saves (or, with '', clears) the pairing key. False if storage refused it. */
export function savePairKey(key, storage = defaultStorage()) {
  try {
    if (key) storage.setItem(PAIR_KEY, key)
    else storage.removeItem(PAIR_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Batching sender: { add(entry), flush({ beacon }), pending(), dispose() }.
 * `onRejected` fires on a 401 (wrong or revoked key); the outbox is kept. Deps are injectable
 * for tests.
 */
export function createRemoteSender({
  url,
  key,
  onRejected = () => {},
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

  // Oldest entries, up to MAX_BATCH_BYTES of body.
  const takeBatch = (outbox) => {
    const batch = []
    let bytes = 64
    for (const entry of outbox) {
      const size = JSON.stringify(entry).length + 1
      if (batch.length && bytes + size > MAX_BATCH_BYTES) break
      batch.push(entry)
      bytes += size
    }
    return batch
  }

  const body = (batch) => JSON.stringify({ key, host, entries: batch })

  const remove = (batch) => {
    const sent = new Set(batch.map((e) => e.id))
    save(load().filter((e) => !sent.has(e.id)))
  }

  async function flush({ beacon: useBeacon = false } = {}) {
    if (useBeacon) {
      // Page is going away: hand it to the browser and leave it in the
      // outbox — the next visit resends it and the Lambda skips the dupes.
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
        if (resp.status === 401) {
          // Wrong or revoked key: keep the presses for the next pairing.
          onRejected()
        } else if (resp.ok || resp.status === 400 || resp.status === 413) {
          // Sent, or never going to be accepted as is: either way, out.
          remove(batch)
          if (load().length) schedule(0)
        } else {
          schedule(retryMs) // 429 (day full) / 5xx: try again later
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
