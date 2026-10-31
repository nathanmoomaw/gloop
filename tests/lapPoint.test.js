import { describe, it, expect } from 'vitest'
import { lapPoint, advancePhase } from '../src/components/lapPoint.js'

describe('lapPoint', () => {
  it('hits the four corners at quarter phases', () => {
    expect(lapPoint(0)).toEqual({ left: 0, top: 0 })
    expect(lapPoint(0.25)).toEqual({ left: 100, top: 0 })
    expect(lapPoint(0.5)).toEqual({ left: 100, top: 100 })
    expect(lapPoint(0.75)).toEqual({ left: 0, top: 100 })
  })

  it('wraps phases outside [0, 1)', () => {
    expect(lapPoint(1.125)).toEqual(lapPoint(0.125))
    expect(lapPoint(-0.125)).toEqual(lapPoint(0.875))
  })

  it('moves continuously (no jump bigger than one step) around the lap', () => {
    let prev = lapPoint(0)
    for (let i = 1; i <= 1000; i++) {
      const cur = lapPoint(i / 1000)
      expect(Math.abs(cur.left - prev.left) + Math.abs(cur.top - prev.top)).toBeLessThan(0.5)
      prev = cur
    }
  })
})

describe('advancePhase', () => {
  it('keeps position when the period changes mid-lap', () => {
    const phase = advancePhase(0, 300, 1200)
    expect(phase).toBeCloseTo(0.25)
    // A period change only affects how far the next step goes, not where the dot is now.
    expect(advancePhase(phase, 0, 400)).toBeCloseTo(0.25)
    expect(advancePhase(phase, 100, 400)).toBeCloseTo(0.5)
  })

  it('ignores a non-positive period', () => {
    expect(advancePhase(0.3, 16, 0)).toBe(0.3)
  })
})
