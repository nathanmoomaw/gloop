// The `sound` button: not randomize, not on/off — a reset into the zone
// where GLOOP audibly feeds the room back right away. Any dial outside its
// "you'll hear it" range jumps to a random spot inside it; dials already
// in range are left alone, so it only undoes whatever made things quiet.

export const SOUND_BOUNDS = {
  volume: [0.7, 1],
  granularMix: [0.6, 1],
  delayMix: [0.5, 1],
  // 4–10 grains/s: dense enough to hear at once, not a buzz.
  rate: [100, 250],
  grainSizeMs: [120, 600],
  feedback: [0.4, 0.75],
  // Below the repeat wash threshold (85%), so grains stay legible.
  repeat: [0.35, 0.8],
  density: [0.3, 0.8],
  dynamics: [0, 0.35],
  // Low sensitivity gates quiet rooms out of the pool entirely.
  sensitivity: [0.3, 1],
  wow: [0, 0.3],
  flutter: [0, 0.25],
  wobble: [0, 0.3],
}

// Returns just the params that need to change: { name: newValue }.
export function soundFix(params, rng = Math.random) {
  const out = {}
  for (const [name, [lo, hi]] of Object.entries(SOUND_BOUNDS)) {
    const v = params[name]
    if (v >= lo && v <= hi) continue
    out[name] = lo + rng() * (hi - lo)
  }
  return out
}
