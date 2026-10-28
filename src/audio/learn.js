import { SOUND_BOUNDS, soundFix } from './sound.js'

// Learn mode: four quick feedback buttons log the current parameters and
// audio levels, while positive feedback steers the `sound` reset toward
// whatever settings actually worked for the listener's room and gear.

/** Feedback button definitions in display order. */
export const FEEDBACK = [
  { id: 'heart', emoji: '❤️', label: 'sounds good', weight: 2 },
  { id: 'sound', emoji: '🔊', label: 'working', weight: 1 },
  { id: 'muted', emoji: '🔇', label: 'no sound', weight: 0 },
  { id: 'star', emoji: '⭐', label: 'dialed in', weight: 3 },
]

/** Lookup table mapping feedback id to its definition. */
export const FEEDBACK_BY_ID = Object.fromEntries(FEEDBACK.map((f) => [f.id, f]))

/** localStorage key for persisted learn entries. */
export const LOG_KEY = 'gloop.learn.v1'

/** Maximum number of entries retained in the log. */
export const LOG_CAP = 2000

const LOG_SPACE_KEYS = new Set(['rate', 'grainSizeMs'])

function round4(x) {
  return Math.round(x * 1e4) / 1e4
}

/** Build a clean, rounded, deep-copied log entry for a feedback press. */
export function makeEntry(kind, params = {}, levels = {}, state = {}, now = Date.now()) {
  if (!Object.prototype.hasOwnProperty.call(FEEDBACK_BY_ID, kind)) {
    throw new Error(`Unknown feedback kind: ${kind}`)
  }
  const cleanParams = {}
  for (const [k, v] of Object.entries(params || {})) {
    cleanParams[k] = typeof v === 'number' && Number.isFinite(v) ? round4(v) : v
  }
  const numLevel = (v) => (typeof v === 'number' && Number.isFinite(v) ? round4(v) : 0)
  return {
    t: new Date(now).toISOString(),
    kind,
    params: cleanParams,
    levels: {
      input: numLevel(levels?.input),
      output: numLevel(levels?.output),
      grainsPerSec: numLevel(levels?.grainsPerSec),
    },
    state: {
      listening: Boolean(state?.listening),
      playing: Boolean(state?.playing),
      thru: Boolean(state?.thru),
      rawMic: Boolean(state?.rawMic),
    },
  }
}

/** Compute recency- and kind-weighted target params from positive entries. */
export function learnedTarget(entries, halfLife = 50) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const n = entries.length
  const weighted = []
  for (let i = 0; i < n; i++) {
    const e = entries[i]
    const spec = e && FEEDBACK_BY_ID[e.kind]
    if (!spec || spec.weight <= 0) continue
    // A like while the grains weren't sounding (off, or muted by thru)
    // rated something else, so it doesn't teach the target.
    if (e.state && (e.state.playing === false || e.state.thru === true)) continue
    const recency = 0.5 ** ((n - 1 - i) / halfLife)
    const w = spec.weight * recency
    if (w > 0 && Number.isFinite(w)) {
      weighted.push({ params: e.params || {}, w })
    }
  }
  if (weighted.length === 0) return null

  const out = {}
  for (const key of Object.keys(SOUND_BOUNDS)) {
    const isLog = LOG_SPACE_KEYS.has(key)
    let sumW = 0
    let acc = 0
    for (const { params, w } of weighted) {
      const v = params[key]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (isLog && v <= 0) continue
      sumW += w
      acc += w * (isLog ? Math.log(v) : v)
    }
    if (sumW > 0) {
      out[key] = isLog ? Math.exp(acc / sumW) : acc / sumW
    }
  }
  return out
}

/** Pull out-of-range params into SOUND_BOUNDS using learnedTarget when available. */
export function learnedSoundFix(params, entries, rng = Math.random) {
  return soundFix(params, rng, learnedTarget(entries))
}

/** Return a new log array with entry appended and oldest trimmed to cap. */
export function appendEntry(log, entry, cap = LOG_CAP) {
  const base = Array.isArray(log) ? log : []
  if (cap <= 0) return []
  const next = [...base, entry]
  return next.length > cap ? next.slice(next.length - cap) : next
}

/** Safely load the entry array from storage, returning [] on any issue. */
export function loadLog(storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return []
    const raw = storage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Safely persist the entry array to storage, returning true on success. */
export function saveLog(log, storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false
    storage.setItem(LOG_KEY, JSON.stringify(log))
    return true
  } catch {
    return false
  }
}

/** Serialize log entries as newline-delimited JSON. */
export function toJSONL(log) {
  if (!Array.isArray(log) || log.length === 0) return ''
  return log.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

/** Count total and per-kind feedback entries. */
export function summarize(log) {
  const byKind = { heart: 0, sound: 0, muted: 0, star: 0 }
  let total = 0
  if (Array.isArray(log)) {
    for (const e of log) {
      total++
      if (e && Object.prototype.hasOwnProperty.call(byKind, e.kind)) {
        byKind[e.kind]++
      }
    }
  }
  return { total, byKind }
}

// Level dials a 🔇 press turns up when nothing is out of range and there's
// no learned target yet — the ones that decide whether anything is heard.
const LEVEL_KEYS = ['volume', 'granularMix', 'delayMix', 'sensitivity']

/**
 * What a 🔇 press changes: learnedSoundFix first. If every dial is already
 * in range (and it's still silent), go all the way to the learned target,
 * or with no history push the level dials halfway to the top of their range.
 */
export function mutedFix(params, entries, rng = Math.random) {
  const target = learnedTarget(entries)
  const fix = soundFix(params, rng, target)
  if (Object.keys(fix).length) return fix
  const out = {}
  if (target) {
    for (const [name, value] of Object.entries(target)) {
      const [lo, hi] = SOUND_BOUNDS[name]
      const next = Math.min(hi, Math.max(lo, value))
      // Log-space averaging doesn't round-trip exactly; skip float noise.
      if (Math.abs(next - params[name]) > 1e-6) out[name] = next
    }
    // Already at the target and still silent: fall through to the levels.
    if (Object.keys(out).length) return out
  }
  for (const name of LEVEL_KEYS) {
    const hi = SOUND_BOUNDS[name][1]
    const next = params[name] + (hi - params[name]) / 2
    if (next !== params[name]) out[name] = next
  }
  return out
}
