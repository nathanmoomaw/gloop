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
//   sensitivity  — how quiet the live mic input has to get before the engine
//                  treats it as "not presently hearing new sound": the grain
//                  pool stops recording over itself (so grains keep echoing
//                  the last real captured audio instead of degrading into
//                  recorded silence) and the repeat/decay ceiling stretches
//                  out toward SUSTAIN_MAX_MS. Higher value = more sensitive
//                  = counts quieter input as still "active", so both of the
//                  above kick in less readily. The dial sets a floor, not a
//                  fixed value: the longer input stays below it, the further
//                  the effective threshold auto-ramps down (see
//                  AUTO_SENSITIVITY_RAMP_SEC), so a persistently quiet room
//                  keeps getting easier to pick up instead of just staying
//                  gated out. Resets back to the dial's own threshold as soon
//                  as input crosses it again.
//   mix          — per-grain envelope peak level (internal balance, not
//                  exposed as its own dial).
//   granularMix  — overall level of the direct granular voice (the dry grain
//                  hits, before the delay network) reaching the output.
//   delayMix     — overall level of the dynamic-delay/feedback echo path
//                  reaching the output. Split from granularMix so the two
//                  can be balanced independently instead of only sharing one
//                  combined `mix` level. Automatically boosted further (up
//                  to QUIET_DELAY_BOOST_MAX louder) while live input is
//                  quiet, same `quietFactor` as the repeat/sustain ceiling.
//   volume       — master output gain (0-1 dial range, scaled by OUTPUT_BOOST
//                  before hitting the masterGain node).

// Resolved via Vite's `new URL(..., import.meta.url)` asset pattern so it
// works identically in dev and build — audioWorklet.addModule() needs a URL.
const recorderProcessorUrl = new URL('./recorder-processor.js', import.meta.url)

let ctx = null
let micStream = null
let analyser = null
let grainInterval = null
let masterGain = null
let perturbDecayInterval = null
let onGrainFireCallback = null

// Opt-in only (see start()) — browsers' default echoCancellation/
// noiseSuppression/autoGainControl processing is a real suspect for the
// "choppy, cuts off" complaints (NS in particular gates/ducks audio that
// doesn't look like voice, which is a bad fit for continuous granular
// capture), but disabling it isn't safe as a default: prior testing found
// each of the three individually could drop Chromium's fake-device signal
// to near-silence. Exposed as a user-toggleable A/B switch instead so real
// hardware can be compared live rather than guessed at blind.
let rawCapture = false

export function setRawCapture(value) {
  rawCapture = value
}

export function getRawCapture() {
  return rawCapture
}

const GRAIN_MS_DEFAULT = 400
const RATE_MS_DEFAULT = 200
const POOL_SIZE = 24
// Ceiling for the `size` (grainSizeMs) dial. Pool buffers below are sized to
// hold exactly this much captured audio — grains longer than a pool slot
// silently fail to play (see playGrain's `grainSamples > src.length` guard),
// so this and the buffer allocation have to move together.
const SIZE_MAX_MS = 3000

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
// When the mic hasn't picked up new sound in a while, the repeat ceiling
// stretches from REPEAT_MAX_MS up toward this — a much longer, more
// persistent wash of echoes instead of the loop dying out quickly.
const SUSTAIN_MAX_MS = 30000
// Must cover the largest possible per-grain delay time: SIZE_MAX_MS (the
// base delay time tracks grainSizeMs) plus wobble's own +/- swing and a bit
// of margin.
const MAX_DELAY_SEC = SIZE_MAX_MS / 1000 + WOBBLE_MAX_SEC + 0.1
// Output boost applied on top of the volume dial's 0-1 range — the dial
// already maxes out at unity gain, so louder-by-default has to happen as a
// multiplier on top of it rather than by raising the dial's own ceiling.
// Bumped 2 -> 3 after the first pass (2x) still read as "not louder" —
// turned out the safety limiter below was eating most of that gain before
// it ever reached the speakers (see its comment); this and the limiter
// retune below are meant to land together.
const OUTPUT_BOOST = 3
// Fixed gain applied after the safety limiter to recover the loudness the
// compression stage takes back out — see the limiter setup in start() for
// why this exists.
const LIMITER_MAKEUP_GAIN = 1.4
// How much louder the delay/feedback echo path gets, on top of its own
// `delayMix` level, at full quiet (quietFactor === 1). 0.8 = up to 80%
// louder than the plain delayMix level when nothing new is coming in.
const QUIET_DELAY_BOOST_MAX = 0.8
// Sensitivity dial maps to an input-level threshold in this range: higher
// sensitivity = lower threshold = quieter input still counts as "active".
const SENSITIVITY_THRESH_MAX = 0.05
const SENSITIVITY_THRESH_MIN = 0.002
// Smoothing factor for the rolling input-level estimate (per audio block).
const INPUT_LEVEL_SMOOTHING = 0.85
// Auto-sensitivity: how long a continuous quiet streak takes to reach full
// ramp (effective threshold at its lowest, i.e. most sensitive).
const AUTO_SENSITIVITY_RAMP_SEC = 8
// Floor the ramp can reach, as a fraction of the dial's own threshold — e.g.
// 0.25 means "at full quiet, pick up input 4x quieter than the dial alone
// would allow." Never ramps below this, so it can't chase the noise floor
// forever.
const AUTO_SENSITIVITY_MIN_RATIO = 0.25

