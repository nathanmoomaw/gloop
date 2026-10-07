import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { pigmentAt } from '../color/kubelkaMunk'

// Renders rainbow "sand" grains settling into Chladni-plate-style nodal
// patterns driven by the dominant frequency of the live audio analyser —
// now gliding above a rippling liquid-like plate surface built from the
// same nodal standing-wave math, plus a gentle ambient ripple so the plate
// stays alive even at rest.
//
// Pointer interaction: clicking/dragging pushes nearby grains (visual only,
// cheap — read via a mutable ref inside the rAF loop so it never triggers a
// React re-render) and calls `onInteract` so the caller can feed the same
// gesture into the audio engine as a temporary perturbation.
// The Chladni nodal pattern's natural "tile" is GRAIN_AREA_SIZE wide (sin()
// is periodic, so it repeats seamlessly beyond that) — but the visible
// plate mesh is drawn much larger (PLATE_MESH_SIZE) so its edges sit
// off-screen at any aspect ratio. Grains now roam that same full extent
// (GRAIN_SPAN tile-widths) instead of being confined to one central tile;
// count scales with the linear span, not the full area, to keep the extra
// per-frame grain-loop cost reasonable.
const GRAIN_AREA_SIZE = 2
const PLATE_MESH_SIZE = 10
const GRAIN_SPAN = PLATE_MESH_SIZE / GRAIN_AREA_SIZE
const GRAIN_COUNT = 800 * GRAIN_SPAN * 20
const PLANE_SEGMENTS = 80
const HOVER_HEIGHT = 0.002
const NODAL_HEIGHT_SCALE = 0.018
const RIPPLE_HEIGHT_SCALE = 0.005

// Ambient background motion (rad/sec, tile-units/sec) — always active, slow
// enough that a full cycle takes minutes rather than reading as spinning.
const AMBIENT_SPIN_SPEED = 0.006
const AMBIENT_PAN_SPEED_U = 0.008
const AMBIENT_PAN_SPEED_V = 0.005
// Per-frame multiplicative decay on touch-imparted spin/pan velocity — a
// drag leaves the pattern drifting/turning for roughly a second afterward
// instead of snapping back, the "physics from the last touches" part.
// Total displacement from a drag is roughly GAIN * decay/(1-decay), so
// these two are tuned together — a fast decay alone isn't enough to keep a
// long drag (many pointermove events) from integrating into a huge jump.
const DRIFT_VELOCITY_DECAY = 0.95
const DRIFT_PAN_TOUCH_GAIN = 0.01
const DRIFT_SPIN_TOUCH_GAIN = 0.01

// Camera wander: the view over the plate drifts in every dimension at once
// (orbit, elevation, distance, roll, look-at target), each on its own
// sine sum with mutually irrational frequency ratios so the motion never
// visibly loops. It only moves while `on` — off, it eases to a stop and
// holds. While on, both its timing and its shape come from the output:
//   clock speed — live level + onsets, how fast grains fire (rate), wobble
//   elevation   — feedback: hotter loop tilts the view lower, more dramatic
//   distance    — size: bigger grains pull the camera back
//   orbit width — density: drawing from more of the pool swings wider
//   roll        — wow + flutter: tape wobble tips the horizon
//   aim drift   — dynamics: delay-time jitter wanders the look-at point
// Every param-driven value is eased, so knob turns (and evolve's glides)
// morph the motion rather than jump it.
const CAM_BASE_RATE = 0.04 // phase units/sec while on, before params/level
const CAM_LEVEL_RATE = 0.6 // extra at full amplitude
const CAM_ONSET_RATE = 2.5 // extra per unit of amplitude jump above its slow average
const CAM_FIRE_RATE = 0.25 // extra at the fastest grain rate (20ms)
const CAM_WOBBLE_RATE = 0.2 // extra at full wobble
const CAM_RATE_SMOOTHING = 0.02 // per-frame easing of the clock rate, no jerks
const CAM_SHAPE_SMOOTHING = 0.02 // per-frame easing of param-driven shape
const CAM_ACTIVE_SMOOTHING = 0.03 // per-frame easing of the on/off gate
const CAM_AZIMUTH_RANGE = 0.75 // rad, +/- around the front view
const CAM_ELEV_MIN = 0.72 // rad (~41°) — lower and the plate's far edge shows
const CAM_ELEV_MAX = 1.12 // rad (~64°)
const CAM_DIST_MIN = 1.8
const CAM_DIST_MAX = 2.4
const CAM_ROLL_RANGE = 0.07 // rad
const CAM_TARGET_RANGE = 0.18 // look-at drift across the plate
// Tilt dance: on top of the wander, the view rocks forward/backward —
// pitching toward the plate and pushing in, then rebounding away — on a
// damped spring. A steady rocking drive (tempo rises with level) keeps it
// swaying, and each onset kicks it forward so transients read as a lean
// into the sound. Gated by `on` like the rest of the camera.
const TILT_RANGE = 0.07 // rad, drive amplitude at full level
const TILT_BASE_HZ = 0.35 // rocking tempo at silence
const TILT_LEVEL_HZ = 0.9 // extra tempo at full amplitude
const TILT_KICK = 0.6 // rad/s of forward velocity per unit onset per 60fps frame
const TILT_SPRING_HZ = 1.4 // spring natural frequency
const TILT_DAMPING = 0.3 // damping ratio — underdamped, so kicks bounce back
const TILT_MAX = 0.16 // rad, hard clamp
const TILT_DOLLY = 0.9 // forward push (world units) per rad of tilt
// Random per page load so each session opens on a different view.
const CAM_START_PHASE = Math.random() * 100
// Sum of two sines at incommensurate rates, normalized to [-1, 1].
function wander(phase, f1, f2, offset) {
  return (Math.sin(phase * f1 + offset) + Math.sin(phase * f2 * Math.SQRT2 + offset * 1.7)) / 2
}

