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
      className="shake-button"
      onClick={handleClick}
      title="Shake (randomize)"
      aria-label="Shake / randomize controls"
    >
      ⚡
    </button>
  )
}
