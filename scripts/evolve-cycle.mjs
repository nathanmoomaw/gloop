// Offline half of GLOOP's self-evolving loop: fit the preference predictor on
// all logged JSONL entries and search SOUND_BOUNDS for higher-scoring default
// parameters where the predictor already has enough nearby evidence.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPredictor, FEATURES } from '../src/audio/predict.js'
import { SOUND_BOUNDS } from '../src/audio/sound.js'
import { getParams } from '../src/audio/engine.js'

/** Deterministic 32-bit PRNG so candidate searches are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function listJsonlFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
      .map((d) => path.join(dir, d.name))
      .sort()
  } catch {
    return []
  }
}

/**
 * Read *.jsonl from `dir` and `dir/remote`, skipping malformed lines,
 * deduping by `id` when present, and sorting ascending by `t`.
 */
export function readEntries(dir = path.join(process.cwd(), 'learning')) {
  const files = [...listJsonlFiles(dir), ...listJsonlFiles(path.join(dir, 'remote'))]
  const seenIds = new Set()
  const entries = []
  for (const file of files) {
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (!parsed || typeof parsed !== 'object') continue
      if (parsed.id !== undefined && parsed.id !== null) {
        if (seenIds.has(parsed.id)) continue
        seenIds.add(parsed.id)
      }
      entries.push(parsed)
    }
  }
  entries.sort((a, b) => String(a?.t ?? '').localeCompare(String(b?.t ?? '')))
  return entries
}

function roundSig4(x) {
  if (!Number.isFinite(x) || x === 0) return 0
  return Number(x.toPrecision(4))
}

/**
 * Search within `bounds` for a candidate with confidence >= 0.3 that beats
 * `current` by at least 0.05 predicted score.
 */
export function proposeDefaults({
  entries = [],
  current = getParams(),
  bounds = SOUND_BOUNDS,
  samples = 4000,
  seed = 1,
  minEntries = 20,
} = {}) {
  const predictor = createPredictor(entries)
  const trained = predictor.size
  const base = predictor.predict(current)
  if (trained < minEntries) {
    return { trained, base, best: null, changes: {} }
  }

  const rng = mulberry32(seed)
  const searchKeys = Object.keys(bounds).filter((k) =>
    Object.prototype.hasOwnProperty.call(FEATURES, k),
  )

  let bestCandidate = null
  let bestPred = null

  for (let i = 0; i < samples; i++) {
    const cand = { ...current }
    for (const key of searchKeys) {
      const [lo, hi] = bounds[key]
      const isLog = FEATURES[key][2]
      const u = rng()
      cand[key] = isLog ? Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo))) : lo + u * (hi - lo)
    }
    const pred = predictor.predict(cand)
    if (pred.confidence < 0.3) continue
    if (!bestPred || pred.score > bestPred.score) {
      bestPred = pred
      bestCandidate = cand
    }
  }

  if (!bestPred || bestPred.score - base.score < 0.05) {
    return { trained, base, best: bestPred, changes: {} }
  }

  const changes = {}
  for (const key of searchKeys) {
    const [fLo, fHi] = FEATURES[key]
    const span = fHi - fLo
    if (Math.abs(bestCandidate[key] - current[key]) > 0.02 * span) {
      changes[key] = roundSig4(bestCandidate[key])
    }
  }

  return {
    trained,
    base,
    best: bestPred,
    changes,
  }
}

function parseArgs(argv) {
  const opts = { samples: 4000, seed: 1, minEntries: 20 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--samples' && argv[i + 1] !== undefined) {
      opts.samples = Number(argv[++i])
    } else if (arg === '--seed' && argv[i + 1] !== undefined) {
      opts.seed = Number(argv[++i])
    } else if (arg === '--min-entries' && argv[i + 1] !== undefined) {
      opts.minEntries = Number(argv[++i])
    }
  }
  // A typo (`--samples abc`) falls back to the default instead of a silent no-op.
  for (const [k, v] of Object.entries({ samples: 4000, seed: 1, minEntries: 20 })) {
    if (!Number.isFinite(opts[k]) || opts[k] < 0) opts[k] = v
  }
  return opts
}

function countByKind(entries) {
  const counts = {}
  for (const e of entries) {
    const k = e && typeof e.kind === 'string' ? e.kind : 'unknown'
    counts[k] = (counts[k] || 0) + 1
  }
  return counts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const learningDir = path.join(process.cwd(), 'learning')
  const entries = readEntries(learningDir)
  const byKind = countByKind(entries)
  const current = getParams()
  const { trained, base, best, changes } = proposeDefaults({
    entries,
    current,
    bounds: SOUND_BOUNDS,
    samples: opts.samples,
    seed: opts.seed,
    minEntries: opts.minEntries,
  })

  const date = new Date().toISOString().slice(0, 10)
  const cycleDir = path.join(learningDir, 'cycle')
  fs.mkdirSync(cycleDir, { recursive: true })

  const kindSummary =
    Object.entries(byKind)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || 'none'

  const lines = [
    `# Evolve Cycle — ${date}`,
    '',
    `- Entries: ${entries.length} (${kindSummary})`,
    `- Training size: ${trained} (min required: ${opts.minEntries})`,
    `- Current defaults: score ${base.score.toFixed(4)}, confidence ${base.confidence.toFixed(4)}`,
  ]

  const changeKeys = Object.keys(changes)
  if (trained < opts.minEntries) {
    lines.push('', `Not enough training data yet (${trained} < ${opts.minEntries}); no suggestion.`)
  } else if (!best) {
    lines.push('', 'No candidate reached the 0.3 confidence threshold; no suggestion.')
  } else {
    lines.push(`- Best found: score ${best.score.toFixed(4)}, confidence ${best.confidence.toFixed(4)}`)
    if (changeKeys.length === 0) {
      lines.push('', 'No suggestion (improvement below +0.05 threshold or within 2% of current defaults).')
    } else {
      lines.push(
        '',
        '| param | current | suggested |',
        '| --- | --- | --- |',
        ...changeKeys.map((k) => `| ${k} | ${current[k]} | ${changes[k]} |`),
        '',
        'Apply: edit the `state` defaults in src/audio/engine.js',
      )
    }
  }

  const mdPath = path.join(cycleDir, `${date}.md`)
  const jsonPath = path.join(cycleDir, `${date}.json`)
  fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf8')

  const jsonPayload = {
    date,
    entries: { total: entries.length, byKind },
    trained,
    current: { score: roundSig4(base.score), confidence: roundSig4(base.confidence) },
    best: best
      ? { score: roundSig4(best.score), confidence: roundSig4(best.confidence) }
      : null,
    changes,
  }
  fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2) + '\n', 'utf8')

  console.log(`evolve-cycle (${date}): ${entries.length} entries, ${trained} trained`)
  console.log(`current score=${base.score.toFixed(3)} (conf=${base.confidence.toFixed(3)})`)
  if (changeKeys.length > 0 && best) {
    console.log(`suggested ${changeKeys.length} param(s) -> score=${best.score.toFixed(3)} (wrote ${mdPath})`)
  } else {
    console.log(`no suggestion written to ${mdPath}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