// Rendered sand-particle size scales with the `size` (grainSizeMs) dial —
// mirrors its min/max in App.jsx. sqrt curve gives more visible change at
// the low end and tapers off at the high end, instead of 3s grains
// rendering literally 100x bigger than 30ms ones.
const SIZE_KNOB_MIN_MS = 30
const SIZE_KNOB_MAX_MS = 3000
const GRAIN_POINT_SIZE_MIN = 0.01
const GRAIN_POINT_SIZE_MAX = 0.045
function pointSizeForGrainMs(ms) {
  const t = Math.sqrt(
    Math.max(0, Math.min(1, (ms - SIZE_KNOB_MIN_MS) / (SIZE_KNOB_MAX_MS - SIZE_KNOB_MIN_MS))),
  )
  return GRAIN_POINT_SIZE_MIN + t * (GRAIN_POINT_SIZE_MAX - GRAIN_POINT_SIZE_MIN)
}

// Same Chladni nodal function used to drift grains toward nodal lines and,
// now, to shape the plate surface itself — the plate's topology and the
// grains' resting pattern are the same physics, not two separate effects.
function nodalValue(n, m, u, v) {
  return (
    Math.sin(n * Math.PI * u) * Math.sin(m * Math.PI * v) -
    Math.sin(m * Math.PI * u) * Math.sin(n * Math.PI * v)
  )
}

function surfaceHeight(n, m, u, v, amplitude, t) {
  const nodal = nodalValue(n, m, u, v)
  // Ambient liquid motion — present even with no audio, so the plate never
  // looks static, scaled up when the resonance amplitude is higher.
  const ripple = Math.sin(u * 8 + t * 0.1) * Math.cos(v * 8 - t * 0.08)
  return (
    nodal * amplitude * NODAL_HEIGHT_SCALE + ripple * (0.3 + amplitude * 0.7) * RIPPLE_HEIGHT_SCALE
  )
}

// Kubelka-Munk pigment palette (see color/kubelkaMunk.js) vs. the original
// HSL rainbow — on by default, `k` flips between them live for A/B.
const KM_DEFAULT = true

// Shared color writer for plate and grains: `phase` around the color wheel,
// `lightness` on the same 0-1 HSL scale the rainbow mode already uses.
const pigmentScratch = [0, 0, 0]
function setPaletteColor(color, useKM, phase, saturation, lightness) {
  if (!useKM) {
    color.setHSL(phase, saturation, lightness)
    return
  }
  const [r, g, b] = pigmentAt(phase, pigmentScratch)
  if (lightness <= 0.5) {
    // Darker than a full tint: scale the pigment down (HSL l=0.5 ~ full).
    const k = lightness * 2
    color.setRGB(r * k, g * k, b * k, THREE.SRGBColorSpace)
  } else {
    // Lighter: wash toward white, like adding titanium white to the paint.
    const w = (lightness - 0.5) * 2
    color.setRGB(r + (1 - r) * w, g + (1 - g) * w, b + (1 - b) * w, THREE.SRGBColorSpace)
  }
}

