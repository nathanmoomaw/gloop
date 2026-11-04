import { describe, it, expect } from 'vitest'
import {
  OUTBOX_KEY,
  SID_KEY,
  TESTER_KEY,
  clientTags,
  createRemoteSender,
  deviceClass,
  markNoticeSeen,
  noticeSeen,
  optedOut,
  remoteUrl,
} from '../src/audio/learnRemote.js'

function fakeStorage(init = {}) {
  const map = new Map(Object.entries(init))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    map,
  }
}

// Manual timers: run() fires whatever is scheduled.
function fakeTimers() {
  let next = null
  return {
    setTimer: (fn) => (next = fn),
    clearTimer: () => (next = null),
    run: async () => {
      const fn = next
      next = null
      await fn?.()
    },
    scheduled: () => next !== null,
  }
}

const entry = (t) => ({ t, kind: 'heart', params: {}, levels: {}, state: {} })

describe('remoteUrl', () => {
  it('is off in dev or without the URL', () => {
    expect(remoteUrl({ PROD: false, VITE_LEARN_URL: 'u' })).toBeNull()
    expect(remoteUrl({ PROD: true })).toBeNull()
    expect(remoteUrl({ PROD: true, VITE_LEARN_URL: 'u' })).toBe('u')
  })
})

describe('createRemoteSender', () => {
  it('batches adds and sends them after the delay as text/plain', async () => {
    const calls = []
    const timers = fakeTimers()
    const storage = fakeStorage()
    const s = createRemoteSender({ url: 'U', host: 'h', storage, ...timers, fetchImpl: async (u, o) => (calls.push([u, o]), { ok: true }) })
    s.add(entry('a'))
    s.add(entry('b'))
    expect(calls).toHaveLength(0)
    expect(JSON.parse(storage.getItem(OUTBOX_KEY))).toHaveLength(2)
    await timers.run()
    expect(calls).toHaveLength(1)
    expect(calls[0][1].headers['Content-Type']).toBe('text/plain')
    const sent = JSON.parse(calls[0][1].body)
    expect('key' in sent).toBe(false)
    expect(sent.host).toBe('h')
    expect(sent.entries.map(({ id, ...e }) => (expect(id).toMatch(/^[a-z0-9]+$/), e))).toEqual([entry('a'), entry('b')])
    expect(s.pending()).toBe(0)
    expect(storage.getItem(OUTBOX_KEY)).toBeNull()
  })

  it('keeps the outbox and retries on 5xx, 429, 403 and network errors', async () => {
    for (const fail of [async () => ({ ok: false, status: 502 }), async () => ({ ok: false, status: 429 }), async () => ({ ok: false, status: 403 }), async () => { throw new Error('offline') }]) {
      const timers = fakeTimers()
      const s = createRemoteSender({ url: 'U', storage: fakeStorage(), ...timers, fetchImpl: fail })
      s.add(entry('a'))
      await timers.run()
      expect(s.pending()).toBe(1)
      expect(timers.scheduled()).toBe(true)
    }
  })

  it('drops a batch the server rejects for good (400/413)', async () => {
    const timers = fakeTimers()
    const s = createRemoteSender({ url: 'U', storage: fakeStorage(), ...timers, fetchImpl: async () => ({ ok: false, status: 413 }) })
    s.add(entry('a'))
    await timers.run()
    expect(s.pending()).toBe(0)
  })

  it('picks up an outbox left by an earlier page load', async () => {
    const calls = []
    const storage = fakeStorage({ [OUTBOX_KEY]: JSON.stringify([{ ...entry('old'), id: 'x1' }]) })
    const s = createRemoteSender({ url: 'U', storage, ...fakeTimers(), fetchImpl: async (u, o) => (calls.push(o), { ok: true }) })
    expect(s.pending()).toBe(1)
    await s.flush()
    expect(JSON.parse(calls[0].body).entries).toEqual([{ ...entry('old'), id: 'x1' }])
  })

  it('caps each request at ~48KB and chains the rest', async () => {
    const sizes = []
    const timers = fakeTimers()
    const s = createRemoteSender({ url: 'U', storage: fakeStorage(), ...timers, fetchImpl: async (u, o) => (sizes.push(o.body.length), { ok: true }) })
    const big = (t) => ({ ...entry(t), params: { pad: 'x'.repeat(1000) } })
    for (let i = 0; i < 80; i++) s.add(big(String(i)))
    await timers.run()
    await timers.run()
    expect(sizes.length).toBe(2)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(48 * 1024)
    expect(s.pending()).toBe(0)
  })

  it('a beacon flush leaves the batch for the next visit to resend', async () => {
    let sent = null
    const s = createRemoteSender({ url: 'U', storage: fakeStorage(), ...fakeTimers(), beacon: (u, blob) => ((sent = blob), true) })
    s.add(entry('a'))
    await s.flush({ beacon: true })
    expect(sent).toBeInstanceOf(Blob)
    expect(s.pending()).toBe(1)
  })

  it('two tabs share one outbox without losing each other\'s presses', async () => {
    const storage = fakeStorage()
    const bodies = []
    const fetchImpl = async (u, o) => (bodies.push(JSON.parse(o.body).entries.map((e) => e.t)), { ok: true })
    const a = createRemoteSender({ url: 'U', storage, ...fakeTimers(), fetchImpl })
    const b = createRemoteSender({ url: 'U', storage, ...fakeTimers(), fetchImpl })
    a.add(entry('a1'))
    b.add(entry('b1'))
    a.add(entry('a2'))
    expect(b.pending()).toBe(3)
    await b.flush()
    await a.flush()
    expect(bodies).toEqual([['a1', 'b1', 'a2']])
    expect(a.pending()).toBe(0)
  })

  it('keeps an entry added while a send was in flight', async () => {
    const storage = fakeStorage()
    let release
    const s = createRemoteSender({ url: 'U', storage, ...fakeTimers(), fetchImpl: () => new Promise((r) => (release = () => r({ ok: true }))) })
    s.add(entry('a'))
    const flushing = s.flush()
    await Promise.resolve()
    s.add(entry('b'))
    release()
    await flushing
    expect(JSON.parse(storage.getItem(OUTBOX_KEY)).map((e) => e.t)).toEqual(['b'])
  })

  it('works (in memory) when localStorage throws', async () => {
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    const calls = []
    const s = createRemoteSender({ url: 'U', storage: throwing, ...fakeTimers(), fetchImpl: async (u, o) => (calls.push(o), { ok: true }) })
    s.add(entry('a'))
    expect(s.pending()).toBe(1)
    await s.flush()
    expect(JSON.parse(calls[0].body).entries[0].t).toBe('a')
    expect(s.pending()).toBe(0)
  })

  it('falls back to memory when writes start failing (storage full)', async () => {
    const storage = fakeStorage()
    storage.setItem = () => { throw new Error('quota') }
    const calls = []
    const s = createRemoteSender({ url: 'U', storage, ...fakeTimers(), fetchImpl: async (u, o) => (calls.push(o), { ok: true }) })
    s.add(entry('a'))
    s.add(entry('b'))
    expect(s.pending()).toBe(2)
    await s.flush()
    expect(JSON.parse(calls[0].body).entries.map((e) => e.t)).toEqual(['a', 'b'])
  })

  it('caps each request at 50 entries and chains the rest', async () => {
    const counts = []
    const timers = fakeTimers()
    const s = createRemoteSender({ url: 'U', storage: fakeStorage(), ...timers, fetchImpl: async (u, o) => (counts.push(JSON.parse(o.body).entries.length), { ok: true }) })
    for (let i = 0; i < 120; i++) s.add(entry(String(i)))
    for (let i = 0; i < 3; i++) await timers.run()
    expect(counts).toEqual([50, 50, 20])
  })
})

