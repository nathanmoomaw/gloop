import { randomUUID } from 'node:crypto'

// Pure learn-entry validation and request handling, separated from AWS SDK
// imports so tests run without stubbing DynamoDB.

export const KINDS = new Set([
  'heart',
  'sound',
  'muted',
  'star',
  'settle',
  'linger',
  'rescue',
  'pick',
])
export const MAX_BODY = 64 * 1024
export const MAX_ENTRIES = 50
export const MAX_KEYS = 40

const STATE_KEYS = ['listening', 'playing', 'thru', 'rawMic']

function numericFields(obj) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj).slice(0, MAX_KEYS)) {
    if (/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(k) && typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v
    }
  }
  return out
}

export function cleanHost(host) {
  return typeof host === 'string' && /^[a-z0-9.:-]{1,80}$/i.test(host) ? host : 'unknown'
}

// Re-serialize only known fields with known types so an open endpoint cannot
// store arbitrary text. Invalid/missing client ids get a fresh UUID so the row
// still lands; resend dedupe only applies to valid client ids.
export function cleanEntry(entry, host, now = new Date()) {
  if (!entry || typeof entry !== 'object' || !KINDS.has(entry.kind)) return null
  const isoNow = now.toISOString()
  const t =
    typeof entry.t === 'string' && /^[0-9TZ:.+-]{10,30}$/.test(entry.t) ? entry.t : isoNow
  const id =
    typeof entry.id === 'string' && /^[a-z0-9]{6,40}$/.test(entry.id)
      ? entry.id
      : randomUUID().replace(/-/g, '')
  const day = /^\d{4}-\d{2}-\d{2}$/.test(t.slice(0, 10)) ? t.slice(0, 10) : isoNow.slice(0, 10)
  return {
    day,
    id,
    t,
    kind: entry.kind,
    params: numericFields(entry.params),
    levels: numericFields(entry.levels),
    state: Object.fromEntries(STATE_KEYS.map((k) => [k, entry.state?.[k] === true])),
    host,
  }
}

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return v
  }
  return undefined
}

export function createHandler({ writeItems, allowedOrigins = [] }) {
  const allowed = new Set(allowedOrigins)

  return async function handler(event) {
    const origin = getHeader(event?.headers, 'origin')
    const isAllowed = Boolean(origin && allowed.has(origin))
    const cors = isAllowed
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'content-type',
          Vary: 'Origin',
        }
      : {}
    const reply = (statusCode, body) => ({ statusCode, headers: cors, body })

    const method = event?.requestContext?.http?.method
    if (method === 'OPTIONS') return reply(204, '')
    if (method !== 'POST') return reply(405, 'method')

    // CORS only binds browsers; reject non-allowed origins in the handler too.
    if (!isAllowed) return reply(403, 'forbidden')

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    if (raw.length > MAX_BODY) return reply(413, 'too big')

    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(400, 'bad json')
    }

    if (
      !body ||
      !Array.isArray(body.entries) ||
      body.entries.length === 0 ||
      body.entries.length > MAX_ENTRIES
    ) {
      return reply(400, 'entries')
    }

    const host = cleanHost(body.host)
    const items = body.entries.map((e) => cleanEntry(e, host)).filter(Boolean)
    if (!items.length) return reply(400, 'no valid entries')

    try {
      await writeItems(items)
    } catch (err) {
      console.error('Failed to write learn batch:', err)
      return reply(502, 'write failed')
    }

    return reply(204, '')
  }
}
