import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  ACTIVATIONS,
  HIDDEN_COUNT,
  NODE_FNS,
  chladniValue,
  compileGenome,
  crossoverGenomes,
  evaluateGenome,
  mutateGenome,
  randomGenome,
  fillLUT,
  modeChladni,
  sampleLUT,
} from '../src/visual/cppn.js'

function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W_LIMITS = [8, 8, 6, 2, 1, 1]

function assertValidGenome(g) {
  expect(g.hidden).toHaveLength(HIDDEN_COUNT)
  expect(g.out).toHaveLength(HIDDEN_COUNT)
  expect(g.outBias).toBeGreaterThanOrEqual(-0.3)
  expect(g.outBias).toBeLessThanOrEqual(0.3)
  for (let i = 0; i < HIDDEN_COUNT; i++) {
    const node = g.hidden[i]
    expect(NODE_FNS).toContain(node.fn)
    expect(node.w).toHaveLength(6)
    for (let j = 0; j < 6; j++) {
      expect(node.w[j]).toBeGreaterThanOrEqual(-W_LIMITS[j])
      expect(node.w[j]).toBeLessThanOrEqual(W_LIMITS[j])
    }
    expect(node.b).toBeGreaterThanOrEqual(-1)
    expect(node.b).toBeLessThanOrEqual(1)
    expect(g.out[i]).toBeGreaterThanOrEqual(-1.5)
    expect(g.out[i]).toBeLessThanOrEqual(1.5)
  }
}