const state = {
  grainSizeMs: GRAIN_MS_DEFAULT,
  rate: RATE_MS_DEFAULT,
  feedback: 0.65,
  repeat: 0.65,
  spread: 0.3,
  density: 0.6,
  dynamics: 0.15,
  sensitivity: 0.1,
  wow: 0,
  flutter: 0,
  wobble: 0,
  mix: 0.7,
  granularMix: 1,
  delayMix: 1,
  volume: 0.9,
}

// Ephemeral nudge applied on top of state by grain-canvas interaction —
// decays back to zero on its own, never mutates the user's dial positions.
const perturbation = { spread: 0, feedback: 0, dynamics: 0 }

let pool = []
let poolWriteIndex = 0
let recorderNode = null
// Rolling estimate of live input level, updated per audio block — drives the
// "no new sound coming in" sustain behavior via the sensitivity threshold.
let inputLevel = 0
// ctx.currentTime of the last block that counted as "active" (crossed the
// then-current effective threshold) — drives the auto-sensitivity ramp in
// currentThreshold(). Set to ctx.currentTime on start() so a fresh session
// doesn't begin mid-ramp.
let lastActiveTime = 0

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
    masterGain.gain.value = value * OUTPUT_BOOST
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

// Standalone context for one-off tap sounds, used when the user pushes the
// grain field while not actively listening — there's no live mic capture to
// draw a real grain from in that state, so this synthesizes a stand-in
// "what would this rearrangement sound like" blip instead. Lazily created
// on first tap and kept alive across taps; independent of start()/stop().
let tapCtx = null
let tapNoiseBuffer = null

