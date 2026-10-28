import { useCallback, useState } from 'react'
import * as engine from '../audio/engine'
import { glideTo, EVOLVE_KEYS, EVOLVE_RANGES } from '../audio/evolve'
import { nextGeneration, seedPopulation } from '../audio/breed'
import './BreedPanel.css'

// Bar colors follow each param's own knob hue (index.css tokens).
const KEY_COLORS = {
  rate: 'var(--color-rate)',
  dynamics: 'var(--color-dynamics)',
  feedback: 'var(--color-feedback)',
  repeat: 'var(--color-repeat)',
  grainSizeMs: 'var(--color-size)',
  density: 'var(--color-density)',
  wow: 'var(--color-wow)',
  flutter: 'var(--color-flutter)',
  wobble: 'var(--color-wobble)',
}

const LETTERS = 'ABCD'

/**
 * Interactive evolution (see src/audio/breed.js): tap a card to hear it,
 * heart the ones worth keeping, breed the next round from those. Mounted
 * only while open, so each opening seeds from whatever is playing now.
 */
export default function BreedPanel({ onClose }) {
  const [pop, setPop] = useState(() => seedPopulation(engine.getParams()))
  const [active, setActive] = useState(0)
  const [picks, setPicks] = useState([])

  const audition = useCallback((i, candidates) => {
    setActive(i)
    glideTo(candidates[i].params)
  }, [])

  const togglePick = useCallback((i) => {
    setPicks((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))
  }, [])

  const breed = useCallback(() => {
    const next = nextGeneration(pop, picks)
    setPop(next)
    setPicks([])
    // Land on the first new child — the thing there is to hear next.
    audition(Math.min(picks.length, next.candidates.length - 1), next.candidates)
  }, [pop, picks, audition])

  return (
    <div className="breed-panel" role="dialog" aria-label="Breed sounds">
      <div className="breed-panel__cards">
        {pop.candidates.map((c, i) => (
          <div
            key={c.id}
            className={`breed-card ${i === active ? 'breed-card--active' : ''} ${picks.includes(i) ? 'breed-card--picked' : ''}`}
          >
            <button
              type="button"
              className="breed-card__play"
              onClick={() => audition(i, pop.candidates)}
              aria-label={`Listen to ${LETTERS[i]}`}
              aria-pressed={i === active}
            >
              <span className="breed-card__letter">{LETTERS[i]}</span>
              <span className="breed-card__bars" aria-hidden="true">
                {EVOLVE_KEYS.map((k) => {
                  const [lo, hi] = EVOLVE_RANGES[k]
                  const h = ((c.params[k] - lo) / (hi - lo)) * 100
                  return <span key={k} style={{ height: `${Math.max(6, h)}%`, background: KEY_COLORS[k] }} />
                })}
              </span>
            </button>
            <button
              type="button"
              className="breed-card__pick"
              onClick={() => togglePick(i)}
              aria-pressed={picks.includes(i)}
              aria-label={`Keep ${LETTERS[i]}`}
            >
              {picks.includes(i) ? '♥' : '♡'}
            </button>
          </div>
        ))}
      </div>
      <div className="breed-panel__footer">
        <span className="breed-panel__gen">gen {pop.generation}</span>
        <button type="button" className="breed-panel__btn" onClick={breed} disabled={picks.length === 0}>
          breed
        </button>
        <button type="button" className="breed-panel__btn" onClick={onClose}>
          done
        </button>
      </div>
    </div>
  )
}
