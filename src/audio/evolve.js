// GLOOP evolve — Avida-style host/parasite parameter competition, layered
// on top of engine.js's public param surface (getParams/setParam/
// getAnalyser) rather than reaching into its internals.
//
// Avida runs self-replicating programs in a grid of CPU cells; parasites
// are mutated code fragments that invade a host cell and steal its
// execution cycles to replicate themselves, and hosts that survive can
// evolve resistance — a genuine arms race, not a one-shot GA generation.
// This maps that onto GLOOP's own feedback loop instead of a virtual CPU
// grid:
//   - a fixed number of "slots" hold host parameter-sets (mutated variants
//     of the dial values, not full presets — same evolvable subset as the
//     shake button touches, master volume/sensitivity excluded)
//   - each tick, a parasite (a larger mutation of a random slot) is
//     actually applied to the live engine and given a moment to play, then
//     scored against that slot's incumbent host on a stability fitness —
//     so evolution is audible/visible as it happens, not a hidden
//     background optimizer
//   - fitness is read directly off the same signal GrainField's Chladni
//     nodal pattern already derives its resonance mode from: the live
//     analyser's dominant FFT bin. A pattern that holds a steady dominant
//     bin at real amplitude scores high; silence or bin-hopping noise
//     scores low (level is a multiplicative gate so silence can't win by
//     trivially being "stable")
//   - a host that survives a challenge gains a small, decaying resistance
//     bonus — without this the whole thing collapses into a plain
//     generational GA with nothing "host" about it. Resistance decays back
//     down on its own, so the arms race never permanently settles (the
//     Red Queen framing already logged for GLOOP in worth-saving/gloop.md)

import { getParams, setParam, getAnalyser } from './engine'

// Same texture-only philosophy as App.jsx's SHAKE_RANGES: master volume
// and sensitivity are excluded so evolution reshuffles the sound's
// character without ever drifting it toward silence or blasting output.
const EVOLVE_RANGES = {
  rate: [20, 600],
  dynamics: [0, 1],
  feedback: [0, 0.9],
  repeat: [0, 1],
  grainSizeMs: [30, 3000],
  density: [0, 1],
  wow: [0, 1],
  flutter: [0, 1],
  wobble: [0, 1],
}
const EVOLVE_KEYS = Object.keys(EVOLVE_RANGES)

const SLOT_COUNT = 5
// How much of a slot's own params a parasite jumps by, per mutated key, as
// a fraction of that param's full range — a real "invasive" jump, bigger
// than incremental drift.
const PARASITE_MUTATION_SCALE = 0.35
// Fraction of evolvable keys a parasite actually touches per challenge —
// the rest of the host's params pass through unchanged (a point mutation,
// not a full reshuffle like the shake button).
const PARASITE_MUTATION_RATE = 0.5
const RESISTANCE_GAIN = 0.35
const RESISTANCE_MAX = 1.2
// Resistance decay per generation tick — an evolved host's edge fades on
// its own, so the same slot can't just become permanently un-invadable.
const RESISTANCE_DECAY = 0.85

const GENERATION_INTERVAL_MS = 2400
// How long a challenging parasite is left actually playing before its
// fitness is read — long enough for the rolling fitness window (below) to
// mostly reflect the new params rather than the outgoing host's tail.
const EVAL_DELAY_MS = 1100
const FITNESS_SAMPLE_MS = 120
// Rolling window (in samples) the dominant-bin stability score is measured
// over — short enough to react within one generation, long enough not to
// be noise on a single frame.
const FITNESS_HISTORY_LEN = Math.round(1000 / FITNESS_SAMPLE_MS)

let slots = []
let running = false
let genTimer = null
let fitnessTimer = null
let dominantBinHistory = []
let levelHistory = []
let onTickCallback = null

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function mutate(params, scale, rate) {
  const next = { ...params }
  for (const key of EVOLVE_KEYS) {
    if (Math.random() > rate) continue
    const [lo, hi] = EVOLVE_RANGES[key]
    const jitter = (Math.random() - 0.5) * 2 * (hi - lo) * scale
    next[key] = clamp((params[key] ?? lo) + jitter, lo, hi)
  }
  return next
}

