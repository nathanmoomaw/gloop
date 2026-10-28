// GLOOP visual CPPN — tiny compositional pattern-producing network (Stanley
// 2007) that generates a scalar nodal field over the vibrating plate. Visual
// presets are plain genomes that can be mutated and crossed over; compileGenome
// flattens weights into a Float64Array so GrainField can evaluate ~87k points
// per frame without allocating. GrainField evaluates it on a LUT grid once a
// frame (fillLUT) and samples that per point (sampleLUT).
//
// x/y are periodic in u/v with period 2 (~u - 0.5 near the center), the same
// tile as the Chladni function, so the field repeats across the plate without
// a seam where grains wrap. The Chladni input stays period-2 while n/m ease
// between modes too (see modeChladni), and time enters as sin(t·0.05) so
// nodes never drift into saturation over a long session.

/** Classic square-plate Chladni nodal function in (-2, 2). */
export function chladniValue(n, m, u, v) {
  return (
    Math.sin(n * Math.PI * u) * Math.sin(m * Math.PI * v) -
    Math.sin(m * Math.PI * u) * Math.sin(n * Math.PI * v)
  )
}

/**
 * Chladni at fractional n/m as a bilinear blend of the four neighbouring
 * integer modes — continuous as the modes ease, and still period 2 in u/v
 * (chladniValue itself isn't, for non-integer n/m).
 */
export function modeChladni(n, m, u, v) {
  const n0 = Math.floor(n)
  const m0 = Math.floor(m)
  const a = n - n0
  const b = m - m0
  const c00 = chladniValue(n0, m0, u, v)
  if (!a && !b) return c00
  const c10 = chladniValue(n0 + 1, m0, u, v)
  const c01 = chladniValue(n0, m0 + 1, u, v)
  const c11 = chladniValue(n0 + 1, m0 + 1, u, v)
  const top = c00 + (c10 - c00) * a
  return top + (c01 + (c11 - c01) * a - top) * b
}

/** Names of available hidden-node activation functions. */
export const NODE_FNS = ['sin', 'cos', 'gauss', 'tanh', 'sawtri']

const sin = (x) => Math.sin(x)
const cos = (x) => Math.cos(x)
const gauss = (x) => 2 * Math.exp(-x * x) - 1
const tanh = (x) => Math.tanh(x)
const sawtri = (x) => 1 - 2 * Math.abs(((((x % 2) + 2) % 2) - 1))

/** Activation function lookup keyed by NODE_FNS names. */
export const ACTIVATIONS = { sin, cos, gauss, tanh, sawtri }

/** Number of hidden nodes in every genome. */
export const HIDDEN_COUNT = 6

// Per-weight symmetric bounds [wx, wy, wr, wc, wt, wa].
const W_LIMITS = [8, 8, 6, 2, 1, 1]
const B_LIMIT = 1
const OUT_LIMIT = 1.5
const OUT_BIAS_LIMIT = 0.3

function randSym(limit, rand) {
  return (rand() * 2 - 1) * limit
}

function pickFn(rand) {
  return NODE_FNS[Math.floor(rand() * NODE_FNS.length)]
}

function clamp(x, limit) {
  return x < -limit ? -limit : x > limit ? limit : x
}

function mutateGene(val, limit, rate, rand) {
  if (rand() >= rate) return val
  // Sum of two uniform(-0.5, 0.5) draws in [-1, 1], scaled to 20% of width (2 * limit * 0.2).
  const noise = (rand() - 0.5 + (rand() - 0.5)) * (0.4 * limit)
  return clamp(val + noise, limit)
}

/** Generate a random genome using the supplied PRNG. */
export function randomGenome(rand = Math.random) {
  const hidden = []
  const out = []
  for (let i = 0; i < HIDDEN_COUNT; i++) {
    const w = W_LIMITS.map((lim) => randSym(lim, rand))
    hidden.push({ fn: pickFn(rand), w, b: randSym(B_LIMIT, rand) })
    out.push(randSym(OUT_LIMIT, rand))
  }
  return { hidden, out, outBias: randSym(OUT_BIAS_LIMIT, rand) }
}

/** Return a deep-copied genome with numeric genes and activations mutated. */
export function mutateGenome(genome, rate = 0.2, rand = Math.random) {
  const hidden = genome.hidden.map((node) => ({
    fn: rand() < rate / 4 ? pickFn(rand) : node.fn,
    w: node.w.map((wi, idx) => mutateGene(wi, W_LIMITS[idx], rate, rand)),
    b: mutateGene(node.b, B_LIMIT, rate, rand),
  }))
  const out = genome.out.map((o) => mutateGene(o, OUT_LIMIT, rate, rand))
  const outBias = mutateGene(genome.outBias, OUT_BIAS_LIMIT, rate, rand)
  return { hidden, out, outBias }
}

