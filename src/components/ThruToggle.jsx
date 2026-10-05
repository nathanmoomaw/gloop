import { useCallback } from 'react'
import './ThruToggle.css'

/**
 * Full bypass: the live mic goes straight to the output, clean, and the
 * granular/delay path (in-flight loop tails included) is muted. Engaging
 * it opens the mic if it isn't already — there's nothing to pass through
 * otherwise. Off brings the effects back.
 */
export default function ThruToggle({ active, onToggle }) {
  const handleClick = useCallback(() => onToggle(!active), [active, onToggle])

  return (
    <button
      type="button"
      className={`thru-toggle bevel ${active ? 'thru-toggle--active' : ''}`}
      onClick={handleClick}
      title={
        active
          ? 'Thru: clean mic straight out, all loop effects bypassed — tap to bring the effects back.'
          : 'Tap for thru: clean mic straight out, bypassing the whole grain/delay loop.'
      }
      aria-pressed={active}
      aria-label="Toggle audio thru (effects bypass)"
    >
      thru
    </button>
  )
}
