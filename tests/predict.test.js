import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { FEATURES, LABELS, featurize, createPredictor, bestOf } from '../src/audio/predict.js'
import { SOUND_BOUNDS } from '../src/audio/sound.js'
import { getParams } from '../src/audio/engine.js'
import { proposeDefaults } from '../scripts/evolve-cycle.mjs'

const sampleParams = {
  rate: 200,
  grainSizeMs: 500,
  feedback: 0.5,
  repeat: 0.5,
  density: 0.5,
  dynamics: 0.2,
  wow: 0.1,
  flutter: 0.1,
  wobble: 0.1,
  volume: 0.8,
  granularMix: 0.8,
  delayMix: 0.7,
  sensitivity: 0.5,
}

const lowParams = Object.fromEntries(Object.entries(FEATURES).map(([k, [lo]]) => [k, lo]))
const highParams = Object.fromEntries(Object.entries(FEATURES).map(([k, [, hi]]) => [k, hi]))

describe('featurize', () => {
  it('maps log and linear ranges into [0, 1] with 0.5 fallback', () => {
    const fLow = featurize({ rate: 20 })
    const fHigh = featurize({ rate: 4000 })
    const fMid = featurize({ rate: Math.sqrt(20 * 4000), feedback: 0.45 })

    expect(fLow[0]).toBeCloseTo(0, 6)
    expect(fHigh[0]).toBeCloseTo(1, 6)
    expect(fMid[0]).toBeCloseTo(0.5, 6)
    expect(fMid[2]).toBeCloseTo(0.5, 6)
    // Missing key falls back to 0.5
    expect(fMid[1]).toBeCloseTo(0.5, 6)
  })

  it('clamps out-of-range values and handles non-positive log inputs', () => {
    const f = featurize({ rate: 1, grainSizeMs: 99999, feedback: -2, repeat: 5 })
    expect(f[0]).toBeCloseTo(0, 6)
    expect(f[1]).toBeCloseTo(1, 6)
    expect(f[2]).toBeCloseTo(0, 6)
    expect(f[3]).toBeCloseTo(1, 6)

    const nonPos = featurize({ rate: 0, grainSizeMs: -10, feedback: Number.NaN })
    expect(nonPos[0]).toBeCloseTo(0.5, 6)
    expect(nonPos[1]).toBeCloseTo(0.5, 6)
    expect(nonPos[2]).toBeCloseTo(0.5, 6)
  })
})

describe('createPredictor', () => {
  it('returns the prior with zero confidence when empty', () => {
    const pred = createPredictor([])
    expect(pred.size).toBe(0)
    const res = pred.predict(sampleParams)
    expect(res.score).toBeCloseTo(0.5, 6)
    expect(res.confidence).toBeCloseTo(0, 6)
  })

  it('computes exact score and confidence for a single heart at P', () => {
    const pred = createPredictor([{ kind: 'heart', params: sampleParams }])
    expect(pred.size).toBe(1)
    const res = pred.predict(sampleParams)
    expect(res.score).toBeCloseTo(0.75, 6)
    expect(res.confidence).toBeCloseTo(0.5, 6)
  })

  it('averages heart and muted at the same P with default recency', () => {
    const pred = createPredictor(
      [
        { kind: 'heart', params: sampleParams },
        { kind: 'muted', params: sampleParams },
      ],
      { halfLife: 1e9 },
    )
    const res = pred.predict(sampleParams)
    expect(res.score).toBeCloseTo(0.5, 6)
    expect(res.confidence).toBeCloseTo(2 / 3, 6)

    // Even at default halfLife = 200, both are ~1 so score ≈ 0.5 and confidence ≈ 2/3
    const predDefault = createPredictor([
      { kind: 'heart', params: sampleParams },
      { kind: 'muted', params: sampleParams },
    ])
    const resDefault = predDefault.predict(sampleParams)
    expect(resDefault.score).toBeCloseTo((0.5 ** (1 / 200) + 0.5) / (0.5 ** (1 / 200) + 2), 6)
    expect(resDefault.confidence).toBeCloseTo(2 / 3, 3)
  })

  it('weights older entries by 0.5 ** ((n - 1 - i) / halfLife)', () => {
    const pred = createPredictor(
      [
        { kind: 'heart', params: sampleParams },
        { kind: 'muted', params: sampleParams },
      ],
      { halfLife: 1 },
    )
    const res = pred.predict(sampleParams)
    expect(res.score).toBeCloseTo(0.4, 6)
    expect(res.confidence).toBeCloseTo(0.6, 6)
  })

  it('falls back to prior when query is at maximum feature distance', () => {
    const pred = createPredictor([{ kind: 'heart', params: lowParams }])
    const res = pred.predict(highParams)
    expect(res.score).toBeCloseTo(0.5, 6)
    expect(res.confidence).toBeLessThan(1e-9)
  })

  it('ignores entries where grains were not sounding or kind is unknown', () => {
    const pred = createPredictor([
      { kind: 'heart', params: sampleParams, state: { playing: false } },
      { kind: 'star', params: sampleParams, state: { playing: true, thru: true } },
      { kind: 'bogus', params: sampleParams, state: { playing: true, thru: false } },
      { kind: 'heart', params: sampleParams, state: { playing: true, thru: false } },
    ])
    expect(pred.size).toBe(1)
    const res = pred.predict(sampleParams)
    expect(res.score).toBeCloseTo(0.75, 6)
    expect(res.confidence).toBeCloseTo(0.5, 6)
  })
})

