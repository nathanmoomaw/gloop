import { useCallback } from 'react'
import './OnButton.css'

/**
 * Power toggle for grain playback — independent of `listen`, which only
 * controls recording the mic into the grain pool. With `on` alone, the
 * pool keeps looping whatever it last captured; with `listen` alone, new
 * sound gets recorded silently for later. Sits directly right of listen,
 * sized between it and the knobs.
 */
export default function OnButton({ active, onToggle, size = 76 }) {
  const handleClick = useCallback(() => onToggle(!active), [active, onToggle])

  return (
    <button
      type="button"
      className={`on-button bevel ${active ? 'on-button--active' : ''}`}
      style={{ '--on-size': `${size}px` }}
      onClick={handleClick}
      title={active ? 'Playing grains — tap to stop' : 'Tap to start playing grains'}
      aria-pressed={active}
      aria-label={active ? 'Stop playback' : 'Start playback'}
    >
      on
    </button>
  )
}
