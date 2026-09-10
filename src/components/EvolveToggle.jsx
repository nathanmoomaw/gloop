import { useCallback } from 'react'
import './EvolveToggle.css'

/**
 * Toggles the Avida-style host/parasite parameter evolution (see
 * src/audio/evolve.js) — a background competition that periodically
 * mutates and auditions live parameter sets against a spectral-stability
 * fitness, expressing the winner onto the running engine. Only meaningful
 * while listening (it needs the live analyser to score fitness against),
 * so it's disabled otherwise.
 */
export default function EvolveToggle({ active, disabled, onToggle }) {
  const handleClick = useCallback(() => {
    if (disabled) return
    onToggle(!active)
  }, [active, disabled, onToggle])

  return (
    <button
      type="button"
      className={`evolve-toggle ${active ? 'evolve-toggle--active' : ''}`}
      onClick={handleClick}
      disabled={disabled}
      title={
        disabled
          ? 'Start listening first — evolution needs live audio to score against.'
          : active
            ? 'Host/parasite parameter evolution is running — tap to stop.'
            : 'Tap to let mutated parameter sets compete for the live sound, judged on spectral/nodal stability.'
      }
      aria-pressed={active}
      aria-label="Toggle parameter evolution"
    >
      evolve
    </button>
  )
}
