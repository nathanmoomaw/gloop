import { describe, expect, it } from 'vitest'
import { LINGER_MS, SETTLE_MS, SOUNDING_RMS, createImplicitLearner } from '../src/audio/implicit.js'

const loud = { output: SOUNDING_RMS * 4 }
const quiet = { output: SOUNDING_RMS / 2 }
const on = { playing: true, thru: false }

// Ticks once a second for `ms`, collecting every kind logged.
function run(learner, ms, { params = { rate: 200 }, levels = loud, state = on, start = 0 } = {}) {
  const out = []
  for (let t = start; t <= start + ms; t += 1000) out.push(...learner.tick({ params, levels, state }, t))
  return out
}

describe('createImplicitLearner', () => {
  it('logs settle after 20s of sound, linger after 90s, each once', () => {
    const l = createImplicitLearner()
    expect(run(l, SETTLE_MS - 2000)).toEqual([])
    expect(run(l, LINGER_MS + 20000, { start: SETTLE_MS - 1000 })).toEqual(['settle', 'linger'])
  })

  it('a dial change starts the count over', () => {
    const l = createImplicitLearner()
    run(l, 15000)
    expect(run(l, 15000, { params: { rate: 201 }, start: 16000 })).toEqual([])
    expect(run(l, 10000, { params: { rate: 201 }, start: 32000 })).toEqual(['settle'])
  })

  it('only time with sound coming out counts', () => {
    for (const opts of [{ levels: quiet }, { state: { playing: false, thru: false } }, { state: { playing: true, thru: true } }]) {
      expect(run(createImplicitLearner(), LINGER_MS + 5000, opts)).toEqual([])
    }
  })

  it('a backgrounded gap does not count as listening', () => {
    const l = createImplicitLearner()
    run(l, 5000)
    expect(l.tick({ params: { rate: 200 }, levels: loud, state: on }, 5000 + 60000)).toEqual([])
    expect(run(l, 10000, { start: 66000 })).toEqual([])
  })
})
