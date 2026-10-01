import { useCallback, useRef } from 'react'
import './ShakeButton.css'

/**
 * Lightning-bolt icon that randomizes the granular/modulation dials and
 * gives the grain field a nudge — a quick reshuffle for a different
 * texture without hand-tuning every knob. Mirrors the shake/randomize
 * pattern from ribbon (see LIFE/LINEAGE.md), adapted to GLOOP's calmer,
 * console-less aesthetic: only the bolt itself shakes, not the whole
 * screen.
 */
export default function ShakeButton({ onShake }) {
  const btnRef = useRef(null)

  const handleClick = useCallback(() => {
    const el = btnRef.current
    if (el) {
      el.classList.remove('shake-button--shaking')
      // Force reflow so the animation can restart even if it's still running.
      void el.offsetWidth
      el.classList.add('shake-button--shaking')
    }
    onShake()
  }, [onShake])

  return (
    <button
      ref={btnRef}
      type="button"
      className="shake-button bevel"
      onClick={handleClick}
      title="Shake (randomize)"
      aria-label="Shake / randomize controls"
    >
      {/* Inline SVG instead of the ⚡ emoji — the emoji renders in full
          color on most platforms and sits off-center on its font's
          baseline; this follows currentColor and centers exactly. */}
      <svg className="shake-button__bolt" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.5 2 4.5 13.5h6.2L9.8 22l9.2-12h-6.3L13.5 2Z" />
      </svg>
    </button>
  )
}
