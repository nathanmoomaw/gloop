// GLOOP audio engine — mic input -> granular echo loopback
//
// Captures short "grains" of live mic input into a rotating buffer pool,
// then replays them back through a feedback delay network with randomized
// grain offset/pitch/pan, producing a granular echo instead of a clean delay.
//
// Param surface (state), all live-adjustable via setParam:
//   grainSizeMs  — grain duration (ms). Granular dial #1.
//   rate         — grain trigger interval (ms), decoupled from grainSizeMs.
//                  This is the single "how often grains fire" axis — a separate
//                  "frequency" dial was considered (see DEVLOG) but rate alone
//                  covers it: pushed low it reads as pitch/texture, pushed high
//                  it reads as rhythm, so a second axis didn't add real value.
//   spread       — per-grain pitch/pan randomization (0-1).
//   density      — how much of the buffer pool a grain can be pulled from
//                  (0 = only the most recently captured audio, 1 = anywhere in
//                  the rotating pool). Granular dial #2, distinct from spread.
//   feedback     — feedback loop gain (how "hot" each regeneration is).
//   repeat       — decay/tail length: how long the feedback loop takes to die
//                  to silence, independent of the feedback gain amount itself.
//   wow          — slow, deep pitch drift LFO depth (classic tape wow).
//   flutter      — fast, shallow pitch jitter LFO depth (tape flutter).
//   wobble       — slow delay-time modulation LFO depth (distinct from
//                  `dynamics`, which is a per-grain random jitter rather than
//                  a continuous LFO).
//   dynamics     — depth of per-grain random delay-time variation ("dynamic
//                  delay") — how much the delay time itself wobbles grain to
//                  grain, as opposed to wobble's continuous sweep.
//   mix          — per-grain envelope peak level (internal balance, not
//                  exposed as its own dial).
//   volume       — master output gain.

let ctx = null
let micStream = null
let analyser = null
let grainInterval = null
let masterGain = null
let perturbDecayInterval = null
let onGrainFireCallback = null

const GRAIN_MS_DEFAULT = 120
const RATE_MS_DEFAULT = 130
const POOL_SIZE = 24

// Modulation ranges — the raw 0-1 dial values are scaled into these before
// being applied to the audio graph.
const WOW_MAX_RATIO = 0.18 // playbackRate +/- 18% at full depth, slow
const WOW_HZ = 0.15
const FLUTTER_MAX_RATIO = 0.04 // playbackRate +/- 4% at full depth, fast
const FLUTTER_HZ = 7.5
const WOBBLE_MAX_SEC = 0.09 // delay time +/- 90ms at full depth, slow LFO
const WOBBLE_HZ = 0.3
const DYNAMICS_MAX_SEC = 0.3 // per-grain random delay jitter, up to +/-300ms
const REPEAT_MIN_MS = 250
const REPEAT_MAX_MS = 6000
const MAX_DELAY_SEC = 2 // matches ctx.createDelay(2)

const state = {
  grainSizeMs: GRAIN_MS_DEFAULT,
  rate: RATE_MS_DEFAULT,
  feedback: 0.45,
  repeat: 0.4,
  spread: 0.3,
  density: 0.35,
  dynamics: 0.15,
  wow: 0,
  flutter: 0,
  wobble: 0,
  mix: 0.7,
  volume: 0.9,
}

// Ephemeral nudge applied on top of state by grain-canvas interaction —
// decays back to zero on its own, never mutates the user's dial positions.
const perturbation = { spread: 0, feedback: 0, dynamics: 0 }

let pool = []
let poolWriteIndex = 0
let recorderNode = null

// Persistent modulation sources, created once in start().
let wowLFO = null
let wowDepth = null
let flutterLFO = null
let flutterDepth = null
let wobbleLFO = null
let wobbleDepth = null

export function getAnalyser() {
  return analyser
}

export function setParam(name, value) {
  if (!(name in state)) return
  state[name] = value

  // A few params drive already-created persistent nodes and need to be
  // pushed onto the live AudioParam immediately, not just stashed in state.
  if (name === 'volume' && masterGain) {
    masterGain.gain.value = value
  } else if (name === 'wow' && wowDepth) {
    wowDepth.gain.value = value * WOW_MAX_RATIO
  } else if (name === 'flutter' && flutterDepth) {
    flutterDepth.gain.value = value * FLUTTER_MAX_RATIO
  } else if (name === 'wobble' && wobbleDepth) {
    wobbleDepth.gain.value = value * WOBBLE_MAX_SEC
  }
}

export function getParams() {
  return { ...state }
}

