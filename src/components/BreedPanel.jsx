import { useCallback, useState } from 'react'
import * as engine from '../audio/engine'
import { adoptPicks, fittestParams, glideTo, EVOLVE_KEYS, EVOLVE_RANGES } from '../audio/evolve'
import { BREED_SIZE, nextGeneration, seedPopulation } from '../audio/breed'
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
 * only while open, so each opening seeds from whatever is playing now plus
 * evolve's fittest slots; every pick also goes back to evolve.
 */
export default function BreedPanel({ predict, onPick, onClose }) {
  const [pop, setPop] = useState(() => seedPopulation(engine.getParams(), fittestParams(BREED_SIZE), predict))
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
    // Picks join evolve's population too (see evolve.js adoptPicks), and
    // each is logged for learning.
    const picked = picks.map((i) => pop.candidates[i].params)
    adoptPicks(picked)
    picked.forEach((params) => onPick?.(params))
    const next = nextGeneration(pop, picks, Math.random, predict)
    setPop(next)
    setPicks([])
    // Land on the first new child — the thing there is to hear next.
    audition(Math.min(picks.length, next.candidates.length - 1), next.candidates)
  }, [pop, picks, audition, onPick, predict])

  // The model's guess per card, so its judging can be judged; faint while
  // it has little evidence nearby.
  const guess = (params) => {
    if (!predict) return null
    const { score, confidence } = predict(params)
    return (
      <span className="breed-card__guess" style={{ opacity: 0.35 + confidence * 0.65 }} title="predicted from what you've liked">
        {Math.round(score * 100)}%
      </span>
    )
  }

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
              {guess(c.params)}
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
