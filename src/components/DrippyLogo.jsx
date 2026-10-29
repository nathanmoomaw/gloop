import { useEffect, useState } from 'react'
import './DrippyLogo.css'

// Glitches the wordmark sometimes does: name → length in ms. Each is a
// `gloop-logo--<name>` class (DrippyLogo.css) on the glitch layer for that
// long. rgb and tear also show the two colored ghost copies of the text.
const GLITCHES = {
  rgb: 520,
  slice: 420,
  jitter: 360,
  skew: 300,
  invert: 260,
  flicker: 480,
  scan: 380,
  melt: 900,
  mirror: 220,
  color: 700,
  blur: 340,
  tear: 460,
}
const GLITCH_NAMES = Object.keys(GLITCHES)
const GAP_MIN_MS = 4000
const GAP_MAX_MS = 16000
// Chance a glitch is followed straight away by another, so they sometimes
// come in a stutter rather than always alone.
const BURST_CHANCE = 0.2

// Drip strands hanging off the wordmark: x position (% of width), start
// (% of the box height, which includes the drop room below — the letters'
// baseline sits near 38%, so strands start just inside a letter), cycle
// length and delay, staggered so they never fall in step.
const DRIPS = [
  { x: 14, top: 36, dur: 6.1, delay: 0.7 },
  { x: 22, top: 33, dur: 5.2, delay: 0 },
  { x: 36, top: 37, dur: 7.9, delay: 4.4 },
  { x: 47, top: 35, dur: 6.8, delay: 2.1 },
  { x: 64, top: 34, dur: 4.6, delay: 3.4 },
  { x: 73, top: 36, dur: 5.7, delay: 5.3 },
  { x: 80, top: 32, dur: 7.4, delay: 1.2 },
]

/**
 * The "gloop" wordmark, melting: an SVG goo filter (blur, then a hard alpha
 * threshold) fuses the letters with drip strands below them, so each
 * strand stretches out of the letter like liquid and sheds a droplet.
 */
export default function DrippyLogo() {
  const [glitch, setGlitch] = useState(null)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let timer
    let last = null
    const schedule = (gap) => {
      timer = setTimeout(() => {
        let next
        do next = GLITCH_NAMES[Math.floor(Math.random() * GLITCH_NAMES.length)]
        while (next === last)
        last = next
        setGlitch(next)
        timer = setTimeout(() => {
          setGlitch(null)
          schedule(Math.random() < BURST_CHANCE ? 80 + Math.random() * 300 : GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS))
        }, GLITCHES[next])
      }, gap)
    }
    schedule(GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS))
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="gloop-logo" aria-hidden="true">
      <svg className="gloop-logo__defs" width="0" height="0">
        <defs>
          <filter id="gloop-goo">
            {/* Blur sized for the 3x wordmark: wide enough that strands and
                drops visibly pool into the letters. */}
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo" />
            {/* Crisp letters back on top, so only the joins melt. */}
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          {/* Phone size (smaller font): same goo, proportionally less blur. */}
          <filter id="gloop-goo-sm">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
      <div className={`gloop-logo__glitch ${glitch ? `gloop-logo--${glitch}` : ''}`}>
        <div className="gloop-logo__ghosts">
          <span className="gloop-logo__ghost gloop-logo__ghost--a">gloop</span>
          <span className="gloop-logo__ghost gloop-logo__ghost--b">gloop</span>
        </div>
        <div className="gloop-logo__goo">
          <span className="gloop-logo__text">gloop</span>
          {DRIPS.map((d) => (
            <span
              key={d.x}
              className="gloop-logo__drip"
              style={{ left: `${d.x}%`, top: `${d.top}%`, '--dur': `${d.dur}s`, '--delay': `${d.delay}s` }}
            >
              <span className="gloop-logo__drop" />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