// Called by the grain canvas (via App) on pointer interaction — temporarily
// nudges spread/feedback/dynamics, then relaxes back over ~1s.
export function perturb(strength = 1) {
  const s = Math.max(0, Math.min(1, strength))
  perturbation.spread = Math.min(1.2, perturbation.spread + 0.6 * s)
  perturbation.feedback = Math.min(0.4, perturbation.feedback + 0.25 * s)
  perturbation.dynamics = Math.min(1, perturbation.dynamics + 0.5 * s)
}

// Registers a callback fired every time a grain is triggered, with the
// current rate/delay-time — used by the loop indicator ring to stay in sync.
export function onGrainFire(callback) {
  onGrainFireCallback = callback
}

export async function start() {
  if (ctx) return
  ctx = new (window.AudioContext || window.webkitAudioContext)()

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  const micSource = ctx.createMediaStreamSource(micStream)

  analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.8

  masterGain = ctx.createGain()
  masterGain.gain.value = state.volume
  masterGain.connect(ctx.destination)
  masterGain.connect(analyser)

  // Tape-style modulation sources — persistent for the life of the session,
  // fanned out to each grain's playbackRate/delayTime as they're created.
  wowLFO = ctx.createOscillator()
  wowLFO.type = 'sine'
  wowLFO.frequency.value = WOW_HZ
  wowDepth = ctx.createGain()
  wowDepth.gain.value = state.wow * WOW_MAX_RATIO
  wowLFO.connect(wowDepth)
  wowLFO.start()

  flutterLFO = ctx.createOscillator()
  flutterLFO.type = 'sine'
  flutterLFO.frequency.value = FLUTTER_HZ
  flutterDepth = ctx.createGain()
  flutterDepth.gain.value = state.flutter * FLUTTER_MAX_RATIO
  flutterLFO.connect(flutterDepth)
  flutterLFO.start()

  wobbleLFO = ctx.createOscillator()
  wobbleLFO.type = 'sine'
  wobbleLFO.frequency.value = WOBBLE_HZ
  wobbleDepth = ctx.createGain()
  wobbleDepth.gain.value = state.wobble * WOBBLE_MAX_SEC
  wobbleLFO.connect(wobbleDepth)
  wobbleLFO.start()

  // Capture mic into rotating grain buffers via ScriptProcessor (simple, portable).
  const bufferSize = 2048
  recorderNode = ctx.createScriptProcessor(bufferSize, 1, 1)
  pool = Array.from({ length: POOL_SIZE }, () => new Float32Array(Math.ceil((ctx.sampleRate * 400) / 1000)))
  poolWriteIndex = 0
  let writeOffset = 0

  recorderNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    const buf = pool[poolWriteIndex % POOL_SIZE]
    for (let i = 0; i < input.length; i++) {
      if (writeOffset >= buf.length) {
        writeOffset = 0
        poolWriteIndex++
      }
      pool[poolWriteIndex % POOL_SIZE][writeOffset++] = input[i]
    }
  }

  micSource.connect(recorderNode)
  // ScriptProcessor only fires onaudioprocess reliably once it's connected
  // through to the destination — route it there via a zero-gain sink so the
  // graph requirement is satisfied without audibly passing raw mic input.
  const silentSink = ctx.createGain()
  silentSink.gain.value = 0
  recorderNode.connect(silentSink)
  silentSink.connect(ctx.destination)

  // Perturbation decays on a real-time clock, independent of grain rate.
  perturbDecayInterval = setInterval(() => {
    perturbation.spread *= 0.85
    perturbation.feedback *= 0.85
    perturbation.dynamics *= 0.85
  }, 60)

  scheduleGrains()
}

function scheduleGrains() {
  const fire = () => {
    if (!ctx) return
    playGrain()
    if (onGrainFireCallback) {
      onGrainFireCallback({ rate: state.rate, delayTime: state.grainSizeMs / 1000 })
    }
    const jitter = 1 + (Math.random() - 0.5) * state.spread * 0.4
    grainInterval = setTimeout(fire, Math.max(15, state.rate * jitter))
  }
  fire()
}

// Picks a pool slot, biased toward the most recently written audio when
// density is low, and spanning the whole rotating pool when density is high.
function pickPoolSlot() {
  const windowSize = Math.max(1, Math.round(1 + state.density * (POOL_SIZE - 1)))
  const offset = Math.floor(Math.random() * windowSize)
  const idx = (((poolWriteIndex - offset) % POOL_SIZE) + POOL_SIZE) % POOL_SIZE
  return pool[idx]
}

