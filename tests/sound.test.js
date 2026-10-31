import { describe, expect, it } from 'vitest'
import { SOUND_BOUNDS, soundFix } from '../src/audio/sound.js'
import { getParams } from '../src/audio/engine.js'
import { EVOLVE_RANGES } from '../src/audio/evolve.js'

describe('soundFix', () => {
  it('leaves in-range params alone', () => {
    const inRange = Object.fromEntries(Object.entries(SOUND_BOUNDS).map(([k, [lo, hi]]) => [k, (lo + hi) / 2]))
    expect(soundFix(inRange)).toEqual({})
  })

  it('pulls out-of-range params inside their bounds', () => {
    const quiet = { ...getParams(), volume: 0, granularMix: 0, delayMix: 0, rate: 4000, sensitivity: 0, repeat: 1 }
    const fix = soundFix(quiet)
    const outOfRange = Object.keys(SOUND_BOUNDS).filter(
      (k) => quiet[k] < SOUND_BOUNDS[k][0] || quiet[k] > SOUND_BOUNDS[k][1],
    )
    expect(Object.keys(fix).sort()).toEqual(outOfRange.sort())
    expect(outOfRange).toEqual(expect.arrayContaining(['volume', 'granularMix', 'delayMix', 'rate', 'sensitivity', 'repeat']))
    for (const [k, v] of Object.entries(fix)) {
      expect(v).toBeGreaterThanOrEqual(SOUND_BOUNDS[k][0])
      expect(v).toBeLessThanOrEqual(SOUND_BOUNDS[k][1])
    }
  })

  it('every bound sits inside its dial range', () => {
    // Evolvable dials' ranges, plus the 0-1 dials evolve leaves alone.
    const dials = { ...EVOLVE_RANGES, volume: [0, 1], granularMix: [0, 1], delayMix: [0, 1], sensitivity: [0, 1] }
    for (const [k, [lo, hi]] of Object.entries(SOUND_BOUNDS)) {
      expect(dials[k], k).toBeDefined()
      expect(lo, k).toBeLessThan(hi)
      expect(lo, k).toBeGreaterThanOrEqual(dials[k][0])
      expect(hi, k).toBeLessThanOrEqual(dials[k][1])
    }
  })
})