describe('optedOut', () => {
  it('honors GPC and DNT, nothing else', () => {
    expect(optedOut({ globalPrivacyControl: true })).toBe(true)
    expect(optedOut({ doNotTrack: '1' })).toBe(true)
    expect(optedOut({ doNotTrack: '0', globalPrivacyControl: false })).toBe(false)
    expect(optedOut(undefined)).toBe(false)
  })
})

describe('deviceClass', () => {
  it('maps user agents to ios/android/desktop', () => {
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe('ios')
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('ios')
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe('desktop')
    expect(deviceClass({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' })).toBe('android')
    expect(deviceClass(undefined)).toBe('desktop')
  })
})

describe('clientTags', () => {
  const nav = { userAgent: 'x' }

  it('keeps a ?tester= name and one sid across visits', () => {
    const storage = fakeStorage()
    const first = clientTags({ search: '?tester=Nic', storage, nav })
    expect(first).toMatchObject({ tester: 'nic', device: 'desktop' })
    expect(first.sid).toMatch(/^[a-z0-9]{6,24}$/)
    const later = clientTags({ search: '', storage, nav })
    expect(later).toEqual(first)
    expect(storage.getItem(TESTER_KEY)).toBe('nic')
  })

  it('ignores a bad tester name and a bad stored sid', () => {
    const storage = fakeStorage({ [SID_KEY]: 'BAD!' })
    const tags = clientTags({ search: '?tester=<script>', storage, nav })
    expect('tester' in tags).toBe(false)
    expect(tags.sid).not.toBe('BAD!')
    expect(storage.getItem(SID_KEY)).toBe(tags.sid)
  })

  it('still tags when storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const tags = clientTags({ search: '?tester=amy', storage, nav })
    expect(tags.tester).toBe('amy')
    expect(tags.sid).toMatch(/^[a-z0-9]{6,24}$/)
  })

  it('rides along in the batch body without overriding host or entries', async () => {
    const calls = []
    const timers = fakeTimers()
    const tags = { tester: 'nic', sid: 'abc123', device: 'ios', host: 'evil', entries: [] }
    const s = createRemoteSender({ url: 'U', host: 'h', tags, storage: fakeStorage(), ...timers, fetchImpl: async (u, o) => (calls.push(o), { ok: true }) })
    s.add(entry('a'))
    await timers.run()
    const sent = JSON.parse(calls[0].body)
    expect(sent).toMatchObject({ tester: 'nic', sid: 'abc123', device: 'ios', host: 'h' })
    expect(sent.entries).toHaveLength(1)
  })
})

describe('sharing notice', () => {
  it('stays hidden once seen, shows when storage is blocked', () => {
    const storage = fakeStorage()
    expect(noticeSeen(storage)).toBe(false)
    markNoticeSeen(storage)
    expect(noticeSeen(storage)).toBe(true)
    expect(noticeSeen({ getItem: () => { throw new Error('blocked') } })).toBe(false)
  })
})
