import { useCallback } from 'react'
import './EvolveToggle.css'

/**
 * Opens/closes learn mode (see LearnPanel / audio/learn.js). Shares
 * EvolveToggle's styling with its own hue. Always enabled: "no sound"
 * feedback is most useful exactly when nothing is playing.
 */
export default function LearnToggle({ active, onToggle }) {
  const handleClick = useCallback(() => onToggle(!active), [active, onToggle])

  return (
    <button
      type="button"
      className={`evolve-toggle bevel ${active ? 'evolve-toggle--active' : ''}`}
      style={{ '--toggle-color': 'var(--color-feedback)' }}
      onClick={handleClick}
      title={active ? 'Learn mode — tap to close.' : 'Tap to rate the sound as you play; GLOOP learns what works.'}
      aria-pressed={active}
      aria-label="Toggle learn mode"
    >
      learn
    </button>
  )
}
