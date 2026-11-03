// Every dial's full range, [min, max, isLog], in one place. The knobs, evolve,
// breed's bars and the preference model all read from here; the `sound` and
// shake bounds are narrower windows inside these (tests check that).
// Key order is the preference model's feature order.
export const DIAL_RANGES = {
  // ms between grains (the knob shows grains/s, clockwise = faster).
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

/** The ranges for `keys`, in that order. */
export function pickRanges(keys) {
  return Object.fromEntries(keys.map((k) => [k, DIAL_RANGES[k]]))
}
