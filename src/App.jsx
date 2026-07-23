import { useCallback, useEffect, useRef, useState } from 'react'
import * as engine from './audio/engine'
import GrainField from './components/GrainField'
import { RotaryKnob } from './components/RotaryKnob'
import ListenButton from './components/ListenButton'
import { LoopIndicator } from './components/LoopIndicator'
import './App.css'

// Loop ring rotation period is derived from the current grain rate, but
// scaled up so it stays visually legible across the whole rate range —
// at rate=20ms a 1:1 spin would be an unreadable blur, so the ring turns
// once every few grain cycles instead. It still speeds up/slows down live
// with the rate dial, which is the "tracks the actual current rate" ask.
function loopPeriodFromRate(rateMs) {
  return Math.min(4000, Math.max(400, rateMs * 6))
}

export default function App() {
  const [running, setRunning] = useState(false)
  const [params, setParams] = useState(engine.getParams())
  const [analyser, setAnalyser] = useState(null)
  const loopRef = useRef(null)

  // Register the grain-fire pulse once — imperative, so it never re-renders
  // React on every grain (which can fire tens of times per second).
  useEffect(() => {
    engine.onGrainFire(() => {
      loopRef.current?.pulse()
    })
  }, [])

  const toggle = async () => {
    if (running) {
      engine.stop()
      setRunning(false)
      setAnalyser(null)
      return
    }
    await engine.start()
    setAnalyser(engine.getAnalyser())
    setRunning(true)
  }

  const updateParam = (name, value) => {
    engine.setParam(name, value)
    setParams(engine.getParams())
  }

  const handleInteract = useCallback((nx, ny, intensity) => {
    engine.perturb(intensity)
  }, [])

  const pct = (v) => `${Math.round(v * 100)}%`

  return (
    <div className="gloop-app">
      <div className="grain-field">
        <GrainField analyser={analyser} running={running} onInteract={handleInteract} />
      </div>

      <div className="controls-overlay">
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
        </div>

        <div className="control-cluster control-cluster--bottom-left">
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
          <div className="listen-wrap">
            <LoopIndicator
              ref={loopRef}
              active={running}
              periodMs={loopPeriodFromRate(params.rate)}
              size={172}
            />
            <ListenButton running={running} onToggle={toggle} size={128} />
          </div>
        </div>
      </div>
    </div>
  )
}
