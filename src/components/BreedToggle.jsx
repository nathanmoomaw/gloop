import { useCallback } from 'react'
import './EvolveToggle.css'

/**
 * Opens/closes the interactive breed panel (see BreedPanel / audio/breed.js)
 * — the hand-picked counterpart to `evolve`. Shares EvolveToggle's styling
 * with its own hue. Disabled while `on` is off, since auditioning needs
 * live playback.
 */
export default function BreedToggle({ active, disabled, onToggle }) {
  const handleClick = useCallback(() => {
    if (disabled) return
    onToggle(!active)
  }, [active, disabled, onToggle])

  return (
    <button
      type="button"
      className={`evolve-toggle bevel ${active ? 'evolve-toggle--active' : ''}`}
      style={{ '--toggle-color': 'var(--color-repeat)' }}
      onClick={handleClick}
      disabled={disabled}
      title={
        disabled
          ? 'Turn `on` first — breeding auditions the live sound.'
          : active
            ? 'Breeding — tap to close.'
            : 'Tap to breed sounds by ear: audition variants, keep favorites, breed the next round.'
      }
      aria-pressed={active}
      aria-label="Toggle sound breeding"
    >
      breed
    </button>
  )
}
