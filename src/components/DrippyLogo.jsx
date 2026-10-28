import './DrippyLogo.css'

// Drip strands hanging off the wordmark: x position (% of width), start
// (% of the box height, which includes the drop room below — the letters'
// baseline sits near 38%, so strands start just inside a letter), cycle
// length and delay, staggered so they never fall in step.
const DRIPS = [
  { x: 22, top: 33, dur: 5.2, delay: 0 },
  { x: 47, top: 35, dur: 6.8, delay: 2.1 },
  { x: 64, top: 34, dur: 4.6, delay: 3.4 },
  { x: 80, top: 32, dur: 7.4, delay: 1.2 },
]

/**
 * The "gloop" wordmark, melting: an SVG goo filter (blur, then a hard alpha
 * threshold) fuses the letters with drip strands below them, so each
 * strand stretches out of the letter like liquid and sheds a droplet.
 */
export default function DrippyLogo() {
  return (
    <div className="gloop-logo" aria-hidden="true">
      <svg className="gloop-logo__defs" width="0" height="0">
        <defs>
          <filter id="gloop-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            {/* Crisp letters back on top, so only the joins melt. */}
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
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
  )
}
