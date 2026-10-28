import { describe, expect, it } from 'vitest'
import { crossover, mutate } from '../src/audio/evolve.js'
import { getParams, setParam, smearAmount } from '../src/audio/engine.js'

const KEYS = ['rate', 'dynamics', 'feedback', 'repeat', 'grainSizeMs', 'density', 'wow', 'flutter', 'wobble']
const genome = (value, gen, fitness) => ({
  params: Object.fromEntries(KEYS.map((k) => [k, value])),
  innovation: Object.fromEntries(KEYS.map((k) => [k, gen])),
  fitness,
})

describe('crossover (NEAT innovation rule)', () => {
  it('disjoint genes come from the fitter parent, with its innovation number', () => {
    const fit = genome(0.8, 3, 0.9)
    const weak = genome(0.2, 1, 0.1)
    for (const [a, b] of [[fit, weak], [weak, fit]]) {
      const child = crossover(a, b)
      for (const k of KEYS) {
        expect(child.params[k]).toBe(0.8)
        expect(child.innovation[k]).toBe(3)
      }
    }
  })

  it('matching genes inherit from either parent', () => {
    const a = genome(0.8, 2, 0.9)
    const b = genome(0.2, 2, 0.1)
    const seen = new Set()
    for (let i = 0; i < 20; i++) {
      for (const v of Object.values(crossover(a, b).params)) seen.add(v)
    }
    expect(seen).toEqual(new Set([0.8, 0.2]))
  })
})

describe('mutate', () => {
  it('rate 0 changes nothing and returns copies', () => {
    const g = genome(0.5, 1)
    const out = mutate(g.params, g.innovation, 0.5, 0, 9)
    expect(out.params).toEqual(g.params)
    expect(out.innovation).toEqual(g.innovation)
    expect(out.params).not.toBe(g.params)
  })

  it('rate 1 stamps every gene with the current generation and stays in range', () => {
    const g = genome(0.5, 1)
    for (let i = 0; i < 50; i++) {
      const out = mutate(g.params, g.innovation, 5, 1, 7)
      for (const k of KEYS) expect(out.innovation[k]).toBe(7)
      expect(out.params.feedback).toBeLessThanOrEqual(0.9)
      expect(out.params.rate).toBeGreaterThanOrEqual(20)
      expect(out.params.grainSizeMs).toBeGreaterThanOrEqual(30)
      expect(out.params.wow).toBeGreaterThanOrEqual(0)
      expect(out.params.wow).toBeLessThanOrEqual(1)
    }
  })
})

describe('engine param surface', () => {
  it('getParams returns a copy and setParam ignores unknown keys', () => {
    const p = getParams()
    p.feedback = 123
    expect(getParams().feedback).not.toBe(123)
    setParam('notAParam', 1)
    expect('notAParam' in getParams()).toBe(false)
  })

  it('setParam stores known keys without a built graph', () => {
    setParam('density', 0.42)
    expect(getParams().density).toBe(0.42)
  })
})

describe('smearAmount (Clouds-style repeat threshold)', () => {
  it('is 0 below the threshold, 1 at the top, monotonic between', () => {
    expect(smearAmount(0)).toBe(0)
    expect(smearAmount(0.85)).toBe(0)
    expect(smearAmount(1)).toBe(1)
    let prev = 0
    for (let r = 0.85; r <= 1; r += 0.01) {
      const s = smearAmount(r)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })
})
