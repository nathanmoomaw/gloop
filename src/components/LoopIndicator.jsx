import { forwardRef, useImperativeHandle, useRef } from 'react'
import './LoopIndicator.css'

/**
 * Glowing dot that laps the screen's edges — a visual readout, not a
 * control. Lap time tracks the current grain rate/delay time live; it
 * briefly flares each time a grain actually fires (driven imperatively via
 * `pulse()` on a nested element so restarting the flash animation never
 * disturbs the dot's own continuous travel animation — those live on two
 * separate elements precisely so toggling one doesn't restart the other).
 */
export const LoopIndicator = forwardRef(function LoopIndicator({ active, periodMs = 1200 }, ref) {
  const glowRef = useRef(null)

  useImperativeHandle(ref, () => ({
    pulse() {
      const el = glowRef.current
      if (!el) return
      el.classList.remove('loop-indicator__glow--pulse')
      // Force reflow so the animation can restart even if it's still running.
      void el.offsetWidth
      el.classList.add('loop-indicator__glow--pulse')
    },
  }), [])

  return (
    <div
      className={`loop-indicator ${active ? 'loop-indicator--active' : ''}`}
      style={{ '--loop-duration': `${periodMs}ms` }}
    >
      <div className="loop-indicator__track" />
      <span className="loop-indicator__dot">
        <span ref={glowRef} className="loop-indicator__glow" />
      </span>
    </div>
  )
})
