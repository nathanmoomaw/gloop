import { useCallback } from 'react'
import './OnButton.css'

/**
 * Power toggle for grain playback — independent of `listen`, which only
 * controls recording the mic into the grain pool. With `on` alone, the
 * pool keeps looping whatever it last captured; with `listen` alone, new
 * sound gets recorded silently for later.
 */
export default function OnButton({ active, onToggle }) {
  const handleClick = useCallback(() => onToggle(!active), [active, onToggle])

  return (
    <button
      type="button"
      className={`on-button ${active ? 'on-button--active' : ''}`}
      onClick={handleClick}
      title={active ? 'Playing grains — tap to stop' : 'Tap to start playing grains'}
      aria-pressed={active}
      aria-label={active ? 'Stop playback' : 'Start playback'}
    >
      on
    </button>
  )
}