describe('chladniValue and activations', () => {
  it('matches known Chladni modal values to 9 digits', () => {
    expect(chladniValue(2, 3, 0.25, 0.5)).toBeCloseTo(-1, 9)
    expect(chladniValue(1, 2, 0.5, 0.25)).toBeCloseTo(1, 9)
    expect(chladniValue(3, 3, 0.37, 0.81)).toBeCloseTo(0, 9)
  })

  it('satisfies antisymmetry chladniValue(n, m, u, v) === -chladniValue(m, n, u, v)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, m, u, v) => {
          expect(chladniValue(n, m, u, v)).toBeCloseTo(-chladniValue(m, n, u, v), 12)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('computes exact sawtri landmarks', () => {
    const { sawtri } = ACTIVATIONS
    expect(sawtri(0)).toBeCloseTo(-1, 12)
    expect(sawtri(0.5)).toBeCloseTo(0, 12)
    expect(sawtri(1)).toBeCloseTo(1, 12)
    expect(sawtri(1.5)).toBeCloseTo(0, 12)
    expect(sawtri(2)).toBeCloseTo(-1, 12)
    expect(sawtri(-0.5)).toBeCloseTo(0, 12)
  })
})

describe('genome operators and evaluation', () => {
  it('is deterministic for a seeded PRNG and round-trips through JSON', () => {
    const g1 = randomGenome(mulberry32(1))
    const g2 = randomGenome(mulberry32(1))
    expect(g1).toEqual(g2)
    assertValidGenome(g1)

    const parsed = JSON.parse(JSON.stringify(g1))
    expect(parsed).toEqual(g1)
    expect(evaluateGenome(parsed, 2, 3, 0.3, 0.7, 12.5, 0.6)).toBe(
      evaluateGenome(g1, 2, 3, 0.3, 0.7, 12.5, 0.6)
    )
  })

  it('mutateGenome(g, 0) returns a deep-equal clone with distinct references', () => {
    const g = randomGenome(mulberry32(42))
    const cloned = mutateGenome(g, 0, mulberry32(99))
    expect(cloned).toEqual(g)
    expect(cloned).not.toBe(g)
    expect(cloned.hidden).not.toBe(g.hidden)
    expect(cloned.out).not.toBe(g.out)
    for (let i = 0; i < HIDDEN_COUNT; i++) {
      expect(cloned.hidden[i]).not.toBe(g.hidden[i])
      expect(cloned.hidden[i].w).not.toBe(g.hidden[i].w)
    }
  })

  it('evaluates inside (-2, 2) and matches compileGenome within 1e-12', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seed, n, m, u, v, t, amp) => {
          const g = randomGenome(mulberry32(seed))
          const ref = evaluateGenome(g, n, m, u, v, t, amp)
          const fast = compileGenome(g)(n, m, u, v, t, amp)
          expect(Number.isFinite(ref)).toBe(true)
          expect(ref).toBeGreaterThan(-2)
          expect(ref).toBeLessThan(2)
          expect(Math.abs(fast - ref)).toBeLessThanOrEqual(1e-12)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('mutateGenome and crossoverGenomes preserve invariants without mutating inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seedA, seedB, rate) => {
          const rng = mulberry32(seedA ^ seedB)
          const a = randomGenome(mulberry32(seedA))
          const b = randomGenome(mulberry32(seedB))
          const snapA = JSON.stringify(a)
          const snapB = JSON.stringify(b)

          const m = mutateGenome(a, rate, rng)
          expect(JSON.stringify(a)).toBe(snapA)
          assertValidGenome(m)

          const c = crossoverGenomes(a, b, rng)
          expect(JSON.stringify(a)).toBe(snapA)
          expect(JSON.stringify(b)).toBe(snapB)
          assertValidGenome(c)
          for (let i = 0; i < HIDDEN_COUNT; i++) {
            const matchesA =
              JSON.stringify(c.hidden[i]) === JSON.stringify(a.hidden[i]) &&
              c.out[i] === a.out[i]
            const matchesB =
              JSON.stringify(c.hidden[i]) === JSON.stringify(b.hidden[i]) &&
              c.out[i] === b.out[i]
            expect(matchesA || matchesB).toBe(true)
          }
          expect(c.outBias === a.outBias || c.outBias === b.outBias).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('fillLUT / sampleLUT', () => {
  const size = 16
  const fn = (n, m, u, v) => Math.sin(Math.PI * u) + 0.5 * Math.cos(Math.PI * v)

  it('returns the exact value on texel points', () => {
    const lut = new Float32Array(size * size)
    fillLUT(lut, size, fn, 2, 3, 0, 0)
    for (const [i, j] of [[0, 0], [3, 7], [15, 15]]) {
      expect(sampleLUT(lut, size, (2 * i) / size, (2 * j) / size)).toBeCloseTo(fn(0, 0, (2 * i) / size, (2 * j) / size), 6)
    }
  })

  it('wraps every 2 in u and v, including negatives', () => {
    const lut = new Float32Array(size * size)
    fillLUT(lut, size, fn, 2, 3, 0, 0)
    fc.assert(fc.property(fc.double({ min: -10, max: 10, noNaN: true }), fc.double({ min: -10, max: 10, noNaN: true }), (u, v) => {
      const s = sampleLUT(lut, size, u, v)
      expect(Number.isFinite(s)).toBe(true)
      expect(sampleLUT(lut, size, u + 2, v - 4)).toBeCloseTo(s, 4)
    }), { numRuns: 200 })
  })

  it('stays within the min/max of the grid (bilinear never overshoots)', () => {
    const lut = new Float32Array(size * size)
    fillLUT(lut, size, fn, 2, 3, 0, 0)
    const lo = Math.min(...lut)
    const hi = Math.max(...lut)
    fc.assert(fc.property(fc.double({ min: -4, max: 4, noNaN: true }), fc.double({ min: -4, max: 4, noNaN: true }), (u, v) => {
      const s = sampleLUT(lut, size, u, v)
      expect(s).toBeGreaterThanOrEqual(lo - 1e-6)
      expect(s).toBeLessThanOrEqual(hi + 1e-6)
    }), { numRuns: 200 })
  })

  it('the CPPN field itself has period 2 in u and v', () => {
    const f = compileGenome(randomGenome(mulberry32(7)))
    expect(f(2, 3, 0.3 + 2, 0.7 - 2, 5, 0.4)).toBeCloseTo(f(2, 3, 0.3, 0.7, 5, 0.4), 9)
    // Also while the modes ease between integers.
    expect(f(2.4, 3.7, 0.3 + 2, 0.7 - 2, 5, 0.4)).toBeCloseTo(f(2.4, 3.7, 0.3, 0.7, 5, 0.4), 9)
  })

  it('modeChladni matches chladniValue at integer modes and is continuous between them', () => {
    expect(modeChladni(2, 3, 0.25, 0.5)).toBeCloseTo(chladniValue(2, 3, 0.25, 0.5), 12)
    expect(modeChladni(2.999999, 3, 0.25, 0.5)).toBeCloseTo(chladniValue(3, 3, 0.25, 0.5), 5)
  })
})