function playGrain() {
  const effSpread = Math.min(1.5, state.spread + perturbation.spread)
  const effFeedback = Math.min(0.95, state.feedback + perturbation.feedback)
  const effDynamics = Math.min(1, state.dynamics + perturbation.dynamics)

  const src = pickPoolSlot()
  const grainSamples = Math.floor((ctx.sampleRate * state.grainSizeMs) / 1000)
  if (grainSamples < 8 || grainSamples > src.length) return

  const startAt = Math.floor(Math.random() * Math.max(1, src.length - grainSamples))
  const buffer = ctx.createBuffer(1, grainSamples, ctx.sampleRate)
  buffer.copyToChannel(src.subarray(startAt, startAt + grainSamples), 0)

  const bufSource = ctx.createBufferSource()
  bufSource.buffer = buffer
  bufSource.playbackRate.value = 1 + (Math.random() - 0.5) * effSpread * 0.6
  // Wow (slow/deep) + flutter (fast/shallow) additively modulate playback rate.
  wowDepth.connect(bufSource.playbackRate)
  flutterDepth.connect(bufSource.playbackRate)

  const grainGain = ctx.createGain()
  const attack = state.grainSizeMs * 0.15
  grainGain.gain.setValueAtTime(0, ctx.currentTime)
  grainGain.gain.linearRampToValueAtTime(state.mix, ctx.currentTime + attack / 1000)
  grainGain.gain.linearRampToValueAtTime(0, ctx.currentTime + state.grainSizeMs / 1000)

  // Dynamic delay: per-grain random jitter on top of the grain-size-derived
  // base delay time. Distinct from wobble, which is a continuous LFO below.
  const dynamicsJitter = (Math.random() - 0.5) * 2 * effDynamics * DYNAMICS_MAX_SEC
  const baseDelaySec = Math.max(0.01, Math.min(MAX_DELAY_SEC - WOBBLE_MAX_SEC - 0.01, state.grainSizeMs / 1000 + dynamicsJitter))

  const delay = ctx.createDelay(MAX_DELAY_SEC)
  delay.delayTime.value = baseDelaySec
  wobbleDepth.connect(delay.delayTime)

  const feedbackGain = ctx.createGain()
  // Repeat controls tail length: the loop gain starts at the feedback amount
  // and decays to near-silence over a duration set by `repeat`, independent
  // of the feedback value itself (which sets how "hot" the early repeats are).
  const repeatMs = REPEAT_MIN_MS + state.repeat * (REPEAT_MAX_MS - REPEAT_MIN_MS)
  feedbackGain.gain.setValueAtTime(Math.max(0.0001, effFeedback), ctx.currentTime)
  if (effFeedback > 0.0005) {
    feedbackGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + repeatMs / 1000)
  }

  const panner = ctx.createStereoPanner()
  panner.pan.value = (Math.random() - 0.5) * effSpread * 2

  bufSource.connect(grainGain)
  grainGain.connect(panner)
  panner.connect(masterGain)
  panner.connect(delay)
  delay.connect(feedbackGain)
  feedbackGain.connect(delay)
  feedbackGain.connect(masterGain)

  bufSource.start()
  const stopAt = ctx.currentTime + state.grainSizeMs / 1000 + 0.05
  bufSource.stop(stopAt)
  bufSource.onended = () => {
    try { wowDepth.disconnect(bufSource.playbackRate) } catch { /* already disconnected */ }
    try { flutterDepth.disconnect(bufSource.playbackRate) } catch { /* already disconnected */ }
  }

  // Tear down this grain's private feedback subgraph once its tail has fully
  // decayed, so the persistent LFO depth nodes don't accumulate fan-out
  // connections to long-dead nodes over a running session.
  setTimeout(() => {
    try { wobbleDepth.disconnect(delay.delayTime) } catch { /* already disconnected */ }
    try { delay.disconnect() } catch { /* already disconnected */ }
    try { feedbackGain.disconnect() } catch { /* already disconnected */ }
  }, repeatMs + 80)
}

export function stop() {
  if (grainInterval) clearTimeout(grainInterval)
  grainInterval = null
  if (perturbDecayInterval) clearInterval(perturbDecayInterval)
  perturbDecayInterval = null
  if (micStream) micStream.getTracks().forEach((t) => t.stop())
  if (ctx) ctx.close()
  ctx = null
  analyser = null
  pool = []
  wowLFO = null
  wowDepth = null
  flutterLFO = null
  flutterDepth = null
  wobbleLFO = null
  wobbleDepth = null
}
