import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { SOUND_BOUNDS } from '../src/audio/sound.js'
import {
  FEEDBACK,
  FEEDBACK_BY_ID,
  LOG_CAP,
  makeEntry,
  learnedTarget,
  learnedSoundFix,
  appendEntry,
  loadLog,
  saveLog,
  toJSONL,
  summarize,
} from '../src/audio/learn.js'
import { mutedFix } from '../src/audio/learn.js'

const BOUND_KEYS = Object.keys(SOUND_BOUNDS)
const POSITIVE_KINDS = ['heart', 'sound', 'star']
const ALL_KINDS = FEEDBACK.map((f) => f.id)

describe('learn', () => {
  it('exposes the four feedback kinds in order', () => {
    expect(ALL_KINDS).toEqual(['heart', 'sound', 'muted', 'star'])
    expect(FEEDBACK_BY_ID.star.weight).toBe(3)
    expect(FEEDBACK_BY_ID.muted.weight).toBe(0)
  })

  it('makeEntry copies inputs, rounds to 4 decimals, defaults missing fields, and throws on unknown kind', () => {
    const params = { volume: 0.123456, rate: 250.987654 }
    const levels = { input: 0.555555 }
    const state = { listening: true }
    const entry = makeEntry('heart', params, levels, state, 1700000000000)

    params.volume = 99
    levels.input = 99
    state.listening = false

    expect(entry.t).toBe('2023-11-14T22:13:20.000Z')
    expect(entry.params).toEqual({ volume: 0.1235, rate: 250.9877 })
    expect(entry.levels).toEqual({ input: 0.5556, output: 0, grainsPerSec: 0 })
    expect(entry.state).toEqual({ listening: true, playing: false, thru: false, rawMic: false })
    expect(() => makeEntry('bogus', {}, {}, {})).toThrow(/Unknown feedback kind/)
  })

  it('matches fixed learnedTarget assertions', () => {
    const vEntries = [
      { kind: 'heart', params: { volume: 0.8 } },
      { kind: 'star', params: { volume: 0.6 } },
    ]
    expect(learnedTarget(vEntries, Infinity).volume).toBeCloseTo(0.68, 10)

    const rEntries = [
      { kind: 'heart', params: { rate: 100 } },
      { kind: 'heart', params: { rate: 400 } },
    ]
    expect(learnedTarget(rEntries, Infinity).rate).toBeCloseTo(200, 10)

    const mutedOnly = [
      { kind: 'muted', params: { volume: 0.8, rate: 200 } },
      { kind: 'muted', params: { volume: 0.5, rate: 150 } },
    ]
    expect(learnedTarget(mutedOnly)).toBeNull()
  })

  it('property: learnedTarget values lie within [min, max] of contributing values', () => {
    const paramArb = fc.record(
      Object.fromEntries(
        BOUND_KEYS.map((k) => [
          k,
          fc.double({ min: Math.max(0.01, SOUND_BOUNDS[k][0]), max: SOUND_BOUNDS[k][1], noNaN: true }),
        ]),
      ),
    )
    const entryArb = fc.record({
      kind: fc.constantFrom(...POSITIVE_KINDS),
      params: paramArb,
    })

    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 25 }), (entries) => {
        const target = learnedTarget(entries, 50)
        expect(target).not.toBeNull()
        for (const k of BOUND_KEYS) {
          const vals = entries.map((e) => e.params[k])
          const lo = Math.min(...vals)
          const hi = Math.max(...vals)
          expect(target[k]).toBeGreaterThanOrEqual(lo - 1e-9)
          expect(target[k]).toBeLessThanOrEqual(hi + 1e-9)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('property: learnedSoundFix returns {} when in range and clamps out-of-range keys into bounds', () => {
    const inRangeParams = Object.fromEntries(
      BOUND_KEYS.map((k) => [k, (SOUND_BOUNDS[k][0] + SOUND_BOUNDS[k][1]) / 2]),
    )
    expect(learnedSoundFix(inRangeParams, [])).toEqual({})

    const arbParams = fc.record(
      Object.fromEntries(
        BOUND_KEYS.map((k) => {
          const [lo, hi] = SOUND_BOUNDS[k]
          const span = hi - lo
          return [k, fc.double({ min: lo - span, max: hi + span, noNaN: true })]
        }),
      ),
    )
    const arbEntries = fc.array(
      fc.record({
        kind: fc.constantFrom(...ALL_KINDS),
        params: arbParams,
      }),
      { maxLength: 10 },
    )

    fc.assert(
      fc.property(arbParams, arbEntries, (params, entries) => {
        const fix = learnedSoundFix(params, entries)
        const expectedKeys = BOUND_KEYS.filter(
          (k) => params[k] < SOUND_BOUNDS[k][0] || params[k] > SOUND_BOUNDS[k][1],
        )
        expect(Object.keys(fix).sort()).toEqual(expectedKeys.sort())
        for (const [k, v] of Object.entries(fix)) {
          expect(v).toBeGreaterThanOrEqual(SOUND_BOUNDS[k][0])
          expect(v).toBeLessThanOrEqual(SOUND_BOUNDS[k][1])
        }
      }),
      { numRuns: 200 },
    )
  })

  it('property: appendEntry never mutates input and never exceeds cap', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 30 }),
        fc.integer(),
        fc.integer({ min: 1, max: 15 }),
        (arr, item, cap) => {
          const snapshot = [...arr]
          const res = appendEntry(arr, item, cap)
          expect(arr).toEqual(snapshot)
          expect(res.length).toBeLessThanOrEqual(cap)
          expect(res[res.length - 1]).toBe(item)
          expect(LOG_CAP).toBe(2000)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('round-trips loadLog/saveLog and handles throwing or invalid storage gracefully', () => {
    const mem = new Map()
    const fakeStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    }
    const sample = [makeEntry('star', { volume: 0.9 }, {}, {}, 1000)]
    expect(saveLog(sample, fakeStorage)).toBe(true)
    expect(loadLog(fakeStorage)).toEqual(sample)

    mem.set('gloop.learn.v1', '{not json')
    expect(loadLog(fakeStorage)).toEqual([])
    mem.set('gloop.learn.v1', JSON.stringify({ not: 'an array' }))
    expect(loadLog(fakeStorage)).toEqual([])

    const throwingStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(loadLog(throwingStorage)).toEqual([])
    expect(saveLog(sample, throwingStorage)).toBe(false)
    expect(loadLog(null)).toEqual([])
    expect(saveLog(sample, null)).toBe(false)
  })

  it('property: toJSONL line count equals log length and summarize tallies kinds', () => {
    expect(toJSONL([])).toBe('')
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_KINDS), { maxLength: 40 }),
        (kinds) => {
          const log = kinds.map((k, i) => ({ kind: k, i }))
          const jsonl = toJSONL(log)
          const lines = jsonl === '' ? [] : jsonl.trimEnd().split('\n')
          expect(lines.length).toBe(log.length)
          const sum = summarize(log)
          expect(sum.total).toBe(log.length)
          expect(sum.byKind.heart + sum.byKind.sound + sum.byKind.muted + sum.byKind.star).toBe(log.length)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('mutedFix', () => {
  const inRange = Object.fromEntries(Object.entries(SOUND_BOUNDS).map(([k, [lo, hi]]) => [k, lo + (hi - lo) * 0.25]))

  it('fixes out-of-range dials first, like learnedSoundFix', () => {
    expect(Object.keys(mutedFix({ ...inRange, volume: 0 }, []))).toEqual(['volume'])
  })

  it('with everything in range and no history, turns the level dials up halfway', () => {
    const out = mutedFix(inRange, [])
    expect(Object.keys(out).sort()).toEqual(['delayMix', 'granularMix', 'sensitivity', 'volume'])
    const [lo, hi] = SOUND_BOUNDS.volume
    expect(out.volume).toBeCloseTo(inRange.volume + (hi - inRange.volume) / 2, 9)
    expect(out.volume).toBeLessThanOrEqual(hi)
    expect(lo).toBeLessThan(out.volume)
  })

  it('with everything in range and history, goes to the learned target', () => {
    const liked = { ...inRange, feedback: 0.7 }
    const out = mutedFix(inRange, [makeEntry('star', liked, {}, { playing: true })])
    expect(Object.keys(out)).toEqual(['feedback'])
    expect(out.feedback).toBeCloseTo(0.7, 9)
  })
})

describe('learned target ignores likes that rated something else', () => {
  it('skips entries logged while not playing or with thru on', () => {
    const e = (state, volume) => ({ ...makeEntry('star', { volume }, {}, state) })
    const t = learnedTarget([e({ playing: true }, 0.8), e({ playing: false }, 0.1), e({ playing: true, thru: true }, 0.1)])
    expect(t.volume).toBeCloseTo(0.8, 9)
  })

  it('mutedFix falls back to the levels when the dials already sit on the target', () => {
    const inRange = Object.fromEntries(Object.entries(SOUND_BOUNDS).map(([k, [lo, hi]]) => [k, lo + (hi - lo) * 0.25]))
    const out = mutedFix(inRange, [makeEntry('star', inRange, {}, { playing: true })])
    expect(Object.keys(out).sort()).toEqual(['delayMix', 'granularMix', 'sensitivity', 'volume'])
  })
})
