import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import * as engine from './audio/engine'
import { RotaryKnob } from './components/RotaryKnob'
import ListenButton from './components/ListenButton'
import { LoopIndicator } from './components/LoopIndicator'
import ShakeButton from './components/ShakeButton'
import './App.css'

// Randomization ranges for the shake button — mirrors each dial's own
// min/max below. Master `volume` is deliberately excluded (mirrors
// ribbon's shake convention of never randomizing master level — a shake
// should reshuffle texture, not suddenly blast or mute the output).
const SHAKE_RANGES = {
  rate: [20, 600],
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
  const [running, setRunning] = useState(false)
  const [params, setParams] = useState(engine.getParams())
  const [analyser, setAnalyser] = useState(null)
  const [micError, setMicError] = useState(null)
  const loopRef = useRef(null)

  // Register the grain-fire pulse once — imperative, so it never re-renders
  // React on every grain (which can fire tens of times per second).
  useEffect(() => {
    engine.onGrainFire(() => {
      loopRef.current?.pulse()
    })
  }, [])

  const stopListening = () => {
    engine.stop()
    setRunning(false)
    setAnalyser(null)
  }

  const toggle = useCallback(async () => {
    if (running) {
      stopListening()
      return
    }
    setMicError(null)
    try {
      await engine.start()
      setAnalyser(engine.getAnalyser())
      setRunning(true)
    } catch (err) {
      setMicError(micErrorMessage(err))
    }
  }, [running])

  // Spacebar toggles listening either way — a quick key that doesn't
  // require aiming for the listen button.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggle])

  const updateParam = (name, value) => {
    engine.setParam(name, value)
    setParams(engine.getParams())
  }

  const handleInteract = useCallback((nx, ny, intensity) => {
    if (running) {
      engine.perturb(intensity)
    } else {
      // Not listening — there's no live grain stream to nudge, so play a
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

  const pct = (v) => `${Math.round(v * 100)}%`

  return (
    <div className="gloop-app">
      <div className="grain-field">
        <Suspense fallback={null}>
          <GrainField analyser={analyser} running={running} onInteract={handleInteract} />
        </Suspense>
      </div>

      <LoopIndicator ref={loopRef} active={running} periodMs={loopPeriodFromRate(params.rate)} />

      <div className="controls-overlay">
        <div className="control-cluster control-cluster--top-center">
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

        <div className="control-cluster control-cluster--top-left">
          <RotaryKnob
            label="rate"
            valueLabel={`${Math.round(params.rate)}ms`}
            value={params.rate}
            min={20}
            max={600}
            step={5}
            onChange={(v) => updateParam('rate', v)}
            color="var(--color-rate)"
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
              max={400}
              step={5}
              onChange={(v) => updateParam('grainSizeMs', v)}
              color="var(--color-size)"
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
          <div className="listen-wrap">
            <ListenButton running={running} onToggle={toggle} size={128} />
            {micError && (
              <button type="button" className="mic-error-toast" onClick={() => setMicError(null)}>
                {micError}
              </button>
            )}
          </div>
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
        </div>
      </div>
    </div>
  )
}
