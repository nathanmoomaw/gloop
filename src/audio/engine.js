// GLOOP audio engine — mic input -> granular echo loopback
//
// Captures short "grains" of live mic input into a rotating buffer pool,
// then replays them back through a feedback delay network with randomized
// grain offset/pitch/pan, producing a granular echo instead of a clean delay.

let ctx = null
let micStream = null
let analyser = null
let grainInterval = null
let masterGain = null

const GRAIN_MS_DEFAULT = 120
const POOL_SIZE = 24

const state = {
  grainSizeMs: GRAIN_MS_DEFAULT,
  feedback: 0.45,
  spread: 0.3, // randomized pitch/pan drift per grain, 0-1
  mix: 0.7,
}

let pool = []
let poolWriteIndex = 0
let recorderNode = null

export function getAnalyser() {
  return analyser
}

export function setParam(name, value) {
  if (name in state) state[name] = value
}

export function getParams() {
  return { ...state }
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
  masterGain.gain.value = 0.9
  masterGain.connect(ctx.destination)
  masterGain.connect(analyser)

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
  // ScriptProcessor must be connected to a destination-reachable node to run in all browsers.
  recorderNode.connect(ctx.createGain()) // silent sink

  scheduleGrains()
}

function scheduleGrains() {
  const fire = () => {
    if (!ctx) return
    playGrain()
    const jitter = 1 + (Math.random() - 0.5) * state.spread
    grainInterval = setTimeout(fire, Math.max(20, state.grainSizeMs * jitter))
  }
  fire()
}

function playGrain() {
  const src = pool[Math.floor(Math.random() * POOL_SIZE)]
  const grainSamples = Math.floor((ctx.sampleRate * state.grainSizeMs) / 1000)
  if (grainSamples < 8 || grainSamples > src.length) return

  const startAt = Math.floor(Math.random() * Math.max(1, src.length - grainSamples))
  const buffer = ctx.createBuffer(1, grainSamples, ctx.sampleRate)
  buffer.copyToChannel(src.subarray(startAt, startAt + grainSamples), 0)

  const bufSource = ctx.createBufferSource()
  bufSource.buffer = buffer
  bufSource.playbackRate.value = 1 + (Math.random() - 0.5) * state.spread * 0.6

  const grainGain = ctx.createGain()
  const attack = state.grainSizeMs * 0.15
  grainGain.gain.setValueAtTime(0, ctx.currentTime)
  grainGain.gain.linearRampToValueAtTime(state.mix, ctx.currentTime + attack / 1000)
  grainGain.gain.linearRampToValueAtTime(0, ctx.currentTime + state.grainSizeMs / 1000)

  const delay = ctx.createDelay(2)
  delay.delayTime.value = state.grainSizeMs / 1000
  const feedbackGain = ctx.createGain()
  feedbackGain.gain.value = state.feedback

  const panner = ctx.createStereoPanner()
  panner.pan.value = (Math.random() - 0.5) * state.spread * 2

  bufSource.connect(grainGain)
  grainGain.connect(panner)
  panner.connect(masterGain)
  panner.connect(delay)
  delay.connect(feedbackGain)
  feedbackGain.connect(delay)
  feedbackGain.connect(masterGain)

  bufSource.start()
  bufSource.stop(ctx.currentTime + state.grainSizeMs / 1000 + 0.05)
}

export function stop() {
  if (grainInterval) clearTimeout(grainInterval)
  grainInterval = null
  if (micStream) micStream.getTracks().forEach((t) => t.stop())
  if (ctx) ctx.close()
  ctx = null
  analyser = null
  pool = []
}
