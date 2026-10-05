import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import * as engine from './audio/engine'
import { RotaryKnob } from './components/RotaryKnob'
import ListenButton from './components/ListenButton'
import OnButton from './components/OnButton'
import { LoopIndicator } from './components/LoopIndicator'
import ShakeButton from './components/ShakeButton'
import MicModeToggle from './components/MicModeToggle'
import EvolveToggle from './components/EvolveToggle'
import ThruToggle from './components/ThruToggle'
import WaveformOverlay from './components/WaveformOverlay'
import { startEvolve, stopEvolve } from './audio/evolve'
import './App.css'

// Randomization ranges for the shake button — mirrors each dial's own
// min/max below. Master `volume` is deliberately excluded (mirrors
// ribbon's shake convention of never randomizing master level — a shake
// should reshuffle texture, not suddenly blast or mute the output).
const SHAKE_RANGES = {
  // Narrower than the dial's 20-4000: a shake shouldn't land on either
  // extreme (machine-gun buzz or near-silent gaps).
  rate: [100, 3000],
  dynamics: [0, 1],
  feedback: [0, 0.9],
  repeat: [0, 1],
  sensitivity: [0, 1],
  grainSizeMs: [30, 400],
  density: [0, 1],
  wow: [0, 1],
  flutter: [0, 1],
  wobble: [0, 1],
}

// Spacebar press shorter than this counts as a tap (latch listen) rather
// than a hold (listen only while held) — matches ListenButton's long press.
const SPACE_HOLD_MS = 350
// A second spacebar press landing within this long after the previous one
// is released is a double-tap: stop everything (listen, then `on`),
// whatever state the first tap left things in.
const SPACE_DOUBLE_TAP_MS = 400

// rate and size are the two most consequential dials (how often grains
// fire / how long each one is), so they're drawn at 2x the default knob.
const BIG_KNOB = 96

// three.js pulls the JS bundle from ~205KB to ~715KB (gzip ~65KB→~194KB —
// see ROADMAP), so GrainField loads as its own chunk behind a dynamic
// import instead of shipping in the initial bundle every visitor downloads
// before they've even tapped "listen".
const GrainField = lazy(() => import('./components/GrainField'))

// Loop ring rotation period is derived from the current grain rate, but
// scaled up so it stays visually legible across the whole rate range —
// at rate=20ms a 1:1 spin would be an unreadable blur, so the ring turns
// once every few grain cycles instead. It still speeds up/slows down live
// with the rate dial, which is the "tracks the actual current rate" ask.
function loopPeriodFromRate(rateMs) {
  return Math.min(4000, Math.max(400, rateMs * 6))
}

// Maps getUserMedia/AudioContext failures to a message a non-technical user
// can act on — mobile in particular surfaces these often (permission
// prompts dismissed without reading, no mic hardware, insecure http:// LAN
// testing, another app already holding the mic).
function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return "Microphone access was denied. Enable it for this site in your browser's settings, then try again."
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this device.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is already in use by another app.'
    case 'NotSupportedError':
      return err.message || 'Microphone access is not supported in this browser.'
    default:
      return 'Could not access the microphone. Please try again.'
  }
}

