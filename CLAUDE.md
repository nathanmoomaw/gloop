# GLOOP

## Project Overview
GLOOP is a granular synthesis echo loopback device — part of the ribbon/puddle/audness lineage (see `~/Sites/LIFE/LINEAGE.md`). It listens to the mic, chops what it hears into short grains, and replays them through a feedback delay network so the room's own sound becomes a granular echo. Visualized as rainbow sand grains settling into Chladni-plate nodal patterns on a vibrating speaker.

## Tech Stack
- Vite + React 19, no backend
- Web Audio API: AudioWorklet grain capture → grain pool → randomized playback through per-grain delay/feedback/pan (see `src/audio/engine.js`). Capture (`listen`) and playback (`on`) are independent toggles over one shared graph; idle suspends rather than closes the context so the pool persists. Grain outputs sum into `fxBus`; `thru` mutes it and opens a dry mic → limiter monitor path (`thruGain`) that bypasses `masterGain`. Above `repeat` 85% (`smearAmount`), grains also send into a shared convolver (`smearVerb` → `fxBus`) for a Clouds-style wash.
- Param evolution: `src/audio/evolve.js` (automatic Avida-style host/parasite loop, NEAT crossover, `glideTo`) and `src/audio/breed.js` (interactive: the listener picks, pure functions, UI in `BreedPanel`). Opening one stops the other.
- three.js (WebGL) for the grain-field visualization (see `src/components/GrainField.jsx`) — a rippling plate mesh driven by the same Chladni nodal math as the grains, with grains rendered as glowing 3D points hovering just above the live surface height. Colors come from a Kubelka-Munk pigment ring LUT (`src/color/kubelkaMunk.js`) by default; `k` toggles back to the HSL rainbow. Not audness-powered — see Audness note below. `c` eases the nodal field from Chladni to an evolved CPPN (`src/visual/cppn.js`: 6 hidden nodes over periodic x/y/r, mode-blended Chladni, time and level), evaluated once a frame on a 96×96 LUT and sampled per point; Shift+C mutates the genome and morphs into it.

## Status
Scaffold stage (2026-07-12). Core mic → grain → feedback loop and Chladni-driven visualization are implemented as a first pass. Deploy infra provisioned 2026-07-23.

## Reference notes (not yet built)
- **Sethares dissonance** (timbre-derived scales): s = 0.24/(0.0207·f_min + 18.96); d = min(a1,a2)·(5e^(−3.51·s·Δf) − 5e^(−5.75·s·Δf)), summed over partial pairs. Candidate `evolve`/`breed` fitness term, or for scales shared with ribbon/puddle.
- **Digital waveguide synthesis** (J.O. Smith, CCRMA) and arXiv:2604.12878, which fits waveguide parameters with evolutionary algorithms. That's the bridge from GLOOP's evolve/breed thread to a future physical-model voice. The Karplus-Strong tap sound is already the simplest waveguide.
- **OPFS** (Origin Private File System) is the storage upgrade once GLOOP persists more than small settings, e.g. saved CPPN genomes, breed archives, or captured grain pools (binary audio). `localStorage` is fine until then.

## Audness
GLOOP does **not** use `@audness/core` and shouldn't — audness is a synth-voice engine (oscillators, VCF, delay/reverb, bitcrush) for the puddle v2+/ribbon v4+ lineage, with no mic-capture or granular-synthesis support at all. GLOOP's actual needs (live mic ingestion, grain-pool capture, per-grain delay/feedback/pan network) are a different problem than what audness solves; `src/audio/engine.js` is intentionally bespoke. `LIFE/LINEAGE.md` places GLOOP directly under ribbon, not under audness, consistent with this.

## Conventions
- DUMP.md is a symlink to `~/Sites/LIFE/dumps/gloop.md` — gitignored here, lives privately in LIFE.
- `/dump` here follows the same 3-step pattern as other lineage projects (see `.claude/commands/dump.md`).
- ETHOS.md / MYTHOS.md hold direction and narrative; update DEVLOG.md and ROADMAP.md as work lands.
- Tests: `npm test` = vitest unit tests (`tests/*.test.js`, pure modules only — no AudioContext/WebGL) + build smoke. `npm run review:haiku [-- <ref>]` runs the global big-diff `review-haiku` before merging to main.
- Argon + Jev (from 2026-10-28 until Nathan says otherwise, Nic's test): bulk new code (3+ files / 300+ lines) goes through `/argon` with `test_cmd: npx vitest run --reporter=dot`. Every change gets `jev [--spec "…"] [ref]` on the changed files before `review:haiku`; log what each caught in DEVLOG.

## Deploy
- `main` → `gloop.obfusco.us`, `dev/*` → `gloop-dev.obfusco.us`, via `.github/workflows/deploy.yml` (GitHub Actions → S3 → CloudFront).
- Private S3 buckets (`gloop.obfusco.us`, `gloop-dev.obfusco.us`), each fronted by its own CloudFront distribution (prod `E1OR0VU2T3D7I5`, dev `E1EW5T5VWLL28W`) via Origin Access Control — not S3 static website hosting. Bucket policy scopes `s3:GetObject` to each distribution's ARN only.
- Shared `*.obfusco.us` wildcard ACM cert (us-east-1), CachingOptimized managed cache policy, 404→`/index.html` (200) custom error response for SPA routing, Route53 A-alias records in the `obfusco.us` hosted zone.
- Deploy credentials: dedicated IAM user `github-actions-gloop` (own inline policy scoped only to gloop's 2 buckets + 2 distributions) — intentionally *not* the shared `github-actions-moomaw` user other lineage projects use, since that user was already at AWS's 2-access-key limit and rotating a key would have risked breaking other live sites. GitHub secrets `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set on this repo.
