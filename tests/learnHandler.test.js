import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import {
  KINDS,
  MAX_BODY,
  MAX_ENTRIES,
  cleanEntry,
  cleanHost,
  createHandler,
} from '../infra/learn/handler.mjs'
import { unmarshal, toEntry, lastDays } from '../scripts/learn-pull.mjs'

const ALLOWED = ['https://gloop.obfusco.us', 'https://gloop-dev.obfusco.us']

function makeEvent({
  method = 'POST',
  origin = 'https://gloop.obfusco.us',
  originKey = 'origin',
  body = '',
  isBase64Encoded = false,
} = {}) {
  const headers = origin !== undefined ? { [originKey]: origin } : {}
  return {
    requestContext: { http: { method } },
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded,
  }
}

describe('learn Lambda handler', () => {
  it('handles OPTIONS preflight with CORS only for allowed origins', async () => {
    const writeItems = vi.fn()
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })

    const ok = await handler(makeEvent({ method: 'OPTIONS' }))
    expect(ok.statusCode).toBe(204)
    expect(ok.body).toBe('')
    expect(ok.headers['Access-Control-Allow-Origin']).toBe('https://gloop.obfusco.us')
    expect(ok.headers.Vary).toBe('Origin')

    const other = await handler(makeEvent({ method: 'OPTIONS', origin: 'https://evil.example' }))
    expect(other.statusCode).toBe(204)
    expect(other.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('rejects non-POST methods with 405', async () => {
    const handler = createHandler({ writeItems: vi.fn(), allowedOrigins: ALLOWED })
    const res = await handler(makeEvent({ method: 'GET' }))
    expect(res.statusCode).toBe(405)
  })

  it('rejects POST from disallowed origin with 403 without writing', async () => {
    const writeItems = vi.fn()
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })
    const res = await handler(
      makeEvent({
        origin: 'https://evil.example',
        body: { entries: [{ kind: 'heart' }] },
      }),
    )
    expect(res.statusCode).toBe(403)
    expect(writeItems).not.toHaveBeenCalled()
  })

  it('accepts Origin header regardless of case', async () => {
    const writeItems = vi.fn().mockResolvedValue(undefined)
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })
    const res = await handler(
      makeEvent({
        originKey: 'Origin',
        body: { entries: [{ kind: 'heart', id: 'abc12345' }] },
      }),
    )
    expect(res.statusCode).toBe(204)
    expect(writeItems).toHaveBeenCalledTimes(1)
  })

  it('validates body size, JSON syntax, entry count, and entry kinds', async () => {
    const writeItems = vi.fn()
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })

    const big = await handler(makeEvent({ body: 'x'.repeat(MAX_BODY + 1) }))
    expect(big.statusCode).toBe(413)

    const badJson = await handler(makeEvent({ body: '{not json' }))
    expect(badJson.statusCode).toBe(400)

    const empty = await handler(makeEvent({ body: { entries: [] } }))
    expect(empty.statusCode).toBe(400)

    const tooMany = await handler(
      makeEvent({
        body: { entries: Array.from({ length: MAX_ENTRIES + 1 }, () => ({ kind: 'heart' })) },
      }),
    )
    expect(tooMany.statusCode).toBe(400)

    const allBad = await handler(
      makeEvent({ body: { entries: [{ kind: 'nope' }, null, 'str'] } }),
    )
    expect(allBad.statusCode).toBe(400)
    expect(writeItems).not.toHaveBeenCalled()
  })

  it('cleans entries, strips bad params/keys, ignores body.key, and writes', async () => {
    const writeItems = vi.fn().mockResolvedValue(undefined)
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })

    const res = await handler(
      makeEvent({
        body: {
          key: 'legacy-secret-ignored',
          host: 'bad host!',
          entries: [
            {
              id: 'clientid01',
              t: '2026-07-15T04:05:06.000Z',
              kind: 'star',
              params: {
                rate: 1.25,
                volume: 'loud',
                nanVal: Number.NaN,
                infVal: Number.POSITIVE_INFINITY,
                'evil key': 5,
              },
              levels: { input: 0.1, output: 0.4 },
              state: { listening: true, playing: 1, thru: false, rawMic: 'true' },
            },
          ],
        },
      }),
    )

    expect(res.statusCode).toBe(204)
    expect(writeItems).toHaveBeenCalledTimes(1)
    const [items] = writeItems.mock.calls[0]
    expect(items).toEqual([
      {
        day: '2026-07-15',
        id: 'clientid01',
        t: '2026-07-15T04:05:06.000Z',
        kind: 'star',
        params: { rate: 1.25 },
        levels: { input: 0.1, output: 0.4 },
        state: { listening: true, playing: false, thru: false, rawMic: false },
        host: 'unknown',
      },
    ])
  })

  it('decodes base64-encoded request bodies', async () => {
    const writeItems = vi.fn().mockResolvedValue(undefined)
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })
    const raw = JSON.stringify({
      host: 'gloop.obfusco.us',
      entries: [{ id: 'b64entry1', t: '2026-08-01T00:00:00Z', kind: 'pick' }],
    })
    const res = await handler(
      makeEvent({
        body: Buffer.from(raw, 'utf8').toString('base64'),
        isBase64Encoded: true,
      }),
    )
    expect(res.statusCode).toBe(204)
    expect(writeItems.mock.calls[0][0][0].id).toBe('b64entry1')
    expect(writeItems.mock.calls[0][0][0].host).toBe('gloop.obfusco.us')
  })

  it('generates distinct 32-char hex ids when entry id is missing or invalid', () => {
    const a = cleanEntry({ kind: 'heart', id: 'bad!' }, 'gloop.obfusco.us')
    const b = cleanEntry({ kind: 'heart' }, 'gloop.obfusco.us')
    expect(a.id).toMatch(/^[0-9a-f]{32}$/)
    expect(b.id).toMatch(/^[0-9a-f]{32}$/)
    expect(a.id).not.toBe(b.id)
  })

  it('returns 502 when writeItems throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const writeItems = vi.fn().mockRejectedValue(new Error('ddb down'))
    const handler = createHandler({ writeItems, allowedOrigins: ALLOWED })
    const res = await handler(makeEvent({ body: { entries: [{ kind: 'sound' }] } }))
    expect(res.statusCode).toBe(502)
    errSpy.mockRestore()
  })

  it('property: cleanEntry never throws and only emits finite numbers for valid kinds', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const out = cleanEntry(input, cleanHost(input?.host))
        if (out === null) return true
        expect(KINDS.has(out.kind)).toBe(true)
        expect(out.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(out.id).toMatch(/^[a-z0-9]{6,40}$/)
        for (const v of Object.values(out.params)) {
          expect(typeof v === 'number' && Number.isFinite(v)).toBe(true)
        }
        for (const v of Object.values(out.levels)) {
          expect(typeof v === 'number' && Number.isFinite(v)).toBe(true)
        }
        return true
      }),
    )
  })
})

