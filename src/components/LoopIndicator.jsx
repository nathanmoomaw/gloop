import { forwardRef, useImperativeHandle, useRef } from 'react'
import './LoopIndicator.css'

/**
 * Circulating glow ring — a visual readout, not a control. Rotation speed
 * tracks the current grain rate/delay time live; a sparkle pulses on the
 * ring each time a grain actually fires (driven imperatively via `pulse()`
 * so it doesn't force a React re-render on every grain).
 */
export const LoopIndicator = forwardRef(function LoopIndicator({ active, periodMs = 1200, size = 168 }, ref) {
  const flashRef = useRef(null)

  useImperativeHandle(ref, () => ({
    pulse() {
      const el = flashRef.current
      if (!el) return
      el.classList.remove('loop-indicator__flash--pulse')
      // Force reflow so the animation can restart even if it's still running.
      void el.offsetWidth
      el.classList.add('loop-indicator__flash--pulse')
    },
  }), [])

  return (
    <div
      className={`loop-indicator ${active ? 'loop-indicator--active' : ''}`}
      style={{ '--loop-size': `${size}px`, '--loop-duration': `${periodMs}ms` }}
    >
      <div className="loop-indicator__ring">
        <span className="loop-indicator__sparkle" />
      </div>
      <span ref={flashRef} className="loop-indicator__flash" />
    </div>
  )
})
