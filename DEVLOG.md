# DEVLOG

## 2026-07-24 - Sound quality pass + more polish on the 3D plate

**Sound quality** (answering "how can I improve the quality of the sound
produced?" — see chat for the full answer, this is the part actioned now):

- Safety limiter (`DynamicsCompressorNode`, threshold -6dB, ratio 12:1) now
  sits between `masterGain` and `ctx.destination`. Feedback goes up to 0.95
  and silence-sustain tails can run 30s, so overlapping grain feedback
  loops could genuinely sum into harsh digital clipping at higher
  feedback/volume settings — this catches it instead of letting it distort.
- Highpass filter (70Hz) on the mic input, before it ever reaches the grain
  pool — removes rumble/handling noise and DC bias from the source
  material itself, so every grain pulled from it is already clean, rather
  than filtering the mix after the fact.
- Grain envelope switched from linear to exponential attack/release. Linear
  ramps have an audible "zipper" edge at each grain boundary, especially
  with several grains overlapping at once (default rate/grainSize overlap
  ~4-5x) — exponential is the standard smoother envelope shape for
  granular synthesis.
- Biggest remaining lever, not done here: migrating capture off
  `ScriptProcessorNode` (main-thread, deprecated) to an `AudioWorklet`
  (already tracked in ROADMAP) — main-thread contention between audio
  capture and the WebGL grain-field render is a real glitch risk now that
  both are doing meaningfully more work than the original scaffold.

**3D plate polish**, third round of feedback on the same day's work:

- Pointer-push force cut 5x (0.03 → 0.006) — a real scaling bug from
  extending grains across the full plate: the displacement was scaled by
  `GRAIN_SPAN` to preserve the *radius* correctly, but that also scaled how
  *far* pushed grains flew, which is why a tap was flinging sand across
  half the screen.
- Ambient animation speed cut again (ripple/hue-drift/camera-sway
  multipliers roughly halved once more) and the n/m/amplitude smoothing
  eased more slowly too, per repeated "still too fast" feedback.
- Grain count 5x'd again (16000 → 80000) per "want to see many many more."
  Measured 31fps under headless *software* GL at this count (down from
  60fps at 16000) — SwiftShader is a pessimistic proxy without a real GPU,
  but this is a real cost worth watching on lower-end/mobile hardware; flag
  if it feels janky on an actual device and it can be dialed back.
- Spacebar now toggles listening both ways (previously stop-only).

## 2026-07-24 - Root-caused the flicker, slowed motion, 4x grain count

Found the actual cause of "the 3D stuff is super flickery": `n`, `m` (the
Chladni mode numbers) and `amplitude` were read directly off the raw
per-frame dominant FFT bin with zero smoothing. Real (and even synthetic
test) mic input is noisy frame to frame, so the whole height field could
snap between very different standing-wave shapes on consecutive frames —
invisible-ish on the old flat 2D canvas, but very obvious as discontinuous
jumps once the same data drives real 3D shading. Fixed by easing `n`/`m` as
continuous floats (not integers — `sin(nπu)` is perfectly well-defined for
non-integer `n`, so this morphs smoothly between resonance patterns instead
of jumping) and `amplitude` toward their per-frame targets each frame,
rather than snapping straight to them.

Also slowed the ambient animation itself per feedback ("needs to move much
slower"): the ripple's temporal terms, the plate's hue-drift rate, and the
camera's idle sway were all roughly halved to a third of their previous
speed.

**Grain count 4x'd** (4000 → 16000) per "want to see many many more sand
grains." Verified via Playwright that this still holds a steady 60fps even
under headless *software* GL rendering (SwiftShader, no real GPU) — real
hardware should have plenty of margin.

## 2026-07-24 - Grains span the full screen + tap-to-play while idle

Two more follow-ups on the same day's plate work:

- **Grains now roam the full plate, not just the original central tile.**
  They were still confined to the `GRAIN_AREA_SIZE` (2-unit) square even
  after the plate mesh itself was enlarged to fill the screen. Introduced
  `GRAIN_SPAN` (`PLATE_MESH_SIZE / GRAIN_AREA_SIZE` = 5) as how many
  Chladni-pattern tile-widths grains can now wander across; the nodal drift
  math reads the fractional part of each grain's position (`x - floor(x)`)
  to sample the periodic pattern, same trick the plate mesh already used.
  Grain count scaled from 800 to `800 * GRAIN_SPAN` (4000) — scaled with the
  *linear* span rather than the full 25x area increase, to keep the
  per-frame grain loop's cost reasonable while still giving decent coverage
  edge to edge. Pointer-push physics were re-derived in normalized [0,1]
  terms so the push still feels identical regardless of the larger roaming
  domain.
- **Tapping the grains while not listening now makes a sound.** Previously
  `onInteract` always called `engine.perturb()`, which only nudges
  parameters of an already-running grain stream — with no live mic capture
  active, a tap did nothing audible at all. Added `engine.playTapSound(nx,
  ny, intensity)`: a short bandpass-filtered noise burst (pitch from
  vertical tap position, pan from horizontal, level/duration from
  intensity) through a lazily-created, independent `AudioContext` — a
  synthesized stand-in for "what this grain rearrangement would sound
  like," since there's no real captured audio to draw an actual grain from
  in that state. `App.jsx`'s `handleInteract` now branches on `running`:
  perturb the live stream if listening, play the tap synth otherwise.

Verified with Playwright: grains render across the full frame (screenshot),
and tapping while stopped exercises the new code path with no console/page
errors.

## 2026-07-24 - Plate tuning pass + real fix for echo dying out in silence

Follow-up feedback on the same day's 3D plate + sustain work:

- **Plate now spans the full screen.** Previously the plate mesh was sized
  to exactly match the grains' own 2×2 physical area, so at most camera
  angles/aspect ratios its edges fell inside the viewport, leaving visible
  black margins. Decoupled the two: grains still live in a `GRAIN_AREA_SIZE`
  (2-unit) square as before, but the visible mesh is now a much larger
  `PLATE_MESH_SIZE` (10 units) whose u/v (for the nodal height function) is
  still computed on the original 2-unit basis — `sin()` is periodic, so the
  Chladni pattern tiles seamlessly outward across the bigger mesh with no
  seam, and its edges now sit off-screen at any reasonable aspect ratio.
- **Ripple amplitude cut 10x** (`NODAL_HEIGHT_SCALE` 0.18→0.018,
  `RIPPLE_HEIGHT_SCALE` 0.05→0.005, `HOVER_HEIGHT` scaled down to match)
  per feedback that the motion read as jerky/chaotic.
- **Defaults tuned for "not enough sound happening"**: `RATE_MS_DEFAULT`
  130→26ms (grains fire ~5x more often out of the box) and default
  `sensitivity` 0.5→0.1 (pushes the effective quiet-threshold up, so the
  sustain/freeze behavior below engages far more readily at the stock
  setting instead of sitting in a middle ground).
- **The actual bug behind "echo doesn't really continue in silence"**:
  last session's sustain fix only stretched how long the feedback *decay*
  took, but the grain pool kept recording live audio the entire time — so
  after ~`POOL_SIZE × 400ms` (~9.6s) of true quiet, every buffer slot had
  already been overwritten with near-silence, and grains had nothing real
  left to echo no matter how long the decay ceiling was. Real fix: while
  `inputLevel` is below the sensitivity threshold, `onaudioprocess` now
  skips writing into the pool entirely (see `currentThreshold()` in
  `engine.js`) — the last real captured audio just keeps getting re-drawn
  from indefinitely until fresh sound pushes the level back above
  threshold. Combined with the existing decay-ceiling stretch, this is what
  actually makes the loop feel like it "just continues."
- **Spacebar stops listening** — a fast kill-switch that doesn't require
  aiming for the listen button (`App.jsx`, gated on `running` so it doesn't
  eat the page-scroll spacebar when idle).

Verified with Playwright: new `rate`/`sensitivity` defaults round-trip
correctly, spacebar toggles `running` off, screenshots confirm the plate
fills the frame edge-to-edge with visibly calmer motion.

## 2026-07-24 - 3D liquid plate (three.js) + audness confirmation

**Grain field is now a real 3D scene (three.js/WebGL), not a flat 2D canvas.**
The plate is a rippling mesh whose height comes from the *same* Chladni
nodal function that already drove grain drift (`nodalValue(n, m, u, v)`,
now shared between plate and grains), plus a small ambient traveling ripple
so the plate stays alive even at rest. Grains are rendered as additive-blend
`THREE.Points`, hovering `HOVER_HEIGHT` above the plate's live surface
height at their own (x, y) — the "gliding above the plate due to acoustic
resonance" effect the dump asked for. Grain drift/pointer-push physics are
otherwise unchanged from the 2D version (same math, just also driving a 3D
Y position now).

- Plate vertex colors: hue swept by position (`(u+v)/2`) plus a slow time
  drift, brightness driven by ripple height — first pass used hue-by-time-only
  and rendered as a flat muddy brown; fixed by making hue vary spatially so
  the surface reads as an actual moving rainbow gradient (verified via
  Playwright screenshot before/after).
- Fixed camera with a small continuous positional sway (not user-orbitable)
  — keeps the "console-less," no-extra-chrome feel while still making the
  3D depth/parallax legible at a glance.
- Kept "lightly" in scope per the ask: `antialias: false`, pixel ratio
  capped at 2, same grain count (800) as the 2D version, moderate plate
  subdivision (56×56 segments), no lights/shadows (unlit `MeshBasicMaterial`
  with vertex colors) — computeVertexNormals() was dropped since nothing
  reads normals without lighting.
- New dependency: `three` (~0.185). Bundle grew from ~205KB to ~715KB
  (~65KB→~194KB gzip) — a real, known tradeoff of moving off Canvas 2D,
  worth watching on slow mobile connections but not addressed further here.
- Verified with Playwright: no console/page errors, screenshots confirm
  correct rendering both idle and while listening (nodal lines visible as
  grains trace bright paths across the rippling surface).

**Audness question answered**: confirmed GLOOP does not use `@audness/core`
and shouldn't — audness is a synth-voice engine (oscillators/VCF/bitcrush),
has zero mic-capture or granular-synthesis capability, and was never a fit
for what GLOOP needs. See CLAUDE.md's new Audness section.

**Dev branch**: cut `dev/v0` from `main`, pushed — confirmed it auto-deploys
to gloop-dev.obfusco.us (previously 403/empty) via the existing
`dev/**`-triggered workflow job. It's identical to `main`'s tip as of this
push, so there was nothing to "merge forward" yet.

## 2026-07-24 - Sustain-on-silence + sensitivity dial

Feedback previously always decayed over a fixed `repeat`-controlled window
(250ms-6s) regardless of whether the mic was still hearing anything, so the
echo died out quickly even with nothing new competing for attention.

- `engine.js` now tracks a rolling input-level estimate (per-block RMS,
  smoothed 85/15 across blocks) in the `ScriptProcessor` capture callback.
- New `sensitivity` param (0-1, default 0.5) maps to an amplitude threshold
  (0.05 down to 0.002 as sensitivity rises) — the level below which live
  input counts as "not presently hearing new sound."
- The repeat-time ceiling (`REPEAT_MAX_MS`, 6s) now stretches toward a new
  `SUSTAIN_MAX_MS` (30s) in proportion to how far below that threshold the
  current input level sits (`quietFactor`), so the loop becomes a much
  longer, more persistent wash of echoes while quiet, and behaves exactly
  as before while actively fed. Bounded and self-decaying either way — no
  true infinite freeze/looper, which would need buffer-pool freezing and
  was out of scope for this ask.
- New `sensitivity` RotaryKnob added next to feedback/repeat in the
  top-right cluster (`App.jsx`, `--color-sensitivity` teal in `index.css`).

Verified with Playwright (fake mic device): param round-trips correctly via
setParam/getParams, and audio output stays nonzero (sampled over ~1s to
avoid catching an inter-grain gap) after the change.

## 2026-07-23 - Fix: total silence bug (ScriptProcessor never fired)

User reported no sound at all. Root cause was in `src/audio/engine.js`,
present since the original scaffold (2026-07-12): the mic-capture
`ScriptProcessorNode` was connected to a freshly created `GainNode` that
was never itself connected onward to `ctx.destination` —

```js
recorderNode.connect(ctx.createGain()) // silent sink
```

Chrome/Firefox only reliably fire `onaudioprocess` once the node graph
reaches the destination; this dangling node meant `onaudioprocess` never
ran, so the grain buffer pool stayed all-zero forever. Grain scheduling,
the loop indicator, and the Chladni visualization all worked fine (none
of them depend on real mic data), which is why this went unnoticed —
every grain was faithfully playing back silence.

Fix: route the sink through an explicit zero-gain node connected to
`ctx.destination`, satisfying the browser's graph requirement without
audibly passing raw mic input through:

```js
const silentSink = ctx.createGain()
silentSink.gain.value = 0
recorderNode.connect(silentSink)
silentSink.connect(ctx.destination)
```

Verified with Playwright + Chrome's fake-mic-device flags: analyser
time-domain data was exactly `0` (true digital silence) before the fix
and nonzero after, on the same build.

## 2026-07-23 - AWS infra provisioned: gloop.obfusco.us + gloop-dev.obfusco.us live

Provisioned by inspecting `now.obfusco.us`'s *live* AWS config directly (more
reliable than sibling DEVLOG prose, which turned out stale — several claimed
"S3 static website hosting + public bucket policy" but the actual running
setup is private buckets behind CloudFront Origin Access Control):

- S3 buckets `gloop.obfusco.us` / `gloop-dev.obfusco.us` — private, all
  public-access-block flags on, bucket policy scopes `s3:GetObject` to
  `cloudfront.amazonaws.com` conditioned on each distribution's own ARN.
- CloudFront distributions: prod `E1OR0VU2T3D7I5`
  (d1eixcc7pe2gns.cloudfront.net), dev `E1EW5T5VWLL28W`
  (d3qtibdrec7700.cloudfront.net). Each has its own OAC (prod
  `E3GA4G20VS4SMF`, dev `E230UICKWZMB8Q`), the shared `*.obfusco.us`
  wildcard ACM cert (us-east-1), AWS's managed CachingOptimized cache
  policy, and a 404→`/index.html` (200) custom error response for SPA
  routing.
- Route53 A-alias records added in the `obfusco.us` hosted zone
  (`Z2YGI1EJ2R4PG0`) for both subdomains, pointing at their distributions
  via the fixed CloudFront alias hosted-zone-id `Z2FDTNDATAQYW2`.
- **Credentials — deviated from convention on purpose**: every other
  lineage project shares one IAM user (`github-actions-moomaw`) via an
  inline `moomaw-deploy` policy, but that user already had AWS's max of 2
  active access keys and I couldn't retrieve either existing secret value
  (write-only once set) or safely tell which live site depends on which
  key. Rather than rotate a key some other repo might still need, created
  a new dedicated IAM user `github-actions-gloop` with its own minimal
  inline policy (scoped only to gloop's 2 buckets + 2 distributions) and
  set its key as this repo's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
  secrets. Zero risk to now/tuner/ribbon/vibe/moveloose/puddle's deploys.
- `.github/workflows/deploy.yml` added, mirroring `now`'s workflow
  structure (lint → build → verify `dist/index.html` → configure AWS creds
  → `aws s3 sync --delete` → CloudFront invalidation → smoke-test curl),
  `main` → prod job, `dev/**` → dev job.

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
