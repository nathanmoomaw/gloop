import { useRef, useState } from 'react'
import * as engine from './audio/engine'
import GrainField from './components/GrainField'
import './App.css'

export default function App() {
  const [running, setRunning] = useState(false)
  const [params, setParams] = useState(engine.getParams())
  const analyserRef = useRef(null)

  const toggle = async () => {
    if (running) {
      engine.stop()
      setRunning(false)
      return
    }
    await engine.start()
    analyserRef.current = engine.getAnalyser()
    setRunning(true)
  }

  const updateParam = (name, value) => {
    engine.setParam(name, value)
    setParams(engine.getParams())
  }

  return (
    <div className="gloop-app">
      <div className="grain-field">
        <GrainField analyser={analyserRef.current} running={running} />
      </div>

      <div className="controls">
        <button onClick={toggle}>{running ? 'stop' : 'start listening'}</button>

        <label>
          grain size
          <input
            type="range"
            min="30"
            max="400"
            value={params.grainSizeMs}
            onChange={(e) => updateParam('grainSizeMs', Number(e.target.value))}
          />
        </label>

        <label>
          feedback
          <input
            type="range"
            min="0"
            max="0.9"
            step="0.01"
            value={params.feedback}
            onChange={(e) => updateParam('feedback', Number(e.target.value))}
          />
        </label>

        <label>
          spread / drift
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={params.spread}
            onChange={(e) => updateParam('spread', Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  )
}