describe('learn-pull helpers', () => {
  it('unmarshals nested DynamoDB JSON attributes and strips day in toEntry', () => {
    const ddbItem = {
      day: { S: '2026-10-30' },
      id: { S: 'abc12345' },
      t: { S: '2026-10-30T10:00:00.000Z' },
      kind: { S: 'linger' },
      params: { M: { rate: { N: '0.75' }, grainSizeMs: { N: '120' } } },
      levels: { M: { input: { N: '0.2' }, extra: { NULL: true } } },
      state: {
        M: {
          listening: { BOOL: true },
          playing: { BOOL: false },
          list: { L: [{ S: 'x' }, { N: '2' }, { NULL: true }] },
        },
      },
      host: { S: 'gloop.obfusco.us' },
    }
    const plain = unmarshal({ M: ddbItem })
    expect(plain.params).toEqual({ rate: 0.75, grainSizeMs: 120 })
    expect(plain.levels).toEqual({ input: 0.2, extra: null })
    expect(plain.state.list).toEqual(['x', 2, null])

    const entry = toEntry(plain)
    expect(entry).toEqual({
      id: 'abc12345',
      t: '2026-10-30T10:00:00.000Z',
      kind: 'linger',
      params: { rate: 0.75, grainSizeMs: 120 },
      levels: { input: 0.2, extra: null },
      state: { listening: true, playing: false, list: ['x', 2, null] },
      host: 'gloop.obfusco.us',
    })
    expect('day' in entry).toBe(false)
  })

  it('computes lastDays in UTC from today backwards', () => {
    expect(lastDays(3, new Date('2026-10-30T12:00:00Z'))).toEqual([
      '2026-10-30',
      '2026-10-29',
      '2026-10-28',
    ])
  })
})
