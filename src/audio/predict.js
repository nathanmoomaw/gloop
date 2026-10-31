// Nonparametric preference predictor over the learn log: Nadaraya-Watson
// kernel regression in normalized feature space with a Beta-like prior so
// unexplored regions report 0.5 at zero confidence instead of extrapolating
// wildly from a single distant datapoint.
import { wasSounding } from './learn.js'

// First 9 match EVOLVE_RANGES in evolve.js; the 4 level dials are appended
// because they decide whether anything is heard at all.
export const FEATURES = {
  rate: [20, 4000, true],
  grainSizeMs: [30, 3000, true],
  feedback: [0, 0.9, false],
  repeat: [0, 1, false],
  density: [0, 1, false],
  dynamics: [0, 1, false],
  wow: [0, 1, false],
  flutter: [0, 1, false],
  wobble: [0, 1, false],
  volume: [0, 1, false],
  granularMix: [0, 1, false],
  delayMix: [0, 1, false],
  sensitivity: [0, 1, false],
}

const FEATURE_SPECS = Object.entries(FEATURES).map(([key, [lo, hi, isLog]]) => ({
  key,
  lo,
  hi,
  isLog,
  logLo: isLog ? Math.log(lo) : 0,
  span: isLog ? Math.log(hi) - Math.log(lo) : hi - lo,
}))

// Target quality score per feedback/implicit kind (0 = silent/bad, 1 = loved).
export const LABELS = {
  heart: 1,
  star: 1,
  pick: 0.9,
  linger: 0.85,
  sound: 0.75,
  settle: 0.65,
  rescue: 0.1,
  muted: 0,
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Map a params object to a vector in [0, 1]^d across FEATURES in key order. */
export function featurize(params) {
  const p = params && typeof params === 'object' ? params : {}
  return FEATURE_SPECS.map(({ key, lo, isLog, logLo, span }) => {
    const v = p[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0.5
    if (isLog) {
      if (v <= 0) return 0.5
      return clamp01((Math.log(v) - logLo) / span)
    }
    return clamp01((v - lo) / span)
  })
}

/**
 * Fit a kernel regressor over learn entries. Entries taken while the grains
 * were muted (playing === false or thru === true) rated something else and
 * are skipped, matching learnedTarget in learn.js.
 */
export function createPredictor(
  entries,
  { bandwidth = 0.15, halfLife = 200, prior = 0.5, priorWeight = 1 } = {},
) {
  const kept = []
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue
      if (!Object.prototype.hasOwnProperty.call(LABELS, e.kind)) continue
      if (!e.params || typeof e.params !== 'object') continue
      if (!wasSounding(e)) continue
      kept.push({ x: featurize(e.params), y: LABELS[e.kind] })
    }
  }

  const n = kept.length
  const samples = kept.map((item, i) => ({
    x: item.x,
    y: item.y,
    r: 0.5 ** ((n - 1 - i) / halfLife),
  }))
  const invTwoSigma2 = 1 / (2 * bandwidth * bandwidth)
  const dim = FEATURE_SPECS.length

  function predict(params) {
    const q = featurize(params)
    let sumW = 0
    let sumWY = 0
    for (let i = 0; i < n; i++) {
      const { x, y, r } = samples[i]
      let sq = 0
      for (let j = 0; j < dim; j++) {
        const d = q[j] - x[j]
        sq += d * d
      }
      const d2 = sq / dim
      const k = Math.exp(-d2 * invTwoSigma2)
      const w = r * k
      sumW += w
      sumWY += w * y
    }
    const denom = sumW + priorWeight
    return {
      score: (sumWY + prior * priorWeight) / denom,
      confidence: sumW / denom,
    }
  }

  return { predict, size: n }
}

/** Return the candidate with the highest predicted score (first wins ties). */
export function bestOf(predictor, candidates, getParams = (c) => c) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  let bestCandidate = candidates[0]
  let bestScore = predictor.predict(getParams(candidates[0])).score
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const { score } = predictor.predict(getParams(c))
    if (score > bestScore) {
      bestScore = score
      bestCandidate = c
    }
  }
  return bestCandidate
}
