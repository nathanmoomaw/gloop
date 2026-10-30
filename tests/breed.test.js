import { describe, expect, it } from 'vitest'
import { BREED_SIZE, nextGeneration, seedPopulation } from '../src/audio/breed.js'
import { EVOLVE_KEYS } from '../src/audio/evolve.js'
import { getParams } from '../src/audio/engine.js'

describe('seedPopulation', () => {
  it('starts from the current sound plus mutants, all on evolvable keys only', () => {
    const current = getParams()
    const pop = seedPopulation(current)
    expect(pop.candidates).toHaveLength(BREED_SIZE)
    for (const k of EVOLVE_KEYS) expect(pop.candidates[0].params[k]).toBe(current[k])
    for (const c of pop.candidates) expect(Object.keys(c.params).sort()).toEqual([...EVOLVE_KEYS].sort())
    expect(new Set(pop.candidates.map((c) => c.id)).size).toBe(BREED_SIZE)
  })
})

describe('nextGeneration', () => {
  it('keeps picks, fills the round with stamped children, archives the rest', () => {
    const pop = seedPopulation(getParams())
    const next = nextGeneration(pop, [1, 3])
    expect(next.generation).toBe(2)
    expect(next.candidates).toHaveLength(BREED_SIZE)
    expect(next.candidates[0]).toBe(pop.candidates[1])
    expect(next.candidates[1]).toBe(pop.candidates[3])
    expect(next.archive).toEqual([pop.candidates[0], pop.candidates[2]])
  })

  it('always breeds at least one new child, even when everything is picked', () => {
    const pop = seedPopulation(getParams())
    const next = nextGeneration(pop, [0, 1, 2, 3])
    const oldIds = new Set(pop.candidates.map((c) => c.id))
    expect(next.candidates.some((c) => !oldIds.has(c.id))).toBe(true)
    // The pick over the cap is archived, not lost.
    expect(next.archive).toContain(pop.candidates[3])
  })

  it('no picks = no change', () => {
    const pop = seedPopulation(getParams())
    expect(nextGeneration(pop, [])).toBe(pop)
  })

  it('archive is bounded', () => {
    let pop = seedPopulation(getParams())
    for (let i = 0; i < 10; i++) pop = nextGeneration(pop, [0])
    expect(pop.archive.length).toBeLessThanOrEqual(8)
  })
})

describe('seedPopulation with evolve slots', () => {
  it('includes distinct evolved sounds after the current one and keeps a mutant', () => {
    const current = getParams()
    const evolved = [1, 2, 3].map((v) => Object.fromEntries(EVOLVE_KEYS.map((k) => [k, v])))
    const pop = seedPopulation(current, [{ ...current }, ...evolved])
    expect(pop.candidates).toHaveLength(BREED_SIZE)
    expect(pop.candidates[1].params.rate).toBe(1)
    expect(pop.candidates[2].params.rate).toBe(2)
    // the last slot is a mutant of the current sound, not evolved #3
    expect(pop.candidates[3].params.rate).not.toBe(3)
  })
})
