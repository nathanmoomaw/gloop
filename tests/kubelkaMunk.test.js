import { describe, expect, it } from 'vitest'
import { pigmentAt } from '../src/color/kubelkaMunk.js'

const at = (phase) => pigmentAt(phase, [0, 0, 0])
const steps = 512

describe('pigmentAt', () => {
  it('returns normalized sRGB: every channel in [0,1], brightest at 1', () => {
    for (let i = 0; i < steps; i++) {
      const c = at(i / steps)
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0)
        expect(ch).toBeLessThanOrEqual(1)
      }
      expect(Math.max(...c)).toBeCloseTo(1, 5)
    }
  })

  it('wraps phase outside [0,1), including negatives', () => {
    expect(at(1.25)).toEqual(at(0.25))
    expect(at(-0.25)).toEqual(at(0.75))
    expect(at(1)).toEqual(at(0))
  })

  it('starts on hansa yellow', () => {
    const [r, g, b] = at(0)
    expect(r).toBeGreaterThan(0.8)
    expect(g).toBeGreaterThan(0.6)
    expect(b).toBeLessThan(0.2)
  })

  it('makes green where phthalo blue wraps into hansa yellow (subtractive, not gray)', () => {
    let greenest = 0
    for (let i = Math.floor(steps * 0.8); i < steps; i++) {
      const [r, g, b] = at(i / steps)
      greenest = Math.max(greenest, g - Math.max(r, b))
    }
    expect(greenest).toBeGreaterThan(0.25)
  })

  it('walks the ring in roughly even color steps (arc-length resampling)', () => {
    const d = []
    for (let i = 0; i < steps; i++) {
      const p = at(i / steps)
      const q = at((i + 1) / steps)
      d.push(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))
    }
    const mean = d.reduce((s, x) => s + x, 0) / d.length
    expect(Math.max(...d)).toBeLessThan(mean * 4)
  })
})