function ensureTapContext() {
  if (!tapCtx) {
    tapCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (!tapNoiseBuffer) {
    const len = Math.ceil(tapCtx.sampleRate * 0.3)
    tapNoiseBuffer = tapCtx.createBuffer(1, len, tapCtx.sampleRate)
    const data = tapNoiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  return tapCtx
}

// (nx, ny) normalized screen position, intensity 0-1 — mirrors the same
// gesture that would otherwise feed engine.perturb() while listening.
export function playTapSound(nx, ny, intensity) {
  const c = ensureTapContext()

  const src = c.createBufferSource()
  src.buffer = tapNoiseBuffer
  src.playbackRate.value = 0.7 + Math.random() * 0.6

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 300 + (1 - ny) * 3200 // higher on screen = higher pitch
  filter.Q.value = 3 + Math.random() * 4

  const gain = c.createGain()
  const peak = Math.min(0.5, 0.15 + intensity * 0.35)
  const dur = 0.08 + intensity * 0.12
  gain.gain.setValueAtTime(0, c.currentTime)
  gain.gain.linearRampToValueAtTime(peak, c.currentTime + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur)

  const panner = c.createStereoPanner()
  panner.pan.value = (nx - 0.5) * 1.6

  src.connect(filter)
  filter.connect(gain)
  gain.connect(panner)
  panner.connect(c.destination)

  src.start()
  src.stop(c.currentTime + dur + 0.05)
}

// Sensitivity dial (0-1) maps to this amplitude threshold: higher sensitivity
// = lower threshold = quieter input still counts as "active". That dial
// value is a floor, not the final answer — the longer input has stayed below
// it, the further this ramps down toward AUTO_SENSITIVITY_MIN_RATIO of it,
// so a persistently quiet room gets picked up sooner rather than staying
// gated out indefinitely.
function currentThreshold() {
  const base = SENSITIVITY_THRESH_MAX - state.sensitivity * (SENSITIVITY_THRESH_MAX - SENSITIVITY_THRESH_MIN)
  if (!ctx) return base
  const quietSec = Math.max(0, ctx.currentTime - lastActiveTime)
  const rampT = Math.min(1, quietSec / AUTO_SENSITIVITY_RAMP_SEC)
  return base * (1 - rampT * (1 - AUTO_SENSITIVITY_MIN_RATIO))
}

export async function start() {
  if (ctx) return

  // getUserMedia is only exposed in secure contexts (HTTPS, or localhost) —
  // on mobile this is the most common way to end up here, e.g. testing over
  // a plain-http LAN address. Fail with a clear message up front rather than
  // a raw "Cannot read properties of undefined" from calling it directly.
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException(
      'Microphone access needs a secure connection (HTTPS) — this page was loaded over an insecure one.',
      'NotSupportedError',
    )
  }

  ctx = new (window.AudioContext || window.webkitAudioContext)()
  lastActiveTime = ctx.currentTime

  try {
    // Reverted on 2026-07-25 as a *default* (see `rawCapture` above for why
    // it's still available as an opt-in): disabling echoCancellation/
    // noiseSuppression/autoGainControl measured, via Chromium's fake-device
    // harness, as dropping the captured signal to near-silence — each of the
    // three individually, not just AEC. That was a worse failure than the
    // gating/choppiness this toggle is meant to address, so plain
    // `audio: true` stays the default; `rawCapture` only applies when a user
    // explicitly opts in to compare against real hardware.
    const constraints = rawCapture
      ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }
      : { audio: true, video: false }
    micStream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (err) {
    // Nothing was hooked up to this context yet — close it and reset to
    // null so a retry (e.g. tapping listen again after granting permission)
    // doesn't just early-return on the `if (ctx) return` guard above.
    ctx.close()
    ctx = null
    throw err
  }
  const micSource = ctx.createMediaStreamSource(micStream)

  analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.8

  masterGain = ctx.createGain()
  masterGain.gain.value = state.volume * OUTPUT_BOOST
  masterGain.connect(analyser)

  // Safety limiter on the final output — with feedback up to 0.95 and long
  // silence-sustain tails (up to 30s), overlapping grain feedback loops can
  // sum into harsh digital clipping at higher feedback/volume settings.
  // A gentle compressor catches that instead of letting it distort.
  //
  // The original -6dB/12:1 settings were so aggressive that OUTPUT_BOOST
  // (above) mostly just drove the compressor harder instead of making
  // anything audibly louder — a 2x pre-compressor gain increase barely
  // moves the post-compressor level when almost everything above -6dB gets
  // squashed 12:1. Loosened both (higher threshold, gentler ratio) so more
  // of the boosted signal passes through un-squashed, and added a fixed
  // makeup-gain stage after the compressor to recover the loudness the
  // compression stage would otherwise still be eating — safe headroom-wise
  // since the compressor's own ceiling for even a very hot input stays well
  // under 0dBFS at these settings.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 6
  limiter.ratio.value = 8
  limiter.attack.value = 0.003
  limiter.release.value = 0.25
  const makeupGain = ctx.createGain()
  makeupGain.gain.value = LIMITER_MAKEUP_GAIN
  masterGain.connect(limiter)
  limiter.connect(makeupGain)
  makeupGain.connect(ctx.destination)

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

  // Capture mic into rotating grain buffers via an AudioWorklet — runs on
  // the audio render thread, not main, so it no longer contends with the
  // WebGL grain-field render for main-thread time (replaces the previous
  // ScriptProcessorNode, which was both deprecated and main-thread-bound).
  pool = Array.from({ length: POOL_SIZE }, () => new Float32Array(Math.ceil((ctx.sampleRate * SIZE_MAX_MS) / 1000)))
  poolWriteIndex = 0
  let writeOffset = 0

  await ctx.audioWorklet.addModule(recorderProcessorUrl)
  recorderNode = new AudioWorkletNode(ctx, 'recorder-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  })

  recorderNode.port.onmessage = (e) => {
    const input = e.data
    let sumSq = 0
    for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i]
    const blockRms = Math.sqrt(sumSq / input.length)
    inputLevel = inputLevel * INPUT_LEVEL_SMOOTHING + blockRms * (1 - INPUT_LEVEL_SMOOTHING)

    // While quiet, freeze the pool instead of overwriting it with near-
    // silence — this is what actually makes the echo "just continue" when
    // nothing new is coming in: grains keep pulling from the last real
    // captured sound indefinitely, rather than gradually recording over it
    // with silence while only the feedback *decay time* gets extended.
    const threshold = currentThreshold()
    if (inputLevel < threshold) return
    // Crossed the (possibly auto-ramped-down) threshold — this counts as
    // "active" input, so reset the quiet streak the ramp is measured from.
    lastActiveTime = ctx.currentTime

    const buf = pool[poolWriteIndex % POOL_SIZE]
    for (let i = 0; i < input.length; i++) {
      if (writeOffset >= buf.length) {
        writeOffset = 0
        poolWriteIndex++
      }
      pool[poolWriteIndex % POOL_SIZE][writeOffset++] = input[i]
    }
  }

  // Highpass removes rumble/DC bias from the captured audio itself (mic
  // handling rooms/wind noise, or DC offset from cheap hardware) before it
  // ever enters the grain pool — cleans up every grain pulled from it,
  // rather than filtering the mix after the fact.
  const inputHighpass = ctx.createBiquadFilter()
  inputHighpass.type = 'highpass'
  inputHighpass.frequency.value = 70
  micSource.connect(inputHighpass)
  inputHighpass.connect(recorderNode)
  // The audio graph is pulled from the destination backward, so this node
  // only gets processed each render quantum if it has a path through to the
  // destination — route it there via a zero-gain sink so that requirement is
  // satisfied without audibly passing raw mic input.
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
  // Exponential attack/release instead of linear — a linear ramp has an
  // audible "zipper" edge at each grain boundary, especially with several
  // grains overlapping at once (default rate/grainSize overlap ~4-5x). The
  // exponential curve is the standard smoother window shape for granular
  // synthesis envelopes.
  grainGain.gain.setValueAtTime(0.0001, ctx.currentTime)
  grainGain.gain.exponentialRampToValueAtTime(state.mix, ctx.currentTime + attack / 1000)
  grainGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + state.grainSizeMs / 1000)

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
  // The ceiling itself stretches toward SUSTAIN_MAX_MS as live input goes
  // quiet (per `sensitivity`), so echoes linger much longer when nothing new
  // is coming in, and behave normally while actively fed.
  const quietFactor = Math.max(0, Math.min(1, 1 - inputLevel / currentThreshold()))
  const repeatCeilingMs = REPEAT_MAX_MS + quietFactor * (SUSTAIN_MAX_MS - REPEAT_MAX_MS)
  const repeatMs = REPEAT_MIN_MS + state.repeat * (repeatCeilingMs - REPEAT_MIN_MS)
  feedbackGain.gain.setValueAtTime(Math.max(0.0001, effFeedback), ctx.currentTime)
  if (effFeedback > 0.0005) {
    feedbackGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + repeatMs / 1000)
  }

  const panner = ctx.createStereoPanner()
  panner.pan.value = (Math.random() - 0.5) * effSpread * 2

  // Split the direct granular voice and the delay/feedback echo onto their
  // own mix gains so the two can be balanced independently (granularMix,
  // delayMix), rather than always summing at a fixed relative level.
  const granularMixGain = ctx.createGain()
  granularMixGain.gain.value = state.granularMix
  const delayMixGain = ctx.createGain()
  // Quiet-time echo boost: `quietFactor` (already computed above for the
  // repeat/sustain ceiling) also raises the delay/feedback path's own
  // level, not just its tail length — so when the mic isn't picking up new
  // sound, the looped-back echo actually gets louder/more present instead
  // of just decaying more slowly, which is what "reflecting back sounds
  // louder" during silence actually needs. Fades back to the plain
  // `delayMix` level as soon as live input resumes (quietFactor -> 0).
  delayMixGain.gain.value = state.delayMix * (1 + quietFactor * QUIET_DELAY_BOOST_MAX)

  bufSource.connect(grainGain)
  grainGain.connect(panner)
  panner.connect(granularMixGain)
  granularMixGain.connect(masterGain)
  panner.connect(delay)
  delay.connect(feedbackGain)
  feedbackGain.connect(delay)
  feedbackGain.connect(delayMixGain)
  delayMixGain.connect(masterGain)

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
    try { delayMixGain.disconnect() } catch { /* already disconnected */ }
    try { granularMixGain.disconnect() } catch { /* already disconnected */ }
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
  inputLevel = 0
  lastActiveTime = 0
  wowLFO = null
  wowDepth = null
  flutterLFO = null
  flutterDepth = null
  wobbleLFO = null
  wobbleDepth = null
}
