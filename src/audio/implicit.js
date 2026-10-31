// Implicit learning: what anyone's use of GLOOP says about a sound, with no
// buttons pressed. Runs for every listener by default (learn mode's ❤️ 🔊 🔇 ⭐
// are the explicit layer on top). App ticks it about once a second with
// the live params, levels and state; it answers with the signal kinds to
// log (learn.js IMPLICIT), or nothing.
//
//   settle  dials left alone for SETTLE_MS of actual sound: someone chose
//           to keep listening to this
//   linger  the same sound kept for LINGER_MS: a stronger keep
//   rescue  the `sound` button pressed (App logs it directly): whatever
//           was on before wasn't working
//   pick    a breed pick (App logs it from BreedPanel)
//
// Only time with sound coming out counts (playing, thru off, output above
// SOUNDING_RMS), and any dial change starts the count over, whether the
// listener, shake, `sound`, evolve or a breed audition made it. Each
// settled sound logs settle and linger at most once.

export const SETTLE_MS = 20000
export const LINGER_MS = 90000
// Smoothed output RMS (engine.getLevels().output) above which grains are
// audibly coming out, about -46 dBFS.
export const SOUNDING_RMS = 0.005
// Ticks further apart than this (a backgrounded tab) don't count as listening.
const MAX_TICK_GAP_MS = 5000

function sameParams(a, b) {
  if (!a || !b) return false
  for (const key of Object.keys(b)) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > 1e-6) return false
  }
  return true
}

/** { tick({ params, levels, state }, now) → the kinds to log now (maybe none) } */
export function createImplicitLearner() {
  let last = null // params at the previous tick
  let lastTick = null
  let heardMs = 0
  let logged = new Set()

  return {
    tick({ params, levels, state }, now = Date.now()) {
      const gap = lastTick === null ? 0 : now - lastTick
      lastTick = now
      if (!sameParams(last, params)) {
        last = { ...params }
        heardMs = 0
        logged = new Set()
        return []
      }
      const sounding = state.playing && !state.thru && levels.output > SOUNDING_RMS
      if (!sounding || gap > MAX_TICK_GAP_MS) return []
      heardMs += gap
      const out = []
      if (heardMs >= SETTLE_MS && !logged.has('settle')) out.push('settle')
      if (heardMs >= LINGER_MS && !logged.has('linger')) out.push('linger')
      for (const kind of out) logged.add(kind)
      return out
    },
  }
}
