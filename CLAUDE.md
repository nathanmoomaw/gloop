# GLOOP

## Project Overview
GLOOP is a granular synthesis echo loopback device — part of the ribbon/puddle/audness lineage (see `~/Sites/LIFE/LINEAGE.md`). It listens to the mic, chops what it hears into short grains, and replays them through a feedback delay network so the room's own sound becomes a granular echo. Visualized as rainbow sand grains settling into Chladni-plate nodal patterns on a vibrating speaker.

## Tech Stack
- Vite + React 19, no backend
- Web Audio API: `ScriptProcessor` grain capture → grain pool → randomized playback through per-grain delay/feedback/pan (see `src/audio/engine.js`)
- three.js (WebGL) for the grain-field visualization (see `src/components/GrainField.jsx`) — a rippling plate mesh driven by the same Chladni nodal math as the grains, with grains rendered as glowing 3D points hovering just above the live surface height. Not audness-powered — see Audness note below.

## Status
Scaffold stage (2026-07-12). Core mic → grain → feedback loop and Chladni-driven visualization are implemented as a first pass. Deploy infra provisioned 2026-07-23.

## Audness
GLOOP does **not** use `@audness/core` and shouldn't — audness is a synth-voice engine (oscillators, VCF, delay/reverb, bitcrush) for the puddle v2+/ribbon v4+ lineage, with no mic-capture or granular-synthesis support at all. GLOOP's actual needs (live mic ingestion, grain-pool capture, per-grain delay/feedback/pan network) are a different problem than what audness solves; `src/audio/engine.js` is intentionally bespoke. `LIFE/LINEAGE.md` places GLOOP directly under ribbon, not under audness, consistent with this.

## Conventions
- DUMP.md is a symlink to `~/Sites/LIFE/dumps/gloop.md` — gitignored here, lives privately in LIFE.
- `/dump` here follows the same 3-step pattern as other lineage projects (see `.claude/commands/dump.md`).
- ETHOS.md / MYTHOS.md hold direction and narrative; update DEVLOG.md and ROADMAP.md as work lands.

## Deploy
- `main` → `gloop.obfusco.us`, `dev/*` → `gloop-dev.obfusco.us`, via `.github/workflows/deploy.yml` (GitHub Actions → S3 → CloudFront).
- Private S3 buckets (`gloop.obfusco.us`, `gloop-dev.obfusco.us`), each fronted by its own CloudFront distribution (prod `E1OR0VU2T3D7I5`, dev `E1EW5T5VWLL28W`) via Origin Access Control — not S3 static website hosting. Bucket policy scopes `s3:GetObject` to each distribution's ARN only.
- Shared `*.obfusco.us` wildcard ACM cert (us-east-1), CachingOptimized managed cache policy, 404→`/index.html` (200) custom error response for SPA routing, Route53 A-alias records in the `obfusco.us` hosted zone.
- Deploy credentials: dedicated IAM user `github-actions-gloop` (own inline policy scoped only to gloop's 2 buckets + 2 distributions) — intentionally *not* the shared `github-actions-moomaw` user other lineage projects use, since that user was already at AWS's 2-access-key limit and rotating a key would have risked breaking other live sites. GitHub secrets `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set on this repo.
