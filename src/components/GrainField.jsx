import { useEffect, useRef } from 'react'
import * as THREE from 'three'

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

export default function GrainField({ analyser, running, onInteract }) {
  const containerRef = useRef(null)
  const grainsRef = useRef([])
  const pointerRef = useRef({ x: 0.5, y: 0.5, strength: 0, lastX: 0.5, lastY: 0.5 })

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
      size: 0.016,
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

      // Pointer push: decays on its own each frame, independent of audio state.
      const pointer = pointerRef.current
      const pushActive = pointer.strength > 0.002
      if (pointer.strength > 0) pointer.strength *= 0.92

      // Update the plate's rippling surface.
      const posAttr = planeGeo.attributes.position
      const colAttr = planeGeo.attributes.color
      for (let i = 0; i < posAttr.count; i++) {
        const u = posAttr.getX(i) / GRAIN_AREA_SIZE + 0.5
        const v = posAttr.getZ(i) / GRAIN_AREA_SIZE + 0.5
        const h = surfaceHeight(n, m, u, v, amplitude, t)
        posAttr.setY(i, h)
        // Hue sweeps across the plate by position (not just time), so the
        // surface itself reads as a genuine rainbow gradient rather than a
        // single flat tint — dark near the background color in the calm
        // nodal valleys, saturated and bright on the ripple peaks.
        const hue = ((u + v) * 0.5 + t * 0.008) % 1
        const brightness = 0.04 + Math.min(1, Math.abs(h) / NODAL_HEIGHT_SCALE) * 0.42
        tmpColor.setHSL(hue, 0.8, brightness)
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
        const u = g.x - Math.floor(g.x)
        const v = g.y - Math.floor(g.y)
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

        const localU = g.x - Math.floor(g.x)
        const localV = g.y - Math.floor(g.y)
        const worldX = (g.x / GRAIN_SPAN - 0.5) * PLATE_MESH_SIZE
        const worldZ = (g.y / GRAIN_SPAN - 0.5) * PLATE_MESH_SIZE
        const worldY = surfaceHeight(n, m, localU, localV, amplitude, t) + HOVER_HEIGHT
        gPos.setXYZ(i, worldX, worldY, worldZ)

        tmpColor.setHSL(g.hue / 360, 0.85, 0.55 + amplitude * 0.2)
        gCol.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b)
      }
      gPos.needsUpdate = true
      gCol.needsUpdate = true

      // Camera: fixed tilted view over the plate, with a slow, subtle sway
      // so the 3D depth/parallax of the ripple reads clearly at a glance.
      camera.position.set(Math.sin(t * 0.012) * 0.15, 1.5, 1.55 + Math.cos(t * 0.008) * 0.08)
      camera.lookAt(0, 0, 0)

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