// Param-driven camera shape targets (see CAM_* comment), all 0-1-ish.
function cameraShapeFor(p) {
  const sizeNorm = Math.max(0, Math.min(1, ((p.grainSizeMs ?? 400) - SIZE_KNOB_MIN_MS) / (SIZE_KNOB_MAX_MS - SIZE_KNOB_MIN_MS)))
  return {
    fire: 1 - Math.max(0, Math.min(1, ((p.rate ?? 2000) - 20) / 3980)),
    wobble: p.wobble ?? 0,
    elev: 1 - Math.min(1, (p.feedback ?? 0.65) / 0.9),
    dist: Math.sqrt(sizeNorm),
    orbit: 0.3 + 0.7 * (p.density ?? 0.6),
    roll: Math.min(2, 0.2 + (p.wow ?? 0) + (p.flutter ?? 0) * 0.5),
    aim: 0.3 + (p.dynamics ?? 0.15),
  }
}

export default function GrainField({ analyser, running, onInteract, grainSizeMs = 400, params }) {
  const containerRef = useRef(null)
  const grainsRef = useRef([])
  const pointerRef = useRef({ x: 0.5, y: 0.5, strength: 0, lastX: 0.5, lastY: 0.5 })
  // Slow background spin/pan, partly ambient and partly nudged by touch
  // velocity (see DRIFT_* constants) — panU/panV/spin are the accumulated
  // position, velU/velV/spinVel the decaying momentum from recent drags.
  const driftRef = useRef({ panU: 0, panV: 0, velU: 0, velV: 0, spin: 0, spinVel: 0 })
  // Camera clock (see CAM_* constants) and the slow amplitude average its
  // onset detection compares against — in a ref so toggling `on` (which
  // rebuilds the scene) doesn't jump the view back to a new start point.
  const camRef = useRef({
    phase: CAM_START_PHASE,
    rate: 0,
    slowAmplitude: 0.3,
    active: 0,
    reach: 0.9,
    shape: cameraShapeFor({}),
    tilt: 0,
    tiltVel: 0,
    tiltPhase: 0,
  })
  // Latest output params, read live in the draw loop (same reason as
  // grainSizeRef) to steer the camera.
  const paramsRef = useRef(params ?? {})
  useEffect(() => {
    paramsRef.current = params ?? {}
  }, [params])
  // Read live in the draw loop rather than an effect dependency — the size
  // dial changes on every drag tick, and rebuilding the whole three.js scene
  // that often would be both wasteful and visibly jarring.
  const grainSizeRef = useRef(grainSizeMs)
  // Read live in the draw loop, same reason as grainSizeRef.
  const kmRef = useRef(KM_DEFAULT)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey && !e.altKey) kmRef.current = !kmRef.current
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    grainSizeRef.current = grainSizeMs
  }, [grainSizeMs])

  useEffect(() => {
    const container = containerRef.current

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0x06060e, 1)
    container.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10)

    const resize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    // Plate surface — a rippling "liquid" whose topology is the same Chladni
    // standing wave driving the grains, plus a gentle ambient ripple.
    const planeGeo = new THREE.PlaneGeometry(PLATE_MESH_SIZE, PLATE_MESH_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS)
    planeGeo.rotateX(-Math.PI / 2)
    const planeColors = new Float32Array(planeGeo.attributes.position.count * 3)
    planeGeo.setAttribute('color', new THREE.BufferAttribute(planeColors, 3))
    const planeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
    const plateMesh = new THREE.Mesh(planeGeo, planeMat)
    scene.add(plateMesh)

    // Grains — same nodal-drift physics as before, now rendered as glowing
    // 3D points hovering just above the plate's local surface height.
    if (grainsRef.current.length === 0) {
      grainsRef.current = Array.from({ length: GRAIN_COUNT }, () => ({
        x: Math.random() * GRAIN_SPAN,
        y: Math.random() * GRAIN_SPAN,
        hue: Math.random() * 360,
      }))
    }
    const grainGeo = new THREE.BufferGeometry()
    const grainPositions = new Float32Array(GRAIN_COUNT * 3)
    const grainColors = new Float32Array(GRAIN_COUNT * 3)
    grainGeo.setAttribute('position', new THREE.BufferAttribute(grainPositions, 3))
    grainGeo.setAttribute('color', new THREE.BufferAttribute(grainColors, 3))
    const grainMat = new THREE.PointsMaterial({
      size: pointSizeForGrainMs(grainSizeRef.current),
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const grainPoints = new THREE.Points(grainGeo, grainMat)
    scene.add(grainPoints)

    resize()
    window.addEventListener('resize', resize)

    const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const tmpColor = new THREE.Color()
    const startTime = performance.now()
    let raf
    // Smoothed mode numbers/amplitude — the raw dominant FFT bin is noisy
    // frame to frame, so using it directly snapped the entire height field
    // between very different standing-wave shapes every frame, which read
    // as flicker (especially with real 3D shading, much more than it did on
    // the old flat 2D canvas). n/m are eased as continuous floats rather
    // than integers — sin(nπu) is perfectly well-defined for non-integer n,
    // so this gives a smooth morph between resonance patterns instead of a
    // discrete jump.
    let smoothN = 3
    let smoothM = 4
    let smoothAmplitude = 0.3
    const cam = camRef.current
    let lastFrame = performance.now()

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const t = (performance.now() - startTime) / 1000

      let targetN = 3
      let targetM = 4
      let targetAmplitude = 0.3

      if (running && freqData) {
        analyser.getByteFrequencyData(freqData)
        let maxBin = 0
        let maxVal = 0
        for (let i = 0; i < freqData.length; i++) {
          if (freqData[i] > maxVal) {
            maxVal = freqData[i]
            maxBin = i
          }
        }
        targetN = 2 + (maxBin % 7)
        targetM = 3 + ((maxBin * 3) % 9)
        targetAmplitude = Math.min(1, maxVal / 255)
      }

      smoothN += (targetN - smoothN) * 0.015
      smoothM += (targetM - smoothM) * 0.015
      smoothAmplitude += (targetAmplitude - smoothAmplitude) * 0.03
      const n = smoothN
      const m = smoothM
      const amplitude = smoothAmplitude

      grainMat.size = pointSizeForGrainMs(grainSizeRef.current)
      const useKM = kmRef.current

      // Pointer push: decays on its own each frame, independent of audio state.
      const pointer = pointerRef.current
      const pushActive = pointer.strength > 0.002
      if (pointer.strength > 0) pointer.strength *= 0.92

      // Background spin/pan: ambient drift (always on) plus decaying
      // momentum imparted by recent drags (see driftRef init comment).
      const drift = driftRef.current
      drift.panU += drift.velU
      drift.panV += drift.velV
      drift.velU *= DRIFT_VELOCITY_DECAY
      drift.velV *= DRIFT_VELOCITY_DECAY
      drift.spin += drift.spinVel
      drift.spinVel *= DRIFT_VELOCITY_DECAY
      const panU = drift.panU + t * AMBIENT_PAN_SPEED_U
      const panV = drift.panV + t * AMBIENT_PAN_SPEED_V
      // Spin is applied as a rotation of the (u, v) sampling coordinates
      // around the tile center, not as an Object3D rotation on the meshes
      // themselves — grains' actual world positions (g.x/g.y) have to stay
      // put for the pointer-push math below (which compares them directly
      // against screen-space pointer coords) to keep lining up with what's
      // rendered; only the nodal/color pattern underneath visibly turns,
      // and grains drifting toward nodal minima follow it, which reads as
      // the whole field spinning anyway.
      const spinAngle = drift.spin + t * AMBIENT_SPIN_SPEED
      const spinCos = Math.cos(spinAngle)
      const spinSin = Math.sin(spinAngle)

      // Update the plate's rippling surface.
      const posAttr = planeGeo.attributes.position
      const colAttr = planeGeo.attributes.color
      for (let i = 0; i < posAttr.count; i++) {
        const rawU = posAttr.getX(i) / GRAIN_AREA_SIZE + 0.5 + panU
        const rawV = posAttr.getZ(i) / GRAIN_AREA_SIZE + 0.5 + panV
        const du = rawU - 0.5
        const dv = rawV - 0.5
        const u = 0.5 + du * spinCos - dv * spinSin
        const v = 0.5 + du * spinSin + dv * spinCos
        const h = surfaceHeight(n, m, u, v, amplitude, t)
        posAttr.setY(i, h)
        // Hue sweeps across the plate by position (not just time), so the
        // surface itself reads as a genuine rainbow gradient rather than a
        // single flat tint — dark near the background color in the calm
        // nodal valleys, saturated and bright on the ripple peaks.
        const hue = ((u + v) * 0.5 + t * 0.008) % 1
        const brightness = 0.04 + Math.min(1, Math.abs(h) / NODAL_HEIGHT_SCALE) * 0.42
        setPaletteColor(tmpColor, useKM, hue, 0.8, brightness)
        colAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b)
      }
      posAttr.needsUpdate = true
      colAttr.needsUpdate = true

      // Update grains — same nodal-drift physics as the 2D version, now
      // hovering above the plate's live surface height at their (x, y).
      const gPos = grainGeo.attributes.position
      const gCol = grainGeo.attributes.color
      const grains = grainsRef.current
      for (let i = 0; i < grains.length; i++) {
        const g = grains[i]
        // Fractional part tiles the nodal pattern across the grain's full
        // GRAIN_SPAN-wide roaming area, same trick as the plate mesh.
        const rawU = g.x - Math.floor(g.x) + panU
        const rawV = g.y - Math.floor(g.y) + panV
        const du0 = rawU - 0.5
        const dv0 = rawV - 0.5
        const u = 0.5 + du0 * spinCos - dv0 * spinSin
        const v = 0.5 + du0 * spinSin + dv0 * spinCos
        const nodal = nodalValue(n, m, u, v)

        const pull = 0.002 * (1 - Math.min(1, Math.abs(nodal) * 2))
        g.x += (Math.random() - 0.5) * 0.004 * (0.3 + amplitude) - Math.sign(nodal) * pull
        g.y += (Math.random() - 0.5) * 0.004 * (0.3 + amplitude) - Math.sign(nodal) * pull

        if (pushActive) {
          // pointer.x/y are normalized [0,1] screen-space; grains roam a
          // GRAIN_SPAN-wide domain, so compare in normalized terms and scale
          // the resulting displacement back up — keeps the same push feel
          // as before regardless of the larger roaming area.
          const dxNorm = g.x / GRAIN_SPAN - pointer.x
          const dyNorm = g.y / GRAIN_SPAN - pointer.y
          const distSq = dxNorm * dxNorm + dyNorm * dyNorm
          if (distSq < 0.035) {
            const dist = Math.sqrt(distSq) || 0.001
            const force = pointer.strength * (1 - dist / 0.19)
            g.x += (dxNorm / dist) * force * 0.006 * GRAIN_SPAN
            g.y += (dyNorm / dist) * force * 0.006 * GRAIN_SPAN
          }
        }

        g.x = Math.min(GRAIN_SPAN, Math.max(0, g.x))
        g.y = Math.min(GRAIN_SPAN, Math.max(0, g.y))
        g.hue = (g.hue + 0.05) % 360

        const rawLocalU = g.x - Math.floor(g.x) + panU
        const rawLocalV = g.y - Math.floor(g.y) + panV
        const dlu = rawLocalU - 0.5
        const dlv = rawLocalV - 0.5
        const localU = 0.5 + dlu * spinCos - dlv * spinSin
        const localV = 0.5 + dlu * spinSin + dlv * spinCos
        const worldX = (g.x / GRAIN_SPAN - 0.5) * PLATE_MESH_SIZE
        const worldZ = (g.y / GRAIN_SPAN - 0.5) * PLATE_MESH_SIZE
        const worldY = surfaceHeight(n, m, localU, localV, amplitude, t) + HOVER_HEIGHT
        gPos.setXYZ(i, worldX, worldY, worldZ)

        setPaletteColor(tmpColor, useKM, g.hue / 360, 0.85, 0.55 + amplitude * 0.2)
        gCol.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b)
      }
      gPos.needsUpdate = true
      gCol.needsUpdate = true

      // Camera wander (see CAM_* constants): clock rate eased toward a
      // level + onset-driven target, then every dimension read off it.
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastFrame) / 1000)
      lastFrame = now
      // Off: the gate eases to 0, which stops the clock and freezes the
      // shape where it is — the view settles and holds instead of snapping.
      cam.active += ((running ? 1 : 0) - cam.active) * CAM_ACTIVE_SMOOTHING
      const shape = cam.shape
      const target = cameraShapeFor(paramsRef.current)
      const shapeEase = CAM_SHAPE_SMOOTHING * cam.active
      for (const k in shape) shape[k] += (target[k] - shape[k]) * shapeEase
      cam.slowAmplitude += (amplitude - cam.slowAmplitude) * 0.01
      const onset = Math.max(0, amplitude - cam.slowAmplitude)
      const targetRate = running
        ? CAM_BASE_RATE + amplitude * CAM_LEVEL_RATE + onset * CAM_ONSET_RATE +
          shape.fire * CAM_FIRE_RATE + shape.wobble * CAM_WOBBLE_RATE
        : 0
      cam.rate += (targetRate - cam.rate) * CAM_RATE_SMOOTHING
      cam.phase += cam.rate * dt
      const camPhase = cam.phase
      // Amplitude keeps easing while off (toward its idle value), so reach
      // is gated too or the frozen view would still creep.
      cam.reach += (0.85 + amplitude * 0.15 - cam.reach) * cam.active
      const reach = cam.reach
      const elevSpan = CAM_ELEV_MAX - CAM_ELEV_MIN
      const azimuth = wander(camPhase, 0.31, 0.17, 0) * CAM_AZIMUTH_RANGE * shape.orbit * reach
      // Param sets the center, wander sways +/- a quarter span around it.
      const elev = Math.max(CAM_ELEV_MIN, Math.min(CAM_ELEV_MAX,
        CAM_ELEV_MIN + shape.elev * elevSpan + wander(camPhase, 0.23, 0.13, 2.1) * elevSpan * 0.25))
      const distSpan = CAM_DIST_MAX - CAM_DIST_MIN
      const dist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX,
        CAM_DIST_MIN + shape.dist * distSpan + wander(camPhase, 0.19, 0.29, 4.3) * distSpan * 0.2))
      const tx = wander(camPhase, 0.27, 0.11, 1.3) * CAM_TARGET_RANGE * shape.aim * reach
      const tz = wander(camPhase, 0.21, 0.15, 3.7) * CAM_TARGET_RANGE * shape.aim * reach
      const horiz = Math.cos(elev) * dist
      camera.position.set(tx + Math.sin(azimuth) * horiz, Math.sin(elev) * dist, tz + Math.cos(azimuth) * horiz)
      camera.lookAt(tx, 0, tz)
      camera.rotateZ(wander(camPhase, 0.37, 0.09, 5.9) * CAM_ROLL_RANGE * shape.roll * reach)

      // Tilt dance (see TILT_* constants): spring chases the rocking drive,
      // onsets kick it forward. Off, drive and kicks gate to 0 and the
      // spring settles back to level.
      cam.tiltPhase += (TILT_BASE_HZ + amplitude * TILT_LEVEL_HZ) * dt * cam.active
      const tiltDrive = Math.sin(cam.tiltPhase * Math.PI * 2) * TILT_RANGE * (0.35 + amplitude * 0.65) * cam.active
      const omega = TILT_SPRING_HZ * Math.PI * 2
      cam.tiltVel += ((tiltDrive - cam.tilt) * omega * omega - 2 * TILT_DAMPING * omega * cam.tiltVel) * dt
      cam.tiltVel -= onset * TILT_KICK * dt * 60 * cam.active
      cam.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, cam.tilt + cam.tiltVel * dt))
      // Negative tilt pitches down toward the plate and dollies in.
      camera.rotateX(cam.tilt)
      camera.translateZ(cam.tilt * TILT_DOLLY)

      renderer.render(scene, camera)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      grainGeo.dispose()
      grainMat.dispose()
      planeGeo.dispose()
      planeMat.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [analyser, running])

  const handlePointer = (e) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))

    const pointer = pointerRef.current
    const dx = nx - pointer.lastX
    const dy = ny - pointer.lastY
    const moveDist = Math.sqrt(dx * dx + dy * dy)
    pointer.x = nx
    pointer.y = ny
    pointer.lastX = nx
    pointer.lastY = ny
    pointer.strength = Math.min(1, pointer.strength + Math.max(0.25, moveDist * 6))

    // Drag direction nudges the background spin/pan's momentum — decays on
    // its own in the draw loop (DRIFT_VELOCITY_DECAY), so a stroke leaves
    // the pattern drifting/turning for a bit rather than snapping back.
    const drift = driftRef.current
    drift.velU += dx * DRIFT_PAN_TOUCH_GAIN
    drift.velV += dy * DRIFT_PAN_TOUCH_GAIN
    drift.spinVel += dx * DRIFT_SPIN_TOUCH_GAIN

    if (onInteract) {
      onInteract(nx, ny, Math.min(1, Math.max(0.3, moveDist * 8)))
    }
  }

  const handlePointerDown = (e) => {
    const pointer = pointerRef.current
    pointer.lastX = pointer.x
    pointer.lastY = pointer.y
    handlePointer(e)
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => { if (e.buttons > 0) handlePointer(e) }}
    />
  )
}