export default function App() {
  // `listening` = mic recording into the grain pool, `running` = grains
  // playing out (the `on` button). Independent — see engine.js.
  const [listening, setListening] = useState(false)
  const [running, setRunning] = useState(false)
  const [params, setParams] = useState(engine.getParams())
  const [analyser, setAnalyser] = useState(null)
  const [micError, setMicError] = useState(null)
  const [rawMic, setRawMic] = useState(engine.getRawCapture())
  const [evolving, setEvolving] = useState(false)
  const [thru, setThru] = useState(engine.isThru())
  const loopRef = useRef(null)
  // The first listen of a session also turns `on`, so a first-time visitor
  // hears something; after that the two stay independent (record silently).
  const hasListenedRef = useRef(false)

  // Register the grain-fire pulse once — imperative, so it never re-renders
  // React on every grain (which can fire tens of times per second).
  useEffect(() => {
    engine.onGrainFire(() => {
      loopRef.current?.pulse()
    })
  }, [])

  // `trail` (spacebar stops) lets in-flight echo tails ring out instead of
  // the quick fade the `on` button uses — see engine.stopPlaying.
  const setPower = useCallback(async (next, { trail = false } = {}) => {
    if (!next) {
      stopEvolve()
      setEvolving(false)
      engine.stopPlaying({ trail })
      setRunning(false)
      return
    }
    await engine.startPlaying()
    setAnalyser(engine.getAnalyser())
    setRunning(true)
  }, [])

  const setListen = useCallback(async (next) => {
    if (!next) {
      engine.stopListening()
      setListening(false)
      return
    }
    if (!hasListenedRef.current) {
      hasListenedRef.current = true
      setPower(true)
    }
    setMicError(null)
    try {
      // false = released before the mic finished opening (quick hold).
      if (await engine.startListening()) setListening(true)
      setAnalyser(engine.getAnalyser())
    } catch (err) {
      setMicError(micErrorMessage(err))
    }
  }, [setPower])

  // A tap while the mic is still opening (permission prompt up) cancels it
  // — React's `listening` is still false then, so toggling off that alone
  // would start a second listen instead of stopping the first.
  const toggleListen = useCallback(
    () => setListen(!(listening || engine.isListenPending())),
    [listening, setListen],
  )

  // Hold-to-record (long press on listen, or holding spacebar): turns `on`
  // on (or leaves it on) and listens only while held — release stops
  // listening but leaves playback running so the capture keeps looping.
  const holdStart = useCallback(() => {
    setPower(true)
    setListen(true)
  }, [setPower, setListen])

  const holdEnd = useCallback(() => setListen(false), [setListen])

  // Spacebar: a quick tap from fully off latches listen + `on`; a quick tap
  // while anything is going stops both, leaving the echo to trail off
  // (up to 10s). A hold records only while held. Unlike the button,
  // recording starts on keydown rather than after the hold threshold, so a
  // hold doesn't lose its first beat — the tap/hold decision is made on
  // keyup instead.
  const spaceRef = useRef(null)
  const lastSpaceUpRef = useRef(-Infinity)

  const stopAllWithTrail = useCallback(() => {
    setListen(false)
    setPower(false, { trail: true })
  }, [setListen, setPower])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      if (e.repeat || spaceRef.current) return
      // Event timestamps, not performance.now() in the handler: the first
      // press builds the audio graph and can block the main thread long
      // enough that a quick tap's keyup *handler* runs >350ms later.
      if (e.timeStamp - lastSpaceUpRef.current < SPACE_DOUBLE_TAP_MS) {
        // Consumed: the matching keyup shouldn't act again.
        spaceRef.current = { doubleTap: true }
        lastSpaceUpRef.current = -Infinity
        stopAllWithTrail()
        return
      }
      const wasListening = engine.isListening()
      const wasActive = wasListening || engine.isPlaying()
      spaceRef.current = { downAt: e.timeStamp, wasListening, wasActive }
      if (!wasListening) holdStart()
    }
    const handleKeyUp = (e) => {
      if (e.code !== 'Space') return
      // Also stops a focused button from treating the keyup as a click.
      e.preventDefault()
      const press = spaceRef.current
      spaceRef.current = null
      if (!press || press.doubleTap) return
      lastSpaceUpRef.current = e.timeStamp
      const isTap = e.timeStamp - press.downAt < SPACE_HOLD_MS
      if (isTap) {
        // Tap from fully off: leave listen + on latched. Tap while anything
        // was going: stop both, with a trail.
        if (press.wasActive) stopAllWithTrail()
        return
      }
      // Hold: listen only while held; `on` keeps looping the capture.
      holdEnd()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [holdStart, holdEnd, stopAllWithTrail])

  const updateParam = (name, value) => {
    engine.setParam(name, value)
    setParams(engine.getParams())
  }

  const handleInteract = useCallback((nx, ny, intensity) => {
    if (running) {
      engine.perturb(intensity)
    } else {
      // Not playing — there's no live grain stream to nudge, so play a
      // synthesized stand-in for "what this push would sound like" instead.
      engine.playTapSound(nx, ny, intensity)
    }
  }, [running])

  const handleShake = useCallback(() => {
    for (const [name, [min, max]] of Object.entries(SHAKE_RANGES)) {
      engine.setParam(name, min + Math.random() * (max - min))
    }
    setParams(engine.getParams())
    // Also gives the live grain stream (and the plate/grains that react to
    // it) an audible/visual nudge, same as dragging across the grain field.
    if (running) engine.perturb(1)
  }, [running])

  const handleRawMicToggle = useCallback((next) => {
    engine.setRawCapture(next)
    setRawMic(next)
  }, [])

  // Thru passes the mic straight out, so engaging it also opens the mic if
  // it isn't already — otherwise the button would do nothing audible.
  // Turning thru off leaves listen as it is.
  const handleThruToggle = useCallback((next) => {
    engine.setThru(next)
    setThru(next)
    if (next && !engine.isListening()) setListen(true)
  }, [setListen])

  const handleEvolveToggle = useCallback((next) => {
    if (next) {
      startEvolve()
    } else {
      stopEvolve()
    }
    setEvolving(next)
  }, [])

  // Evolution mutates params directly on the engine (not through
  // updateParam), so while it's running, poll the knobs back in sync —
  // otherwise the dials would sit frozen while the actual sound underneath
  // them drifts, hiding the one thing this feature is meant to show.
  useEffect(() => {
    if (!evolving) return
    const id = setInterval(() => setParams(engine.getParams()), 300)
    return () => clearInterval(id)
  }, [evolving])

  const pct = (v) => `${Math.round(v * 100)}%`

  return (
    <div className="gloop-app">
      <div className="grain-field">
        <Suspense fallback={null}>
          <GrainField
            analyser={analyser}
            running={running}
            onInteract={handleInteract}
            grainSizeMs={params.grainSizeMs}
          />
        </Suspense>
      </div>

      <WaveformOverlay analyser={analyser} running={running} />

      <div className="gloop-logo" aria-hidden="true">gloop</div>

      <LoopIndicator ref={loopRef} active={running} periodMs={loopPeriodFromRate(params.rate)} />

      <div className="controls-overlay">
        <div className="control-cluster control-cluster--top-left">
          <RotaryKnob
            label="rate"
            valueLabel={`${Math.round(params.rate)}ms`}
            value={params.rate}
            min={20}
            max={4000}
            step={10}
            onChange={(v) => updateParam('rate', v)}
            color="var(--color-rate)"
            size={BIG_KNOB}
          />
          <RotaryKnob
            label="dynamics"
            valueLabel={pct(params.dynamics)}
            value={params.dynamics}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('dynamics', v)}
            color="var(--color-dynamics)"
          />
        </div>

        <div className="control-cluster control-cluster--top-right">
          <RotaryKnob
            label="feedback"
            valueLabel={pct(params.feedback)}
            value={params.feedback}
            min={0}
            max={0.9}
            step={0.01}
            onChange={(v) => updateParam('feedback', v)}
            color="var(--color-feedback)"
          />
          <RotaryKnob
            label="repeat"
            valueLabel={pct(params.repeat)}
            value={params.repeat}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('repeat', v)}
            color="var(--color-repeat)"
          />
          <RotaryKnob
            label="sensitivity"
            valueLabel={pct(params.sensitivity)}
            value={params.sensitivity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('sensitivity', v)}
            color="var(--color-sensitivity)"
            size={40}
          />
        </div>

        <div className="control-cluster control-cluster--bottom-left">
          <ShakeButton onShake={handleShake} />
          <div className="control-cluster__row">
            <RotaryKnob
              label="size"
              valueLabel={`${Math.round(params.grainSizeMs)}ms`}
              value={params.grainSizeMs}
              min={30}
              max={3000}
              step={20}
              onChange={(v) => updateParam('grainSizeMs', v)}
              color="var(--color-size)"
              size={BIG_KNOB}
            />
            <RotaryKnob
              label="density"
              valueLabel={pct(params.density)}
              value={params.density}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateParam('density', v)}
              color="var(--color-density)"
            />
          </div>
        </div>

        <div className="control-cluster control-cluster--bottom-right">
          <RotaryKnob
            label="wow"
            valueLabel={pct(params.wow)}
            value={params.wow}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('wow', v)}
            color="var(--color-wow)"
            size={40}
          />
          <RotaryKnob
            label="flutter"
            valueLabel={pct(params.flutter)}
            value={params.flutter}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('flutter', v)}
            color="var(--color-flutter)"
            size={40}
          />
          <RotaryKnob
            label="wobble"
            valueLabel={pct(params.wobble)}
            value={params.wobble}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('wobble', v)}
            color="var(--color-wobble)"
            size={40}
          />
        </div>

        <div className="control-cluster control-cluster--center">
          <div className="control-cluster__mix-pair">
            <RotaryKnob
              label="granular"
              valueLabel={pct(params.granularMix)}
              value={params.granularMix}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateParam('granularMix', v)}
              color="var(--color-granular-mix)"
              size={60}
            />
            <RotaryKnob
              label="delay"
              valueLabel={pct(params.delayMix)}
              value={params.delayMix}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateParam('delayMix', v)}
              color="var(--color-delay-mix)"
              size={60}
            />
          </div>
          <div className="listen-wrap">
            <ListenButton
              running={listening}
              onToggle={toggleListen}
              onHoldStart={holdStart}
              onHoldEnd={holdEnd}
              onPress={engine.prepare}
              size={128}
            />
            {micError && (
              <button type="button" className="mic-error-toast" onClick={() => setMicError(null)}>
                {micError}
              </button>
            )}
          </div>
          <OnButton active={running} onToggle={setPower} />
          <RotaryKnob
            label="volume"
            valueLabel={pct(params.volume)}
            value={params.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateParam('volume', v)}
            color="var(--color-volume)"
            size={40}
            className="control-cluster__volume"
          />
          <div className="control-cluster__utility-pair">
            <MicModeToggle active={rawMic} onToggle={handleRawMicToggle} />
            <ThruToggle active={thru} onToggle={handleThruToggle} />
            <EvolveToggle active={evolving} disabled={!running} onToggle={handleEvolveToggle} />
          </div>
        </div>
      </div>
    </div>
  )
}
