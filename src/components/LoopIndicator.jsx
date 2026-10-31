import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { advancePhase, lapPoint } from './lapPoint'
import './LoopIndicator.css'

/**
 * Glowing dot that laps the screen's edges — a visual readout, not a
 * control. Lap time tracks the current grain rate/delay time live, driven
 * from a JS phase (see lapPoint.js) so a rate change alters speed without
 * making the dot jump; it
 * briefly flares each time a grain actually fires (driven imperatively via
 * `pulse()` on a nested element so restarting the flash animation never
 * disturbs the dot's own continuous travel animation — those live on two
 * separate elements precisely so toggling one doesn't restart the other).
 */
export const LoopIndicator = forwardRef(function LoopIndicator({ active, periodMs = 1200 }, ref) {
  const glowRef = useRef(null)
  const dotRef = useRef(null)
  const periodRef = useRef(periodMs)
  periodRef.current = periodMs

  // Always running, like the CSS animation it replaces, so the dot keeps
  // travelling through the fade-out.
  useEffect(() => {
    let raf
    let phase = 0
    let last = null
    const tick = (now) => {
      if (last !== null) phase = advancePhase(phase, now - last, periodRef.current)
      last = now
      const el = dotRef.current
      if (el) {
        const { left, top } = lapPoint(phase)
        el.style.left = `${left}%`
        el.style.top = `${top}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

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
    <div className={`loop-indicator ${active ? 'loop-indicator--active' : ''}`}>
      <div className="loop-indicator__track" />
      <span ref={dotRef} className="loop-indicator__dot">
        <span ref={glowRef} className="loop-indicator__glow" />
      </span>
    </div>
  )
})
