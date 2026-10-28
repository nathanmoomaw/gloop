import { useRef, useCallback, memo } from 'react'
import './RotaryKnob.css'

const MIN_ANGLE = -135
const MAX_ANGLE = 135
const ANGLE_RANGE = MAX_ANGLE - MIN_ANGLE // 270°

/**
 * Rotary knob with ghost slider overlay.
 * Ported from puddle's RotaryKnob (same drag model, ghost-slider feedback,
 * per-control --knob-color), adjusted here for GLOOP's rainbow palette.
 * Uses vertical drag (up = increase, down = decrease) with pointer capture.
 */
export const RotaryKnob = memo(function RotaryKnob({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  color = 'var(--rainbow-1)',
  label,
  valueLabel,
  size = 48,
  className = '',
}) {
  const knobRef = useRef(null)
  const notchRef = useRef(null)
  const ghostRef = useRef(null)
  const ghostThumbRef = useRef(null)
  const dragging = useRef(false)
  const hasDragged = useRef(false)
  const startY = useRef(0)
  const startValue = useRef(0)
  const dragSensitivity = useRef(200)

  const range = max - min

  // Map value to angle
  const ratio = Math.max(0, Math.min(1, (value - min) / range))
  const angle = MIN_ANGLE + ratio * ANGLE_RANGE

  // Direct DOM update for zero-lag response
  const applyVisuals = useCallback((newRatio) => {
    const deg = MIN_ANGLE + newRatio * ANGLE_RANGE
    if (notchRef.current) {
      notchRef.current.style.transform = `rotate(${deg}deg)`
    }
    if (ghostThumbRef.current) {
      const topPct = (1 - newRatio) * 100
      ghostThumbRef.current.style.top = `${topPct}%`
    }
  }, [])

  const onPointerDown = useCallback((e) => {
    dragging.current = true
    startY.current = e.clientY
    startValue.current = value
    e.currentTarget.setPointerCapture(e.pointerId)

    // When near screen bottom, reduce drag distance required for full range
    const spaceBelow = window.innerHeight - e.clientY
    dragSensitivity.current = Math.min(200, Math.max(50, spaceBelow * 1.2))

    // Show ghost slider
    if (ghostRef.current) ghostRef.current.classList.add('rotary-knob__ghost--visible')
  }, [value])

  const onPointerMove = useCallback((e) => {
    if (!dragging.current) return
    hasDragged.current = true

    // Vertical drag: up = increase, down = decrease
    const dy = startY.current - e.clientY
    const deltaRatio = dy / dragSensitivity.current
    const newValue = Math.max(min, Math.min(max,
      startValue.current + deltaRatio * range
    ))

    // Snap to step
    const stepped = Math.round(newValue / step) * step
    const clampedStepped = Math.max(min, Math.min(max, stepped))

    const newRatio = (clampedStepped - min) / range
    applyVisuals(newRatio)
    onChange(clampedStepped)
  }, [min, max, step, range, onChange, applyVisuals])

  const onPointerUp = useCallback((e) => {
    const didDrag = hasDragged.current
    dragging.current = false
    hasDragged.current = false
    // Hide ghost slider
    if (ghostRef.current) ghostRef.current.classList.remove('rotary-knob__ghost--visible')
    // Swallow the synthetic click that fires after a pointer-capture drag
    // ends. Mouse only: a touch drag fires no click, so the swallow would
    // eat the next tap on anything else instead.
    if (didDrag && e.pointerType === 'mouse') {
      const suppress = (ev) => ev.stopImmediatePropagation()
      document.addEventListener('click', suppress, { once: true, capture: true })
      setTimeout(() => document.removeEventListener('click', suppress, true), 300)
    }
  }, [])

  // Keyboard: arrows nudge 1% of the range, PageUp/PageDown 10%,
  // Home/End jump to the ends — standard ARIA slider keys.
  const onKeyDown = useCallback((e) => {
    const nudge = Math.max(step, range / 100)
    let next
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight': next = value + nudge; break
      case 'ArrowDown':
      case 'ArrowLeft': next = value - nudge; break
      case 'PageUp': next = value + nudge * 10; break
      case 'PageDown': next = value - nudge * 10; break
      case 'Home': next = min; break
      case 'End': next = max; break
      default: return
    }
    e.preventDefault()
    const stepped = Math.max(min, Math.min(max, Math.round(next / step) * step))
    applyVisuals((stepped - min) / range)
    onChange(stepped)
  }, [value, min, max, step, range, onChange, applyVisuals])

  const ghostTopPct = (1 - ratio) * 100

  return (
    <div
      className={`rotary-knob ${className}`}
      style={{ '--knob-size': `${size}px`, '--knob-color': color }}
    >
      {label && <span className="rotary-knob__label">{label}</span>}
      <div
        className="rotary-knob__body bevel"
        ref={knobRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{ touchAction: 'none' }}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueLabel != null ? String(valueLabel) : undefined}
      >
        {/* The rotating notch indicator */}
        <div
          className="rotary-knob__notch-ring"
          ref={notchRef}
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="rotary-knob__notch" />
        </div>

        {/* Ghost slider overlay — visible during drag */}
        <div className="rotary-knob__ghost" ref={ghostRef}>
          <div className="rotary-knob__ghost-track" />
          <div
            className="rotary-knob__ghost-thumb"
            ref={ghostThumbRef}
            style={{ top: `${ghostTopPct}%` }}
          />
        </div>
      </div>
      {valueLabel != null && <span className="rotary-knob__value">{valueLabel}</span>}
    </div>
  )
})
