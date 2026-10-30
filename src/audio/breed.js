// GLOOP breed — Karl Sims-style interactive evolution: the listener is the
// fitness function. Each round shows BREED_SIZE candidate parameter sets;
// the user auditions them, hearts the ones they like, and the next round is
// bred from those picks with the same NEAT crossover + mutation evolve.js
// uses for its automatic host/parasite loop. The two share a population:
// a round opens with evolve's fittest slots, and picks go back to evolve
// (adoptPicks, called from BreedPanel).
//
// Unpicked candidates aren't deleted, only deprioritized: they go to a
// small archive and occasionally come back as a second parent — a sound
// that lost one round can still carry something worth keeping (the SCP
// "low score ≠ no lineage value" caution logged in worth-saving/gloop.md).
//
// Pure functions over a plain population object — no engine access here,
// so the UI decides when to audition (glideTo) and this stays testable.

import { crossover, mutate, EVOLVE_KEYS } from './evolve'

export const BREED_SIZE = 4
const ARCHIVE_MAX = 8
// Chance a child's second parent comes from the archive instead of the picks.
const ARCHIVE_PARENT_CHANCE = 0.15
// Round 0 spreads wide so there's a real choice; later rounds refine.
const SEED_SCALE = 0.25
const SEED_RATE = 0.6
const CHILD_SCALE = 0.1
const CHILD_RATE = 0.35

let nextId = 1

function candidate(params, innovation) {
  return { id: nextId++, params, innovation, fitness: 0 }
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)]
}

// Round 0: the current sound as-is, then `evolved` (evolve's fittest
// slots, so breed starts from what evolution found), then mutants of the
// current sound to fill the round.
export function seedPopulation(current, evolved = []) {
  const params = Object.fromEntries(EVOLVE_KEYS.map((k) => [k, current[k]]))
  const innovation = Object.fromEntries(EVOLVE_KEYS.map((k) => [k, 0]))
  const candidates = [candidate(params, innovation)]
  const same = (a, b) => EVOLVE_KEYS.every((k) => a[k] === b[k])
  for (const e of evolved) {
    if (candidates.length >= BREED_SIZE - 1) break // keep one fresh mutant
    if (candidates.some((c) => same(c.params, e))) continue
    candidates.push(candidate(Object.fromEntries(EVOLVE_KEYS.map((k) => [k, e[k]])), { ...innovation }))
  }
  while (candidates.length < BREED_SIZE) {
    const m = mutate(params, innovation, SEED_SCALE, SEED_RATE, 1)
    candidates.push(candidate(m.params, m.innovation))
  }
  return { generation: 1, candidates, archive: [] }
}

// Next round from the picked indexes (at least one). Picks carry over
// unchanged — capped so there's always at least one new child — and the
// rest of the round is their offspring.
export function nextGeneration(pop, pickedIdx, rng = Math.random) {
  const keptIdx = pickedIdx.slice(0, BREED_SIZE - 1)
  const picked = keptIdx.map((i) => pop.candidates[i])
  if (picked.length === 0) return pop
  const gen = pop.generation + 1
  // Everything not kept is archived — a pick over the cap first, so the
  // archive's size limit trims it last.
  const archive = [
    ...pickedIdx.slice(BREED_SIZE - 1).map((i) => pop.candidates[i]),
    ...pop.candidates.filter((_, i) => !pickedIdx.includes(i)),
    ...pop.archive,
  ].slice(0, ARCHIVE_MAX)
  // Fitter = picked, for crossover's disjoint-gene rule.
  const parents = picked.map((c) => ({ ...c, fitness: 1 }))
  const candidates = [...picked]
  while (candidates.length < BREED_SIZE) {
    const a = pick(parents, rng)
    const b = archive.length && rng() < ARCHIVE_PARENT_CHANCE ? pick(archive, rng) : pick(parents, rng)
    const x = crossover(a, b)
    const m = mutate(x.params, x.innovation, CHILD_SCALE, CHILD_RATE, gen)
    candidates.push(candidate(m.params, m.innovation))
  }
  return { generation: gen, candidates, archive }
}
