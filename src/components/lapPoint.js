/**
 * Position on the loop indicator's rectangular lap for a phase in [0, 1):
 * top edge, right edge, bottom edge, left edge, each a quarter of the lap
 * (same even-quarters path the old CSS keyframes traced). Returns left/top
 * as percentages of the track box.
 */
export function lapPoint(phase) {
  const p = ((phase % 1) + 1) % 1
  const q = Math.floor(p * 4)
  const t = (p * 4 - q) * 100
  switch (q) {
    case 0: return { left: t, top: 0 }
    case 1: return { left: 100, top: t }
    case 2: return { left: 100 - t, top: 100 }
    default: return { left: 0, top: 100 - t }
  }
}

/**
 * Advances lap phase by `dtMs` at the current lap period. The dot's speed
 * follows the period, but its position never jumps when the period changes —
 * which it did when the period lived in a CSS animation-duration (changing
 * the duration re-maps elapsed time onto the new keyframes mid-lap).
 */
export function advancePhase(phase, dtMs, periodMs) {
  if (!(periodMs > 0)) return phase
  return (phase + dtMs / periodMs) % 1
}