describe('bestOf', () => {
  it('picks the candidate nearest a heart over one nearest a muted', () => {
    const pred = createPredictor([
      { kind: 'heart', params: lowParams },
      { kind: 'muted', params: highParams },
    ])
    expect(bestOf(pred, [highParams, lowParams])).toBe(lowParams)
    expect(bestOf(pred, [])).toBeNull()

    const wrapped = [{ id: 'bad', p: highParams }, { id: 'good', p: lowParams }]
    expect(bestOf(pred, wrapped, (c) => c.p)).toEqual({ id: 'good', p: lowParams })
  })
})

describe('proposeDefaults', () => {
  it('moves parameters toward a cluster of heart entries when enough data exists', () => {
    const baseDefaults = getParams()
    // Far from the hearts on most dials, so the defaults predict near the
    // 0.5 prior and there's real room to improve.
    const current = { ...baseDefaults, rate: 3000, grainSizeMs: 60, feedback: 0.05, repeat: 0.05, density: 0.05, volume: 0.1, granularMix: 0.1, delayMix: 0.1 }
    const loved = { ...baseDefaults, rate: 150, feedback: 0.6, grainSizeMs: 800, sensitivity: 0.5 }
    const entries = Array.from({ length: 30 }, () => ({
      kind: 'heart',
      params: loved,
      state: { playing: true, thru: false },
    }))

    const result = proposeDefaults({
      entries,
      current,
      bounds: SOUND_BOUNDS,
      samples: 4000,
      seed: 1,
      minEntries: 20,
    })

    expect(result.trained).toBe(30)
    expect(result.best).not.toBeNull()
    expect(result.changes.rate).toBeDefined()
    expect(Math.abs(result.changes.rate - 150)).toBeLessThan(Math.abs(current.rate - 150))

    const tooFew = proposeDefaults({
      entries: entries.slice(0, 5),
      current,
      bounds: SOUND_BOUNDS,
      samples: 500,
      seed: 1,
      minEntries: 20,
    })
    expect(tooFew.trained).toBe(5)
    expect(tooFew.best).toBeNull()
    expect(tooFew.changes).toEqual({})
  })
})

describe('property tests', () => {
  const paramsArb = fc.record(
    Object.fromEntries(
      Object.entries(FEATURES).map(([k, [lo, hi]]) => [
        k,
        fc.double({ min: lo, max: hi, noNaN: true }),
      ]),
    ),
  )

  const validEntryArb = fc.record({
    kind: fc.constantFrom(...Object.keys(LABELS)),
    params: paramsArb,
    state: fc.record({
      playing: fc.boolean(),
      thru: fc.boolean(),
    }),
  })

  const mixedEntriesArb = fc.array(fc.oneof(validEntryArb, fc.anything()), { maxLength: 25 })

  it('never throws on arbitrary entries and keeps score in [0, 1] and confidence in [0, 1)', () => {
    fc.assert(
      fc.property(mixedEntriesArb, paramsArb, (entries, query) => {
        const pred = createPredictor(entries)
        const { score, confidence } = pred.predict(query)
        expect(Number.isFinite(score)).toBe(true)
        expect(Number.isFinite(confidence)).toBe(true)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
        expect(confidence).toBeGreaterThanOrEqual(0)
        expect(confidence).toBeLessThan(1)
      }),
      { numRuns: 100 },
    )
  })

  it('adding a heart at P never lowers predict(P).score', () => {
    fc.assert(
      fc.property(mixedEntriesArb, paramsArb, (entries, p) => {
        const before = createPredictor(entries).predict(p).score
        const heartAtP = { kind: 'heart', params: p, state: { playing: true, thru: false } }
        const after = createPredictor([...entries, heartAtP]).predict(p).score
        expect(after + 1e-12).toBeGreaterThanOrEqual(before)
      }),
      { numRuns: 100 },
    )
  })
})