function applyParams(params) {
  for (const key of EVOLVE_KEYS) {
    if (key in params) setParam(key, params[key])
  }
}

// Reads the live analyser each tick and folds it into a short rolling
// history — this is the same "dominant FFT bin" GrainField.jsx reads to
// pick its Chladni mode numbers, reused here as the stability signal
// instead of duplicating separate audio analysis.
function sampleFitness() {
  const analyser = getAnalyser()
  if (!analyser) return
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(data)

  let maxBin = 0
  let maxVal = 0
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i]
    if (data[i] > maxVal) {
      maxVal = data[i]
      maxBin = i
    }
  }
  const level = sum / data.length / 255

  dominantBinHistory.push(maxBin)
  levelHistory.push(level)
  if (dominantBinHistory.length > FITNESS_HISTORY_LEN) dominantBinHistory.shift()
  if (levelHistory.length > FITNESS_HISTORY_LEN) levelHistory.shift()
}

// Fitness = level * stability, both 0-1. Multiplicative on purpose: a
// silent plate is trivially "stable" (the dominant bin barely moves) but
// isn't a real nodal pattern, so level gates it down to ~0 rather than
// stability alone rewarding silence.
function currentFitness() {
  if (dominantBinHistory.length < 3) return 0
  const mean = dominantBinHistory.reduce((a, b) => a + b, 0) / dominantBinHistory.length
  const variance = dominantBinHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / dominantBinHistory.length
  // Normalize against a bin-spread that would already read as chaotic
  // mode-hopping in GrainField's own smoothing, rather than the full FFT
  // range (which would make almost everything look "stable").
  const stability = clamp(1 - variance / 400, 0, 1)
  const level = levelHistory.reduce((a, b) => a + b, 0) / levelHistory.length
  return stability * level
}

function runGeneration() {
  if (!running) return

  const hostIdx = Math.floor(Math.random() * slots.length)
  const host = slots[hostIdx]
  const parasiteParams = mutate(host.params, PARASITE_MUTATION_SCALE, PARASITE_MUTATION_RATE)

  applyParams(parasiteParams)

  genTimer = setTimeout(() => {
    if (!running) return
    const parasiteFitness = currentFitness()
    const hostEffective = host.fitness * (1 + host.resistance)

    if (parasiteFitness > hostEffective) {
      slots[hostIdx] = { params: parasiteParams, fitness: parasiteFitness, resistance: 0 }
    } else {
      // Host resists the invasion — put its own params back (the parasite
      // was actually playing during the eval window) and reward the win
      // with a decaying resistance bump.
      applyParams(host.params)
      host.resistance = Math.min(RESISTANCE_MAX, host.resistance + RESISTANCE_GAIN)
    }

    for (const slot of slots) slot.resistance *= RESISTANCE_DECAY

    if (onTickCallback) {
      onTickCallback({
        hostIdx,
        won: parasiteFitness > hostEffective,
        fitness: Math.max(parasiteFitness, hostEffective),
      })
    }

    genTimer = setTimeout(runGeneration, GENERATION_INTERVAL_MS - EVAL_DELAY_MS)
  }, EVAL_DELAY_MS)
}

// Fires with { hostIdx, won, fitness } after each generation's outcome —
// purely informational (e.g. for a UI pulse), evolution runs the same
// without a listener.
export function onEvolveTick(callback) {
  onTickCallback = callback
}

export function startEvolve() {
  if (running) return
  if (!getAnalyser()) return // needs a live listening session to measure fitness against
  running = true

  const seed = getParams()
  slots = Array.from({ length: SLOT_COUNT }, () => ({ params: { ...seed }, fitness: 0, resistance: 0 }))
  dominantBinHistory = []
  levelHistory = []

  fitnessTimer = setInterval(sampleFitness, FITNESS_SAMPLE_MS)
  genTimer = setTimeout(runGeneration, GENERATION_INTERVAL_MS - EVAL_DELAY_MS)
}

export function stopEvolve() {
  running = false
  if (genTimer) clearTimeout(genTimer)
  genTimer = null
  if (fitnessTimer) clearInterval(fitnessTimer)
  fitnessTimer = null
  slots = []
}

export function isEvolving() {
  return running
}