/** Uniformly cross two genomes per hidden node without mutating inputs. */
export function crossoverGenomes(a, b, rand = Math.random) {
  const hidden = []
  const out = []
  for (let i = 0; i < HIDDEN_COUNT; i++) {
    const pickA = rand() < 0.5
    const srcNode = (pickA ? a : b).hidden[i]
    hidden.push({ fn: srcNode.fn, w: [...srcNode.w], b: srcNode.b })
    out.push((pickA ? a : b).out[i])
  }
  const outBias = (rand() < 0.5 ? a : b).outBias
  return { hidden, out, outBias }
}

/** Reference evaluator for a genome at a single (u, v, t, amplitude) point. */
export function evaluateGenome(genome, n, m, u, v, t, amplitude) {
  const x = 0.5 * Math.sin(Math.PI * (u - 0.5))
  const y = 0.5 * Math.sin(Math.PI * (v - 0.5))
  const r = Math.hypot(x, y)
  const c = modeChladni(n, m, u, v)
  const ts = Math.sin(t * 0.05)
  let sum = genome.outBias
  for (let i = 0; i < genome.hidden.length; i++) {
    const node = genome.hidden[i]
    const w = node.w
    const z =
      w[0] * x +
      w[1] * y +
      w[2] * r +
      w[3] * c +
      w[4] * ts +
      w[5] * amplitude +
      node.b
    sum += genome.out[i] * ACTIVATIONS[node.fn](z)
  }
  return 2 * Math.tanh(sum)
}

/** Compile a genome into an allocation-free per-point evaluator closure. */
export function compileGenome(genome) {
  const count = genome.hidden.length
  // 8 floats per node: wx, wy, wr, wc, wt, wa, b, out_i.
  const weights = new Float64Array(count * 8)
  const fns = new Array(count)
  for (let i = 0; i < count; i++) {
    const node = genome.hidden[i]
    const base = i * 8
    weights[base] = node.w[0]
    weights[base + 1] = node.w[1]
    weights[base + 2] = node.w[2]
    weights[base + 3] = node.w[3]
    weights[base + 4] = node.w[4]
    weights[base + 5] = node.w[5]
    weights[base + 6] = node.b
    weights[base + 7] = genome.out[i]
    fns[i] = ACTIVATIONS[node.fn]
  }
  const outBias = genome.outBias

  return function evalCompiled(n, m, u, v, t, amplitude) {
    const x = 0.5 * Math.sin(Math.PI * (u - 0.5))
    const y = 0.5 * Math.sin(Math.PI * (v - 0.5))
    const r = Math.sqrt(x * x + y * y)
    const c = modeChladni(n, m, u, v)
    const ts = Math.sin(t * 0.05)
    let sum = outBias
    for (let i = 0; i < count; i++) {
      const base = i * 8
      const z =
        weights[base] * x +
        weights[base + 1] * y +
        weights[base + 2] * r +
        weights[base + 3] * c +
        weights[base + 4] * ts +
        weights[base + 5] * amplitude +
        weights[base + 6]
      sum += weights[base + 7] * fns[i](z)
    }
    return 2 * Math.tanh(sum)
  }
}

/** Grid resolution for fillLUT/sampleLUT: one period-2 tile, size × size texels. */
export const LUT_SIZE = 96

/** Fill a Float32Array(size * size) with fn sampled over one u/v tile [0, 2)². */
export function fillLUT(lut, size, fn, n, m, t, amplitude) {
  const step = 2 / size
  for (let j = 0; j < size; j++) {
    const v = j * step
    for (let i = 0; i < size; i++) lut[j * size + i] = fn(n, m, i * step, v, t, amplitude)
  }
}

/** Bilinear sample of a fillLUT grid at any u, v (wraps every 2). */
export function sampleLUT(lut, size, u, v) {
  let fu = (u * 0.5 - Math.floor(u * 0.5)) * size
  let fv = (v * 0.5 - Math.floor(v * 0.5)) * size
  // Float rounding can land exactly on size.
  if (fu >= size) fu = 0
  if (fv >= size) fv = 0
  const i0 = fu | 0
  const j0 = fv | 0
  const i1 = i0 + 1 === size ? 0 : i0 + 1
  const j1 = j0 + 1 === size ? 0 : j0 + 1
  const a = fu - i0
  const b = fv - j0
  const r0 = j0 * size
  const r1 = j1 * size
  const top = lut[r0 + i0] + (lut[r0 + i1] - lut[r0 + i0]) * a
  const bottom = lut[r1 + i0] + (lut[r1 + i1] - lut[r1 + i0]) * a
  return top + (bottom - top) * b
}
