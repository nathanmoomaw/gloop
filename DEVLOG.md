# DEVLOG

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
