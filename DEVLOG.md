# DEVLOG

## 2026-07-23 - Workspace theme, DIGEST confirmation, DNS check

- Added `.vscode/settings.json` — GLOOP now has its own editor color theme
  (deep teal/obsidian bg, coral accent) distinct from every other lineage
  project's workspace colors (puddle/ribbon purple, moveloose forest green,
  tuner royal blue, LIFE palenight, butterfly-world night-blue, flyerz
  monokai).
- Confirmed DIGEST.md needs no per-project setup — the `~/.claude/digest-logger.js`
  Stop hook and `~/.gitignore` (which excludes `DIGEST.md` /
  `.claude/.digest-state.json` globally) already apply to every project
  including this one; gloop will get its first `DIGEST.md` starting from
  this session's Stop hook.
- Checked the `gloop-dev.obfusco.us` DNS_PROBE_FINISHED_NXDOMAIN report —
  expected, not a bug: no S3/CloudFront/Route53 has been provisioned yet
  (same deferred item tracked below/in ROADMAP, still pending go-ahead).

## 2026-07-23 - Real UI: console-less floating dials + extended engine params

Replaced the placeholder 3-slider bar with the intended console-less UI —
individual controls float directly over the full-bleed Chladni canvas,
pinned to the screen edges, mobile-first. No panel/toolbar background
anywhere in the control layer.

- `src/components/RotaryKnob.jsx` + `.css` — ported from puddle's rotary
  knob (same drag model: vertical drag, ghost-slider feedback overlay,
  `--knob-color` per-control, responsive shrink under 767px), recolored for
  GLOOP's rainbow palette (`--rainbow-1..6` + per-control `--color-*` vars
  added to `index.css`).
- `src/components/ListenButton.jsx` + `.css` — the old start/stop button
  reimagined as a large circular toggle, the primary/centerpiece control.
  Idle state breathes gently; listening state gets a spinning rainbow
  conic-gradient ring baked into the button itself.
- `src/components/LoopIndicator.jsx` + `.css` — new visual-only readout, a
  dashed ring circling the listen button. Rotation period is derived live
  from the current `rate` param (scaled up so it stays legible at fast
  rates rather than a 1:1 blur — see `loopPeriodFromRate` in App.jsx). A
  sparkle pulses on the ring every time a grain actually fires, driven
  imperatively via `engine.onGrainFire()` + a `pulse()` ref method so it
  never forces a React re-render at grain-rate frequency (can be tens/sec).
- `src/App.jsx` / `App.css` — five floating clusters (`top-left`,
  `top-right`, `bottom-left`, `bottom-right`, `center`) positioned via
  `position: fixed` with `pointer-events: none` on the wrapper and `auto`
  per-cluster, so empty screen space always falls through to the canvas.

**engine.js param surface extended** (all still live-adjustable via the
existing `setParam`/`getParams`):

- `rate` — grain trigger interval, newly decoupled from `grainSizeMs`
  (previously one value drove both timing and duration). Judgment call: the
  dump floated a possible separate "frequency" axis — didn't add one, since
  a single well-explained `rate` dial already reads as pitch/texture when
  pushed low and as rhythm when pushed high; a second axis felt redundant.
- `density` — how much of the rotating grain-buffer pool a grain can be
  pulled from (0 = only the most recently captured audio, 1 = anywhere in
  the pool). New second granular dial alongside `grainSizeMs`, decided to
  keep `spread` as-is (pitch/pan drift) rather than overload it further.
- `dynamics` — per-grain random delay-time jitter depth ("dynamic delay").
- `repeat` — tail decay length: feedback-loop gain now ramps from the
  `feedback` value down to near-silence over a `repeat`-controlled duration
  (250ms-6s), so "how hot each echo is" and "how long the tail lasts" are
  finally separate controls instead of both being implied by `feedback`.
- `wow` / `flutter` / `wobble` — three real, distinct LFOs: wow is a slow
  (~0.15Hz) deep pitch drift on grain playback rate, flutter a fast
  (~7.5Hz) shallow pitch jitter, wobble a slow (~0.3Hz) delay-time sweep —
  deliberately different rates/depths/targets so they don't just alias to
  the same modulation.
- `volume` — master output gain, now exposed (was hardcoded to 0.9).

Persistent LFO nodes are created once in `start()` and fanned out to each
new grain's `playbackRate`/`delayTime` as it's created; each grain
disconnects itself from those LFOs (`onended`, and a matched timeout for
the per-grain delay/feedback subgraph) so the fan-out list doesn't grow
unbounded over a long-running session.

**Grain canvas interaction**: `GrainField` now takes pointer events
(down/move) and calls an `onInteract(nx, ny, intensity)` prop; `App.jsx`
routes that straight into `engine.perturb(intensity)`, which temporarily
nudges `spread`/`feedback`/`dynamics` and decays back over ~1s on a
real-time interval — independent of the dial positions the user actually
set, so the knobs never visibly jump. Added a small matching visual-only
push on nearby sand grains in the canvas itself (reads a mutable pointer
ref inside the existing rAF loop, no extra re-renders) since MYTHOS/ETHOS
call out "draw, push, shake" as part of GLOOP's identity.

Build/lint verified clean (`npm run build`, `npm run lint`, `npm run dev`
boots and serves 200).

AWS infra (gloop.obfusco.us / gloop-dev.obfusco.us) intentionally untouched
— still pending explicit go-ahead per ROADMAP.

## 2026-07-12 - Project scaffold

- Created GitHub repo `nathanmoomaw/gloop` (public, lineage project)
- Vite + React 19 scaffold, mirroring vibe's build setup
- `src/audio/engine.js` — mic capture into rotating grain buffer pool, randomized grain playback through per-grain delay/feedback/pan network
- `src/components/GrainField.jsx` — Chladni-plate nodal-pattern grain-field visualization, mode numbers driven by dominant frequency from the analyser
- `src/App.jsx` — start/stop mic, grain size / feedback / spread controls
- Standard mds added: CLAUDE.md, ETHOS.md, MYTHOS.md, ROADMAP.md, this DEVLOG
- DUMP.md symlinked to `LIFE/dumps/gloop.md`, gitignored
- Updated `LIFE/LINEAGE.md`: grains (concept) → GLOOP (active, scaffold stage)
- Deploy (S3 + CloudFront + Route53 for gloop.obfusco.us / gloop-dev.obfusco.us) intentionally not provisioned yet — new billed AWS infra + DNS change, pending go-ahead
