import { useCallback, useEffect, useRef } from 'react'
import './ListenButton.css'

// How long a press has to be held before it counts as hold-to-record
// instead of a plain tap toggle.
const LONG_PRESS_MS = 350

/**
 * Large circular "listen" toggle — the centerpiece control. Not a knob:
 * a tap starts/stops recording the mic into the grain pool. Holding it
 * (long press) records only for as long as it's held — `onHoldStart` /
 * `onHoldEnd` fire instead of `onToggle`, same as holding spacebar.
 */
export default function ListenButton({ running, onToggle, onHoldStart, onHoldEnd, onPress, size = 128 }) {
  const timerRef = useRef(null)
  const holdingRef = useRef(false)
  const suppressClickRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearTimer, [])

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return
    onPress?.()
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      holdingRef.current = true
      onHoldStart()
    }, LONG_PRESS_MS)
  }, [onHoldStart, onPress])

  const handlePointerEnd = useCallback(() => {
    clearTimer()
    if (holdingRef.current) {
      holdingRef.current = false
      // The click that follows a long press's pointerup shouldn't also
      // toggle listening back on.
      suppressClickRef.current = true
      onHoldEnd()
    }
  }, [onHoldEnd])

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onToggle()
  }, [onToggle])

  return (
    <button
      className={`listen-button ${running ? 'listen-button--on' : ''}`}
      style={{ '--listen-size': `${size}px` }}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onContextMenu={(e) => e.preventDefault()}
      aria-pressed={running}
      aria-label={running ? 'Stop listening' : 'Start listening (hold to record while held)'}
      title="Tap to toggle listening — hold (or hold spacebar) to listen only while held"
    >
      <span className="listen-button__ring" />
      <span className="listen-button__core">
        <span className="listen-button__label">
          {running ? 'listening' : 'listen'}
        </span>
      </span>
    </button>
  )
}
